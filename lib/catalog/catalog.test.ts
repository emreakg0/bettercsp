import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, normalizeCourse, parseCourse, minute } from '../rutgers/normalize.ts';
import { searchCourses, findCourse } from './search.ts';
import type { CatalogSource } from './types.ts';

const source: CatalogSource = { id: '2027-1-NB', label: 'Test snapshot', file: '', capturedAt: null };
const input: unknown = JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8'));
const courses = normalizeCatalog(input, source);
const calculus = courses.find(c => c.code === '01:640:251');
assert.ok(calculus);

test('normalizes every snapshot record without losing course variants or section indexes', () => {
  assert.equal(courses.length, 4605);
  assert.equal(courses.reduce((count, c) => count + c.sections.length, 0), 11528);
  assert.equal(new Set(courses.map(c => c.id)).size, 4605);
  const variants = courses.filter(c => c.code === '01:750:193');
  assert.equal(variants.length, 2);
  assert.notEqual(variants[0].id, variants[1].id);
});
test('preserves actual calculus registration and lecture/recitation information', () => {
  assert.equal(calculus.title, 'MULTIVARIABLE CALCULUS');
  assert.equal(calculus.credits, 4);
  assert.equal(calculus.sections.length, 30);
  const first = calculus.sections[0];
  assert.equal(first.index, '15895');
  assert.equal(first.availability, 'closed');
  assert.deepEqual(first.meetings.map(m => m.mode), ['LEC', 'LEC', 'RECIT']);
  assert.equal(first.meetings[0].startMinute, 730);
  assert.equal(first.meetings[0].building, 'SEC');
  assert.match(calculus.prerequisites, / OR /);
  assert.doesNotMatch(calculus.prerequisites, /<em>/);
});
test('retains unknown restriction metadata and displays source signals without claiming eligibility', () => {
  const raw = structuredClone(calculus.raw);
  raw.sections[0].futureEligibilityRule = { code: 'X', message: 'Verify with department' };
  raw.sections[0].honorPrograms = [{ code: 'A' }];
  raw.sections[0].sectionCourseType = 'H';
  raw.sections[0].specialPermissionAddCode = '04';
  const section = normalizeCourse(raw, source).sections[0];
  assert.deepEqual(section.raw.futureEligibilityRule, raw.sections[0].futureEligibilityRule);
  assert.ok(section.notices.some(n => n.field === 'futureEligibilityRule' && n.text.includes('Verify')));
  assert.equal(section.delivery.label, 'Hybrid');
  assert.equal(section.honors?.kind, 'program-information');
  assert.ok(section.notices.some(n => n.field === 'specialPermissionAddCode' && n.text === '04'));
});
test('does not infer honors from a course prerequisite mentioning honors calculus', () => {
  assert.match(calculus.prerequisites, /HONORS/);
  assert.ok(calculus.sections.filter(s => /^\d+$/.test(s.number)).every(s => s.honors === null));
  assert.equal(calculus.sections.find(s => s.index === '15919')?.honors?.kind, 'designated');
});
test('preserves unknown credits, unlisted instructors, and unknown availability', () => {
  const raw = structuredClone(calculus.raw);
  raw.credits = null;
  raw.creditsObject = { code: 'BA', description: 'Credits by arrangement' };
  raw.sections[0].openStatus = null;
  const course = normalizeCourse(raw, source);
  assert.equal(course.credits, null);
  assert.equal(course.creditsLabel, 'Credits by arrangement');
  assert.equal(course.sections[0].availability, 'unknown');
  assert.deepEqual(course.sections[0].instructors, []);
});
test('validates malformed required records rather than silently dropping them', () => {
  assert.throws(() => normalizeCatalog([{ ...calculus.raw, credits: 'four' }], source), /record 0/);
  assert.throws(() => parseCourse({ ...calculus.raw, sections: [{ ...calculus.raw.sections[0], index: 'abc' }] }), /index/);
  assert.throws(() => normalizeCatalog([calculus.raw, calculus.raw], source), /Duplicate course/);
  assert.throws(() => normalizeCatalog({}, source), /array/);
});
test('invalid or missing meeting times remain unresolved instead of midnight', () => {
  assert.equal(minute(''), null);
  assert.equal(minute('2460'), null);
  assert.equal(minute('0000'), 0);
  const raw = structuredClone(calculus.raw);
  raw.sections[0].meetingTimes[0].endTimeMilitary = '0600';
  assert.equal(normalizeCourse(raw, source).sections[0].meetings[0].startMinute, null);
});
test('finds calculus by expanded title, case-insensitive code, and compact code', () => {
  for (const query of ['Multivariable Calculus', '01:640:251', '01640251', '  multivariable  calculus  ']) {
    assert.ok(searchCourses(courses, { query }).courses.some(c => c.id === calculus.id), query);
  }
});
test('combines subject filtering and search without matching other departments', () => {
  const result = searchCourses(courses, { query: 'calculus', subject: '640' });
  assert.ok(result.total > 0);
  assert.ok(result.courses.every(c => c.subject === '640'));
  assert.equal(searchCourses(courses, { query: '01:640:251', subject: '198' }).total, 0);
});
test('paginates bounded results and clamps invalid/out-of-range pages', () => {
  const result = searchCourses(courses, {});
  assert.equal(result.total, 4605);
  assert.equal(result.courses.length, 30);
  assert.notEqual(searchCourses(courses, { page: 2 }).courses[0].id, result.courses[0].id);
  for (const page of [NaN, Infinity, -3, 0]) assert.equal(searchCourses(courses, { page }).page, 1);
  assert.equal(searchCourses(courses, { page: 99999 }).page, result.pages);
  const empty = searchCourses(courses, { query: 'not-a-real-course', page: 2 });
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
});

