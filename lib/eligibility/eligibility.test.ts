import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import { plannerCourse } from '../scheduling/selection.ts';
import { generateSchedules } from '../scheduling/generate.ts';
import { defaultConstraints, defaultWeights, type GenerationRequest } from '../scheduling/generation-types.ts';
import { parseGenerationRequest } from '../scheduling/generation-request.ts';
import { evaluateEligibility } from './evaluate.ts';
import { emptyProfile, type StudentProfile } from './types.ts';
import { parseStudentProfile } from './profile.ts';

const courses = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), { id: '2027-1-NB', label: '', file: '', capturedAt: null });
const calculus = courses.find(c => c.code === '01:640:251')!;
const honors = calculus.sections.find(s => s.index === '15919')!;
const arabic = courses.find(c => c.code === '01:013:140')!;
const profile = (patch: Partial<StudentProfile> = {}): StudentProfile => ({ ...structuredClone(emptyProfile), ...patch });
function actual(index: string) {
  const course = courses.find(c => c.sections.some(s => s.index === index))!;
  assert.ok(course); return { course, section: course.sections.find(s => s.index === index)! };
}
function request(courseId: string, student = profile(), excludeConfirmed = false): GenerationRequest {
  return { choices: [{ courseId, required: true }], constraints: structuredClone(defaultConstraints), weights: { ...defaultWeights }, preferredInstructors: [], eligibility: { profile: student, excludeConfirmed } };
}

