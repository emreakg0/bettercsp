import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { emptyAcademicProfile, parseAcademicProfile } from '../academic/profile.ts';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import { defaultConstraints } from '../scheduling/generation-types.ts';
import { plannerCourse, type Selection } from '../scheduling/selection.ts';
import { evaluatePreflight, rankPreflightAlternatives, sectionWarning } from './preflight.ts';
import { emptyProfile } from './types.ts';

const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')),
  { id: '2027-1-NB', label: '', file: '', capturedAt: null });
function selection(code: string, index?: string): Selection {
  const { sections, ...course } = plannerCourse(catalog.find(c => c.code === code)!);
  return { course, section: index ? sections.find(s => s.index === index)! : sections[0] };
}

test('in-progress and reported transfer credit inform prerequisite verification without satisfying it', () => {
  const target = selection('01:198:112');
  const planning = parseAcademicProfile({ inProgressCourses: ['01:198:111'], equivalentCredits: [
    { courseCode: '01:198:111', status: 'rutgers-accepted', source: 'transfer' },
  ] });
  const [row] = evaluatePreflight([target], emptyProfile, planning);
  const issue = row.issues.find(item => item.scope === 'course')!;
  assert.equal(issue.level, 'verify');
  assert.equal(issue.alternate, false);
  assert.match(issue.detail, /In progress.*01:198:111.*Rutgers-accepted credit.*Confirm whether/);
  assert.equal(issue.finding?.status, 'verification-needed');
  assert.ok(!row.issues.some(item => item.level === 'conflict'));
});

test('a reported completed prerequisite leaves the real H1 honors restriction and distinct course evidence', () => {
  const target = selection('01:640:251', '15919');
  const profile = { ...emptyProfile, completedCourses: ['01:640:152'] };
  const [row] = evaluatePreflight([target], profile, emptyAcademicProfile);
  assert.equal(row.level, 'action');
  assert.ok(row.issues.some(issue => issue.title === 'Honors admission requirement' && issue.scope === 'section' && issue.alternate));
  assert.match(row.issues.find(issue => issue.scope === 'course')!.detail, /Reported completions match.*still need confirmation/);
  assert.match(sectionWarning(target.course, target.section, profile), /Honors admission/);
  const original = plannerCourse(catalog.find(c => c.code === target.course.code)!);
  const alternatives = rankPreflightAlternatives(target, original.sections, [target], profile, emptyAcademicProfile, defaultConstraints);
  assert.ok(alternatives.length > 0);
  assert.ok(alternatives[0].issues.every(issue => issue.level === 'verify'));
  assert.ok(alternatives[0].issues.some(issue => issue.scope === 'course'));
});

test('declared major mismatch is a conflict, intended major and missing data are not', () => {
  const target = selection('01:082:492', '13357');
  const planning = parseAcademicProfile({ intendedMajors: ['Art History'] });
  const [missing] = evaluatePreflight([target], emptyProfile, planning);
  assert.equal(missing.issues.find(issue => issue.title === 'Major restriction')!.level, 'verify');
  assert.ok(!missing.issues.some(issue => issue.level === 'conflict'));
  assert.match(sectionWarning(target.course, target.section, emptyProfile), /Major restriction/);
  const [known] = evaluatePreflight([target], { ...emptyProfile, declarationsComplete: true, majors: ['198'] }, planning);
  assert.equal(known.level, 'conflict');
  assert.match(known.issues[0].detail, /Art History.*conflicts with the information/);
});

test('unsupported compound section restrictions remain visible as verification, without a false picker warning', () => {
  const target = selection('01:014:341', '13214');
  const [row] = evaluatePreflight([target], { ...emptyProfile, declarationsComplete: true }, emptyAcademicProfile);
  const issue = row.issues.find(item => item.title === 'Enrollment restriction needs interpretation')!;
  assert.equal(issue.level, 'verify');
  assert.ok(!issue.alternate);
  assert.match(issue.finding!.evidence[0].text, /MAJ:.*MINOR:/);
  assert.doesNotMatch(sectionWarning(target.course, target.section, emptyProfile), /Major restriction|Minor restriction/);
});

test('the published Spring 2027 NB travel rule checks ordinary and exception gaps separately from overlaps', () => {
  const a = selection('01:198:112'), b = selection('01:640:251');
  const meeting = { ...a.section.meetings[0], timing: 'scheduled' as const, dayCode: 'M' };
  a.section.meetings = [{ ...meeting, campus: 'BUSCH', startMinute: 540, endMinute: 600 }];
  const issues = (campus: string, startMinute: number) => {
    b.section.meetings = [{ ...meeting, campus, startMinute, endMinute: startMinute + 45 }];
    return evaluatePreflight([a, b], emptyProfile, emptyAcademicProfile).flatMap(row => row.issues).filter(issue => issue.scope === 'timetable');
  };
  assert.match(issues('COLLEGE AVENUE', 639)[0].detail, /40-minute minimum/);
  assert.deepEqual(issues('COLLEGE AVENUE', 640), []);
  assert.match(issues('LIV', 629)[0].detail, /30-minute minimum/);
  assert.deepEqual(issues('LIV', 630), []);
  assert.deepEqual(issues('ONLINE', 600), []);
  assert.deepEqual(issues('Unknown site', 600), []);
  assert.equal(issues('ONLINE', 599)[0].level, 'conflict');
  b.section.id = '2027-1-NK:' + b.section.index;
  assert.deepEqual(issues('COLLEGE AVENUE', 610), []);
});

test('same-course alternatives preserve neighboring classes and current hard constraints', () => {
  const target = selection('01:640:251', '15919');
  const options = plannerCourse(catalog.find(c => c.code === target.course.code)!).sections;
  const excluded = options.find(section => section.id !== target.section.id)!;
  const kept = selection('01:198:112');
  kept.section.meetings = [{ ...kept.section.meetings[0], timing: 'scheduled', dayCode: 'M', startMinute: 500, endMinute: 590, campus: 'CAC' }];
  const candidates = rankPreflightAlternatives(target, options, [target, kept], emptyProfile, emptyAcademicProfile,
    { ...defaultConstraints, excludedSectionIds: [excluded.id], latestEnd: 1100 });
  assert.ok(candidates.length > 0);
  for (const row of candidates) {
    assert.equal(row.selection.course.id, target.course.id);
    assert.notEqual(row.selection.section.id, excluded.id);
    assert.ok(row.selection.section.meetings.every(m => m.endMinute === null || m.endMinute <= 1100));
    assert.ok(!row.issues.some(issue => issue.scope === 'timetable' && issue.level !== 'verify'));
  }
});
