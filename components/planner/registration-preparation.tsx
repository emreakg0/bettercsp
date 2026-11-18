import { useEffect, useRef, useState } from 'react';
import { degreeCourseMatches, rescueDegreeProgram } from '@/lib/academic/course-matches';
import type { AcademicPlanningProfile } from '@/lib/academic/profile';
import type { StudentProfile } from '@/lib/eligibility/types';
import { applicablePreparation, preparationLifetime, preparationLimit, preparationScope, preparedKey, readPreparation, type Preparation } from '@/lib/recovery/prepared';
import { protectedSections } from '@/lib/recovery/state';
import { registrationLabels, type RegistrationStatus, type RescueDraft, type RescueRequest } from '@/lib/recovery/types';
import type { HardConstraints } from '@/lib/scheduling/generation-types';
import type { Selection } from '@/lib/scheduling/selection';
import type { GenerationSettings } from './generation-controls';
import { RegistrationIndex } from './registration-index';
import { RescueCourseFallbacks } from './rescue-course-fallbacks';

export function RegistrationPreparation({ sourceId, catalogRevision, draft, academic, profile, settings, constraints, ready, onReport, onRescue, onApply, onPlanLater }: {
  sourceId: string; catalogRevision: string; draft: RescueDraft; academic: AcademicPlanningProfile; profile: StudentProfile;
  settings: GenerationSettings; constraints: HardConstraints | null; ready: boolean;
  onReport: (id: string, status: RegistrationStatus) => void; onRescue: (id: string) => void;
  onApply: (id: string, replacement: Selection, basis: string) => boolean; onPlanLater: (code: string) => void;
}) {
  const [saved, setSaved] = useState<{ scope: string; binding: string; cache: Preparation | null } | null>(null);
  const [mode, setMode] = useState(false);
  const [failureId, setFailureId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [memoryOnly, setMemoryOnly] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const backupHeading = useRef<HTMLHeadingElement>(null);
  const scope = preparationScope(sourceId, catalogRevision, draft, academic, settings);
  const key = preparedKey(sourceId);
  const current = saved?.scope === scope ? saved : null;
  const cache = current?.cache ?? null;

  useEffect(() => {
    const controller = new AbortController();
    async function restore(): Promise<void> {
      try {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
        const binding = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        let raw: string | null = null;
        try { raw = sessionStorage.getItem(key); } catch { /* Preparation can still stay in memory. */ }
        if (!controller.signal.aborted) setSaved({ scope, binding, cache: readPreparation(raw, sourceId, catalogRevision, binding) });
      } catch {
        if (!controller.signal.aborted) setError('This browser could not check prepared backups. You can still search in Rescue.');
      }
    }
    void restore();
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, [catalogRevision, key, scope, sourceId]);

  useEffect(() => {
    if (!cache) return;
    const timer = setTimeout(() => setSaved(previous => previous?.cache === cache ? { ...previous, cache: null } : previous),
      Math.max(0, cache.preparedAt + preparationLifetime - Date.now()));
    return () => clearTimeout(timer);
  }, [cache]);

  const locked = protectedSections(draft);
  const targets = draft.selections.filter(selection => !locked.includes(selection.section.id));
  const target = draft.selections.find(selection => selection.section.id === failureId && draft.statuses[failureId] === 'failed');
  const prepared = ready && target ? applicablePreparation(cache, draft, target, academic, profile, constraints) : null;
  const request: RescueRequest = {
    sectionIds: draft.selections.map(s => s.section.id), statuses: draft.statuses, replaceSectionIds: [], overrideProtectionIds: [],
    settings: { choices: [], constraints: { ...(constraints ?? settings.hard), lockedSectionIds: draft.locks }, weights: settings.weights,
      preferredInstructors: settings.instructors.split('\n').map(s => s.trim()).filter(Boolean), eligibility: { profile, excludeConfirmed: true } },
  };

  async function prepare(): Promise<void> {
    if (!current || requestRef.current || !ready || !constraints || draft.selections.length > preparationLimit || !targets.length) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError('');
    setMemoryOnly(false);
    const program = rescueDegreeProgram(academic, sourceId);
    const prepareBackups = targets.map(target => ({ targetId: target.section.id, candidateCodes: program
      ? degreeCourseMatches(program, academic, draft.selections.filter(item => item !== target).map(item => item.course.code), target.course.code).map(match => match.code)
      : [] }));
    try {
      const response = await fetch('/api/planner/rescue', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, sourceId, prepareBackups }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not prepare backups.');
      if (result.catalogRevision !== catalogRevision) throw new Error('The catalog changed. Reload the planner and prepare again.');
      const raw = JSON.stringify({ version: 1, sourceId, catalogRevision, binding: current.binding, preparedAt: Date.now(), entries: result.entries });
      const next = readPreparation(raw, sourceId, catalogRevision, current.binding);
      if (!next || next.entries.length !== targets.length || targets.some(item => !next.entries.some(entry => entry.targetId === item.section.id))) {
        throw new Error('The backup response could not be verified. Try preparing again.');
      }
      if (controller.signal.aborted) return;
      setSaved({ ...current, cache: next });
      try { sessionStorage.setItem(key, raw); } catch { setMemoryOnly(true); }
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not prepare backups.');
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setPending(false); }
    }
  }

  return <section className="registration-preparation schedule-status" aria-labelledby="registration-preparation-heading">
    <h3 id="registration-preparation-heading">Registration backups</h3>
    <div className="generation-actions">
      <button className="button" disabled={!current || !ready || !constraints || !targets.length || draft.selections.length > preparationLimit || pending}
        onClick={() => void prepare()}>{pending ? 'Preparing backups…' : 'Prepare registration backups'}</button>
      <button className="text-button" aria-expanded={mode} aria-controls="registration-mode" onClick={() => setMode(!mode)}>Registration Mode</button>
    </div>
    {!ready ? <p>Resolve unavailable sections or earlier registration reports before preparing.</p>
      : !constraints ? <p>Review the excluded indexes in Build before preparing.</p>
      : draft.selections.length > preparationLimit ? <p>Preparation supports up to {preparationLimit} selected sections.</p>
      : !targets.length ? <p>Add an unlocked, unregistered section to prepare backups.</p> : null}
    {pending && <p role="status">Checking alternatives while keeping all other sections fixed.</p>}
    {cache && <p role="status">Backups checked for {cache.entries.length} {cache.entries.length === 1 ? 'section' : 'sections'}. {memoryOnly
      ? 'Browser storage was unavailable. These backups work until you leave the page.' : 'Saved for this browser tab for up to 24 hours.'}</p>}
    {error && <p role="alert">{error} Your plan is unchanged.</p>}
    <p>Current seats are unverified. Check requirements and seats in Rutgers before registering.</p>
    <div id="registration-mode" hidden={!mode}>
      <h4>Registration Mode</h4>
      <p>Record what happened in WebReg. These buttons update the reports in My Schedule.</p>
      <ul className="generation-notes registration-mode-list">{draft.selections.map(({ course, section }) => {
        const status = draft.statuses[section.id] ?? 'planned';
        return <li key={section.id}>
          <strong>{course.code} · {course.title}</strong>{' · '}<RegistrationIndex index={section.index} />{' · '}{registrationLabels[status]}
          {draft.locks.includes(section.id) && ' · Locked'}
          <div>
            <button className="text-button" disabled={status === 'registered'} onClick={() => onReport(section.id, 'registered')}>Registered successfully<span className="sr-only"> for {course.code}</span></button>{' '}
            <button className="text-button" disabled={status === 'registered'} onClick={() => {
              onReport(section.id, 'failed');
              setFailureId(section.id);
              requestAnimationFrame(() => backupHeading.current?.focus());
            }}>Couldn’t register<span className="sr-only"> for {course.code}</span></button>
          </div>
        </li>;
      })}</ul>
      {mode && target && <div aria-label={'Backups for ' + target.course.code} role="region">
        <h4 ref={backupHeading} tabIndex={-1}>Backups for {target.course.code}</h4>
        {prepared ? <p role="status">Prepared alternatives for {target.course.code}</p>
          : <p role="status">{locked.includes(target.section.id) ? 'This section is protected. Review it in Rescue.'
            : cache ? 'No applicable prepared option for this section.'
              : 'No current backups for this plan. The cache may have expired or the plan or profile may have changed.'}</p>}
        <button className="text-button" onClick={() => onRescue(target.section.id)}>Search in Registration Rescue</button>
        <RescueCourseFallbacks key={target.section.id} sourceId={sourceId} draft={draft} target={target} academic={academic}
          profile={profile} request={request} excludedIndexes={settings.excludedIndexes} ready={ready} active={mode}
          preparedMode prepared={prepared} onPlanLater={onPlanLater} onMoreRepairs={() => onRescue(target.section.id)}
          onApply={(id, replacement, basis) => {
            const checked = applicablePreparation(cache, draft, target, academic, profile, constraints);
            const option = checked?.options.find(option => option.selection.section.id === replacement.section.id);
            return checked?.basis === basis && option ? onApply(id, option.selection, basis) : false;
          }} />
      </div>}
    </div>
  </section>;
}
