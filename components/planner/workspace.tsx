'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SectionList } from '@/components/catalog/section-list';
import { findConflicts, formatDay, formatTime, needsTimingVerification } from '@/lib/scheduling/meetings';
import { readSavedIds, readSavedLocks, selectedCreditsLabel, excludedIndexIds, applyGenerated, selectSection, storageKey, type PlannerCourse, type Selection } from '@/lib/scheduling/selection';
import { WeeklyCalendar } from './weekly-calendar';
import { ScheduleGenerator, type GeneratorChoice } from './schedule-generator';
import { AcademicProfile } from './academic-profile';
import { RegistrationPreflight } from './registration-preflight';
import { RegistrationIndex } from './registration-index';
import { sectionWarning } from '@/lib/eligibility/preflight';
import { eligibilityForSource, emptyAcademicProfile } from '@/lib/academic/profile';
import { RescuePanel } from './rescue-panel';
import { initialSettings, type GenerationSettings } from './generation-controls';
import { applyCourseFallback, applyRepair, draftSignature, protectedSections, readSavedRegistration, registrationAfterChange, undoRepair } from '@/lib/recovery/state';
import { registrationLabels, type RegistrationStatuses, type Repair, type RescueDraft } from '@/lib/recovery/types';
import type { RankedSchedule } from '@/lib/scheduling/generation-types';

type PlannerView = 'build' | 'schedule' | 'rescue';
const destinations = { build: 'Build', schedule: 'My Schedule', rescue: 'Rescue' } as const;

function focusDestination(id: string): void {
  document.getElementById(id)?.focus();
}

