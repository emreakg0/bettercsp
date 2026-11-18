'use client';
import { useEffect, useRef, useState } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import type { AcademicPlanningProfile } from '@/lib/academic/profile';
import { snapshotEvidence } from '@/lib/availability/evidence';
import { detectProblems } from '@/lib/recovery/problems';
import { draftSignature, protectedSections } from '@/lib/recovery/state';
import type { Repair, RescueDraft, RescueRequest, RescueResult } from '@/lib/recovery/types';
import { findConflicts } from '@/lib/scheduling/meetings';
import { excludedIndexIds, type Selection } from '@/lib/scheduling/selection';
import type { GenerationSettings } from './generation-controls';
import { RegistrationReadiness } from './registration-readiness';
import { RescueGuidance, rescueReasons, type RescueReason } from './rescue-intake';
import { RescueResults } from './rescue-results';
import { RescueCourseFallbacks } from './rescue-course-fallbacks';
import { RegistrationIndex } from './registration-index';

export function RescuePanel({ sourceId, draft, profile, academic, settings, ready, restored, active, sectionIndex, onSelectSection, onFindCourse, onReviewSchedule, onApply, onApplyCourse, onPlanLater }: {
  sourceId: string; draft: RescueDraft; profile: StudentProfile; settings: GenerationSettings; ready: boolean;
  academic: AcademicPlanningProfile; active: boolean; restored: boolean; sectionIndex: string;
  onSelectSection: (index: string) => void; onFindCourse: () => void; onReviewSchedule: () => void;
  onApply: (repair: Repair, basis: string, overrides: string[]) => boolean;
  onApplyCourse: (targetId: string, replacement: Selection, basis: string) => boolean;
  onPlanLater: (code: string) => void;
}) {
  const [diagnosis, setDiagnosis] = useState<{ index: string; reason: RescueReason | '' } | null>(null);
  const [extra, setExtra] = useState<{ index: string; ids: string[] } | null>(null);
  const [authorization, setAuthorization] = useState<{ scope: string; ids: string[] } | null>(null);
  const [checkAvailability, setCheckAvailability] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ context: string; message: string } | null>(null);
  const [response, setResponse] = useState<{ result: RescueResult; context: string; scope: string; serial: number; draft: RescueDraft; goal: string } | null>(null);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  const repairSettings = useRef<HTMLDetailsElement>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const affected = draft.selections.find(s => s.section.index === sectionIndex);
  const sectionId = affected?.section.id ?? '';
  const additional = extra?.index === sectionIndex ? extra.ids : [];
  const status = draft.statuses[sectionId];
  const reason = diagnosis?.index === sectionIndex ? diagnosis.reason : status === 'failed' ? 'rejected' : status === 'needs-permission' ? 'permission' : '';
  const conflicts = reason === 'conflict' && affected
    ? findConflicts(draft.selections.map(s => s.section)).filter(c => c.firstId === sectionId || c.secondId === sectionId)
    : [];
  const replacement = reason !== 'conflict';
  const canSearch = !!affected && (replacement || conflicts.length > 0);
  const protections = protectedSections(draft);
  const replaceSectionIds = replacement && affected
    ? [sectionId, ...additional.filter(id => id !== sectionId && draft.selections.some(s => s.section.id === id))] : [];
  const scope = JSON.stringify({ draft: draftSignature(draft), profile, settings, reason, sectionId, replaceSectionIds, checkAvailability });
  const overrides = authorization?.scope === scope ? authorization.ids : [];
  const context = JSON.stringify([scope, overrides]);
  const base: RescueRequest = {
    sectionIds: draft.selections.map(s => s.section.id), statuses: draft.statuses, replaceSectionIds, overrideProtectionIds: overrides,
    settings: { choices: [], constraints: { ...settings.hard, lockedSectionIds: draft.locks }, weights: settings.weights,
      preferredInstructors: settings.instructors.split('\n').map(s => s.trim()).filter(Boolean), eligibility: { profile, excludeConfirmed: true } },
  };

  function clearIntakeChange(): void {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setExtra(null);
    setAuthorization(null);
    setResponse(null);
    setError(null);
  }
  async function search(): Promise<void> {
    if (!canSearch || !affected || !ready || !active || pending || draft.selections.length > 12) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const goal = reason === 'conflict'
      ? 'Resolve the meeting overlap involving ' + affected.course.code
      : reason === 'closed' ? 'Find an alternative to the reported closed section of ' + affected.course.code
        : reason === 'permission' ? 'Find another section while you verify permission for ' + affected.course.code
          : 'Find another section of ' + affected.course.code;
    setPending(true);
    setError(null);
    try {
      const request = { ...base, settings: { ...base.settings, constraints: {
        ...base.settings.constraints, excludedSectionIds: excludedIndexIds(settings.excludedIndexes, sourceId),
      } } };
      const answer = await fetch('/api/planner/rescue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, sourceId, checkAvailability }), signal: abort.signal });
      const result = await answer.json();
      if (!answer.ok) throw new Error(result.error || 'Unable to search for repairs.');
      if (!abort.signal.aborted) setResponse({ result, context, scope, serial: ++serial.current, draft, goal });
    } catch (err) {
      if (!abort.signal.aborted) setError({ context, message: err instanceof Error ? err.message : 'Connection failed. Try searching again.' });
    } finally {
      if (controller.current === abort) setPending(false);
    }
  }

  return <section hidden={!active} className="rescue-panel" id="rescue-panel" aria-labelledby="planner-rescue-heading">
    <h2 id="planner-rescue-heading" tabIndex={-1}>Registration Rescue</h2>
    <p>Choose the class that didn’t work. Registered and locked sections stay protected.</p>
    {!restored ? <p role="status">Load your saved schedule to use Rescue.</p> : !draft.selections.length ? <div className="schedule-status">
      <h3>Start with a section</h3>
      <p>Search for the affected course and choose a specific section. Add any sections you already registered for and mark them as Registered in your saved schedule. Rescue needs a plan to know what to preserve.</p>
      <button className="button" onClick={onFindCourse}>Find the affected course</button>
    </div> : <>
      <label className="rescue-field">Which section is affected?
        <select value={affected?.section.index ?? ''} onChange={event => { onSelectSection(event.target.value); clearIntakeChange(); }}>
          <option value="">Choose a section from your saved schedule</option>
          {draft.selections.map(s => <option value={s.section.index} key={s.section.id}>{s.course.title} ({s.course.code}) · Section {s.section.number} · Index {s.section.index}</option>)}
        </select>
      </label>
      {sectionIndex && !affected && <p role="status">That section is no longer in My Schedule. Choose a saved section above or <button className="text-button" onClick={onFindCourse}>find the affected course</button>.</p>}
      {affected && <>
        <p><RegistrationIndex key={sectionId} index={affected.section.index} /> · {draft.selections.filter(s => draft.statuses[s.section.id] === 'registered').length} marked registered · {draft.locks.length} manually locked. <button className="text-button" onClick={onReviewSchedule}>Review registration reports</button></p>
        <RescueCourseFallbacks key={sectionId} sourceId={sourceId} draft={draft} target={affected} academic={academic} active={active}
          profile={profile} request={base} excludedIndexes={settings.excludedIndexes} ready={ready} onApply={onApplyCourse} onPlanLater={onPlanLater}
          onMoreRepairs={() => {
            if (repairSettings.current) { repairSettings.current.open = true; repairSettings.current.querySelector('summary')?.focus(); }
            if (!protections.includes(sectionId) && response?.context !== context) void search();
          }} />
        <details><summary>Why might registration have failed?</summary>
          <label className="rescue-field">What went wrong with registration?
            <select value={reason} onChange={event => { setDiagnosis({ index: sectionIndex, reason: event.target.value as RescueReason | '' }); clearIntakeChange(); }}>
              <option value="">Choose a situation</option>
              {Object.entries(rescueReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {reason && <RescueGuidance reason={reason} affected={affected} selections={draft.selections} conflicts={conflicts} profile={profile} />}
          <details><summary>Other known restrictions and source notes</summary>
            <RegistrationReadiness selections={[affected]} profile={profile} />
            <ul className="generation-notes">{detectProblems(draft, base, snapshotEvidence(sourceId))
              .filter(problem => problem.sectionId === sectionId)
              .map((problem, index) => <li key={index}><strong>{problem.source === 'student' ? 'Your report' : problem.source} · </strong>{problem.message}</li>)}</ul>
          </details>
        </details>
        <details ref={repairSettings}><summary>More repair options</summary>
          <p className="muted">These protections include self-reported registrations and manual locks. Repair uses your planner preferences and hard constraints.</p>
          <ul className="generation-notes">{draft.selections.filter(s => protections.includes(s.section.id)).map(s =>
            <li key={s.section.id}>{s.course.code} · section {s.section.number} · index {s.section.index}</li>)}</ul>
          {replacement && draft.selections.length > 1 && <fieldset><legend>Also request a different section for</legend>
            <div className="generation-checks">{draft.selections.filter(s => s.section.id !== sectionId).map(s => <label key={s.section.id}>
              <input type="checkbox" checked={additional.includes(s.section.id)} onChange={e => setExtra({ index: sectionIndex, ids: e.target.checked ? [...additional, s.section.id] : additional.filter(id => id !== s.section.id) })} />{s.course.code} · section {s.section.number}
            </label>)}</div></fieldset>}
          <label className="academic-checkbox"><input type="checkbox" checked={checkAvailability} onChange={e => setCheckAvailability(e.target.checked)} />Try a server-side SOC check</label>
          <p className="muted">Seat information remains snapshot-based because the endpoint’s campus scope is unverified.</p>
          {!canSearch && <p className="muted">No known timetable overlap involving this section. To request a replacement anyway, choose “I need to replace a section” under registration guidance.</p>}
          {canSearch && <button className="button" disabled={!ready || draft.selections.length > 12 || pending} onClick={() => void search()}>{pending ? 'Searching for small repairs…' : 'Find minimum-change repairs'}</button>}
          {error?.context === context && <p role="alert" className="snapshot-note">{error.message} Your selected sections and protections are unchanged.</p>}
          {response && <>
            <RescueResults key={response.serial} result={response.result} goal={response.goal} draft={response.draft} profile={profile} overrides={overrides} stale={response.context !== context || pending || !ready || !canSearch} onApply={onApply} />
            {canSearch && response.scope === scope && !response.result.repairs.length && !!protections.length && <details className="protection-overrides">
              <summary>Explicitly authorize exploring protected changes</summary>
              <p className="muted">This only authorizes exploration. Applying any protected change requires separate approval. BetterCSP never drops a class in WebReg.</p>
              {draft.selections.filter(s => protections.includes(s.section.id)).map(s => <label className="academic-checkbox" key={s.section.id}>
                <input type="checkbox" checked={overrides.includes(s.section.id)} onChange={e => setAuthorization({ scope, ids: e.target.checked ? [...overrides, s.section.id] : overrides.filter(id => id !== s.section.id) })} />I authorize exploring changes to {s.course.code}, index {s.section.index} ({draft.statuses[s.section.id] === 'registered' ? 'registered self-report' : 'manual lock'}).
              </label>)}
            </details>}
          </>}
        </details>
      </>}
    </>}
  </section>;
}
