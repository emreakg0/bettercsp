'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import type { PlanningContext } from '@/lib/eligibility/preflight';
import type { RegistrationStatuses } from '@/lib/recovery/types';
import type { GenerationResult, HardConstraints, RankedSchedule } from '@/lib/scheduling/generation-types';
import { excludedIndexIds, type Selection } from '@/lib/scheduling/selection';
import { GenerationControls, type GenerationSettings } from './generation-controls';
import { GenerationResults } from './generation-results';

export interface GeneratorChoice { courseId: string; code: string; title: string; required: boolean; campuses: string[]; keepSection?: boolean }
// New orchestration is limited to generation requests; manual persistence remains workspace-owned.
export function ScheduleGenerator({ sourceId, choices, onChoicesChange, selections, locks, statuses, ready, onApply, profile, planning, preflightConstraints, settings, onSettingsChange, picker, active, onRemoveCourse, onSearch, onReviewSchedule }: {
  planning: PlanningContext; preflightConstraints: HardConstraints | null; statuses: RegistrationStatuses;
  picker: ReactNode; active: boolean; onRemoveCourse: (courseId: string) => void; onSearch: () => void; onReviewSchedule: () => void;
  settings: GenerationSettings; onSettingsChange: (settings: GenerationSettings) => void; profile: StudentProfile; sourceId: string; choices: GeneratorChoice[]; onChoicesChange: (choices: GeneratorChoice[]) => void;
  selections: Selection[]; locks: string[]; ready: boolean;
  onApply: (schedule: RankedSchedule, targetIds: string[], rescueSectionId?: string) => boolean;
}) {
  const [excludeConfirmed, setExcludeConfirmed] = useState(false);
  const [pending, setPending] = useState<'initial' | 'more' | null>(null), [error, setError] = useState('');
  const [pageError, setPageError] = useState<{ message: string; restart: boolean } | null>(null);
  const [response, setResponse] = useState<{ result: GenerationResult; basis: string; serial: number; emptyBatch?: boolean } | null>(null);
  const controller = useRef<{ abort: AbortController; more: boolean } | null>(null), consumed = useRef<string | null>(null), serial = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const requestBasis = (picks: GeneratorChoice[]) => JSON.stringify({ choices: picks, settings, profile, excludeConfirmed, selections: selections.map(s => s.section.id), locks });
  const basis = requestBasis(choices);
  const sectionsByCourse = new Map(selections.map(item => [item.course.id, item.section]));
  const canRelease = (choice: GeneratorChoice) => {
    const selection = sectionsByCourse.get(choice.courseId);
    return !!choice.keepSection && !!selection && !locks.includes(selection.id);
  };
  const hasPins = choices.some(canRelease);
  const allFixed = choices.length > 0 && choices.every(choice => {
    const selected = sectionsByCourse.get(choice.courseId);
    return !!selected && (choice.keepSection || locks.includes(selected.id));
  });
  const outsideBuild = selections.some(selection => !choices.some(choice => choice.courseId === selection.course.id));
  useEffect(() => () => controller.current?.abort.abort(), []);
  useEffect(() => () => {
    if (controller.current?.more) controller.current.abort.abort();
  }, [basis, ready, active]);
  const campuses = [...new Set([...choices.flatMap(c => c.campuses), ...selections.flatMap(s => s.section.meetings.map(m => m.campus))].map(c => c.toUpperCase()))].filter(Boolean).sort();
  async function generate(more = false, picks = choices): Promise<void> {
    const cursor = more ? response?.result.discovery?.nextCursor : null;
    if (!active || !ready || pending || controller.current || (more && (!cursor || cursor === consumed.current || response?.basis !== basis))) return;
    const searchBasis = requestBasis(picks);
    const abort = new AbortController();
    controller.current = { abort, more };
    setPageError(null);
    if (!more) consumed.current = null;
    setPending(more ? 'more' : 'initial');
    setError('');
    if (!more) heading.current?.focus();
    try {
      const excluded = excludedIndexIds(settings.excludedIndexes, sourceId);
      const contextualLocks = selections.filter(s => !picks.some(c => c.courseId === s.course.id && !c.keepSection)).map(s => s.section.id);
      const payload = { sourceId, discoveryCursor: cursor, eligibility: { profile, excludeConfirmed }, choices: picks.map(({ courseId, required }) => ({ courseId, required })),
        constraints: { ...settings.hard, excludedSectionIds: excluded, lockedSectionIds: [...new Set([...locks, ...contextualLocks])] },
        weights: settings.weights, preferredInstructors: settings.instructors.split('\n').map(s => s.trim()).filter(Boolean) };
      const request = await fetch('/api/planner/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: abort.signal });
      const body = await request.json();
      if (more && request.status === 409 && !abort.signal.aborted) {
        setPageError({ message: 'This continuation expired or changed. Generate schedules again to continue.', restart: true });
        return;
      }
      if (!request.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Generation failed. Retry with fewer courses.');
      if (abort.signal.aborted) return;
      const result = body as GenerationResult;
      if (more) {
        if (result.discovery?.nextCursor === cursor) throw new Error('The next batch did not advance. Please retry.');
        consumed.current = cursor ?? null;
        setResponse(current => {
          if (current?.basis !== searchBasis || current.result.discovery?.nextCursor !== cursor) return current;
          const seen = new Set(current.result.schedules.map(schedule => schedule.id));
          const additions = result.schedules.filter(schedule => !seen.has(schedule.id));
          return { ...current, emptyBatch: !additions.length, result: { ...result, schedules: [...current.result.schedules, ...additions] } };
        });
      } else {
        setResponse({ result, basis: searchBasis, serial: ++serial.current });
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        if (more) setPageError({ message: 'Could not load the next batch. Your current schedule is still available.', restart: false });
        else setError(err instanceof Error ? err.message : 'Unable to generate. Check your connection and retry.');
      }
    } finally {
      if (controller.current?.abort === abort) { controller.current = null; setPending(null); }
    }
  }
  function allowOtherSections(regenerate = false): void {
    const flexible = choices.map(choice => canRelease(choice) ? { ...choice, keepSection: false } : choice);
    onChoicesChange(flexible);
    if (regenerate) void generate(false, flexible);
  }
  return <>
    <div className="planner-workflow-actions"><span>{choices.length} {choices.length === 1 ? 'course' : 'courses'} added · up to 12</span>
      <button className="button" disabled={!ready || !!pending || (!choices.length && !locks.length)} onClick={() => void generate()}>{pending === 'initial' ? 'Generating schedules…' : 'Generate schedules'}</button>
    </div>
    <div className="planner-workspace">
    <section className="planner-courses" aria-label="Find and add courses">
      {picker}
      <section className="schedule-generator" aria-label="Automatic schedule generator">
        <h2>Your courses <span className="count">{choices.length}</span></h2>
        {!choices.length && <p className="muted">Search above and choose “Add course”. Nothing is saved until you choose a section or apply a schedule.</p>}
        {outsideBuild && <p className="muted">Saved sections outside Build stay fixed in previews. <button className="text-button" onClick={onReviewSchedule}>Review My Schedule</button></p>}
        {hasPins && <button className="text-button" onClick={() => allowOtherSections()}>Allow other sections for unprotected courses</button>}
        <ul className="generator-choices">{choices.map(choice => {
          const selected = selections.find(s => s.course.id === choice.courseId);
          const protectedSection = selected && locks.includes(selected.section.id);
          return <li key={choice.courseId}>
            <div><strong>{choice.code}</strong> · {choice.title}{selected && <small>Section {selected.section.number} · {protectedSection
              ? statuses[selected.section.id] === 'registered' ? 'Registered (protected)' : 'Locked (protected)'
              : choice.keepSection ? 'Kept for generation' : 'Flexible in previews'}</small>}
              {selected && !protectedSection && <label className="generation-keep"><input type="checkbox" checked={!!choice.keepSection}
                onChange={e => onChoicesChange(choices.map(c => c.courseId === choice.courseId ? { ...c, keepSection: e.target.checked } : c))} />Keep section {selected.section.number} for {choice.code}</label>}
            </div>
            <details><summary>Course options</summary>
              <label><input type="checkbox" checked={choice.required || (!!selected && (!!choice.keepSection || !!protectedSection))} disabled={!!selected && (!!choice.keepSection || !!protectedSection)} onChange={e => onChoicesChange(choices.map(c => c.courseId === choice.courseId ? { ...c, required: e.target.checked } : c))} />Required course</label>
              {protectedSection && <p className="muted">Review this protection in My Schedule.</p>}
              <button className="text-button" onClick={() => onRemoveCourse(choice.courseId)}>Remove {choice.code} from Build</button>
            </details>
          </li>;
        })}</ul>
      </section>
    </section>
    <section className="planner-schedule" aria-label="Schedule preview">
        <div className="results-heading generation-heading"><h2 ref={heading} tabIndex={-1}>Schedule options</h2><button className="text-button" onClick={onSearch}>Back to course search</button></div>
        <details className="result-preferences" open={!response}><summary>Edit schedule preferences</summary>
        <GenerationControls value={settings} onChange={onSettingsChange} campuses={campuses} />
        <details className="eligibility-settings"><summary>Eligibility filtering · optional</summary>
          <label className="academic-checkbox"><input type="checkbox" checked={excludeConfirmed} onChange={e => setExcludeConfirmed(e.target.checked)} />Exclude confirmed mismatches against my academic information</label>
          <p className="muted">Unknown eligibility and permission requirements remain visible. Edit your <a className="back-link" href="#academic-planning-profile">academic planning profile</a> to add registration information. A protected incompatible section can prevent results.</p>
        </details>
        </details>
        {!ready && <p role="status" className="muted">Before generating, resolve missing sections or earlier registration reports in <button className="text-button" onClick={onReviewSchedule}>My Schedule</button>.</p>}
        {error && <p role="alert" className="snapshot-note">{error} Your saved schedule is unchanged.</p>}

        {pending === 'initial' && <p role="status" className="muted">Finding schedules for your courses… Your saved schedule is unchanged.</p>}
        {!response && !pending && <div className="schedule-status"><p>Add your courses, then generate schedules to compare possible weeks. Your saved schedule stays as it is until you apply a result.</p></div>}
        {response && <GenerationResults key={response.serial} result={response.result} stale={response.basis !== basis} canApply={ready && pending !== 'initial'} profile={profile} planning={planning} preflightConstraints={preflightConstraints} protectedIds={locks} loadingMore={pending === 'more'}
          canExplore={active && ready && pending !== 'initial'} pageError={pageError} onExplore={() => void generate(true)} emptyBatch={!!response.emptyBatch}
          allFixed={allFixed} onTryOtherSections={hasPins ? () => allowOtherSections(true) : undefined} onReviewSchedule={onReviewSchedule}
          onApply={(schedule, rescueSectionId) => { onApply(schedule, choices.map(c => c.courseId), rescueSectionId); }} />}
    </section>
    </div>
  </>;
}
