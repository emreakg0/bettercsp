import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import type { Course, Meeting, Section } from '../catalog/types.ts';
import { generateSchedules } from './generate.ts';
import { scoreSchedule } from './scoring.ts';
import { defaultConstraints, defaultWeights, type GenerationRequest } from './generation-types.ts';
import { parseGenerationRequest } from './generation-request.ts';
import { findConflicts } from './meetings.ts';
import { applyGenerated, plannerCourse, readSavedLocks, selectSection } from './selection.ts';

const source = { id: '2027-1-NB', file: '', label: 'Spring 2027', capturedAt: null };
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), source);
const calculus = catalog.find(c => c.code === '01:640:251')!;
const dataStructures = catalog.find(c => c.code === '01:198:112')!;
const arabic = catalog.find(c => c.code === '01:013:140')!;
function meeting(day = 'M', start = 540, end = 600, campus = 'BUSCH'): Meeting {
  return { timing: 'scheduled', dayCode: day, startMinute: start, endMinute: end, campus, building: '', room: '', mode: 'LEC' };
}
function section(id: string, meetings = [meeting()]): Section {
  return { ...structuredClone(calculus.sections[0]), id, index: id, meetings, notices: [], honors: null,
    campuses: [...new Set(meetings.map(m => m.campus))], instructors: ['TEST, INSTRUCTOR'], raw: { index: id, number: id, meetingTimes: [], crossListedSections: [] } };
}
function course(code: string, sections: Section[]): Course {
  return { ...structuredClone(calculus), id: code, code, sections, notes: [], prerequisites: '' };
}
function request(courses: Course[]): GenerationRequest {
  return { choices: courses.map(c => ({ courseId: c.id, required: true })), constraints: structuredClone(defaultConstraints), weights: { ...defaultWeights }, preferredInstructors: [] };
}

