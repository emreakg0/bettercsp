import { calendarCampus } from '../catalog/calendar-campus.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minute, normalizeCatalog } from '../rutgers/normalize.ts';
import type { Meeting } from '../catalog/types.ts';
import { findConflicts, isScheduled, meetingsOverlap, formatDay, formatTime, needsTimingVerification } from './meetings.ts';
import { plannerCourse, selectedCreditsLabel, readSavedIds, selectSection, storageKey } from './selection.ts';

const source = { id: '2027-1-NB', label: 'Spring 2027', file: '', capturedAt: null };
const courses = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), source);
const calculus = plannerCourse(courses.find(c => c.code === '01:640:251')!);
const other = plannerCourse(courses.find(c => c.code !== calculus.code && c.sections.length)!);
function meeting(dayCode = 'M', startMinute: number | null = 600, endMinute: number | null = 660): Meeting {
  return { timing: 'scheduled', dayCode, startMinute, endMinute, mode: 'LEC', campus: 'Busch', building: 'SEC', room: '101' };
}

test('parses military times independently of AM/PM display fields', () => {
  for (const [input, expected] of [['0000', 0], ['0905', 545], ['1200', 720], ['1740', 1060], ['2359', 1439]] as const) {
    assert.equal(minute(input), expected);
  }
  for (const input of ['', '900', '2400', '1260', 'abcd', '-100', ' 0900']) assert.equal(minute(input), null);
});
test('recognizes all seven documented Rutgers day codes and preserves unknown ones', () => {
  for (const day of ['M', 'T', 'W', 'H', 'F', 'S', 'U']) assert.equal(isScheduled(meeting(day)), true);
  for (const day of ['', 'R', 'MW', 'X']) assert.equal(isScheduled(meeting(day)), false);
  assert.equal(formatDay('H'), 'Thu');
  assert.equal(formatDay('U'), 'Sun');
  assert.equal(formatDay('X'), 'Day code X');
  assert.equal(formatDay('__proto__'), 'Day code __proto__');
  assert.equal(formatTime(1440), '12:00 AM');
});
test('detects half-open interval overlaps including containment and equal starts', () => {
  assert.equal(meetingsOverlap(meeting(), meeting('M', 650, 710)), true);
  assert.equal(meetingsOverlap(meeting(), meeting('M', 610, 620)), true);
  assert.equal(meetingsOverlap(meeting(), meeting()), true);
  assert.equal(meetingsOverlap(meeting(), meeting('M', 660, 720)), false);
  assert.equal(meetingsOverlap(meeting(), meeting('M', 540, 600)), false);
  assert.equal(meetingsOverlap(meeting(), meeting('T')), false);
});
test('unknown, reversed, zero-duration, and non-integer timings cannot be certified', () => {
  for (const value of [meeting('', 600, 660), meeting('M', null, null), meeting('M', 660, 600), meeting('M', 600, 600), meeting('M', -1, 60), meeting('M', 600, 1440), meeting('M', NaN, 660)]) {
    assert.equal(isScheduled(value), false);
    assert.equal(meetingsOverlap(value, meeting()), false);
  }
});
test('scheduled online meetings still conflict; location does not suppress overlap', () => {
  assert.equal(meetingsOverlap({ ...meeting(), campus: 'Online', mode: 'ONLINE' }, meeting()), true);
});
test('detects conflicts in recitations and labs, not only the first lecture', () => {
  const sections = [
    { id: 'a', meetings: [meeting('T'), { ...meeting('W'), mode: 'RECIT' }, { ...meeting('F'), mode: 'LAB' }] },
    { id: 'b', meetings: [meeting('W', 630, 700), meeting('F', 650, 710)] },
  ];
  assert.deepEqual(findConflicts(sections), [
    { firstId: 'a', secondId: 'b', firstMeeting: 1, secondMeeting: 0 },
    { firstId: 'a', secondId: 'b', firstMeeting: 2, secondMeeting: 1 },
  ]);
  assert.deepEqual(findConflicts(sections), findConflicts(sections));
});
test('actual calculus selection retains both lectures, recitation, and locations', () => {
  const selected = selectSection([], calculus, calculus.sections[0]);
  assert.deepEqual(selected[0].section.meetings.map(m => m.mode), ['LEC', 'LEC', 'RECIT']);
  assert.equal(selected[0].section.meetings[0].building, 'SEC');
  assert.equal('raw' in selected[0].section, false);
  assert.equal('raw' in selected[0].course, false);
});
test('adding twice is idempotent; replacing and removing preserve unrelated choices', () => {
  let selected = selectSection([], calculus, calculus.sections[0]);
  selected = selectSection(selected, other, other.sections[0]);
  selected = selectSection(selected, calculus, calculus.sections[0]);
  assert.equal(selected.length, 2);
  selected = selectSection(selected, calculus, calculus.sections[1]);
  assert.equal(selected[0].section.id, calculus.sections[1].id);
  assert.equal(selected[1].section.id, other.sections[0].id);
  assert.deepEqual(selected.filter(s => s.section.id !== selected[0].section.id).map(s => s.section.id), [other.sections[0].id]);
});
test('versioned saves preserve section identity and isolate semester and campus', () => {
  const sectionIds = [calculus.sections[0].id, other.sections[0].id];
  const saved = JSON.stringify({ version: 1, sourceId: source.id, sectionIds });
  assert.deepEqual(readSavedIds(saved, source.id), sectionIds);
  assert.deepEqual(readSavedIds(null, source.id), []);
  assert.notEqual(storageKey(source.id), storageKey('2027-9-NB'));
  assert.notEqual(storageKey(source.id), storageKey('2027-1-NK'));
  assert.throws(() => readSavedIds(saved, '2027-9-NB'));
});
test('invalid saves are rejected rather than silently replacing existing selections', () => {
  for (const saved of ['{', 'null', '{}', JSON.stringify({ version: 2, sourceId: source.id, sectionIds: [] }),
    JSON.stringify({ version: 1, sourceId: source.id, sectionIds: ['2027-1-NB:abc'] }),
    JSON.stringify({ version: 1, sourceId: source.id, sectionIds: [1] })]) {
    assert.throws(() => readSavedIds(saved, source.id));
  }
});

