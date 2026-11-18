'use client';
import { useEffect, useRef, useState } from 'react';
import type { StudentProfile } from '@/lib/eligibility/types';
import type { GenerationResult, RankedSchedule } from '@/lib/scheduling/generation-types';
import { excludedIndexIds, type Selection } from '@/lib/scheduling/selection';
import { GenerationControls, type GenerationSettings } from './generation-controls';
import { GenerationResults } from './generation-results';

export interface GeneratorChoice { courseId: string; code: string; title: string; required: boolean; campuses: string[] }
// New orchestration is limited to generation requests; manual persistence remains workspace-owned.
export function ScheduleGenerator({ sourceId, choices, onChoicesChange, selections, locks, ready, onApply, profile, settings, onSettingsChange }: {
  settings: GenerationSettings; onSettingsChange: (settings: GenerationSettings) => void; profile: StudentProfile; sourceId: string; choices: GeneratorChoice[]; onChoicesChange: (choices: GeneratorChoice[]) => void;
  selections: Selection[]; locks: string[]; ready: boolean;
  onApply: (schedule: RankedSchedule, targetIds: string[]) => boolean;
}) {
  const [excludeConfirmed, setExcludeConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [response, setResponse] = useState<{ result: GenerationResult; basis: string; serial: number } | null>(null);
  const [applied, setApplied] = useState(false);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  const basis = JSON.stringify({ choices, settings, profile, excludeConfirmed, selections: selections.map(s => s.section.id), locks });
  useEffect(() => () => controller.current?.abort(), []);
  const campuses = [...new Set([...choices.flatMap(c => c.campuses), ...selections.flatMap(s => s.section.meetings.map(m => m.campus))].map(c => c.toUpperCase()))].filter(Boolean).sort();
  async function generate(): Promise<void> {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setPending(true); setError(''); setApplied(false);
    try {
      const excluded = excludedIndexIds(settings.excludedIndexes, sourceId);
      const contextualLocks = selections.filter(s => !choices.some(c => c.courseId === s.course.id)).map(s => s.section.id);
      const payload = { sourceId, eligibility: { profile, excludeConfirmed }, choices: choices.map(({ courseId, required }) => ({ courseId, required })),
        constraints: { ...settings.hard, excludedSectionIds: excluded, lockedSectionIds: [...new Set([...locks, ...contextualLocks])] },
        weights: settings.weights, preferredInstructors: settings.instructors.split('\n').map(s => s.trim()).filter(Boolean) };
      const request = await fetch('/api/planner/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: abort.signal });
      const result = await request.json();
      if (!request.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Generation failed. Retry with fewer courses.');
      if (!abort.signal.aborted) setResponse({ result: result as GenerationResult, basis, serial: ++serial.current });
    } catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to generate. Check your connection and retry.'); }
    finally { if (controller.current === abort) setPending(false); }
  }
  return <details className="schedule-generator" aria-label="Automatic schedule generator" open>
    <summary><h2>Find a schedule that fits.</h2></summary><p className="muted">Choose up to 12 courses, including locked or retained manual courses. Each index keeps all of its lecture, recitation, and lab meetings together.</p>
    <button className="text-button" disabled={!selections.length || selections.length > 12} onClick={() => onChoicesChange(selections.map(s => ({ courseId: s.course.id, code: s.course.code, title: s.course.title, required: true, campuses: [...new Set(s.section.meetings.map(m => m.campus))] })))}>Use my planned courses</button>
    {!choices.length && <p className="muted">Use “Include in generator” in course search below, or start with your planned courses.</p>}
    <ul className="generator-choices">{choices.map(choice => <li key={choice.courseId}>
      <span><strong>{choice.code}</strong> · {choice.title}</span>
      <label><input type="checkbox" checked={choice.required} onChange={e => onChoicesChange(choices.map(c => c.courseId === choice.courseId ? { ...c, required: e.target.checked } : c))} />Required</label>
      <button className="text-button" onClick={() => onChoicesChange(choices.filter(c => c.courseId !== choice.courseId))}>Remove {choice.code}</button>
    </li>)}</ul>
    <label className="academic-checkbox"><input type="checkbox" checked={excludeConfirmed} onChange={e => setExcludeConfirmed(e.target.checked)} />Exclude sections with a confirmed mismatch against my reported standing, complete declarations, or an explicit Honors College-only rule</label>
    <p className="muted">Unchecked: retain with warnings. Unknown eligibility, ambiguous codes, and permission requirements are never silently excluded by this option. Locks remain fixed; an incompatible locked section may prevent results.</p>
    <GenerationControls value={settings} onChange={onSettingsChange} campuses={campuses} />
    <p className="muted">Manual courses outside this list stay fixed during generation. Lock a manual section below to keep that exact index. Arranged, unknown-time, and inconsistent-time sections are excluded from generated results; they remain available for manual planning.</p>
    <p className="muted">All results need registration review: separately required courses and eligibility are not automatically verified. Closed snapshot sections remain planning alternatives.</p>
    {!ready && <p role="status" className="muted">Load or resolve your saved sections before generating.</p>}
    <button className="button" disabled={!ready || pending || (!choices.length && !locks.length)} onClick={() => void generate()}>{pending ? 'Generating schedules…' : 'Generate schedules'}</button>
    {error && <p role="alert" className="snapshot-note">{error} Your manual schedule is unchanged.</p>}
    {applied && <p role="status">Applied to your manual schedule below.</p>}
    {response && <GenerationResults key={response.serial} result={response.result} stale={response.basis !== basis || pending} canApply={ready && !pending} profile={profile}
      onApply={schedule => { if (onApply(schedule, choices.map(c => c.courseId))) setApplied(true); }} />}
  </details>;
}
