import { emptyProfile, type StudentProfile } from './types.ts';

export const rutgersCourseCodePattern = /^\d{2}:\d{3}:\d{3}$/;

// Optional academic inputs need validation at the API boundary; saved schedule IDs are unaffected.
export function parseStudentProfile(value: unknown): StudentProfile {
  if (value === undefined) return structuredClone(emptyProfile);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid optional academic information.');
  const data: Record<string, unknown> = { ...emptyProfile, ...value };
  function list(key: keyof StudentProfile, pattern: RegExp, maximum = 100): string[] {
    const field = data[key];
    if (!Array.isArray(field) || field.length > maximum || !field.every(item => typeof item === 'string' && pattern.test(item))) throw new Error(`Invalid ${key}. Use the requested Rutgers codes only.`);
    return [...new Set(field as string[])];
  }
  if (typeof data.declarationsComplete !== 'boolean' || typeof data.standing !== 'string' || typeof data.honors !== 'string' || !['unknown', 'first-year', 'sophomore', 'junior', 'senior'].includes(data.standing)
    || !['unknown', 'honors-college', 'sas-honors', 'other', 'none'].includes(data.honors)) throw new Error('Invalid standing or honors information.');
  const profile: StudentProfile = { schools: list('schools', /^\d{2}$/, 20), majors: list('majors', /^\d{3}$/, 20), minors: list('minors', /^\d{3}$/, 20),
    declarationsComplete: data.declarationsComplete, standing: data.standing as StudentProfile['standing'], honors: data.honors as StudentProfile['honors'],
    completedCourses: list('completedCourses', rutgersCourseCodePattern), notCompletedCourses: list('notCompletedCourses', rutgersCourseCodePattern),
    placementMetFor: list('placementMetFor', rutgersCourseCodePattern), placementNotMetFor: list('placementNotMetFor', rutgersCourseCodePattern),
    grantedPermissionIndexes: list('grantedPermissionIndexes', /^\d{5}$/) };
  if (profile.completedCourses.some(c => profile.notCompletedCourses.includes(c)) || profile.placementMetFor.some(c => profile.placementNotMetFor.includes(c))) throw new Error('A course cannot be marked both met and not met.');
  return profile;
}