test('real Data Structures and Multivariable Calculus preserve all index meeting components', () => {
  assert.equal(dataStructures.sections.length, 45); assert.equal(calculus.sections.length, 30);
  const result = generateSchedules([dataStructures, calculus], request([dataStructures, calculus]));
  assert.ok(result.schedules.length > 1);
  for (const schedule of result.schedules) {
    assert.equal(schedule.selections.length, 2);
    assert.deepEqual(findConflicts(schedule.selections.map(s => s.section)), []);
    assert.ok(schedule.selections.every(s => s.section.meetings.some(m => m.mode === 'RECIT')));
    assert.ok(schedule.selections.every(s => s.section.meetings.filter(m => m.mode === 'LEC').length === 2));
    assert.ok(schedule.restrictions.some(n => n.field === 'Prerequisites'));
    assert.ok(schedule.limitations.some(n => /Eligibility/.test(n)));
  }
});
test('an overlap in the last recitation or lab rejects the whole section', () => {
  const a = course('A', [section('a', [meeting('T'), { ...meeting('W', 660, 720), mode: 'RECIT' }])]);
  const b = course('B', [section('b', [{ ...meeting('W', 700, 760), mode: 'LAB' }])]);
  assert.equal(generateSchedules([a, b], request([a, b])).schedules.length, 0);
  a.sections[0].meetings[1].endMinute = 700;
  assert.equal(generateSchedules([a, b], request([a, b])).schedules.length, 1);
});
test('multiple labs and lectures are indivisible, including internal contradictory overlaps', () => {
  const a = course('A', [section('a', [meeting(), meeting('M', 550, 570)])]);
  const result = generateSchedules([a], request([a]));
  assert.equal(result.schedules.length, 0);
  assert.equal(result.reports[0].exclusions['Overlaps within section'], 1);
});
test('locks are preserved, conflicts between locks fail, and unselected locked courses are included', () => {
  const a = course('A', [section('a'), section('a2', [meeting('W')])]), b = course('B', [section('b')]);
  const input = request([a]); input.constraints.lockedSectionIds = ['a2', 'b'];
  const result = generateSchedules([a, b], input);
  assert.equal(result.schedules.length, 1);
  assert.deepEqual(result.schedules[0].selections.map(s => s.section.id), ['a2', 'b']);
  input.constraints.lockedSectionIds = ['a', 'b'];
  assert.equal(generateSchedules([a, b], input).schedules.length, 0);
  input.constraints.lockedSectionIds = ['a', 'a2'];
  assert.ok(generateSchedules([a, b], input).issues.some(i => /More than one section/.test(i)));
});
test('all hard constraints prune sections, including locks that violate them', () => {
  const a = course('A', [section('a')]);
  for (const patch of [{ earliestStart: 541 }, { latestEnd: 599 }, { daysOff: ['M'] }, { excludedSectionIds: ['a'] }, { excludedCampuses: ['busch'] }]) {
    const input = request([a]); Object.assign(input.constraints, patch); input.constraints.lockedSectionIds = ['a'];
    const result = generateSchedules([a], input);
    assert.equal(result.schedules.length, 0); assert.ok(result.issues[0].includes('no usable section'));
  }
});
test('unknown and arranged meetings are excluded, not treated as conflict-free', () => {
  const async: Meeting = { ...meeting(), timing: 'asynchronous', dayCode: '', startMinute: null, endMinute: null, campus: 'ONLINE' };
  const a = course('A', [section('a', [async]), section('arranged', [{ ...async, timing: 'arranged' }]), section('unknown', [{ ...async, timing: 'unknown' }])]);
  const result = generateSchedules([a], request([a]));
  assert.equal(result.reports[0].exclusions['Arranged or unknown timing'], 2);
  assert.equal(result.schedules.length, 1); assert.equal(result.schedules[0].metrics.earliestStart, null);
  assert.equal(result.schedules[0].metrics.classDays, 0);
  const input = request([a]); input.constraints.lockedSectionIds = ['unknown'];
  assert.equal(generateSchedules([a], input).schedules.length, 0);
  const real = generateSchedules([arabic], request([arabic]));
  assert.ok(real.schedules.length); assert.ok(real.schedules[0].selections[0].section.meetings.some(m => m.timing === 'asynchronous'));
});
test('real B flags with explicit times are excluded with a source consistency reason', () => {
  const actual = catalog.find(c => c.code === '01:991:170')!;
  const result = generateSchedules([actual], request([actual]));
  assert.ok(result.reports[0].exclusions['Inconsistent source timing']);
});
test('cross-listed course codes block duplicate credit even without overlapping times', () => {
  const a = course('01:001:001', [section('a')]), b = course('01:002:002', [section('b', [meeting('W')])]);
  a.sections[0].raw.crossListedSections = [{ offeringUnitCode: '01', subjectCode: '002', courseNumber: '002', registrationIndex: 'b' }];
  assert.equal(generateSchedules([a, b], request([a, b])).schedules.length, 0);
  const actual = catalog.find(c => c.code === '01:074:140')!;
  const duplicate = generateSchedules([arabic, actual], request([arabic, actual]));
  assert.equal(duplicate.schedules.length, 0);
  assert.ok(duplicate.issues.some(issue => issue.includes('01:013:140') && issue.includes('01:074:140') && issue.includes('Choose one')));
});
test('transitive cross-listing and same-course campus variants are conservative duplicates', () => {
  const a = course('01:001:001', [section('a')]), b = course('01:002:002', [section('b', [meeting('T')])]), c = course('01:003:003', [section('c', [meeting('W')])]);
  a.sections[0].raw.crossListedSections = [{ offeringUnitCode: '01', subjectCode: '002', courseNumber: '002' }];
  c.sections[0].raw.crossListedSections = [{ offeringUnitCode: '01', subjectCode: '002', courseNumber: '002' }];
  assert.equal(generateSchedules([a, b, c], request([a, b, c])).schedules.length, 0);
  const variant = structuredClone(a); variant.id = 'variant'; variant.sections = [section('variant', [meeting('U')])];
  assert.equal(generateSchedules([a, variant], request([a, variant])).schedules.length, 0);
});
test('explicit separate-registration notes remain unresolved; no automatic section pairing is inferred', () => {
  const lecture = catalog.find(c => c.code === '01:070:407')!;
  const result = generateSchedules([lecture], request([lecture]));
  assert.ok(result.schedules.length);
  assert.ok(result.schedules[0].limitations.some(n => /MUST ALSO REGISTER FOR 01:070:408/.test(n)));
  assert.equal(result.schedules[0].selections.length, 1);
});
test('optional courses may be omitted, but coverage ranks before weighted preferences', () => {
  const a = course('A', [section('a')]), b = course('B', [section('b', [meeting('W')])]);
  const input = request([a, b]); input.choices[1].required = false;
  const result = generateSchedules([a, b], input);
  assert.equal(result.schedules[0].optionalIncluded, 1);
  assert.equal(result.schedules.at(-1)!.optionalIncluded, 0);
  b.sections[0].meetings = [meeting()];
  assert.equal(generateSchedules([a, b], input).schedules[0].optionalIncluded, 0);
});
test('weighted scoring exposes days, gaps, daily starts, physical-campus transitions, and instructors', () => {
  const a = section('a', [meeting('M', 540, 600, 'BUSCH'), meeting('T', 600, 660, 'ONLINE')]);
  const b = section('b', [meeting('M', 660, 720, 'LIVINGSTON')]); b.instructors = ['PREFERRED, PROFESSOR'];
  const { metrics, breakdown, score } = scoreSchedule([a, b], defaultWeights, ['PREFERRED']);
  assert.equal(metrics.classDays, 2); assert.equal(metrics.earliestStart, 540); assert.equal(metrics.gapMinutes, 60);
  assert.equal(metrics.campusTransitions, 1); assert.equal(metrics.commuteDays, 1); assert.equal(metrics.meanFirstStart, 570);
  assert.equal(metrics.unmatchedInstructors, 1);
  assert.equal(score, breakdown.reduce((sum, part) => sum + part.amount, 0));
});
test('later-start, gap, campus, day-off, commute, and instructor weights change ranking predictably', () => {
  const a = course('A', [section('early', [meeting('M', 540, 600)]), section('late', [meeting('M', 720, 780)])]);
  const input = request([a]); input.weights = { daysOff: 0, gaps: 0, campusChanges: 0, commuteDays: 0, instructors: 0, laterStarts: 5 };
  assert.equal(generateSchedules([a], input).schedules[0].selections[0].section.id, 'late');
  a.sections[0].instructors = ['MY PROFESSOR']; input.preferredInstructors = ['my professor']; input.weights.laterStarts = 0; input.weights.instructors = 5;
  assert.equal(generateSchedules([a], input).schedules[0].selections[0].section.id, 'early');
});
test('duplicate inputs and duplicate sections never produce duplicate retained schedules', () => {
  const a = course('A', [section('a'), section('a')]); const input = request([a]); input.choices.push(input.choices[0]);
  const result = generateSchedules([a], input); assert.equal(result.schedules.length, 1);
});
test('deterministic results are unaffected by input course or section order', () => {
  const input = request([dataStructures, calculus]);
  const a = generateSchedules([dataStructures, calculus], input);
  const reversed = [structuredClone(calculus), structuredClone(dataStructures)]; reversed.forEach(c => c.sections.reverse());
  const b = generateSchedules(reversed, input);
  assert.deepEqual(a, b);
});
test('large products have bounded work and retained memory, with explicit truncation', () => {
  const async = { ...meeting(), timing: 'asynchronous' as const, dayCode: '', startMinute: null, endMinute: null, campus: 'ONLINE' };
  const many = Array.from({ length: 8 }, (_, i) => course(`C${i}`, Array.from({ length: 40 }, (_, j) => section(`${i}-${j}`, [async]))));
  const result = generateSchedules(many, request(many), { maxNodes: 500, maxResults: 5 });
  assert.ok(result.truncated); assert.ok(result.visited <= 500); assert.equal(result.schedules.length, 5);
  assert.deepEqual(result, generateSchedules(many, request(many), { maxNodes: 500, maxResults: 5 }));
});
test('invalid request boundaries reject NaN, weights, date ranges, days and oversized course sets', () => {
  for (const mutate of [
    r => { r.constraints.earliestStart = NaN; }, r => { r.constraints.latestEnd = -1; },
    r => { r.constraints.daysOff = ['R']; }, r => { r.weights.gaps = -1; },
    r => { r.constraints.earliestStart = 900; r.constraints.latestEnd = 800; },
    r => { r.choices = Array.from({ length: 13 }, () => r.choices[0]); },
  ] as ((r: GenerationRequest) => void)[]) {
    const input = request([calculus]); mutate(input); assert.throws(() => parseGenerationRequest(input));
  }
  assert.ok(generateSchedules([calculus], request([])).issues.length);
});
test('applying results preserves unrelated selections and locks, and removes omitted optional targets only', () => {
  const a = plannerCourse(calculus), b = plannerCourse(dataStructures), c = plannerCourse(arabic);
  let selected = selectSection([], a, a.sections[0]); selected = selectSection(selected, b, b.sections[0]);
  const generated = selectSection([], c, c.sections[0]);
  const applied = applyGenerated(selected, generated, [a.id], [b.sections[0].id]);
  assert.equal(applied.length, 2); assert.ok(applied.some(s => s.course.id === b.id));
  assert.ok(!applied.some(s => s.course.id === a.id));
  assert.throws(() => applyGenerated(selected, generated, [a.id, b.id], [b.sections[0].id]));
  const save = JSON.stringify({ version: 1, sourceId: source.id, sectionIds: [a.sections[0].id], lockedSectionIds: [a.sections[0].id] });
  assert.deepEqual(readSavedLocks(save, source.id), [a.sections[0].id]);
  assert.deepEqual(readSavedLocks(JSON.stringify({ version: 1, sourceId: source.id, sectionIds: [] }), source.id), []);
});

