import { readSavedIds, readSavedLocks, type Selection } from './selection.ts';
import type { RescueDraft } from '../recovery/types.ts';
import { findConflicts } from './meetings.ts';

export const namedScheduleLimit = 20;
export const scheduleNameLimit = 60;
export type ScheduleSnapshot = { sectionIds: string[]; lockedSectionIds: string[] };
export type NamedSchedule = ScheduleSnapshot & {
  id: string; name: string; sourceId: string; revision: number; createdAt: string; updatedAt: string;
};
export type ScheduleLibrary = { version: 1; sourceId: string; legacyHandled: boolean; schedules: NamedSchedule[] };
export const libraryKey = (sourceId: string) => `bettercsp:schedule-library:v1:${sourceId}`;

export function scheduleName(name: string, schedules: NamedSchedule[], except?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > scheduleNameLimit || /[\p{Cc}\p{Cf}]/u.test(clean)) throw new Error('Enter a name of 1–60 characters.');
  if (schedules.some(row => row.id !== except && row.name.toLowerCase() === clean.toLowerCase())) throw new Error('That schedule name is already in use.');
  return clean;
}
export function suggestScheduleName(name: string, schedules: NamedSchedule[]): string {
  const base = name.slice(0, scheduleNameLimit);
  let next = base;
  for (let n = 2; schedules.some(row => row.name.toLowerCase() === next.toLowerCase()); n++) {
    const suffix = ' ' + n;
    next = base.slice(0, scheduleNameLimit - suffix.length) + suffix;
  }
  return next;
}
export function readScheduleLibrary(raw: string | null, sourceId: string): ScheduleLibrary {
  if (raw === null) return { version: 1, sourceId, legacyHandled: false, schedules: [] };
  if (raw.length > 100_000) throw new Error('Schedule library is too large.');
  const library = JSON.parse(raw) as ScheduleLibrary | null;
  if (!library || library.version !== 1 || library.sourceId !== sourceId || typeof library.legacyHandled !== 'boolean' ||
      !Array.isArray(library.schedules) || library.schedules.length > namedScheduleLimit) throw new Error('Invalid schedule library.');
  const schedules: NamedSchedule[] = [];
  for (const row of library.schedules) {
    if (!row || typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id) || schedules.some(s => s.id === row.id) ||
        typeof row.name !== 'string' || row.sourceId !== sourceId || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        !validDate(row.createdAt) || !validDate(row.updatedAt) || row.updatedAt < row.createdAt) throw new Error('Invalid named schedule.');
    if (!Array.isArray(row.lockedSectionIds)) throw new Error('Invalid schedule locks.');
    const draft = JSON.stringify({ version: 1, sourceId, sectionIds: row.sectionIds, lockedSectionIds: row.lockedSectionIds });
    schedules.push({ id: row.id, name: scheduleName(row.name, schedules), sourceId, revision: row.revision,
      createdAt: row.createdAt, updatedAt: row.updatedAt, sectionIds: readSavedIds(draft, sourceId), lockedSectionIds: readSavedLocks(draft, sourceId) });
  }
  return { version: 1, sourceId, legacyHandled: library.legacyHandled, schedules };
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function sameSchedule(a: ScheduleSnapshot, b: ScheduleSnapshot): boolean {
  return JSON.stringify([...a.sectionIds].sort()) === JSON.stringify([...b.sectionIds].sort()) &&
    JSON.stringify([...a.lockedSectionIds].sort()) === JSON.stringify([...b.lockedSectionIds].sort());
}

// Activation is a separate transition because registration reports belong to the working term.
export function activateNamedSchedule(draft: RescueDraft, currentMissing: string[], saved: ScheduleSnapshot, selections: Selection[]): RescueDraft {
  if (currentMissing.length) throw new Error('Resolve unavailable indexes in the working draft before switching.');
  const incoming = new Set(selections.map(s => s.section.id));
  if (saved.sectionIds.length !== incoming.size || saved.sectionIds.some(id => !incoming.has(id))) throw new Error('This saved schedule has unavailable indexes.');
  const registered = Object.keys(draft.statuses).filter(id => draft.statuses[id] === 'registered' && !incoming.has(id));
  if (registered.length) throw new Error('This plan omits registered indexes ' + registered.map(id => id.split(':').at(-1)).join(', ') + '. Keep those sections or reconcile the reports in My Schedule.');
  const locked = draft.locks.filter(id => !incoming.has(id));
  if (locked.length) throw new Error('This plan omits manually locked indexes ' + locked.map(id => id.split(':').at(-1)).join(', ') + '. Review those locks in the working draft.');
  if (new Set(selections.map(s => s.course.id)).size !== selections.length) throw new Error('This plan contains multiple sections of one course.');
  if (findConflicts(selections.map(s => s.section)).length) throw new Error('This plan has overlapping meetings. Resolve the conflict before using it.');
  const locks = [...new Set([...draft.locks, ...saved.lockedSectionIds])];
  if (locks.length > 12) throw new Error('This switch would exceed the 12-section manual lock limit. Review the locks in both plans.');
  return { selections, locks, statuses: { ...draft.statuses } };
}
