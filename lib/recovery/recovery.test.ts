import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import type { Course, Meeting, Section } from '../catalog/types.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { defaultConstraints, defaultWeights } from '../scheduling/generation-types.ts';
import { plannerCourse } from '../scheduling/selection.ts';
import { snapshotEvidence, createAvailabilityReader, parseOpenIndexes, reportedAvailability } from '../availability/evidence.ts';
import { applyCourseFallback, applyRepair, draftSignature, parseRegistrationStatuses, readSavedRegistration, undoRepair } from './state.ts';
import { rescueSchedule } from './rescue.ts';
import { parseCourseFallback, parseRescueRequest } from './request.ts';
import { findCourseFallbacks } from './course-fallback.ts';
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

test('course alternatives check another real CS112 section first and retain three registered indexes', () => {
  const target = cs.sections.find(s => s.availability === 'closed')!;
  // Fix three fixture registrations around the real Data Structures and Linear Algebra sections.
  const kept = [course('01:355:101', [section('81001', [meeting('S')])]), course('01:750:193', [section('81002', [meeting('U')])]),
    course('01:013:140', [section('81003', [meeting('F', 470, 500)])])];
  const linear = catalog.find(c => c.code === '01:640:250')!;
  const full = [cs, linear, ...kept];
  const r = request([target.id, ...kept.map(c => c.sections[0].id)]);
  r.statuses = Object.fromEntries(r.sectionIds.slice(1).map(id => [id, 'registered']));
  r.statuses[target.id] = 'failed';
  r.settings.constraints.lockedSectionIds = [kept[0].sections[0].id];
  const result = findCourseFallbacks(full, r, target.id, [linear.code]);
  assert.equal(result.options[0]?.selection.course.code, cs.code);
  const alternative = result.options.find(option => option.selection.course.code === linear.code)!.selection;
  const current = draft(full, r);
  const sameCourse = rescueSchedule(full, { ...r, replaceSectionIds: [target.id] }, snapshot).repairs[0];
  assert.ok(sameCourse);
  const forged = { ...sameCourse, schedule: { ...sameCourse.schedule, selections: [...current.selections.slice(1), alternative] } };
  assert.throws(() => applyRepair(current, forged, result.basis, []), /cannot silently remove/);
  const applied = applyCourseFallback(current, target.id, alternative, result.basis);
  for (const id of r.sectionIds.slice(1)) assert.equal(applied.statuses[id], 'registered');
  assert.equal(applied.statuses[alternative.section.id], 'planned');
  assert.deepEqual(applied.locks, current.locks);
  assert.deepEqual(undoRepair(applied, current, draftSignature(applied)), current);
  assert.throws(() => applyCourseFallback(applied, target.id, alternative, result.basis), /changed/);
  r.statuses[target.id] = 'registered';
  assert.match(findCourseFallbacks(full, r, target.id, [linear.code]).issue!, /protected/);
  assert.throws(() => applyCourseFallback(current, kept[0].sections[0].id, alternative, draftSignature(current)), /protected/);
});

test('course fallback filters snapshot closures, overlap, short travel, hard constraints and permission', () => {
  const bad = course('01:198:112', [section('82001', [meeting('M')], 'closed'), section('82002', [meeting('M', 560, 620)])]);
  const kept = course('01:355:101', [section('82003', [meeting('M')])]);
  const proposed = course('01:640:250', [section('82004', [{ ...meeting('M', 639, 690), campus: 'COLLEGE AVENUE' }]),
    section('82005', [{ ...meeting('M', 640, 690), campus: 'COLLEGE AVENUE' }]), section('82006', [meeting('T', 1100, 1200)]),
    section('82007', [meeting('W')], 'closed')]);
  const r = request([bad.sections[0].id, kept.sections[0].id]);
  r.settings.constraints.latestEnd = 1100;
  const result = findCourseFallbacks([bad, kept, proposed], r, bad.sections[0].id, [proposed.code]);
  assert.deepEqual(result.options.map(option => option.selection.section.index), ['82005']);
  const noResult = findCourseFallbacks([bad, kept], r, bad.sections[0].id, [proposed.code]);
  assert.deepEqual(noResult.options, []);
  assert.equal(noResult.truncated, false);
  const limited = findCourseFallbacks([bad, kept, proposed], r, bad.sections[0].id, [proposed.code], 1);
  assert.ok(limited.truncated);
  assert.ok(limited.visited <= 1);
  const honors = calculus.sections.find(s => s.index === '15919')!;
  assert.deepEqual(findCourseFallbacks([bad, kept, { ...calculus, sections: [{ ...honors, availability: 'open' }] }], r, bad.sections[0].id, [calculus.code]).options, []);
});