test('days off and commute weights favor compact physical attendance; gaps and transitions rank independently', () => {
  const compact = section('compact', [meeting('M', 540, 600), meeting('M', 600, 660)]);
  const spread = section('spread', [meeting('M', 540, 600), meeting('T', 600, 660)]);
  const zero = { daysOff: 0, laterStarts: 0, gaps: 0, campusChanges: 0, commuteDays: 0, instructors: 0 };
  for (const weight of ['daysOff', 'commuteDays'] as const) {
    assert.ok(scoreSchedule([compact], { ...zero, [weight]: 5 }, []).score < scoreSchedule([spread], { ...zero, [weight]: 5 }, []).score);
  }
  const gaps = section('gaps', [meeting('M', 540, 600), meeting('M', 660, 720)]);
  assert.ok(scoreSchedule([compact], { ...zero, gaps: 5 }, []).score < scoreSchedule([gaps], { ...zero, gaps: 5 }, []).score);
  const transitions = section('transitions', [meeting('M', 540, 600), meeting('M', 600, 660, 'LIVINGSTON')]);
  assert.ok(scoreSchedule([compact], { ...zero, campusChanges: 5 }, []).score < scoreSchedule([transitions], { ...zero, campusChanges: 5 }, []).score);
});
test('applying a complete generated schedule deduplicates retained contextual locks', () => {
  const a = plannerCourse(calculus), b = plannerCourse(dataStructures);
  const current = selectSection(selectSection([], a, a.sections[0]), b, b.sections[0]);
  const generated = selectSection(selectSection([], a, a.sections[1]), b, b.sections[0]);
  assert.equal(applyGenerated(current, generated, [a.id], [b.sections[0].id]).length, 2);
});

