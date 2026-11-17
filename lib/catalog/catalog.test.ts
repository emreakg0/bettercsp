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
  assert.ok(section.notices.some(n => n.field === 'Honors indicator'));
  assert.ok(section.notices.some(n => n.field === 'specialPermissionAddCode' && n.text === '04'));
});
test('does not infer honors from a course prerequisite mentioning honors calculus', () => {
  assert.match(calculus.prerequisites, /HONORS/);
  assert.ok(calculus.sections.every(s => !s.notices.some(n => n.field === 'Honors indicator')));
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
