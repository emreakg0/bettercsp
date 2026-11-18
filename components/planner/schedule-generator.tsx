'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import type { PlanningContext } from '@/lib/eligibility/preflight';
import type { GenerationResult, HardConstraints, RankedSchedule } from '@/lib/scheduling/generation-types';
import { excludedIndexIds, type Selection } from '@/lib/scheduling/selection';
import { GenerationControls, type GenerationSettings } from './generation-controls';
import { GenerationResults } from './generation-results';

export interface GeneratorChoice { courseId: string; code: string; title: string; required: boolean; campuses: string[]; keepSection?: boolean }
// New orchestration is limited to generation requests; manual persistence remains workspace-owned.
export function ScheduleGenerator({ sourceId, choices, onChoicesChange, selections, locks, ready, onApply, profile, planning, preflightConstraints, onRescue, settings, onSettingsChange, picker, manualSchedule, view, scheduleView, onViewChange, onScheduleViewChange, onRemoveCourse }: {
  planning: PlanningContext; preflightConstraints: HardConstraints | null; onRescue: (sectionId: string) => void;
  picker: ReactNode; manualSchedule: ReactNode; view: 'courses' | 'calendar'; scheduleView: 'results' | 'saved';
  onViewChange: (view: 'courses' | 'calendar') => void; onScheduleViewChange: (view: 'results' | 'saved') => void; onRemoveCourse: (courseId: string) => void;
  settings: GenerationSettings; onSettingsChange: (settings: GenerationSettings) => void; profile: StudentProfile; sourceId: string; choices: GeneratorChoice[]; onChoicesChange: (choices: GeneratorChoice[]) => void;
  selections: Selection[]; locks: string[]; ready: boolean;
  onApply: (schedule: RankedSchedule, targetIds: string[]) => boolean;
}) {
  const [excludeConfirmed, setExcludeConfirmed] = useState(false);
  const [pending, setPending] = useState<'initial' | 'more' | null>(null), [error, setError] = useState('');
  const [pageError, setPageError] = useState<{ message: string; restart: boolean } | null>(null);
  const [response, setResponse] = useState<{ result: GenerationResult; basis: string; serial: number } | null>(null);
  const [applied, setApplied] = useState(false);
  const controller = useRef<{ abort: AbortController; more: boolean } | null>(null), consumed = useRef<string | null>(null), serial = useRef(0);
  const basis = JSON.stringify({ choices, settings, profile, excludeConfirmed, selections: selections.map(s => s.section.id), locks });
  useEffect(() => () => controller.current?.abort.abort(), []);
  useEffect(() => () => {
    if (controller.current?.more) controller.current.abort.abort();
  }, [basis, ready, scheduleView]);
  const campuses = [...new Set([...choices.flatMap(c => c.campuses), ...selections.flatMap(s => s.section.meetings.map(m => m.campus))].map(c => c.toUpperCase()))].filter(Boolean).sort();
  async function generate(more = false): Promise<void> {
    const cursor = more ? response?.result.discovery?.nextCursor : null;
    if (!ready || pending || controller.current || (more && (!cursor || cursor === consumed.current || response?.basis !== basis))) return;
    const abort = new AbortController();
    controller.current = { abort, more };
    setPageError(null);
    if (!more) consumed.current = null;
    setPending(more ? 'more' : 'initial');
    setError('');
    if (!more) { setApplied(false); onViewChange('calendar'); onScheduleViewChange('results'); }
    try {
      const excluded = excludedIndexIds(settings.excludedIndexes, sourceId);
      const contextualLocks = selections.filter(s => !choices.some(c => c.courseId === s.course.id && !c.keepSection)).map(s => s.section.id);
      const payload = { sourceId, discoveryCursor: cursor, eligibility: { profile, excludeConfirmed }, choices: choices.map(({ courseId, required }) => ({ courseId, required })),
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
          if (current?.basis !== basis || current.result.discovery?.nextCursor !== cursor) return current;
          const seen = new Set(current.result.schedules.map(schedule => schedule.id));
          return { ...current, result: { ...result, schedules: [...current.result.schedules, ...result.schedules.filter(schedule => !seen.has(schedule.id))] } };
        });
      } else {
        setResponse({ result, basis, serial: ++serial.current });
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
  return <>
    <div className="planner-workflow-actions"><span>{choices.length} {choices.length === 1 ? 'course' : 'courses'} added · up to 12</span>
      <button className="button" disabled={!ready || !!pending || (!choices.length && !locks.length)} onClick={() => void generate()}>{pending === 'initial' ? 'Generating schedules…' : 'Generate schedules'}</button>
    </div>
    <div className={`planner-workspace show-${view}`}>
    <section className="planner-courses" aria-label="Find and add courses">
      {picker}
      <section className="schedule-generator" aria-label="Automatic schedule generator">
        <h2>Your courses <span className="count">{choices.length}</span></h2>
        {!choices.length && <p className="muted">Search above and choose “Add course”. Your saved sections stay fixed unless you allow changes.</p>}
        <ul className="generator-choices">{choices.map(choice => {
          const selected = selections.find(s => s.course.id === choice.courseId);
          const protectedSection = selected && locks.includes(selected.section.id);
          return <li key={choice.courseId}>
            <span><strong>{choice.code}</strong> · {choice.title}{selected && <small>Section {selected.section.number}{protectedSection ? ' · protected' : ''}</small>}</span>
            <details><summary>Course options</summary>
              <label><input type="checkbox" checked={choice.required || (!!selected && (!!choice.keepSection || !!protectedSection))} disabled={!!selected && (!!choice.keepSection || !!protectedSection)} onChange={e => onChoicesChange(choices.map(c => c.courseId === choice.courseId ? { ...c, required: e.target.checked } : c))} />Required course</label>
              {selected && <label><input type="checkbox" checked={!!choice.keepSection || !!protectedSection} disabled={!!protectedSection} onChange={e => onChoicesChange(choices.map(c => c.courseId === choice.courseId ? { ...c, keepSection: e.target.checked } : c))} />Keep section {selected.section.number}</label>}
              {selected && <p className="muted">Kept sections are included in every generated schedule and stay fixed. Locked or registered sections must be updated in your saved schedule.</p>}
              <button className="text-button" disabled={!!protectedSection} onClick={() => onRemoveCourse(choice.courseId)}>Remove {choice.code}</button>
            </details>
          </li>;
        })}</ul>
      </section>
    </section>
    <section className="planner-schedule" aria-label="Schedule preview">
      <div className="schedule-view-tabs" aria-label="Schedule view">
        <button aria-pressed={scheduleView === 'results'} onClick={() => onScheduleViewChange('results')}>Schedule options</button>
        <button aria-pressed={scheduleView === 'saved'} onClick={() => onScheduleViewChange('saved')}>Saved schedule ({selections.length})</button>
      </div>
      <div hidden={scheduleView !== 'results'}>
        <details className="result-preferences" open={!response}><summary>Edit schedule preferences</summary>
        <GenerationControls value={settings} onChange={onSettingsChange} campuses={campuses} />
        <details className="eligibility-settings"><summary>Eligibility filtering · optional</summary>
          <label className="academic-checkbox"><input type="checkbox" checked={excludeConfirmed} onChange={e => setExcludeConfirmed(e.target.checked)} />Exclude confirmed mismatches against my academic information</label>
          <p className="muted">Unknown eligibility and permission requirements remain visible. Add academic information under Registration settings. A protected incompatible section can prevent results.</p>
        </details>
        </details>
        {!ready && <p role="status" className="muted">Resolve saved-section or earlier registration-report notices in your saved schedule before generating.</p>}
        {error && <p role="alert" className="snapshot-note">{error} Your saved schedule is unchanged.</p>}

        {pending === 'initial' && <p role="status" className="muted">Finding schedules for your courses… Your saved schedule is unchanged.</p>}
        {!response && !pending && <div className="schedule-status"><h2>Schedule preview</h2><p>Add your courses, then choose “Generate schedules” to compare possible weeks. Your saved schedule will stay unchanged until you apply a result.</p></div>}
        {response && <GenerationResults key={response.serial} result={response.result} stale={response.basis !== basis} canApply={ready && pending !== 'initial'} profile={profile} planning={planning} preflightConstraints={preflightConstraints} protectedIds={locks} loadingMore={pending === 'more'}
          canExplore={ready && pending !== 'initial'} pageError={pageError} onExplore={() => void generate(true)}
          onApply={(schedule, rescueSectionId) => {
            if (onApply(schedule, choices.map(c => c.courseId))) {
              setApplied(true);
              onScheduleViewChange('saved');
              if (rescueSectionId) onRescue(rescueSectionId);
            }
          }} />}
      </div>
      <div hidden={scheduleView !== 'saved'}>{applied && <p role="status">Applied to your saved schedule.</p>}{manualSchedule}</div>
    </section>
    </div>
  </>;
}