test('course lookup accepts encoded route IDs and safely rejects malformed or unknown IDs', () => {
  const byId = new Map(courses.map(c => [c.id, c]));
  assert.equal(findCourse(byId, encodeURIComponent(calculus.id))?.code, '01:640:251');
  assert.equal(findCourse(byId, calculus.id)?.code, '01:640:251');
  assert.equal(findCourse(byId, '%not-valid-encoding'), undefined);
  assert.equal(findCourse(byId, 'unknown'), undefined);
});
test('preserves instructor text when Rutgers supplies no structured instructor records', () => {
  const raw = structuredClone(calculus.raw);
  raw.sections[0].instructorsText = 'Instructor supplied as text';
  assert.deepEqual(normalizeCourse(raw, source).sections[0].instructors, ['Instructor supplied as text']);
});

// Real snapshot regressions distinguish delivery, timing, and registration evidence.
test('Arabic I section 01 is hybrid with asynchronous content, not an honors restriction', () => {
  const arabic = courses.find(c => c.code === '01:013:140')!;
  const section = arabic.sections.find(s => s.index === '13139')!;
  assert.equal(section.number, '01');
  assert.equal(section.raw.sectionCourseType, 'H');
  assert.equal(section.delivery.label, 'Hybrid');
  assert.equal(section.honors, null);
  assert.deepEqual(section.meetings.map(m => m.timing), ['scheduled', 'scheduled', 'asynchronous']);
  assert.equal(section.meetings[0].startMinute, 1060);
  assert.ok(section.notices.some(n => /Hybrid Section - Some Meetings Online/.test(n.text)));
  assert.ok(!section.notices.some(n => /honors/i.test(n.field)));
  assert.ok(section.campuses.includes('Online'));
});
test('Rutgers Honors confirmed calculus H1 index 15919 retains honors and permission evidence', () => {
  const section = calculus.sections.find(s => s.index === '15919')!;
  assert.equal(section.number, 'H1');
  assert.equal(section.raw.sectionCourseType, 'T');
  assert.equal(section.delivery.label, 'Traditional / face-to-face');
  assert.deepEqual(section.honors, { kind: 'designated', evidence: 'HONORS SECTION' });
  assert.deepEqual(section.raw.honorPrograms, []);
  assert.ok(section.notices.some(n => n.field === 'specialPermissionAddCode' && n.text === '03'));
  assert.ok(section.notices.some(n => n.text === 'Department staff'));
  assert.deepEqual(section.meetings.map(m => m.mode), ['LEC', 'LEC', 'RECIT']);
});
test('all H/O/T delivery types are understood independently of honors or section numbering', () => {
  for (const [code, label] of [['H', 'Hybrid'], ['O', 'Online / remote instruction'], ['T', 'Traditional / face-to-face']]) {
    const sections = courses.flatMap(c => c.sections).filter(s => s.raw.sectionCourseType === code);
    assert.ok(sections.length);
    assert.ok(sections.every(s => s.delivery.label === label));
  }
  const raw = structuredClone(calculus.raw);
  raw.sections = [raw.sections[0]];
  raw.sections[0].number = 'H1';
  raw.sections[0].sectionNotes = 'NOT AN HONORS SECTION';
  raw.sections[0].sectionCourseType = 'X';
  const section = normalizeCourse(raw, source).sections[0];
  assert.equal(section.honors, null);
  assert.match(section.delivery.label, /meaning unverified/);
});
test('cross-listed Arabic offerings use readable Rutgers identities with a structured fallback', () => {
  const arabic = courses.find(c => c.code === '01:013:140')!;
  const section = arabic.sections.find(s => s.index === '13139')!;
  assert.equal(section.notices.find(n => n.field === 'Cross-listed sections')?.text, '01:074:140:01 (13140)');
  assert.ok(section.notices.every(n => !/courseNumber:|primaryRegistrationIndex:/.test(n.text)));
  const raw = structuredClone(arabic.raw);
  raw.sections[0].crossListedSectionsText = '';
  const text = normalizeCourse(raw, source).sections[0].notices.find(n => n.field === 'Cross-listed sections')!.text;
  assert.equal(text, '01:074:140:01 (index 13140)');
  assert.ok(Array.isArray(section.raw.crossListedSections));
});
test('real arranged meetings stay distinct from asynchronous content and genuinely unknown timing', () => {
  const course = courses.find(c => c.code === '01:013:321')!;
  assert.ok(course.sections.flatMap(s => s.meetings).some(m => m.timing === 'arranged'));
  const arabic = courses.find(c => c.code === '01:013:140')!;
  const raw = structuredClone(arabic.raw);
  const untimed = raw.sections[0].meetingTimes[2];
  untimed.baClassHours = '';
  assert.equal(normalizeCourse(raw, source).sections[0].meetings[2].timing, 'unknown');
  untimed.baClassHours = 'B';
  untimed.campusLocation = 'T';
  assert.equal(normalizeCourse(raw, source).sections[0].meetings[2].timing, 'asynchronous');
  untimed.startTimeMilitary = '2460';
  assert.equal(normalizeCourse(raw, source).sections[0].meetings[2].timing, 'unknown');
});
test('scheduled online meetings do not become asynchronous because of delivery or location', () => {
  const online = courses.flatMap(c => c.sections).flatMap(s => s.meetings)
    .filter(m => m.mode === 'ONLINE INSTRUCTION(INTERNET)' && m.startMinute !== null && m.dayCode);
  assert.ok(online.length);
  assert.ok(online.every(m => m.timing === 'scheduled'));
});
test('readable open-to restrictions retain source wording without guessing code direction', () => {
  const section = courses.flatMap(c => c.sections).find(s => s.index === '13214')!;
  assert.ok(section.notices.some(n => n.field === 'openToText' && /MAJ: 014/.test(n.text)));
  assert.ok(!section.notices.some(n => n.field === 'majors'));
  assert.ok(Array.isArray(section.raw.majors));
  const negative = courses.flatMap(c => c.sections).find(s => /NOT FOR CBN HONORS/.test(String(s.raw.sectionNotes)))!;
  assert.ok(negative);
  assert.equal(negative.honors, null);
  assert.ok(negative.notices.some(n => /NOT FOR CBN HONORS/.test(n.text)));
});

test('real conflicting arrangement flags preserve supplied times and warn about inconsistent evidence', () => {
  const section = courses.find(c => c.code === '01:991:170')!.sections.find(s => s.index === '16983')!;
  assert.ok(section.meetings.length >= 2);
  assert.ok(section.meetings.every(m => m.timing === 'scheduled'));
  assert.ok(section.notices.some(n => n.field === 'Meeting timing inconsistency' && /confirm/.test(n.text)));
});
