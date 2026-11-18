import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import type { Course, Meeting, Section } from '../catalog/types.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { defaultConstraints, defaultWeights } from '../scheduling/generation-types.ts';
import { plannerCourse } from '../scheduling/selection.ts';
import { snapshotEvidence, createAvailabilityReader, parseOpenIndexes, reportedAvailability } from '../availability/evidence.ts';
import { applyRepair, draftSignature, parseRegistrationStatuses, readSavedRegistration, undoRepair } from './state.ts';
import { rescueSchedule } from './rescue.ts';
import { parseRescueRequest } from './request.ts';
import type { RescueDraft, RescueRequest, AvailabilityEvidence } from './types.ts';

const sourceId = '2027-1-NB';
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), { id: sourceId, file: '', label: '', capturedAt: null });
const calculus = catalog.find(c => c.code === '01:640:251')!, cs = catalog.find(c => c.code === '01:198:112')!;
const snapshot = snapshotEvidence(sourceId);
function meeting(day = 'M', start = 540, end = 600): Meeting { return { timing: 'scheduled', dayCode: day, startMinute: start, endMinute: end, campus: 'BUSCH', building: '', room: '', mode: 'LEC' }; }
function section(index: string, meetings = [meeting()], availability: Section['availability'] = 'open'): Section {
  return { ...structuredClone(calculus.sections[0]), id: `${sourceId}:${index}`, index, number: index, meetings, availability,
    campuses: ['BUSCH'], notices: [], honors: null, raw: { index, number: index, meetingTimes: [], crossListedSections: [] } };
}
function course(code: string, sections: Section[]): Course { return { ...structuredClone(calculus), id: code, code, sections, prerequisites: '', notes: [] }; }
function request(ids: string[]): RescueRequest { return { sectionIds: ids, statuses: {}, replaceSectionIds: [], overrideProtectionIds: [], settings: {
  choices: [], constraints: structuredClone(defaultConstraints), weights: { ...defaultWeights }, preferredInstructors: [], eligibility: { profile: structuredClone(emptyProfile), excludeConfirmed: true },
} }; }
function draft(courses: Course[], r: RescueRequest): RescueDraft {
  return { selections: courses.flatMap(c => { const { sections, ...info } = plannerCourse(c); return sections.filter(s => r.sectionIds.includes(s.id)).map(section => ({ course: info, section })); }), locks: r.settings.constraints.lockedSectionIds, statuses: r.statuses };
}

