import assert from 'node:assert/strict';
import test from 'node:test';
import { courseProgress, degreeCourseMatches, degreeDependents, rescueDegreeProgram } from './course-matches.ts';
import { parseAcademicProfile } from './profile.ts';

const term = '2027-1-NB';
const about = { school: 'School of Arts and Sciences', intendedMajors: ['Computer Science'], catalogYear: 2026 };
const failed = '01:198:344';

test('degrees bind to the reported SAS CS program, explicit 2026–27 catalog and NB term', () => {
  const ba = rescueDegreeProgram(parseAcademicProfile({ ...about, degreeType: 'BA' }), term)!;
  const bs = rescueDegreeProgram(parseAcademicProfile({ ...about, degreeType: 'BS' }), term)!;
  assert.equal(ba.programId, 'rutgers-nb-sas-cs-ba');
  assert.equal(bs.programId, 'rutgers-nb-sas-cs-bs');
  assert.equal(ba.requirements.find(rule => rule.kind === 'elective-pool')?.count, 5);
  assert.equal(bs.requirements.find(rule => rule.kind === 'elective-pool')?.count, 7);
  for (const fields of [{ catalogYear: null }, { catalogYear: 2025 }, { school: 'School of Engineering' }, { intendedMajors: ['Mathematics'] }, { degreeType: null }]) {
    assert.equal(rescueDegreeProgram(parseAcademicProfile({ ...about, degreeType: 'BA', ...fields }), term), null);
  }
  assert.equal(rescueDegreeProgram(parseAcademicProfile({ ...about, degreeType: 'BA' }), '2027-1-NK'), null);
});

test('the B.S. recommends supported science routes without mixing tracks or reusing reported credit', () => {
  for (const degreeType of ['BA', 'BS']) {
    const profile = parseAcademicProfile({ ...about, degreeType, eligibility: { completedCourses: ['01:160:161'] } });
    const matches = degreeCourseMatches(rescueDegreeProgram(profile, term)!, profile, [], failed);
    assert.deepEqual(matches.filter(match => match.scienceTrack).map(match => match.code), degreeType === 'BS' ? ['01:160:162', '01:160:171'] : []);
  }
  const mixed = parseAcademicProfile({ ...about, degreeType: 'BS', inProgressCourses: ['01:750:193', '01:160:161'] });
  assert.ok(!degreeCourseMatches(rescueDegreeProgram(mixed, term)!, mixed, [], failed).some(match => match.scienceTrack));
});

test('completed, in-progress, planned and accepted versus unverified credit remain distinct', () => {
  const profile = parseAcademicProfile({ ...about, degreeType: 'BA', eligibility: { completedCourses: ['01:640:151', '14:332:312'] },
    inProgressCourses: ['01:640:152'], plannedCourses: ['01:198:211'], equivalentCredits: [
      { courseCode: '01:640:250', source: 'transfer', status: 'rutgers-accepted' },
      { courseCode: '01:198:206', source: 'transfer', status: 'unverified' },
    ] });
  for (const [code, status] of [['01:640:151', 'reported-completion'], ['01:640:152', 'in-progress'],
    ['01:640:250', 'reported-accepted-credit'], ['01:198:206', 'unverified-credit'], ['01:198:211', 'planned']]) {
    assert.equal(courseProgress(profile, code), status);
  }
  const program = rescueDegreeProgram(profile, term)!;
  const matches = degreeCourseMatches(program, profile, [], failed).map(match => match.code);
  for (const avoided of ['01:640:151', '01:640:152', '01:640:250', '01:198:205', '01:198:206', failed]) assert.ok(!matches.includes(avoided));
  assert.ok(matches.includes('01:198:211'));
  assert.ok(degreeDependents(program, '01:198:206', profile).some(edge => edge.courseCode === '01:198:344'));
});

test('intro transition uses literal legacy credit and never substitutes CS120, CS121 or CS122', () => {
  const profile = parseAcademicProfile({ ...about, degreeType: 'BA', eligibility: { completedCourses: ['01:198:111'] } });
  const program = rescueDegreeProgram(profile, term)!;
  const matches = (p: typeof profile) => degreeCourseMatches(program, p, [], failed).map(match => match.code);
  assert.ok(matches(profile).includes('01:198:112'));
  const transition = { ...profile, inProgressCourses: ['01:198:121'] };
  for (const code of ['01:198:112', '01:198:120', '01:198:121', '01:198:122']) assert.ok(!matches(transition).includes(code));
  assert.ok(degreeDependents(program, '01:198:112', profile).some(edge => edge.courseCode === '01:198:211'));
  assert.deepEqual(degreeDependents(program, '01:198:122', profile), []);
});