test('course fallback requests validate the term, candidates, target and absence of overrides', () => {
  const r = request([`${sourceId}:82001`]);
  const valid = { targetId: r.sectionIds[0], candidateCodes: ['01:198:205', '01:198:205'] };
  assert.deepEqual(parseCourseFallback(valid, r, sourceId).candidateCodes, ['01:198:205']);
  assert.throws(() => parseCourseFallback(valid, r, '2027-1-NK'), /unavailable/);
  assert.throws(() => parseCourseFallback({ ...valid, targetId: `${sourceId}:82002` }, r, sourceId), /Invalid/);
  assert.throws(() => parseCourseFallback({ ...valid, candidateCodes: ['01:198:122'] }, r, sourceId), /Invalid/);
  assert.throws(() => parseCourseFallback(valid, { ...r, overrideProtectionIds: r.sectionIds }, sourceId), /unavailable/);
});

test('one snapshot-closed real Calculus section is replaced while registered Data Structures is preserved', () => {
  const chosenCs = cs.sections.find(s => s.availability === 'open')!; assert.ok(chosenCs);
  const r = request([calculus.sections[0].id, chosenCs.id]); r.replaceSectionIds = [calculus.sections[0].id]; r.statuses[chosenCs.id] = 'registered';
  const result = rescueSchedule([calculus, cs], r, snapshot);
  assert.ok(result.repairs.length);
  assert.ok(result.problems.some(p => p.source === 'availability' && /snapshot/.test(p.message)));
  assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === chosenCs.id)));
});
test('multiple explicitly requested replacements preserve unrelated courses', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]);
  const b = course('B', [section('10003', [meeting('W')]), section('10004', [meeting('H')])]);
  const c = course('C', [section('10005', [meeting('F')])]); const r = request([a.sections[0].id, b.sections[0].id, c.sections[0].id]);
  r.statuses[a.sections[0].id] = 'failed'; r.statuses[b.sections[0].id] = 'failed';
  assert.equal(rescueSchedule([a, b, c], r, snapshot).visited, 0);
  r.replaceSectionIds = [a.sections[0].id, b.sections[0].id];
  const result = rescueSchedule([a, b, c], r, snapshot);
  assert.equal(result.repairs[0].changedIds.length, 2); assert.equal(result.changeBudget, 2);
  assert.ok(result.repairs[0].schedule.selections.some(s => s.section.id === c.sections[0].id));
  assert.ok(result.problems.filter(p => p.source === 'student').length >= 2);
});
test('minimum changes dominate preferences and minimal-stage alternatives never include extra disruption', () => {
  const a = course('A', [section('10001'), section('10002', [meeting('M', 600, 660)])]);
  const b = course('B', [section('10003', [meeting('T')]), section('10004', [meeting('W', 900, 960)])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id]; r.settings.weights.laterStarts = 10;
  const result = rescueSchedule([a, b], r, snapshot);
  assert.equal(result.changeBudget, 1); assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === b.sections[0].id)));
});
test('one additional planned section is rearranged only when replacing the problem alone cannot work', () => {
  const a = course('A', [section('10001', [meeting('M')]), section('10002', [meeting('T')])]);
  const b = course('B', [section('10003', [meeting('T')]), section('10004', [meeting('W')])]);
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id];
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
test('H1 permission stays diagnostic until the student requests a replacement', () => {
  const h1 = calculus.sections.find(s => s.index === '15919')!; const r = request([h1.id]); r.statuses[h1.id] = 'needs-permission';
  const diagnosis = rescueSchedule([calculus], r, snapshot);
  assert.equal(diagnosis.visited, 0);
  assert.equal(diagnosis.repairs.length, 0);
  assert.ok(diagnosis.problems.some(p => p.source === 'eligibility' && /invitation/.test(p.message)));
  assert.ok(diagnosis.problems.every(p => !p.requiresReplacement));
  r.replaceSectionIds = [h1.id];
  const result = rescueSchedule([calculus], r, snapshot);
  assert.ok(result.repairs.length);
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
  const a = course('A', [section('10001'), section('10002', [meeting('T')])]); const r = request([a.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id]; r.settings.constraints.daysOff = ['T'];
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
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id]; r.statuses[b.sections[0].id] = 'registered';
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
  const r = request(many.map(c => c.sections[0].id)); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id];
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
  const r = request([a.sections[0].id, b.sections[0].id]); r.statuses[a.sections[0].id] = 'failed'; r.replaceSectionIds = [a.sections[0].id];
  const result = rescueSchedule([a, b], r, snapshot);
  assert.ok(result.repairs.length); assert.ok(result.repairs.every(p => p.changedIds.length === 1));
  assert.ok(result.repairs.every(p => p.schedule.selections.some(s => s.section.id === b.sections[0].id)));
  assert.ok(result.repairs.every(p => p.requiresReview));
});


test('repairing a conflict does not automatically replace an unrelated permission report', () => {
  const a = course('A', [section('10001'), section('10004', [meeting('T')])]);
  const b = course('B', [section('10002')]);
  const c = course('C', [section('10003', [meeting('W')]), section('10005', [meeting('H')])]);
  const r = request([a.sections[0].id, b.sections[0].id, c.sections[0].id]);
  r.statuses[b.sections[0].id] = 'registered';
  r.statuses[c.sections[0].id] = 'needs-permission';
  const result = rescueSchedule([a, b, c], r, snapshot);
  assert.equal(result.changeBudget, 1);
  assert.deepEqual(result.repairs[0].changedIds, [a.sections[0].id]);
});