export function PlannerWorkspace({ sourceId, courses, children }: {
  sourceId: string; courses: PlannerCourse[]; children: ReactNode;
}) {
  const [academicProfile, setAcademicProfile] = useState(emptyAcademicProfile);
  const profile = eligibilityForSource(academicProfile, sourceId);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [choices, setChoices] = useState<GeneratorChoice[]>([]);
  const [applyError, setApplyError] = useState('');
  const [statuses, setStatuses] = useState<RegistrationStatuses>({});
  const [settings, setSettings] = useState<GenerationSettings>(initialSettings);
  const [draftMessage, setDraftMessage] = useState('');
  const [backup, setBackup] = useState<{ before: RescueDraft; afterSignature: string; label: string;
    choices?: { before: GeneratorChoice[]; after: GeneratorChoice[] } } | null>(null);
  const academicControl = useRef<{ planCourse: (code: string) => void }>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Loading saved schedule…');
  const [attempt, setAttempt] = useState(0);
  const params = useSearchParams();
  const destination = params.get('view');
  const view = destination === 'schedule' || destination === 'rescue' ? destination : 'build';
  const rescueIndex = params.get('section') ?? '';
  const requestedFocus = useRef<string | null>(null);
  const previousView = useRef<PlannerView>(view);
  const key = storageKey(sourceId);
  const [showGuide, setShowGuide] = useState(true);

  useEffect(() => {
    const target = requestedFocus.current ?? (previousView.current !== view
      ? view === 'build' && params.get('q') ? 'course-search' : `planner-${view}-heading` : null);
    requestedFocus.current = null;
    previousView.current = view;
    if (target) focusDestination(target);
  }, [params, view]);

  function navigate(next: PlannerView, focus: string | null = `planner-${next}-heading`, index?: string): void {
    const url = new URL(window.location.href);
    if (next === 'build') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (index !== undefined) {
      if (index) url.searchParams.set('section', index);
      else url.searchParams.delete('section');
    }
    url.hash = '';
    if (url.href === window.location.href) { if (focus) focusDestination(focus); return; }
    requestedFocus.current = focus;
    window.history.pushState(null, '', url);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function restore(): Promise<void> {
      try { setShowGuide(localStorage.getItem('bettercsp:planner:guide:v1') !== 'dismissed'); }
      catch { /* Guidance stays available when browser storage is blocked. */ }
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
        setChoices(restored.selections.slice(0, 12).map(({ course, section }) => ({ courseId: course.id, code: course.code, title: course.title, required: true, campuses: section.campuses })));
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
  const preflightConstraints = (() => {
    try { return { ...settings.hard, excludedSectionIds: excludedIndexIds(settings.excludedIndexes, sourceId) }; }
    catch { return null; }
  })();
  function openRescue(sectionId: string): void {
    navigate('rescue', 'planner-rescue-heading', sectionId.split(':').at(-1));
  }
  // Candidate-only additions reuse course identities; manual choices additionally keep their exact section.
  function addCourse(course: PlannerCourse, keepSection = false): void {
    setChoices(current => current.some(c => c.courseId === course.id)
      ? current.map(c => c.courseId === course.id && keepSection ? { ...c, keepSection: true } : c)
      : current.length < 12 ? [...current, { courseId: course.id, code: course.code, title: course.title, required: true, keepSection, campuses: [...new Set(course.sections.flatMap(s => s.campuses))] }] : current);
  }
  function add(course: PlannerCourse, section: Selection['section']): void {
    if (selections.some(s => s.course.id === course.id && effectiveLocks.includes(s.section.id))) return;
    setBackup(null);
    addCourse(course, true);
    const next = selectSection(selections, course, section);
    setStatuses(registrationAfterChange(selections, next, statuses)); setSelections(next);
    setDraftMessage(`${course.code} section ${section.number} saved to your planner.`);
    navigate('schedule');
  }
  function reportApplyError(error: unknown, fallback: string): false {
    setApplyError(error instanceof Error ? error.message : fallback);
    requestAnimationFrame(() => focusDestination('planner-apply-error'));
    return false;
  }
  function apply(schedule: RankedSchedule, targetIds: string[], rescueSectionId?: string): boolean {
    try {
      const next = applyGenerated(selections, schedule.selections, targetIds, effectiveLocks);
      const nextStatuses = registrationAfterChange(selections, next, statuses);
      setApplyError(''); setBackup({ before: draft, afterSignature: draftSignature({ selections: next, locks, statuses: nextStatuses }), label: 'Restore pre-generation schedule' }); setSelections(next); setStatuses(nextStatuses);
      setDraftMessage('Applied to your saved schedule.');
      if (rescueSectionId) openRescue(rescueSectionId);
      else navigate('schedule');
      return true;
    } catch (err) { return reportApplyError(err, 'Unable to apply. Generate again.'); }
  }
  function acceptRepair(repair: Repair, basis: string, overrides: string[]): boolean {
    try {
      const next = applyRepair(draft, repair, basis, overrides);
      setBackup({ before: draft, afterSignature: draftSignature(next), label: 'Undo applied repair' });
      setSelections(next.selections); setLocks(next.locks); setStatuses(next.statuses); setApplyError('');
      setDraftMessage('Repair applied to your planner. Your WebReg registration is unchanged.');
      navigate('schedule');
      return true;
    } catch (err) { return reportApplyError(err, 'Repair could not be applied. Search again.'); }
  }
  function acceptCourseFallback(targetId: string, replacement: Selection, basis: string): boolean {
    try {
      if (!canGenerate || !preflightConstraints) throw new Error('Resolve missing sections, prior registrations, or invalid exclusions before applying.');
      const next = applyCourseFallback(draft, targetId, replacement, basis, preflightConstraints);
      const target = selections.find(selection => selection.section.id === targetId)!;
      const existing = choices.find(choice => choice.courseId === replacement.course.id);
      const choice: GeneratorChoice = { courseId: replacement.course.id, title: replacement.course.title, code: replacement.course.code,
        required: choices.find(item => item.courseId === target.course.id)?.required ?? existing?.required ?? true,
        keepSection: true, campuses: [...new Set([...(existing?.campuses ?? []), ...replacement.section.campuses])] };
      const nextChoices = choices.filter(item => item.courseId !== target.course.id && item.courseId !== replacement.course.id);
      if (nextChoices.length < 12) nextChoices.push(choice);
      setBackup({ before: draft, afterSignature: draftSignature(next), label: 'Undo applied course alternative', choices: { before: choices, after: nextChoices } });
      setChoices(nextChoices); setSelections(next.selections); setStatuses(next.statuses); setApplyError('');
      setDraftMessage('Alternative applied to your planner. Your WebReg registration is unchanged.');
      navigate('schedule');
      return true;
    } catch (err) { return reportApplyError(err, 'Course alternative could not be applied. Search again.'); }
  }
  const undoUnavailable = !!backup && (draftSignature(draft) !== backup.afterSignature || !!backup.choices && choices !== backup.choices.after);
  return <>
    <nav className="planner-tabs" aria-label="Planner workspace">
      {(Object.keys(destinations) as PlannerView[]).map(destination => <button key={destination}
        aria-current={view === destination ? 'page' : undefined} onClick={() => navigate(destination)}>{destinations[destination]}</button>)}
    </nav>
    {error && <div className="snapshot-note" role="alert"><p>{error}</p>
      <button className="text-button" onClick={() => setAttempt(a => a + 1)}>Retry loading</button>{' · '}
      <button className="text-button" onClick={() => { setSelections([]); setLocks([]); setStatuses({}); setMissing([]); setError(''); setReady(true); }}>Start a new local schedule</button>
    </div>}
    {applyError && <p className="snapshot-note" id="planner-apply-error" role="alert" tabIndex={-1}>{applyError}</p>}
    <div hidden={view !== 'build'}>
    <h2 id="planner-build-heading" tabIndex={-1}>Build a schedule</h2>
    {showGuide && <aside className="schedule-status" aria-label="Planner quick start">
      <p>Add courses, generate schedules, then apply the one you want to keep in My Schedule. Choose a specific section to build by hand.</p>
      <button className="text-button" onClick={() => { setShowGuide(false); try { localStorage.setItem('bettercsp:planner:guide:v1', 'dismissed'); } catch { /* Dismissal still works for this visit. */ } }}>Dismiss quick start</button>
    </aside>}
    <ScheduleGenerator sourceId={sourceId} choices={choices} onChoicesChange={setChoices} selections={selections} locks={effectiveLocks} statuses={statuses}
      ready={canGenerate} onApply={apply} profile={profile} planning={academicProfile}
      preflightConstraints={preflightConstraints} settings={settings} onSettingsChange={setSettings}
      active={view === 'build'} onRemoveCourse={id => setChoices(current => current.filter(course => course.courseId !== id))} onSearch={() => focusDestination('course-search')}
      onReviewSchedule={() => navigate('schedule')}
      picker={<>
        {children}
        <div className="planner-search-results" role="region" aria-label="Course search results" tabIndex={0}>
        {courses.map(course => <article className="planner-course" key={course.id}>
          <div className="course-choice-heading"><div><span className="course-code">{course.code}</span><h3>{course.title}</h3><span className="muted">{course.creditsLabel}</span></div>
            <button className="button" disabled={!ready || choices.some(c => c.courseId === course.id) || choices.length >= 12} onClick={() => addCourse(course)}>{choices.some(c => c.courseId === course.id) ? 'Added' : 'Add course'}</button>
          </div>
          <details><summary>Choose a specific section</summary>
          <Link className="back-link" href={`/courses/${encodeURIComponent(course.id)}`}>Full course details ↗</Link>
          {course.prerequisites && <p className="course-note"><strong>Prerequisites · </strong>{course.prerequisites}</p>}
          {!!course.notes.length && <details className="course-notes"><summary>Course & department notes</summary><dl>{course.notes.map(note => <div key={note.field}><dt>{note.field}</dt><dd>{note.text}</dd></div>)}</dl></details>}
          <SectionList sections={course.sections} warning={section => sectionWarning(course, section, profile)} renderAction={section => {
            const selected = selections.find(s => s.course.id === course.id);
            return <button className="button" disabled={!ready || selected?.section.id === section.id || (!!selected && effectiveLocks.includes(selected.section.id)) || (!selected && selections.length + missing.length >= 100)}
              onClick={() => add(course, section)}>{selected?.section.id === section.id ? 'Selected' : selected ? `Replace with section ${section.number}` : `Choose section ${section.number}`}</button>;
          }} />
          {!course.sections.length && <p className="muted">No sections supplied. Try another course.</p>}
          </details>
        </article>)}
        </div>
      </>}
    />
    </div>
      <section hidden={view !== 'schedule'} id="manual-schedule" className="saved-schedule" aria-label="Your weekly schedule">
        <div className="results-heading"><h2 id="planner-schedule-heading" tabIndex={-1}>My Schedule <span className="count">{selections.length}</span></h2><p role="status">{saveStatus}</p></div>
        {draftMessage && <p role="status">{draftMessage}</p>}
        <p className="muted" aria-live="polite">{selections.length} selected {selections.length === 1 ? 'course' : 'courses'} · {selectedCreditsLabel(selections.map(s => s.course))}{missing.length ? ' · Totals exclude unresolved saved sections below.' : ''}</p>
        {!selections.length && <button className="button" onClick={() => navigate('build', 'course-search')}>Find courses</button>}
        {backup && <button className="text-button" disabled={undoUnavailable} onClick={() => {
          const before = undoRepair(draft, backup.before, backup.afterSignature);
          setSelections(before.selections); setLocks(before.locks); setStatuses(before.statuses);
          if (backup.choices) setChoices(backup.choices.before);
          setBackup(null);
          setDraftMessage('Restored your previous planner schedule.');
          focusDestination('planner-schedule-heading');
        }}>{backup.label}</button>}
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
            })}</ul></> : <p>{selections.length ? 'Timetable: no overlaps found among known meeting times. Eligibility and seat availability are checked separately.' : 'Your schedule is empty. Search for a course and add a section, or include courses in the generator and apply a result.'}</p>}
          {!!asynchronous.length && <p>Asynchronous content: {asynchronous.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. No required weekly meeting time; not placed on the calendar. Allow time for coursework and check assessment requirements.</p>}
          {!!arranged.length && <p>Hours by arrangement: {arranged.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. Coordinate meetings with the instructor after registration; overlaps cannot be checked until times are known.</p>}
          {!!unresolved.length && <p>Timing needs verification: {unresolved.map(s => `${s.course.code} (${s.section.number})`).join(', ')}. These meetings cannot be checked or placed on the calendar. Confirm with Rutgers.</p>}
        </div>
        <RegistrationPreflight id="saved-preflight" selections={selections} profile={profile} planning={academicProfile}
          protectedIds={effectiveLocks} constraints={preflightConstraints} unresolved={missing.length} stale={!ready}
          onRescue={canGenerate ? openRescue : undefined} />
        <WeeklyCalendar selections={selections} />
        <div className="results-heading"><h2>Selected sections</h2></div>
        {!selections.length && <p className="muted">Add a section from course search, or apply a generated schedule. Your selected sections and registration reports will appear here.</p>}
        {selections.map(({ course, section }) => <article className="selected-section" key={section.id} id={`selected-${section.index}`}>
          <h3>{course.code} · {course.title}</h3><p className="muted">{course.creditsLabel} · Section {section.number}</p>
          <RegistrationIndex index={section.index} />
          <label className="registration-report">Registration report · index {section.index}<select value={statuses[section.id] ?? 'planned'} onChange={e => setStatuses(current => ({ ...current, [section.id]: e.target.value as RegistrationStatuses[string] }))}>{Object.entries(registrationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <p className="muted">Self-reported only. Updating this report does not enroll or drop a section in WebReg.</p>
          <SectionList sections={[section]} />
          {course.prerequisites && <p className="muted">Prerequisites: {course.prerequisites}</p>}
          <button className="text-button" onClick={() => openRescue(section.id)}>Find a replacement for {course.code}</button>
          <button className="text-button" disabled={!locks.includes(section.id) && locks.length >= 12} aria-pressed={locks.includes(section.id)} onClick={() => setLocks(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])}>{locks.includes(section.id) ? `Unlock section ${section.number}` : `Lock section ${section.number}`}</button>
          <button className="text-button remove-button" disabled={effectiveLocks.includes(section.id)} onClick={() => { setBackup(null); const next = selections.filter(s => s.section.id !== section.id); setStatuses(registrationAfterChange(selections, next, statuses)); setSelections(next); setChoices(current => current.filter(c => c.courseId !== course.id)); }}>Remove section {section.number}</button>
        </article>)}
        {missing.map(id => <div className="snapshot-note" key={id}><p>Saved section {id} is absent from this catalog. It remains saved but cannot be checked. Verify with Rutgers.</p>
          <button className="text-button" onClick={() => { setLocks(current => current.filter(value => value !== id)); setMissing(current => current.filter(value => value !== id)); }}>Remove unavailable saved section</button></div>)}
        <p className="footnote">Adding a section adds every meeting supplied for that index, including lectures, recitations, and labs. Separate required-section links and cross-listed equivalence have not been verified. Confirm the full enrollment bundle with Rutgers; do not add cross-listed alternatives for duplicate credit. Commute time and special session dates are not checked. Saves stay in this browser and can be cleared by browser settings; other tabs may overwrite them.</p>
      </section>
    <RescuePanel sourceId={sourceId} draft={draft} profile={profile} academic={academicProfile} settings={settings} ready={canGenerate} restored={ready}
      active={view === 'rescue'} sectionIndex={rescueIndex} onSelectSection={index => navigate('rescue', null, index)}
      onFindCourse={() => navigate('build', 'course-search')} onReviewSchedule={() => navigate('schedule')}
      onApply={acceptRepair} onApplyCourse={acceptCourseFallback} onPlanLater={code => academicControl.current?.planCourse(code)} />
    <div className="planner-secondary">
      <AcademicProfile ref={academicControl} sourceId={sourceId} onChange={setAcademicProfile} />
    </div>
  </>;
}
