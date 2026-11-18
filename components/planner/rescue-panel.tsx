'use client';
import { useEffect, useRef, useState } from 'react';
import { emptyProfile, type StudentProfile } from '@/lib/eligibility/types';
import { snapshotEvidence } from '@/lib/availability/evidence';
import { detectProblems } from '@/lib/recovery/problems';
import { draftSignature, protectedSections } from '@/lib/recovery/state';
import type { Repair, RescueDraft, RescueRequest, RescueResult } from '@/lib/recovery/types';
import { excludedIndexIds } from '@/lib/scheduling/selection';
import type { GenerationSettings } from './generation-controls';
import { RegistrationReadiness } from './registration-readiness';
import { RescueResults } from './rescue-results';

// Rescue has distinct problem/protection approval state; search, calendar, and scoring stay shared.
export function RescuePanel({ sourceId, draft, profile = emptyProfile, settings, ready, onApply }: {
  sourceId: string; draft: RescueDraft; profile: StudentProfile; settings: GenerationSettings; ready: boolean;
  onApply: (repair: Repair, basis: string, overrides: string[]) => boolean;
}) {
  const [replace, setReplace] = useState<string[]>([]), [overrides, setOverrides] = useState<string[]>([]);
  const [checkAvailability, setCheckAvailability] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [response, setResponse] = useState<{ result: RescueResult; context: string; serial: number; draft: RescueDraft } | null>(null);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  const context = JSON.stringify({ draft: draftSignature(draft), profile, settings, replace, overrides, checkAvailability });
  const protections = protectedSections(draft);
  const base: RescueRequest = { sectionIds: draft.selections.map(s => s.section.id), statuses: draft.statuses, replaceSectionIds: replace.filter(id => draft.selections.some(s => s.section.id === id)), overrideProtectionIds: overrides.filter(id => protections.includes(id)),
    settings: { choices: [], constraints: { ...settings.hard, lockedSectionIds: draft.locks }, weights: settings.weights, preferredInstructors: settings.instructors.split('\n').map(s => s.trim()).filter(Boolean), eligibility: { profile, excludeConfirmed: true } } };
  const detected = detectProblems(draft, base, snapshotEvidence(sourceId));
  async function search(): Promise<void> {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setPending(true); setError('');
    try {
      const request = { ...base, settings: { ...base.settings, constraints: { ...base.settings.constraints, excludedSectionIds: excludedIndexIds(settings.excludedIndexes, sourceId) } } };
      const answer = await fetch('/api/planner/rescue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, sourceId, checkAvailability }), signal: abort.signal });
      const result = await answer.json();
      if (!answer.ok) throw new Error(result.error || 'Unable to search for repairs.');
      if (!abort.signal.aborted) setResponse({ result, context, serial: ++serial.current, draft });
    } catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Connection failed. Retry Rescue; your draft is unchanged.'); }
    finally { if (controller.current === abort) setPending(false); }
  }
  return <details className="rescue-panel" id="rescue-panel"><summary>Rescue schedule · protect what already works</summary>
    <p>One section failed? Start with the smallest repair. No proposed change is applied without your approval.</p>
    <p className="muted">Registered means self-reported, not verified by WebReg. Original courses, registered sections, and manual locks stay protected. Hard constraints and preference weights come from the generator controls below.</p>
    <h3>Protected sections</h3><p className="muted">{protections.length ? draft.selections.filter(s => protections.includes(s.section.id)).map(s => `${s.course.code} · index ${s.section.index}${draft.statuses[s.section.id] === 'registered' ? ' (registered self-report)' : ' (locked)'}`).join('; ') : 'No registered or locked sections reported.'}</p>
    <details><summary>Current section restrictions and official next steps</summary><RegistrationReadiness selections={draft.selections} profile={profile} /></details>
    <h3>What needs attention?</h3>
    {detected.length ? <ul className="generation-notes">{detected.map((p, i) => <li key={i}><strong>{p.sectionId.split(':').at(-1)} · {p.source === 'student' ? 'Your report' : `Detected from ${p.source}`}: </strong>{p.message}</li>)}</ul> : <p className="muted">No confirmed problem detected. Request a replacement below or mark the failed section in your manual schedule.</p>}
    <fieldset><legend>Request a replacement · optional</legend><div className="generation-checks">{draft.selections.map(s => <label key={s.section.id}><input type="checkbox" checked={replace.includes(s.section.id)} onChange={e => setReplace(e.target.checked ? [...replace, s.section.id] : replace.filter(id => id !== s.section.id))} />{s.course.code} · {s.section.index}</label>)}</div></fieldset>
    <label className="academic-checkbox"><input type="checkbox" checked={checkAvailability} onChange={e => setCheckAvailability(e.target.checked)} />Try a server-side SOC check · cached for 60 seconds, no polling</label>
    <p className="muted">The open-sections endpoint’s campus scope is currently unverified. A successful retrieval is timestamped, but repairs still use snapshot availability. No seat or registration is guaranteed.</p>
    <button className="button" disabled={!ready || !draft.selections.length || pending} onClick={() => void search()}>{pending ? 'Searching for small repairs…' : 'Find minimum-change repairs'}</button>
    {!ready && <p className="muted">Resolve missing sections or earlier registered reports before Rescue can safely search.</p>}
    {error && <p role="alert" className="snapshot-note">{error} Your selected sections and protections are unchanged.</p>}
    {response && <>
      <RescueResults key={response.serial} result={response.result} draft={response.draft} profile={profile} overrides={base.overrideProtectionIds} stale={response.context !== context || pending || !ready} onApply={onApply} />
      {!response.result.repairs.length && !!protections.length && <details className="protection-overrides"><summary>Explicitly authorize exploring protected changes</summary>
        <p className="muted">This only authorizes exploration. Applying any protected change requires a second explicit approval. BetterCSP never drops a registered class in WebReg.</p>
        {draft.selections.filter(s => protections.includes(s.section.id)).map(s => <label className="academic-checkbox" key={s.section.id}><input type="checkbox" checked={overrides.includes(s.section.id)} onChange={e => setOverrides(e.target.checked ? [...overrides, s.section.id] : overrides.filter(id => id !== s.section.id))} />I authorize exploring changes to {s.course.code}, index {s.section.index} ({draft.statuses[s.section.id] === 'registered' ? 'registered self-report' : 'manual lock'}).</label>)}
      </details>}
    </>}
  </details>;
}
