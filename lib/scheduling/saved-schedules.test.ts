import test from 'node:test';
import assert from 'node:assert/strict';
import { activateNamedSchedule, readScheduleLibrary, scheduleName, suggestScheduleName } from './saved-schedules.ts';
import type { RescueDraft } from '../recovery/types.ts';
import { registrationAfterChange } from '../recovery/state.ts';
import type { Selection } from './selection.ts';

const sourceId = '2027-1-NB';
const firstId = sourceId + ':14411', nextId = sourceId + ':14412', otherId = sourceId + ':14758';
const date = '2026-11-18T00:00:00.000Z';
const row = { id: '6e51f2c0-1234-1234-1234-123456789abc', name: 'Preferred', sourceId, sectionIds: [firstId],
  lockedSectionIds: [firstId], createdAt: date, updatedAt: date, revision: 1 };
const library = { version: 1, sourceId, legacyHandled: true, schedules: [row] };
const selection = (id: string, courseId: string): Selection => ({ course: { id: courseId }, section: { id, meetings: [] } } as unknown as Selection);

test('named libraries validate source, schema, identities, timestamps and locks', () => {
  const restore = (value: unknown) => readScheduleLibrary(JSON.stringify(value), sourceId);
  assert.deepEqual(restore(library), library);
  for (const invalid of [{ sourceId: '2027-1-NK' }, { version: 2 }, { schedules: [{ ...row, updatedAt: '2026-02-30T00:00:00.000Z' }] },
    { schedules: [{ ...row, lockedSectionIds: [nextId] }] }, { schedules: [row, row] }, { schedules: [{ ...row, sectionIds: ['14758'] }] }]) {
    assert.throws(() => restore({ ...library, ...invalid }));
  }
  assert.throws(() => readScheduleLibrary('{broken', sourceId));
});

test('names are cleaned and case-insensitive, and copies have independent arrays', () => {
  assert.equal(scheduleName('  Evening    plan ', [row]), 'Evening plan');
  assert.throws(() => scheduleName(' preferred ', [row]), /already in use/);
  assert.equal(suggestScheduleName('Preferred', [row]), 'Preferred 2');
  const copy = { ...row, name: 'Backup', id: 'a' + row.id.slice(1) };
  const loaded = readScheduleLibrary(JSON.stringify({ ...library, schedules: [row, copy] }), sourceId);
  loaded.schedules[1].sectionIds.push(nextId);
  assert.deepEqual(loaded.schedules[0].sectionIds, [firstId]);
});

test('activation preserves all registration reports and unions locks while rejecting missing protection', () => {
  const first = selection(firstId, 'discrete'), other = selection(otherId, 'writing');
  const draft: RescueDraft = { selections: [first], locks: [firstId], statuses: { [firstId]: 'registered', [nextId]: 'failed' } };
  const saved = { sectionIds: [firstId, otherId], lockedSectionIds: [otherId] };
  const result = activateNamedSchedule(draft, [], saved, [first, other]);
  assert.deepEqual(result.statuses, draft.statuses);
  assert.deepEqual(result.locks, [firstId, otherId]);
  assert.throws(() => activateNamedSchedule(draft, [], saved, [first]), /unavailable/);
  assert.throws(() => activateNamedSchedule(draft, [nextId], saved, [first, other]), /unavailable/);
  assert.throws(() => activateNamedSchedule(draft, [], { sectionIds: [otherId], lockedSectionIds: [] }, [other]), /registered indexes/);
  assert.throws(() => activateNamedSchedule({ ...draft, statuses: {} }, [], { sectionIds: [otherId], lockedSectionIds: [] }, [other]), /manually locked/);
  assert.equal(registrationAfterChange([], [first], draft.statuses)[firstId], 'registered');
});
