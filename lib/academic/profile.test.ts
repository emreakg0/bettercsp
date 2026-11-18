import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentProfile } from '../eligibility/profile.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { storageKey } from '../scheduling/selection.ts';
import {
  academicProfileKey, eligibilityForSource, emptyAcademicProfile, parseAcademicProfile, readAcademicProfile, serializeAcademicProfile,
} from './profile.ts';

test('an empty or partial academic profile keeps existing eligibility defaults', () => {
  assert.equal(readAcademicProfile(null), null);
  assert.deepEqual(parseAcademicProfile({}), emptyAcademicProfile);
  const profile = parseAcademicProfile({ school: ' SAS ', intendedMajors: ['Computer Science', 'Computer Science'], degreeType: 'BS' });
  assert.equal(profile.school, 'SAS');
  assert.deepEqual(profile.intendedMajors, ['Computer Science']);
  assert.equal(profile.catalogYear, null);
  assert.deepEqual(eligibilityForSource(profile, '2027-1-NB'), emptyProfile);
});

test('profile storage round trips independently of semester-scoped schedules', () => {
  const spring = '2027-1-NB', fall = '2027-9-NB';
  const profile = parseAcademicProfile({
    school: 'SAS', intendedMajors: ['Computer Science'], minorPlans: ['Statistics'],
    degreeType: 'BA', catalogYear: 2026, eligibility: { majors: ['198'], minors: ['961'] },
    permissionsBySource: { [spring]: ['15919'], [fall]: ['10015'] },
  });
  const storage = new Map([[storageKey(spring), 'spring schedule'], [storageKey(fall), 'fall schedule']]);
  storage.set(academicProfileKey, serializeAcademicProfile(profile));
  const restored = readAcademicProfile(storage.get(academicProfileKey)!)!;
  assert.deepEqual(restored, profile);
  assert.deepEqual(eligibilityForSource(restored, spring).grantedPermissionIndexes, ['15919']);
  assert.deepEqual(eligibilityForSource(restored, fall).grantedPermissionIndexes, ['10015']);
  assert.deepEqual(eligibilityForSource(restored, '2027-1-NK').grantedPermissionIndexes, []);
  const changed = { ...restored, catalogYear: 2027 };
  storage.set(academicProfileKey, serializeAcademicProfile(changed));
  assert.equal(readAcademicProfile(storage.get(academicProfileKey)!)?.catalogYear, 2027);
  storage.delete(academicProfileKey);
  assert.equal(readAcademicProfile(storage.get(academicProfileKey) ?? null), null);
  assert.equal(storage.get(storageKey(spring)), 'spring schedule');
  assert.equal(storage.get(storageKey(fall)), 'fall schedule');
});

test('completion, current courses, plans, and reported credit keep independent meanings', () => {
  const input = parseAcademicProfile({
    eligibility: { completedCourses: ['01:640:151'] },
    inProgressCourses: ['01:640:152'],
    plannedCourses: ['01:640:251'],
    equivalentCredits: [
      { courseCode: '01:198:111', source: 'ap', status: 'rutgers-accepted' },
      { courseCode: '01:198:112', source: 'transfer', status: 'unverified' },
      { courseCode: null, source: 'other', status: 'rutgers-accepted' },
    ],
  });
  const restored = readAcademicProfile(serializeAcademicProfile(input))!;
  assert.deepEqual(restored.equivalentCredits, input.equivalentCredits);
  assert.deepEqual(restored.inProgressCourses, ['01:640:152']);
  assert.deepEqual(restored.plannedCourses, ['01:640:251']);
  const onlyEligibility = eligibilityForSource(restored, '2027-1-NB');
  assert.deepEqual(onlyEligibility.completedCourses, ['01:640:151']);
  assert.deepEqual(onlyEligibility, parseStudentProfile(onlyEligibility));
  for (const key of ['intendedMajors', 'equivalentCredits', 'plannedCourses', 'inProgressCourses', 'permissionsBySource']) {
    assert.equal(Object.hasOwn(onlyEligibility, key), false);
  }
});

test('corrupt, oversized, unsupported, or malformed browser profiles are rejected', () => {
  for (const value of ['{', 'null', '[]', '{"version":2,"profile":{}}', '{"version":1}', 'x'.repeat(48_001)]) {
    assert.throws(() => readAcademicProfile(value));
  }
  for (const value of [
    { school: ['SAS'] }, { degreeType: 'UNKNOWN' }, { catalogYear: '2026' }, { catalogYear: 8000 },
    { intendedMajors: [22] }, { plannedCourses: ['not-a-code'] }, { inProgressCourses: null },
    { permissionsBySource: { invalid: ['15919'] } }, { permissionsBySource: { '2027-1-NB': ['159190'] } },
    { eligibility: { standing: ['senior'] } }, { eligibility: { honors: ['none'] } },
    { eligibility: { grantedPermissionIndexes: ['15919'] } },
    { equivalentCredits: [{ courseCode: '01:640:151', source: 'ap', status: 'guaranteed' }] },
    { equivalentCredits: [
      { courseCode: '01:640:151', source: 'ap', status: 'unverified' },
      { courseCode: '01:640:151', source: 'ap', status: 'rutgers-accepted' },
    ] },
  ]) {
    assert.throws(() => readAcademicProfile(JSON.stringify({ version: 1, profile: value })));
  }
});

test('storage validation drops unknown fields outside the profile contract', () => {
  const result = parseAcademicProfile({
    netId: 'discard', eligibility: { ruid: 'discard' },
    equivalentCredits: [{ courseCode: null, source: 'transfer', status: 'unverified', transcript: 'discard' }],
  });
  assert.doesNotMatch(serializeAcademicProfile(result), /discard/);
});