test('one snapshot-closed real Calculus section is replaced while registered Data Structures is preserved', () => {
  const chosenCs = cs.sections.find(s => s.availability === 'open')!; assert.ok(chosenCs);
  const r = request([calculus.sections[0].id, chosenCs.id]); r.replaceSectionIds = [calculus.sections[0].id]; r.statuses[chosenCs.id] = 'registered';
  const result = rescueSchedule([calculus, cs], r, snapshot);
  assert.ok(result.repairs.length);
  assert.ok(result.problems.some(p => p.source === 'availability' && /snapshot/.test(p.message)));
  assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === chosenCs.id)));
});
test('multiple student-reported failures are repaired together without disturbing other courses', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]);
  const b = course('B', [section('10003', [meeting('W')]), section('10004', [meeting('H')])]);
  const c = course('C', [section('10005', [meeting('F')])]); const r = request([a.sections[0].id, b.sections[0].id, c.sections[0].id]);
  r.statuses[a.sections[0].id] = 'failed'; r.statuses[b.sections[0].id] = 'failed';
  const result = rescueSchedule([a, b, c], r, snapshot);
  assert.equal(result.repairs[0].changedIds.length, 2); assert.equal(result.changeBudget, 2);
  assert.ok(result.repairs[0].schedule.selections.some(s => s.section.id === c.sections[0].id));
  assert.ok(result.problems.filter(p => p.source === 'student').length >= 2);
});
test('minimum changes dominate preferences and minimal-stage alternatives never include extra disruption', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('M', 600, 660)])]);
  const b = course('B', [section('10003', [meeting('T')]), section('10004', [meeting('W', 900, 960)])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.settings.weights.laterStarts = 10;
  const result = rescueSchedule([a, b], r, snapshot);
  assert.equal(result.changeBudget, 1); assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === b.sections[0].id)));
});
test('one additional planned section is rearranged only when replacing the problem alone cannot work', () => {
  const a = course('A', [section('10001', [meeting('M')]), section('10002', [meeting('T')])]);
  const b = course('B', [section('10003', [meeting('T')]), section('10004', [meeting('W')])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed';
  const result = rescueSchedule([a, b], r, snapshot);
  assert.equal(result.changeBudget, 2); assert.equal(result.repairs[0].changedIds.length, 2);
});
test('registered and locked sections require explicit exploration overrides and separate apply authorization', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]); const r = request([a.sections[0].id]);
  r.statuses[a.sections[0].id] = 'registered'; r.settings.constraints.lockedSectionIds = [a.sections[0].id]; r.replaceSectionIds = [a.sections[0].id];
  assert.equal(rescueSchedule([a], r, snapshot).repairs.length, 0);
  r.overrideProtectionIds = [a.sections[0].id]; const result = rescueSchedule([a], r, snapshot); assert.ok(result.repairs.length);
  const before = draft([a], r); assert.throws(() => applyRepair(before, result.repairs[0], result.basis, []), /Explicit approval/);
  const after = applyRepair(before, result.repairs[0], result.basis, r.overrideProtectionIds);
  assert.equal(after.statuses[a.sections[1].id], 'planned');
  assert.equal(after.statuses[a.sections[0].id], 'registered'); // Keep the unresolved prior-enrollment report.
  assert.deepEqual(after.locks, []);
});
test('honors permission failure uses real H1 and never labels unknown eligibility as resolved', () => {
  const h1 = calculus.sections.find(s => s.index === '15919')!; const r = request([h1.id]); r.statuses[h1.id] = 'needs-permission';
  const result = rescueSchedule([calculus], r, snapshot); assert.ok(result.repairs.length);
  assert.ok(result.problems.some(p => p.source === 'eligibility' && /invitation/.test(p.message)));
  assert.ok(result.repairs.every(p => !p.schedule.selections.some(s => s.section.id === h1.id)));
  assert.ok(result.repairs.every(p => p.requiresReview));
  assert.ok(result.repairs.some(p => p.schedule.eligibility.some(e => e.status === 'verification-needed')));
});
test('a protected timetable conflict is infeasible until protection changes are explicitly authorized', () => {
  const a = course('A', [section('10001')]), b = course('B', [section('10002')]); const r = request([a.sections[0].id, b.sections[0].id]);
  r.statuses[a.sections[0].id] = 'registered'; r.statuses[b.sections[0].id] = 'registered';
  const result = rescueSchedule([a, b], r, snapshot); assert.equal(result.repairs.length, 0);
  assert.ok(result.issues.some(i => /Explicitly authorize/.test(i)));
});
test('hard constraints remain hard during rescue, even when a failed section has an alternative', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]); const r = request([a.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.settings.constraints.daysOff = ['T'];
  assert.equal(rescueSchedule([a], r, snapshot).repairs.length, 0);
});
test('registered snapshot-closed sections are not diagnosed as failed enrollment', () => {
  const a = course('A', [section('10001', [meeting()], 'closed')]); const r = request([a.sections[0].id]); r.statuses[a.sections[0].id] = 'registered';
  const result = rescueSchedule([a], r, snapshot); assert.equal(result.problems.filter(p => p.source === 'availability').length, 0);
});
test('stale/missing/unverified availability never establishes current open or closed seats', () => {
  const s = section('10001', [meeting()], 'open');
  for (const state of ['snapshot', 'stale', 'failed', 'unverified'] as const) assert.equal(reportedAvailability(s, { ...snapshot, state, openIndexes: [] }), 'open');
  assert.equal(reportedAvailability(s, { ...snapshot, state: 'fresh', openIndexes: [] }), 'closed');
  assert.equal(reportedAvailability(s, { ...snapshot, sourceId: '2027-1-NK', state: 'fresh', openIndexes: [] }), 'open');
});
test('availability cache records actual successful retrieval, coalesces calls and retries responsibly', async () => {
  let time = 100000, calls = 0, fail = false;
  const fetcher: typeof fetch = async () => { calls++; if (fail) throw new Error('offline'); time += 100; return new Response(JSON.stringify(['10001', '10002'])); };
  const read = createAvailabilityReader(fetcher, () => time);
  const [first, same] = await Promise.all([read(sourceId), read(sourceId)]);
  assert.equal(calls, 1); assert.deepEqual(first, same); assert.equal(first.retrievedAt, new Date(100100).toISOString());
  assert.equal(first.state, 'unverified'); assert.deepEqual(first.openIndexes, []);
  await read(sourceId); assert.equal(calls, 1);
  time += 60001; fail = true; const stale = await read(sourceId); assert.equal(stale.state, 'stale'); assert.equal(stale.retrievedAt, first.retrievedAt);
  await read(sourceId); assert.equal(calls, 2);
  const failed = await createAvailabilityReader(fetcher, () => time)(sourceId); assert.equal(failed.state, 'failed'); assert.equal(failed.retrievedAt, null);
  assert.throws(() => parseOpenIndexes(['10001', '10001'])); assert.throws(() => parseOpenIndexes([10001]));
});
test('repair apply and undo are atomic, preserve unrelated selections, and reject stale reports or locks', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]), b = course('B', [section('10003', [meeting('F')])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.statuses[b.sections[0].id] = 'registered';
  const result = rescueSchedule([a, b], r, snapshot), before = draft([a, b], r), repair = result.repairs[0]; assert.ok(repair);
  const after = applyRepair(before, repair, result.basis, []); assert.equal(after.statuses[b.sections[0].id], 'registered');
  assert.deepEqual(undoRepair(after, before, draftSignature(after)), before);
  assert.throws(() => applyRepair({ ...before, locks: [a.sections[0].id] }, repair, result.basis, []), /changed/);
  assert.throws(() => undoRepair({ ...after, statuses: {} }, before, draftSignature(after)), /no longer safe/);
});
test('status saves are scoped, legacy-compatible, and validated without overwriting prior reports', () => {
  const value = JSON.stringify({ version: 1, sourceId, sectionIds: [`${sourceId}:10001`], registrationStatuses: { [`${sourceId}:10001`]: 'failed' } });
  assert.equal(readSavedRegistration(value, sourceId)[`${sourceId}:10001`], 'failed');
  assert.deepEqual(readSavedRegistration(JSON.stringify({ version: 1, sourceId, sectionIds: [] }), sourceId), {});
  assert.throws(() => readSavedRegistration(value, '2027-1-NK'));
  assert.throws(() => parseRegistrationStatuses({ [`${sourceId}:10001`]: 'officially-confirmed' }, sourceId));
  const parsed = request([`${sourceId}:10001`]); parsed.overrideProtectionIds = [`${sourceId}:10002`]; assert.throws(() => parseRescueRequest(parsed, sourceId));
});
test('large products and repeated stages share a deterministic computation budget', () => {
  const a = course('A', [section('10001'), ...Array.from({ length: 30 }, (_, i) => section(String(11000 + i), [meeting('T')]))]);
  const many = [a, ...Array.from({ length: 6 }, (_, i) => course(`C${i}`, Array.from({ length: 25 }, (_, j) => section(String(20000 + i * 100 + j), [{ ...meeting(), timing: 'asynchronous', dayCode: '', startMinute: null, endMinute: null, campus: 'ONLINE' }]))))];
  const r = request(many.map(c => c.sections[0].id)); r.statuses[a.sections[0].id] = 'failed';
  const result = rescueSchedule(many, r, snapshot, 300);
  assert.ok(result.visited <= 300); assert.ok(result.truncated); assert.deepEqual(result, rescueSchedule(many, r, snapshot, 300));
  if (result.repairs.length) assert.ok(result.repairs.every(p => p.changedIds.length === 1));
});
test('verified fresh availability is kept separate from snapshot fallback in recovery', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')], 'closed')]); const r = request([a.sections[0].id]);
  const fresh: AvailabilityEvidence = { ...snapshot, state: 'fresh', retrievedAt: '2026-11-17T12:00:00Z', openIndexes: ['10002'] };
  const result = rescueSchedule([a], r, fresh); assert.ok(result.repairs.length); assert.equal(result.repairs[0].requiresReview, false);
  assert.equal(rescueSchedule([a], r, snapshot).repairs.length, 0); // No reported problem in the snapshot.
});

test('one confirmed failure does not force changes to unrelated snapshot-closed planned backups', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]);
  const b = course('B', [section('10003', [meeting('F')], 'closed'), section('10004', [meeting('W')])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed';
  const result = rescueSchedule([a, b], r, snapshot);
  assert.ok(result.repairs.length); assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === b.sections[0].id)));
  assert.ok(result.repairs.every(p => p.requiresReview));
});