test('real Calculus H1 requires invitation/department permission, not generic honors membership', () => {
  const result = evaluateEligibility(calculus, honors);
  assert.equal(result.status, 'permission-required');
  const rule = result.findings.find(f => f.rule === 'math.honors-admission.v1')!;
  assert.match(rule.message, /Membership alone/); assert.ok(rule.evidence.some(e => e.text === '03'));
  assert.ok(rule.evidence.some(e => e.url.includes('math.sas.rutgers.edu')));
  for (const membership of ['none', 'honors-college', 'sas-honors'] as const) {
    const answer = evaluateEligibility(calculus, honors, profile({ honors: membership }));
    assert.equal(answer.confirmedIncompatible, false); assert.equal(answer.status, 'permission-required');
  }
});
test('permission is scoped to the registration index and does not waive prerequisites', () => {
  const granted = evaluateEligibility(calculus, honors, profile({ grantedPermissionIndexes: ['15919'] }));
  assert.equal(granted.findings.find(f => f.category === 'honors')?.status, 'no-known-blocker');
  assert.equal(granted.findings.find(f => f.category === 'prerequisite')?.status, 'verification-needed');
  assert.equal(granted.status, 'verification-needed');
  const otherIndex = evaluateEligibility(calculus, honors, profile({ grantedPermissionIndexes: ['15920'] }));
  assert.equal(otherIndex.status, 'permission-required');
});
test('hybrid H never produces an honors restriction for real Arabic I', () => {
  for (const student of [profile(), profile({ honors: 'none' })]) {
    const answer = evaluateEligibility(arabic, arabic.sections[0], student);
    assert.ok(answer.findings.every(f => f.category !== 'honors'));
    assert.equal(answer.confirmedIncompatible, false);
  }
});
test('real standing restrictions distinguish missing information, a supported match, and explicit mismatch', () => {
  const course = courses.find(c => c.sections.some(s => s.notices.some(n => n.field === 'sectionEligibility' && n.text === 'JUNIORS AND SENIORS')))!;
  const section = course.sections.find(s => s.notices.some(n => n.field === 'sectionEligibility' && n.text === 'JUNIORS AND SENIORS'))!;
  const unknown = evaluateEligibility(course, section); assert.equal(unknown.confirmedIncompatible, false);
  assert.equal(unknown.findings.find(f => f.category === 'standing')?.status, 'verification-needed');
  const yes = evaluateEligibility(course, section, profile({ standing: 'junior' }));
  assert.equal(yes.findings.find(f => f.category === 'standing')?.status, 'no-known-blocker');
  const no = evaluateEligibility(course, section, profile({ standing: 'first-year' }));
  assert.equal(no.confirmedIncompatible, true); assert.equal(no.status, 'potentially-ineligible');
});
test('single-category school/major restrictions require explicitly complete declarations before mismatch filtering', () => {
  const { course, section } = actual('13214');
  // This real source combines major and minor categories; its operator is deliberately unknown.
  assert.equal(evaluateEligibility(course, section, profile({ majors: ['198'], declarationsComplete: true })).confirmedIncompatible, false);
  const c = courses.find(c => c.sections.some(s => s.notices.some(n => n.field === 'openToText' && n.text.startsWith('UNIT: 01 ') && !n.text.includes(';'))))!;
  const s = c.sections.find(s => s.notices.some(n => n.field === 'openToText' && n.text.startsWith('UNIT: 01 ') && !n.text.includes(';')))!;
  assert.equal(evaluateEligibility(c, s, profile({ schools: ['77'] })).confirmedIncompatible, false);
  assert.equal(evaluateEligibility(c, s, profile({ schools: ['77'], declarationsComplete: true })).confirmedIncompatible, true);
  assert.equal(evaluateEligibility(c, s, profile({ schools: ['01'] })).findings.find(f => f.category === 'school-major')?.status, 'no-known-blocker');
});
test('the explicit Honors College-only note is evaluated without decoding program codes', () => {
  const { course, section } = actual('14915');
  assert.equal(evaluateEligibility(course, section).confirmedIncompatible, false);
  assert.equal(evaluateEligibility(course, section, profile({ honors: 'none' })).confirmedIncompatible, true);
  assert.equal(evaluateEligibility(course, section, profile({ honors: 'sas-honors' })).confirmedIncompatible, false);
  assert.equal(evaluateEligibility(course, section, profile({ honors: 'honors-college' })).findings.find(f => f.rule === 'soc.honors-college-only.v1')?.status, 'no-known-blocker');
});
test('known completed courses satisfy a supported simple OR route, while omissions remain unknown', () => {
  const yes = evaluateEligibility(calculus, honors, profile({ completedCourses: ['01:640:152'] }));
  assert.equal(yes.findings.find(f => f.category === 'prerequisite')?.status, 'no-known-blocker');
  const unknown = evaluateEligibility(calculus, honors, profile({ completedCourses: ['01:198:111'] }));
  assert.equal(unknown.findings.find(f => f.category === 'prerequisite')?.status, 'verification-needed');
  const allMissing = ['01:640:152', '01:640:192', '21:640:136', '21:640:156', '50:640:122'];
  const no = evaluateEligibility(calculus, honors, profile({ notCompletedCourses: allMissing }));
  assert.equal(no.findings.find(f => f.category === 'prerequisite')?.status, 'potentially-ineligible');
  assert.equal(no.confirmedIncompatible, false); // Placement/equivalency/override routes are not fully modeled.
});
test('mixed, nested, grade-bearing, and multiple-code-in-one-leaf prerequisites are not falsely proved', () => {
  for (const prerequisites of ['(01:198:111 OR 01:198:112)', '(01:198:111 Intro) OR (01:198:112 Structures) AND (01:640:152 Calc)', '(01:198:111 Intro, grade C or better)', 'PLACEMENT REQUIRED']) {
    const c = { ...calculus, prerequisites };
    const result = evaluateEligibility(c, honors, profile({ completedCourses: ['01:198:111', '01:198:112', '01:640:152'] }));
    assert.equal(result.findings.find(f => f.category === 'prerequisite')?.status, 'verification-needed');
  }
});
test('Data Structures completion does not silently certify minimum-grade and credit-exclusion notes', () => {
  const cs = courses.find(c => c.code === '01:198:112')!;
  const result = evaluateEligibility(cs, cs.sections[0], profile({ completedCourses: ['01:198:111'] }));
  assert.equal(result.findings.find(f => f.category === 'prerequisite')?.status, 'no-known-blocker');
  assert.ok(result.findings.some(f => f.status === 'verification-needed' && f.evidence.some(e => /GRADE BELOW/.test(e.text))));
});
test('real placement and required-component notes remain actionable and evidence-backed', () => {
  const { course, section } = actual('13142');
  const result = evaluateEligibility(course, section, profile({ placementMetFor: [course.code] }));
  assert.ok(result.findings.some(f => f.category === 'placement' && /report placement met/.test(f.message)));
  assert.equal(result.confirmedIncompatible, false);
  const linked = actual('13302');
  assert.ok(evaluateEligibility(linked.course, linked.section).findings.some(f => /MUST ALSO REGISTER/.test(f.message)));
});
test('unknown honors, permission, and future eligibility codes stay verification-needed', () => {
  const section = structuredClone(arabic.sections[0]);
  section.notices.push({ field: 'specialPermissionAddCode', text: '99' }, { field: 'specialPermissionAddCodeDescription', text: 'Future code' }, { field: 'futureEligibilityRule', text: 'X' });
  const result = evaluateEligibility(arabic, section, profile({ grantedPermissionIndexes: [section.index] }));
  assert.equal(result.status, 'verification-needed'); assert.equal(result.confirmedIncompatible, false);
  const honorsProgram = actual('13273');
  assert.ok(evaluateEligibility(honorsProgram.course, honorsProgram.section).findings.some(f => /program codes/.test(f.message)));
});
test('no-known-blocker is distinct from seat availability and requires no fabricated student data', () => {
  const course = { ...arabic, prerequisites: '', notes: [] };
  const section = { ...arabic.sections[0], notices: [], honors: null };
  assert.equal(evaluateEligibility(course, section).status, 'no-known-blocker');
  const closed = { ...section, availability: 'closed' as const };
  assert.deepEqual(evaluateEligibility(course, closed), evaluateEligibility(course, section));
});
test('readiness matches between raw normalized records and client projections', () => {
  const projected = plannerCourse(calculus);
  assert.deepEqual(evaluateEligibility(calculus, honors), evaluateEligibility(projected, projected.sections.find(s => s.index === '15919')!));
});
test('eligibility filtering is opt-in, preserves unknown sections, and never silently changes a lock', () => {
  const c = structuredClone(calculus); c.sections = [structuredClone(c.sections[0])];
  c.sections[0].notices.push({ field: 'sectionEligibility', text: 'SENIORS ONLY' });
  const student = profile({ standing: 'first-year' });
  const retained = generateSchedules([c], request(c.id, student));
  assert.equal(retained.schedules.length, 1); assert.equal(retained.schedules[0].eligibility[0].confirmedIncompatible, true);
  const filtered = generateSchedules([c], request(c.id, student, true));
  assert.equal(filtered.schedules.length, 0); assert.ok(filtered.reports[0].eligibilityExclusions?.[0].findings.some(f => f.category === 'standing'));
  assert.equal(generateSchedules([c], request(c.id, profile(), true)).schedules.length, 1);
  const locked = request(c.id, student, true); locked.constraints.lockedSectionIds = [c.sections[0].id];
  assert.equal(generateSchedules([c], locked).schedules.length, 0); assert.ok(generateSchedules([c], locked).issues.some(i => i.includes('lock')));
});
test('eligibility and snapshot status do not alter deterministic preference scoring', () => {
  const base = generateSchedules([calculus], request(calculus.id));
  const withProfile = generateSchedules([calculus], request(calculus.id, profile({ completedCourses: ['01:640:152'], grantedPermissionIndexes: ['15919'] })));
  assert.deepEqual(base.schedules.map(s => [s.id, s.score]), withProfile.schedules.map(s => [s.id, s.score]));
  assert.deepEqual(withProfile, generateSchedules([calculus], request(calculus.id, profile({ completedCourses: ['01:640:152'], grantedPermissionIndexes: ['15919'] }))));
});
test('profile and generation request boundaries reject invalid or contradictory facts', () => {
  assert.deepEqual(parseStudentProfile(undefined), emptyProfile);
  assert.equal(parseStudentProfile({ standing: 'senior' }).standing, 'senior');
  assert.throws(() => parseStudentProfile(profile({ schools: ['NetID'] })));
  assert.throws(() => parseStudentProfile(profile({ completedCourses: ['01:198:111'], notCompletedCourses: ['01:198:111'] })));
  assert.throws(() => parseStudentProfile(profile({ grantedPermissionIndexes: ['123456'] })));
  const r = request(calculus.id); const raw = { ...r, eligibility: { profile: emptyProfile, excludeConfirmed: 'yes' } };
  assert.throws(() => parseGenerationRequest(raw));
  const clean = parseStudentProfile({ ...emptyProfile, NetID: 'never copied', password: 'never copied' });
  assert.equal('NetID' in clean, false); assert.equal('password' in clean, false);
});

test('program-code metadata alone does not invent honors calculus admission, and another membership does not deny College membership', () => {
  const section = structuredClone(calculus.sections[0]);
  section.honors = { kind: 'program-information', evidence: 'Program codes supplied' };
  section.notices.push({ field: 'Honors program codes', text: 'A — meaning needs verification' });
  assert.ok(!evaluateEligibility(calculus, section).findings.some(f => f.rule === 'math.honors-admission.v1'));
  const { course, section: collegeOnly } = actual('14915');
  const response = generateSchedules([course], { ...request(course.id, profile({ honors: 'sas-honors' }), true), constraints: { ...defaultConstraints, lockedSectionIds: [collegeOnly.id] } });
  assert.equal(response.schedules.length, 1);
  assert.equal(response.schedules[0].eligibility[0].confirmedIncompatible, false);
});