test('Arabic hybrid async component neither conflicts nor produces a missing-time warning', () => {
  const arabic = plannerCourse(courses.find(c => c.code === '01:013:140')!);
  const section = arabic.sections.find(s => s.index === '13139')!;
  const async = section.meetings[2];
  assert.equal(async.timing, 'asynchronous');
  assert.equal(isScheduled(async), false);
  assert.equal(needsTimingVerification(async), false);
  assert.equal(meetingsOverlap(async, meeting('T', 1060, 1140)), false);
  assert.equal(meetingsOverlap(section.meetings[0], meeting('T', 1060, 1140)), true);
  assert.equal(section.honors, null);
  assert.equal(section.delivery.label, 'Hybrid');
});
test('arranged and unknown timings still require verification; honors metadata survives planner projection', () => {
  const arranged = courses.find(c => c.code === '01:013:321')!.sections.flatMap(s => s.meetings).find(m => m.timing === 'arranged')!;
  assert.equal(needsTimingVerification(arranged), true);
  assert.equal(isScheduled(arranged), false);
  assert.equal(needsTimingVerification({ ...meeting(), timing: 'unknown' }), true);
  const honors = calculus.sections.find(s => s.index === '15919')!;
  assert.equal(honors.honors?.kind, 'designated');
  assert.equal(honors.delivery.code, 'T');
});

test('selected credit totals use real catalog values and leave arranged credits unresolved', () => {
  const cs = plannerCourse(courses.find(c => c.code === '01:198:112')!);
  const arranged = plannerCourse(courses.find(c => c.credits === null)!);
  assert.equal(calculus.credits, 4);
  assert.equal(cs.credits, 4);
  assert.equal(selectedCreditsLabel([calculus, cs]), '8 credits');
  assert.equal(selectedCreditsLabel([calculus, calculus]), '4 credits');
  assert.equal(selectedCreditsLabel([calculus, arranged]), '4 credits known; 1 course has variable or unspecified credits');
  assert.equal(selectedCreditsLabel([arranged]), 'Total credits unknown; 1 course has variable or unspecified credits');
  assert.equal(selectedCreditsLabel([]), '0 credits');
  assert.equal(selectedCreditsLabel([{ id: 'zero', credits: 0 }]), '0 credits');
  assert.equal(selectedCreditsLabel([{ id: 'one', credits: 1 }]), '1 credit');
  assert.equal(selectedCreditsLabel([{ id: 'half', credits: 1.5 }, { id: 'other', credits: 2 }]), '3.5 credits');
});


test('calendar palette recognizes campus names and snapshot aliases without guessing unfamiliar sites', () => {
  const pairs = {
    online: ['ONLINE', 'ONL', 'O'],
    busch: [' Busch Campus ', 'BUS', '2'],
    'college-avenue': ['College Ave.', 'CAC', '1'],
    'cook-douglass': ['DOUGLAS/COOK', 'Cook-Douglass', 'D/C', '4'],
    livingston: ['Livingston Campus', 'LIV', '3'],
    downtown: ['DOWNTOWN NB', 'DNB', '5'],
    camden: ['Rutgers–Camden', 'Camden Campus'],
    newark: ['Rutgers University–Newark', 'Newark'],
    other: ['', 'CAMDEN COUNTY COLLEGE', 'OFF CAMPUS', 'STUDY ABROAD', 'Newark Extension'],
  };
  for (const [campus, names] of Object.entries(pairs)) {
    for (const name of names) assert.equal(calendarCampus(name), campus, name);
  }
});
