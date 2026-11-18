'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { SectionList } from '@/components/catalog/section-list';
import { findConflicts, formatDay, formatTime, needsTimingVerification } from '@/lib/scheduling/meetings';
import { readSavedIds, readSavedLocks, applyGenerated, selectSection, storageKey, type PlannerCourse, type Selection } from '@/lib/scheduling/selection';
import { WeeklyCalendar } from './weekly-calendar';
import { ScheduleGenerator, type GeneratorChoice } from './schedule-generator';
import { AcademicProfile } from './academic-profile';
import { RegistrationReadiness } from './registration-readiness';
import { emptyProfile, type StudentProfile } from '@/lib/eligibility/types';
import { RescuePanel } from './rescue-panel';
import { initialSettings, type GenerationSettings } from './generation-controls';
import { applyRepair, draftSignature, protectedSections, readSavedRegistration, registrationAfterChange, undoRepair } from '@/lib/recovery/state';
import { registrationLabels, type RegistrationStatuses, type Repair, type RescueDraft } from '@/lib/recovery/types';
import type { RankedSchedule } from '@/lib/scheduling/generation-types';

// Workspace state is new: Phase 1 has no section selection or browser persistence.
export function PlannerWorkspace({ sourceId, courses, children }: {
  sourceId: string; courses: PlannerCourse[]; children: ReactNode;
}) {
  const [profile, setProfile] = useState<StudentProfile>(structuredClone(emptyProfile));
  const [selections, setSelections] = useState<Selection[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [choices, setChoices] = useState<GeneratorChoice[]>([]);
  const [applyError, setApplyError] = useState('');
  const [statuses, setStatuses] = useState<RegistrationStatuses>({});
  const [settings, setSettings] = useState<GenerationSettings>(initialSettings);
  const [backup, setBackup] = useState<{ before: RescueDraft; afterSignature: string; label: string } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Loading saved schedule…');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'courses' | 'calendar'>('courses');
  const key = storageKey(sourceId);

  useEffect(() => {
    const controller = new AbortController();
    async function restore(): Promise<void> {
      try {
        const saved = localStorage.getItem(key);
        const ids = readSavedIds(saved, sourceId);
        const savedLocks = readSavedLocks(saved, sourceId);
        const registration = readSavedRegistration(saved, sourceId);
        const params = new URLSearchParams(ids.map(id => ['id', id]));
        const response = ids.length ? await fetch(`/api/planner/sections?${params}`, { signal: controller.signal }) : null;
        if (response && !response.ok) throw new Error('Unable to resolve saved sections');
        const restored: { selections: Selection[] } = response ? await response.json() : { selections: [] };
        if (controller.signal.aborted) return;
        setSelections(restored.selections);
        setLocks(savedLocks); setStatuses(registration);
        setMissing(ids.filter(id => !restored.selections.some(s => s.section.id === id)));
        setError('');
        setReady(true);
      } catch {
        if (!controller.signal.aborted) setError('Your saved schedule could not be loaded. Retry, or start a new local schedule. The existing save has been kept.');
      }
    }
    void restore();
    return () => controller.abort();
  }, [key, sourceId, attempt]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, sourceId, sectionIds: [...selections.map(s => s.section.id), ...missing], lockedSectionIds: locks, registrationStatuses: statuses }));
      // Defer status updates because this effect synchronizes external storage.
      queueMicrotask(() => setSaveStatus('Saved on this browser'));
    } catch {
      queueMicrotask(() => setSaveStatus('Local saving is unavailable. Keep this page open; selections will be lost on refresh.'));
    }
  }, [selections, missing, locks, statuses, ready, key, sourceId]);

  const conflicts = findConflicts(selections.map(s => s.section));
  const unresolved = selections.filter(s => !s.section.meetings.length || s.section.meetings.some(m => m.timing !== 'arranged' && needsTimingVerification(m)));
  const arranged = selections.filter(s => s.section.meetings.some(m => m.timing === 'arranged'));
  const asynchronous = selections.filter(s => s.section.meetings.some(m => m.timing === 'asynchronous'));
  const draft: RescueDraft = { selections, locks, statuses };
  const effectiveLocks = protectedSections(draft);
  const priorRegistered = Object.entries(statuses).filter(([id, status]) => status === 'registered' && !selections.some(s => s.section.id === id));
  const canGenerate = ready && !missing.length && !priorRegistered.length;
  function openRescue(): void { const panel = document.getElementById('rescue-panel') as HTMLDetailsElement | null; if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }); } }
  function add(course: PlannerCourse, section: Selection['section']): void {
    if (selections.some(s => s.course.id === course.id && effectiveLocks.includes(s.section.id))) return;
    setBackup(null);
    const next = selectSection(selections, course, section);
    setStatuses(registrationAfterChange(selections, next, statuses)); setSelections(next);
  }
  function apply(schedule: RankedSchedule, targetIds: string[]): boolean {
    try {
      const next = applyGenerated(selections, schedule.selections, targetIds, effectiveLocks);
      const nextStatuses = registrationAfterChange(selections, next, statuses);
      setApplyError(''); setBackup({ before: draft, afterSignature: draftSignature({ selections: next, locks, statuses: nextStatuses }), label: 'Restore pre-generation schedule' }); setSelections(next); setStatuses(nextStatuses); setView('calendar');
      requestAnimationFrame(() => document.getElementById('manual-schedule')?.scrollIntoView({ block: 'start' }));
      return true;
    } catch (err) { setApplyError(err instanceof Error ? err.message : 'Unable to apply. Generate again.'); return false; }
  }
  function acceptRepair(repair: Repair, basis: string, overrides: string[]): boolean {
    try {
      const next = applyRepair(draft, repair, basis, overrides);
      setBackup({ before: draft, afterSignature: draftSignature(next), label: 'Undo applied repair' });
      setSelections(next.selections); setLocks(next.locks); setStatuses(next.statuses); setApplyError(''); setView('calendar');
      return true;
    } catch (err) { setApplyError(err instanceof Error ? err.message : 'Repair could not be applied. Search again.'); return false; }
  }
  return <>
    <RescuePanel sourceId={sourceId} draft={draft} profile={profile} settings={settings} ready={canGenerate} onApply={acceptRepair} />
    <AcademicProfile profile={profile} onChange={setProfile} />
    <ScheduleGenerator sourceId={sourceId} choices={choices} onChoicesChange={setChoices} selections={selections} locks={effectiveLocks}
      ready={canGenerate} onApply={apply} profile={profile} settings={settings} onSettingsChange={setSettings} />
    <div className="planner-tabs" aria-label="Workspace view">
      <button aria-pressed={view === 'courses'} onClick={() => setView('courses')}>Courses</button>
      <button aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>Calendar ({selections.length})</button>
    </div>
    {error && <div className="snapshot-note" role="alert"><p>{error}</p>
      <button className="text-button" onClick={() => setAttempt(a => a + 1)}>Retry loading</button>{' · '}
      <button className="text-button" onClick={() => { setSelections([]); setLocks([]); setStatuses({}); setMissing([]); setError(''); setReady(true); }}>Start a new local schedule</button>
    </div>}
    <div className={`planner-workspace show-${view}`}>
      <section className="planner-courses" aria-label="Find and select sections">
        {children}
        {courses.map(course => <details className="planner-course" key={course.id}>
          <summary><span className="course-code">{course.code}</span><h3>{course.title}</h3><span className="muted">{course.creditsLabel} · {course.sections.length} {course.sections.length === 1 ? 'section' : 'sections'}</span></summary>
          <button className="text-button" disabled={choices.some(c => c.courseId === course.id) || choices.length >= 12} onClick={() => setChoices(current => [...current, {
            courseId: course.id, code: course.code, title: course.title, required: true,
            campuses: [...new Set(course.sections.flatMap(s => [...s.campuses, ...s.meetings.map(m => m.campus)]))].filter(Boolean),
          }])}>{choices.some(c => c.courseId === course.id) ? 'Included in generator' : 'Include in generator'}</button>{' · '}
          <Link className="back-link" href={`/courses/${encodeURIComponent(course.id)}`}>Full course details ↗</Link>
          {course.prerequisites && <p className="course-note"><strong>Prerequisites · </strong>{course.prerequisites}</p>}
          {!!course.notes.length && <details className="course-notes"><summary>Course & department notes</summary><dl>{course.notes.map(note => <div key={note.field}><dt>{note.field}</dt><dd>{note.text}</dd></div>)}</dl></details>}
          <SectionList sections={course.sections} renderAction={section => {
            const selected = selections.find(s => s.course.id === course.id);
            return <button className="button" disabled={!ready || selected?.section.id === section.id || (!!selected && effectiveLocks.includes(selected.section.id)) || (!selected && selections.length + missing.length >= 100)}
              onClick={() => add(course, section)}>{selected?.section.id === section.id ? 'Selected' : selected ? `Replace section ${selected.section.number} with ${section.number}` : 'Add section to schedule'}</button>;
          }} />
          {!course.sections.length && <p className="muted">No sections supplied. Try another course.</p>}
        </details>)}
      </section>
      <section id="manual-schedule" className="planner-schedule" aria-label="Your weekly schedule">
        <div className="results-heading"><h2>Your week <span className="count">{selections.length}</span></h2><p role="status">{saveStatus}</p></div>
        {applyError && <p role="alert">{applyError}</p>}
        <button className="text-button" onClick={openRescue}>Rescue schedule</button>
        {backup && <button className="text-button" disabled={draftSignature(draft) !== backup.afterSignature} onClick={() => { const before = undoRepair(draft, backup.before, backup.afterSignature); setSelections(before.selections); setLocks(before.locks); setStatuses(before.statuses); setBackup(null); }}>{backup.label}</button>}
        {!!priorRegistered.length && <aside className="snapshot-note"><strong>Earlier registered self-reports need WebReg verification</strong><p>These indexes are outside this planner draft. A planner repair did not drop them from Rutgers enrollment. Automatic planning waits until you verify and update these reports.</p>{priorRegistered.map(([id]) => <div key={id}><span>Index {id.split(':').at(-1)} · registered self-report </span><button className="text-button" onClick={() => setStatuses(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))}>I verified this prior enrollment; clear report</button></div>)}</aside>}
        <p className="muted">All times Eastern · all seven days. Select a calendar block for its section details.</p>
        <div className="schedule-status" role="status">
          {selections.length + missing.length >= 100 && <p>This local schedule has reached its 100-section limit. Remove a section before adding another course.</p>}
          {conflicts.length ? <><strong>{conflicts.length} meeting-time {conflicts.length === 1 ? 'conflict' : 'conflicts'}</strong>
            <ul>{conflicts.map((conflict, i) => {
              const a = selections.find(s => s.section.id === conflict.firstId)!;
              const b = selections.find(s => s.section.id === conflict.secondId)!;
              const meeting = a.section.meetings[conflict.firstMeeting];
              return <li key={i}>{a.course.code} ({a.section.number}) overlaps {b.course.code} ({b.section.number}) on {formatDay(meeting.dayCode)}, {formatTime(meeting.startMinute)}–{formatTime(meeting.endMinute)}. Remove or replace a section below.</li>;
            })}</ul></> : <p>{selections.length ? 'No overlaps found among known meeting times.' : 'Your schedule starts here. Find a course and add a section.'}</p>}
          {!!asynchronous.length && <p>Asynchronous content: {asynchronous.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. No required weekly meeting time; not placed on the calendar. Allow time for coursework and check assessment requirements.</p>}
          {!!arranged.length && <p>Hours by arrangement: {arranged.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. Coordinate meetings with the instructor after registration; overlaps cannot be checked until times are known.</p>}
          {!!unresolved.length && <p>Timing needs verification: {unresolved.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. These meetings cannot be checked or placed on the calendar. Confirm with Rutgers.</p>}
        </div>
        <WeeklyCalendar selections={selections} />
        <RegistrationReadiness selections={selections} profile={profile} />
        <div className="results-heading"><h2>Selected sections</h2></div>
        {selections.map(({ course, section }) => <article className="selected-section" key={section.id} id={`selected-${section.index}`}>
          <h3>{course.code} · {course.title}</h3><p className="muted">{course.creditsLabel}</p>
          <label className="registration-report">Registration report · index {section.index}<select value={statuses[section.id] ?? 'planned'} onChange={e => setStatuses(current => ({ ...current, [section.id]: e.target.value as RegistrationStatuses[string] }))}>{Object.entries(registrationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <p className="muted">Self-reported only. Updating this report does not enroll or drop a section in WebReg.</p>
          <SectionList sections={[section]} />
          {course.prerequisites && <p className="muted">Prerequisites: {course.prerequisites}</p>}
          <Link className="text-button" href={`/planner?${new URLSearchParams({ q: course.code })}`} scroll={false} onClick={() => setView('courses')}>Find a replacement for {course.code} ↑</Link>
          <button className="text-button" disabled={!locks.includes(section.id) && locks.length >= 12} aria-pressed={locks.includes(section.id)} onClick={() => setLocks(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])}>{locks.includes(section.id) ? `Unlock section ${section.number}` : `Lock section ${section.number}`}</button>
          <button className="text-button remove-button" disabled={effectiveLocks.includes(section.id)} onClick={() => { setBackup(null); const next = selections.filter(s => s.section.id !== section.id); setStatuses(registrationAfterChange(selections, next, statuses)); setSelections(next); }}>Remove section {section.number}</button>
        </article>)}
        {missing.map(id => <div className="snapshot-note" key={id}><p>Saved section {id} is absent from this catalog. It remains saved but cannot be checked. Verify with Rutgers.</p>
          <button className="text-button" onClick={() => { setLocks(current => current.filter(value => value !== id)); setMissing(current => current.filter(value => value !== id)); }}>Remove unavailable saved section</button></div>)}
        <p className="footnote">Adding a section adds every meeting supplied for that index, including lectures, recitations, and labs. Separate required-section links and cross-listed equivalence have not been verified. Confirm the full enrollment bundle with Rutgers; do not add cross-listed alternatives for duplicate credit. Commute time and special session dates are not checked. Saves stay in this browser and can be cleared by browser settings; other tabs may overwrite them.</p>
      </section>
    </div>
  </>;
}
