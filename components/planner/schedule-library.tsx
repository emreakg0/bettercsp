import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { libraryKey, namedScheduleLimit, readScheduleLibrary, sameSchedule, scheduleName, scheduleNameLimit, suggestScheduleName,
  type NamedSchedule, type ScheduleLibrary, type ScheduleSnapshot } from '@/lib/scheduling/saved-schedules';
import { selectedCreditsLabel, type Selection } from '@/lib/scheduling/selection';
import { registrationLabels, type RegistrationStatuses } from '@/lib/recovery/types';
import { WeeklyCalendar } from './weekly-calendar';
import { RegistrationIndex } from './registration-index';

type Action = { kind: 'save' } | { kind: 'rename' | 'update' | 'delete' | 'activate'; id: string; updatedAt?: string; working?: ScheduleSnapshot };

export function ScheduleLibrary({ sourceId, active, ready, draft, statuses, legacy, capture, viewedId, onView, onClearCapture, onActivate, activationIssue, preflight, children }: {
  sourceId: string; active: boolean; ready: boolean; draft: ScheduleSnapshot; statuses: RegistrationStatuses; legacy: ScheduleSnapshot | null;
  capture: ScheduleSnapshot | null; viewedId: string | null; onView: (id: string | null) => void; onClearCapture: () => void;
  onActivate: (saved: NamedSchedule, selections: Selection[]) => void;
  activationIssue: (saved: NamedSchedule, selections: Selection[]) => string;
  preflight: (saved: NamedSchedule, selections: Selection[], missing: number) => ReactNode; children: ReactNode;
}) {
  const key = libraryKey(sourceId);
  const [loaded, setLoaded] = useState<{ value: ScheduleLibrary; raw: string | null } | null>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ key: string; selections: Selection[]; error?: boolean } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const draftButton = useRef<HTMLButtonElement>(null);
  const rows = loaded?.value.schedules ?? [];
  const viewed = rows.find(row => row.id === viewedId);
  const idsKey = [...new Set(rows.flatMap(row => row.sectionIds))].sort().join(',');
  const current = resolved?.key === idsKey ? resolved : null;
  const selectionsById = new Map(current?.selections.map(selection => [selection.section.id, selection]));
  const viewedSelections = viewed?.sectionIds.flatMap(id => selectionsById.get(id) ?? []) ?? [];
  const missing = (viewed?.sectionIds.length ?? 0) - viewedSelections.length;
  const added = viewed?.sectionIds.filter(id => !draft.sectionIds.includes(id)) ?? [];
  const removed = draft.sectionIds.filter(id => viewed && !viewed.sectionIds.includes(id));
  const nextAction = capture ? { kind: 'save' } as const : action;
  const actionTarget = nextAction && 'id' in nextAction ? rows.find(row => row.id === nextAction.id) : undefined;
  const matches = rows.filter(row => sameSchedule(row, draft)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  useEffect(() => {
    let live = true;
    function read(): void {
      queueMicrotask(() => {
        if (!live) return;
        try {
          const raw = localStorage.getItem(key);
          setLoaded({ value: readScheduleLibrary(raw, sourceId), raw });
          setProblem('');
        } catch {
          setLoaded(null);
          setProblem('Saved schedules could not be read. The stored library has been kept. Retry after checking browser storage.');
        }
      });
    }
    function sync(event: StorageEvent): void { if (event.key === key || event.key === null) read(); }
    read();
    window.addEventListener('storage', sync);
    return () => { live = false; window.removeEventListener('storage', sync); };
  }, [key, sourceId, attempt]);

  useEffect(() => {
    if (!active || !idsKey || current) return;
    const controller = new AbortController();
    async function resolve(): Promise<void> {
      const ids = idsKey.split(',');
      const selections: Selection[] = [];
      try {
        for (let offset = 0; offset < ids.length; offset += 100) {
          const query = new URLSearchParams(ids.slice(offset, offset + 100).map(id => ['id', id]));
          const response = await fetch('/api/planner/sections?' + query, { signal: controller.signal });
          if (!response.ok) throw new Error('Catalog unavailable');
          const page: { selections: Selection[] } = await response.json();
          selections.push(...page.selections);
        }
        if (!controller.signal.aborted) setResolved({ key: idsKey, selections });
      } catch {
        if (!controller.signal.aborted) setResolved({ key: idsKey, selections: [], error: true });
      }
    }
    void resolve();
    return () => controller.abort();
  }, [active, current, idsKey]);

  const actionKind = nextAction?.kind;
  useEffect(() => {
    if (active && actionKind) form.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [active, capture, action, actionKind]); // Focus the inline operation when it opens.

  function write(schedules: NamedSchedule[], legacyHandled = loaded?.value.legacyHandled ?? false): void {
    if (!loaded) throw new Error('The library is unavailable.');
    if (localStorage.getItem(key) !== loaded.raw) throw new Error('The library changed in another tab. Retry loading before saving.');
    const raw = JSON.stringify({ ...loaded.value, schedules, legacyHandled });
    const value = readScheduleLibrary(raw, sourceId);
    localStorage.setItem(key, raw);
    setLoaded({ value, raw });
    setProblem('');
  }

  function created(label: string, snapshot: ScheduleSnapshot): NamedSchedule {
    if (rows.length >= namedScheduleLimit) throw new Error('Delete a saved schedule before adding another.');
    const now = new Date().toISOString();
    return { ...snapshot, id: crypto.randomUUID(), name: scheduleName(label, rows), sourceId,
      revision: 1, createdAt: now, updatedAt: now };
  }
  function perform(run: () => void): void {
    try { run(); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Could not change the saved library.'); }
  }
  function start(next: Action, initial = ''): void {
    onClearCapture();
    const target = 'id' in next ? rows.find(row => row.id === next.id) : undefined;
    setAction('id' in next ? { ...next, updatedAt: target?.updatedAt, working: draft } : next);
    setName(initial);
    setProblem('');
  }
  function finish(focus = true): void {
    setAction(null);
    setName('');
    onClearCapture();
    if (focus) draftButton.current?.focus();
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!nextAction || !loaded || (!ready && nextAction.kind !== 'rename' && nextAction.kind !== 'delete')) return;
    const input = String(new FormData(event.currentTarget).get('scheduleName') ?? '');
    perform(() => {
      if (nextAction.kind === 'save') {
        const row = created(input, capture ?? draft);
        write([...rows, row]);
        onView(row.id);
        setNotice(row.name + ' saved. Your working draft is unchanged.');
      } else if (actionTarget) {
        if (nextAction.updatedAt !== actionTarget.updatedAt || localStorage.getItem(key) !== loaded?.raw ||
            ((nextAction.kind === 'update' || nextAction.kind === 'activate') && nextAction.working && !sameSchedule(nextAction.working, draft))) {
          throw new Error('The schedule changed. Cancel and review it before trying again.');
        }
        if (nextAction.kind === 'activate') {
          const issue = activationIssue(actionTarget, viewedSelections);
          if (issue || actionTarget.id !== viewedId) throw new Error(issue || 'Preview this schedule again before using it.');
          onActivate(actionTarget, viewedSelections);
        } else if (nextAction.kind === 'delete') {
          write(rows.filter(row => row.id !== actionTarget.id));
          if (viewedId === actionTarget.id) onView(null);
          setNotice(actionTarget.name + ' deleted.');
        } else {
          const updatedAt = new Date(Math.max(Date.now(), Date.parse(actionTarget.updatedAt) + 1)).toISOString();
          const patch = nextAction.kind === 'rename' ? { name: scheduleName(input, rows, actionTarget.id) }
            : { ...draft, revision: actionTarget.revision + 1 };
          write(rows.map(row => row.id === actionTarget.id ? { ...row, ...patch, updatedAt } : row));
          setNotice(actionTarget.name + (nextAction.kind === 'rename' ? ' renamed.' : ' updated from your working draft.'));
        }
      }
      finish();
    });
  }

  const issue = viewed && current && !current.error ? activationIssue(viewed, viewedSelections) : '';
  const confirm = nextAction && (!('id' in nextAction) || actionTarget) && (nextAction.kind !== 'activate' || actionTarget?.id === viewedId);
  return <div className="saved-library">
    <aside aria-label="My Saved Schedules">
      <h3>My Saved Schedules</h3>
      <p className="muted">Saved in this browser for this term and campus.</p>
      <button ref={draftButton} className="library-selection" aria-current={!viewedId ? 'true' : undefined} onClick={() => { finish(false); onView(null); }}>Working draft <small>Autosaves as you edit</small></button>
      <button className="button" disabled={!ready || !loaded || !draft.sectionIds.length || rows.length >= namedScheduleLimit}
        onClick={() => start({ kind: 'save' }, suggestScheduleName('Schedule ' + (rows.length + 1), rows))}>Save as new schedule</button>
      {ready && !draft.sectionIds.length && <p className="muted">Add a section to your draft to save a named copy.</p>}
      {rows.length >= namedScheduleLimit && <p className="muted">Library full · {namedScheduleLimit} saved schedules</p>}
      {legacy && loaded && !loaded.value.legacyHandled && rows.length < namedScheduleLimit && <div className="schedule-status">
        <p>Keep a named copy of the plan you had before this update.</p>
        <button className="text-button" onClick={() => perform(() => {
          const row = created(suggestScheduleName('Previous planner schedule', rows), legacy);
          write([...rows, row], true);
          setNotice(row.name + ' saved.');
        })}>Save previous plan as a copy</button>{' '}
        <button className="text-button" onClick={() => perform(() => write(rows, true))}>Dismiss previous plan offer</button>
      </div>}
      <ul className="library-list">{rows.map(row => {
        const courses = row.sectionIds.flatMap(id => selectionsById.get(id)?.course ?? []);
        const count = new Set(courses.map(course => course.id)).size;
        return <li key={row.id}>
          <button className="library-selection" aria-current={viewedId === row.id ? 'true' : undefined} onClick={() => { finish(false); onView(row.id); }}>
            <strong>{row.name}</strong>
            <small>{current && !current.error ? count + (count === 1 ? ' course · ' : ' courses · ') + selectedCreditsLabel(courses) +
              (courses.length !== row.sectionIds.length ? ' · incomplete' : '') : row.sectionIds.length + ' saved indexes'}</small>
            {matches[0]?.id === row.id && <small>Matches working draft</small>}
            {latest?.id === row.id && <small>Most recently saved</small>}
          </button>
          <details className="library-actions"><summary aria-label={'Actions for ' + row.name}>Schedule actions</summary>
            <button className="text-button" onClick={() => start({ kind: 'rename', id: row.id }, row.name)}>Rename</button>
            <button className="text-button" disabled={rows.length >= namedScheduleLimit} onClick={() => perform(() => {
              const copy = created(suggestScheduleName('Backup — ' + row.name, rows), { sectionIds: row.sectionIds, lockedSectionIds: row.lockedSectionIds });
              write([...rows, copy]); onView(copy.id); setNotice(copy.name + ' saved.');
            })}>Duplicate</button>
            <button className="text-button" disabled={!ready || !draft.sectionIds.length} onClick={() => start({ kind: 'update', id: row.id })}>Update from working draft</button>
            <button className="text-button" onClick={() => start({ kind: 'delete', id: row.id })}>Delete</button>
          </details>
        </li>;
      })}</ul>
    </aside>
    <div className="library-content">
      {problem && <div role="alert" className="snapshot-note">{problem} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry loading library</button></div>}
      <p role="status" className="library-notice">{notice}</p>
      {confirm && nextAction && <form ref={form} className="schedule-status library-form" aria-label="Schedule operation" onSubmit={submit}>
        {capture && <p>Save a copy of the generated preview. Your working draft will stay intact.</p>}
        {nextAction.kind === 'save' || nextAction.kind === 'rename' ? <label>Schedule name
          <input key={capture ? 'generated' : actionTarget?.id ?? 'draft'} name="scheduleName" required maxLength={scheduleNameLimit}
            defaultValue={capture ? suggestScheduleName('Generated schedule', rows) : name} />
        </label> : <p>{nextAction.kind === 'delete' ? 'Delete “' + actionTarget?.name + '” from your library?'
          : nextAction.kind === 'update' ? 'Replace the saved sections and locks in “' + actionTarget?.name + '” with your working draft?'
          : 'Use “' + actionTarget?.name + '” as your working draft? This only changes BetterCSP. Your WebReg enrollment and registration reports stay intact. Save a named copy first if you want to keep your current edits.'}</p>}
        <button className="button" disabled={!loaded || (!ready && nextAction.kind !== 'rename' && nextAction.kind !== 'delete') ||
            (nextAction.kind === 'save' && rows.length >= namedScheduleLimit) || (nextAction.kind === 'activate' && (!!issue || !current || current.error))} type="submit">
          {nextAction.kind === 'save' ? 'Save schedule' : nextAction.kind === 'rename' ? 'Save name' : nextAction.kind === 'delete' ? 'Delete schedule'
            : nextAction.kind === 'update' ? 'Update saved schedule' : 'Confirm use this schedule'}
        </button>
        <button className="text-button" type="button" onClick={() => finish()}>Cancel</button>
      </form>}
      {viewed ? <section aria-label="Saved schedule preview">
        <h3 id="named-preview-heading" tabIndex={-1}>{viewed.name}</h3>
        <p className="muted">Saved preview · Your working draft is still available.</p>
        <p className="muted">{sameSchedule(viewed, draft) ? 'This snapshot matches the working draft.'
          : added.length + ' added · ' + removed.length + ' removed compared with the working draft.'}</p>
        {(!!added.length || !!removed.length) && <details>
          <summary>Compare indexes with working draft</summary>
          {!!added.length && <p>Added in this preview · {added.map(id => id.split(':').at(-1)).join(', ')}</p>}
          {!!removed.length && <p>Only in working draft · {removed.map(id => id.split(':').at(-1)).join(', ')}</p>}
        </details>}
        {current?.error ? <div role="alert">Could not load saved sections. <button className="text-button" onClick={() => setResolved(null)}>Retry sections</button></div>
          : !current && !!viewed.sectionIds.length ? <p role="status">Loading saved sections…</p> : <>
            <p>{new Set(viewedSelections.map(s => s.course.id)).size} courses · {selectedCreditsLabel(viewedSelections.map(s => s.course))}</p>
            {missing > 0 && <p role="status">Unavailable indexes: {viewed.sectionIds.filter(id => !selectionsById.has(id)).map(id => id.split(':').at(-1)).join(', ')}.</p>}
            {issue && <p className="snapshot-note">{issue}</p>}
            <button className="button" disabled={!ready || !!issue || !!missing} onClick={() => start({ kind: 'activate', id: viewed.id })}>Use this schedule</button>
            {preflight(viewed, viewedSelections, missing)}
            <WeeklyCalendar selections={viewedSelections} idPrefix="named-preview" />
            <ul className="generation-notes">{viewedSelections.map(({ course, section }) => <li key={section.id} id={'named-preview-' + section.index}>
              <strong>{course.code} · {course.title}</strong> · Section {section.number} · <RegistrationIndex index={section.index} />
              {viewed.lockedSectionIds.includes(section.id) && ' · Locked in this snapshot'}
              {statuses[section.id] && ' · Current report: ' + registrationLabels[statuses[section.id]]}
            </li>)}</ul>
          </>}
      </section> : <>{viewedId && loaded && <p role="status">That saved schedule is unavailable. Showing your working draft.</p>}{children}</>}
    </div>
  </div>;
}