test('non-finite internal budgets fall back to bounded defaults and unknown campuses cannot satisfy exclusions', () => {
  const a = course('A', [section('a', [meeting('M', 540, 600, '')])]);
  const input = request([a]); input.constraints.excludedCampuses = ['BUSCH'];
  assert.equal(generateSchedules([a], input).reports[0].exclusions['Unknown campus under campus exclusions'], 1);
  input.constraints.excludedCampuses = [];
  const result = generateSchedules([a], input, { maxNodes: NaN, maxResults: Infinity });
  assert.equal(result.schedules.length, 1); assert.ok(result.visited <= 25000);
});

test('small complete searches match independent exhaustive interval enumeration', () => {
  const a = course('A', [section('a1', [meeting('M')]), section('a2', [meeting('T')])]);
  const b = course('B', [section('b1', [meeting('M', 570, 630)]), section('b2', [meeting('W')])]);
  const c = course('C', [section('c1', [meeting('T', 570, 630)]), section('c2', [meeting('F')])]);
  const expected: string[] = [];
  for (const x of a.sections) for (const y of b.sections) for (const z of c.sections) {
    const rows = [x, y, z]; let conflict = false;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      for (const m of rows[i].meetings) for (const n of rows[j].meetings) {
        if (m.dayCode === n.dayCode && m.startMinute! < n.endMinute! && n.startMinute! < m.endMinute!) conflict = true;
      }
    }
    if (!conflict) expected.push(rows.map(s => s.id).sort().join('|'));
  }
  const result = generateSchedules([a, b, c], request([a, b, c]), { maxResults: 20 });
  assert.equal(result.truncated, false);
  assert.deepEqual(result.schedules.map(s => s.id).sort(), expected.sort());
});
test('applying a result rejects a conflict with a retained manual section', () => {
  const a = plannerCourse(course('A', [section('a')])), b = plannerCourse(course('B', [section('b')]));
  assert.throws(() => applyGenerated(selectSection([], a, a.sections[0]), selectSection([], b, b.sections[0]), [b.id], []), /overlap/);
});
