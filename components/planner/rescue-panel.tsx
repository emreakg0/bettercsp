'use client';
import { useEffect, useRef, useState } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import { snapshotEvidence } from '@/lib/availability/evidence';
import { detectProblems } from '@/lib/recovery/problems';
import { draftSignature, protectedSections } from '@/lib/recovery/state';
import type { Repair, RescueDraft, RescueRequest, RescueResult } from '@/lib/recovery/types';
import { findConflicts } from '@/lib/scheduling/meetings';
import { excludedIndexIds } from '@/lib/scheduling/selection';
import type { GenerationSettings } from './generation-controls';
import { RegistrationReadiness } from './registration-readiness';
import { RescueGuidance, rescueReasons, type RescueReason } from './rescue-intake';
import { RescueResults } from './rescue-results';

export function RescuePanel({ sourceId, draft, profile, settings, ready, initialSectionId, initialReason, onFindCourse, onReviewSchedule, onApply }: {
  sourceId: string; draft: RescueDraft; profile: StudentProfile; settings: GenerationSettings; ready: boolean;
  initialSectionId?: string; initialReason?: RescueReason; onFindCourse: () => void; onReviewSchedule: () => void;
  onApply: (repair: Repair, basis: string, overrides: string[]) => boolean;
}) {
  const [reason, setReason] = useState<RescueReason | ''>(initialReason ?? '');
  const [sectionId, setSectionId] = useState(initialSectionId ?? '');
  const [additional, setAdditional] = useState<string[]>([]);
  const [authorization, setAuthorization] = useState<{ scope: string; ids: string[] } | null>(null);
  const [checkAvailability, setCheckAvailability] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ context: string; message: string } | null>(null);
  const [response, setResponse] = useState<{ result: RescueResult; context: string; scope: string; serial: number; draft: RescueDraft; goal: string } | null>(null);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  const affected = draft.selections.find(s => s.section.id === sectionId);
  const conflicts = reason === 'conflict' && affected
    ? findConflicts(draft.selections.map(s => s.section)).filter(c => c.firstId === sectionId || c.secondId === sectionId)
    : [];
  const replacement = reason === 'closed' || reason === 'replace' || reason === 'permission';
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
    setAdditional([]);
    setAuthorization(null);
    setResponse(null);
    setError(null);
  }
  async function search(): Promise<void> {
    if (!canSearch || !affected || !ready || pending) return;
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

  return <details className="rescue-panel" id="rescue-panel">
    <summary id="rescue-entry">Registration Rescue — Something went wrong?</summary>
    <p>Get help with a registration problem. Courses you mark as registered stay protected unless you explicitly approve a change.</p>
    <label className="rescue-field">What went wrong with registration?
      <select value={reason} onChange={event => { setReason(event.target.value as RescueReason | ''); clearIntakeChange(); }}>
        <option value="">Choose a situation</option>
        {Object.entries(rescueReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {!draft.selections.length ? <div className="schedule-status">
      <h3>Start with a section</h3>
      <p>Search for the affected course and choose a specific section. Add any sections you already registered for and mark them as Registered in your saved schedule. Rescue needs a plan to know what to preserve.</p>
      <button className="button" onClick={onFindCourse}>Find the affected course</button>
    </div> : <>
      {reason && <label className="rescue-field">Which section is affected?
        <select value={affected?.section.id ?? ''} onChange={event => { setSectionId(event.target.value); clearIntakeChange(); }}>
          <option value="">Choose a section from your saved schedule</option>
          {draft.selections.map(s => <option value={s.section.id} key={s.section.id}>{s.course.title} ({s.course.code}) · Section {s.section.number}</option>)}
        </select>
      </label>}
      {reason && affected && <RescueGuidance reason={reason} affected={affected} selections={draft.selections} conflicts={conflicts} profile={profile} />}
      {canSearch && <>
        <p>{draft.selections.filter(s => draft.statuses[s.section.id] === 'registered').length} marked registered · {draft.locks.length} manually locked. <button className="text-button" onClick={onReviewSchedule}>Review registration reports</button></p>
        <details><summary>Repair settings and protected sections</summary>
          <p className="muted">These protections include self-reported registrations and manual locks. Repair uses your planner preferences and hard constraints.</p>
          <ul className="generation-notes">{draft.selections.filter(s => protections.includes(s.section.id)).map(s =>
            <li key={s.section.id}>{s.course.code} · section {s.section.number} · index {s.section.index}</li>)}</ul>
          {replacement && draft.selections.length > 1 && <fieldset><legend>Also request a different section for</legend>
            <div className="generation-checks">{draft.selections.filter(s => s.section.id !== sectionId).map(s => <label key={s.section.id}>
              <input type="checkbox" checked={additional.includes(s.section.id)} onChange={e => setAdditional(e.target.checked ? [...additional, s.section.id] : additional.filter(id => id !== s.section.id))} />{s.course.code} · section {s.section.number}
            </label>)}</div></fieldset>}
          <label className="academic-checkbox"><input type="checkbox" checked={checkAvailability} onChange={e => setCheckAvailability(e.target.checked)} />Try a server-side SOC check</label>
          <p className="muted">Seat information remains snapshot-based because the endpoint’s campus scope is unverified.</p>
        </details>
        <button className="button" disabled={!ready || draft.selections.length > 12 || pending} onClick={() => void search()}>{pending ? 'Searching for small repairs…' : reason === 'permission' ? 'Look for another section instead' : 'Find minimum-change repairs'}</button>
        {draft.selections.length > 12 && <p className="muted">Rescue can compare up to 12 selected sections.</p>}
        {!ready && <p className="muted">Resolve missing sections or earlier registered reports in your saved schedule before searching.</p>}
      </>}
      <details><summary>Other known restrictions and source notes</summary>
        <RegistrationReadiness selections={affected ? [affected] : draft.selections} profile={profile} />
        <ul className="generation-notes">{detectProblems(draft, base, snapshotEvidence(sourceId))
          .filter(problem => !affected || problem.sectionId === sectionId)
          .map((problem, index) => <li key={index}><strong>{problem.source === 'student' ? 'Your report' : problem.source}: </strong>{problem.message}</li>)}</ul>
      </details>
    </>}
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
  </details>;
}
