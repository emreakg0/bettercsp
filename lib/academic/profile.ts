import { parseStudentProfile, rutgersCourseCodePattern as courseCode } from '../eligibility/profile.ts';
import { emptyProfile, type StudentProfile } from '../eligibility/types.ts';

export const academicProfileKey = 'bettercsp:academic-profile:v1';
export const degreeTypes = ['BA', 'BS', 'BFA', 'BM', 'BSW', 'Other'] as const;
export const creditSources = ['ap', 'transfer', 'other'] as const;
export const creditStatuses = ['rutgers-accepted', 'unverified'] as const;
export const creditLimit = 50;

export interface EquivalentCredit {
  courseCode: string | null;
  source: typeof creditSources[number];
  status: typeof creditStatuses[number];
}
export interface AcademicPlanningProfile {
  school: string;
  intendedMajors: string[];
  minorPlans: string[];
  degreeType: typeof degreeTypes[number] | null;
  catalogYear: number | null;
  inProgressCourses: string[];
  plannedCourses: string[];
  equivalentCredits: EquivalentCredit[];
  eligibility: StudentProfile;
  permissionsBySource: Record<string, string[]>;
}

export const emptyAcademicProfile: AcademicPlanningProfile = {
  school: '', intendedMajors: [], minorPlans: [], degreeType: null, catalogYear: null,
  inProgressCourses: [], plannedCourses: [], equivalentCredits: [], eligibility: emptyProfile, permissionsBySource: {},
};

const sourceId = /^\d{4}-[0-9]-[A-Z]{2}$/;
const programName = /^[\p{L}\p{M}\p{N} .&'’()/-]+$/u;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid academic profile.');
  return value as Record<string, unknown>;
}
function allowed<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some(item => item === value);
}
function names(value: unknown, label: string, max: number, pattern: RegExp, length = 80): string[] {
  if (!Array.isArray(value) || value.length > max || !value.every(item =>
    typeof item === 'string' && item.trim().length <= length && pattern.test(item.trim()))) {
    throw new Error('Check the entries for ' + label + '.');
  }
  return [...new Set(value.map((item: string) => item.trim()))];
}
function credits(value: unknown): EquivalentCredit[] {
  if (!Array.isArray(value) || value.length > creditLimit) throw new Error('Enter up to 50 equivalent-credit records.');
  const unique = new Map<string, EquivalentCredit>();
  for (const raw of value) {
    const { courseCode: code, source, status } = object(raw);
    if (!(code === null || typeof code === 'string' && courseCode.test(code)) || !allowed(creditSources, source) || !allowed(creditStatuses, status)) {
      throw new Error('Check the Rutgers course code, source, and status for each credit record.');
    }
    const key = JSON.stringify([code, source]);
    const previous = unique.get(key);
    if (code !== null && previous && previous.status !== status) throw new Error('Choose one status for the same course code and credit source.');
    // Without a course code there is no basis to identify two entries as the same credit.
    unique.set(code === null ? String(unique.size) : key, { courseCode: code, source, status });
  }
  return [...unique.values()];
}

// The planning profile reuses eligibility validation and keeps planning-only data out of solver requests.
export function parseAcademicProfile(value: unknown): AcademicPlanningProfile {
  const data = { ...emptyAcademicProfile, ...object(value) };
  const { school, degreeType, catalogYear } = data;
  if (typeof school !== 'string' || school.trim().length > 80 || (school.trim() && !programName.test(school.trim()))) throw new Error('Check the Rutgers school name.');
  if (degreeType !== null && !allowed(degreeTypes, degreeType)) throw new Error('Choose an available degree type.');
  if (catalogYear !== null && (typeof catalogYear !== 'number' || !Number.isInteger(catalogYear) || catalogYear < 1900 || catalogYear > 2199)) throw new Error('Enter a four-digit program or catalog year.');
  const scopes = Object.entries(object(data.permissionsBySource));
  if (scopes.length > 24 || scopes.some(([scope]) => !sourceId.test(scope))) throw new Error('Invalid permission semester data.');
  const permissionsBySource = Object.fromEntries(scopes.flatMap(([scope, indexes]) => {
    const valid = parseStudentProfile({ grantedPermissionIndexes: indexes }).grantedPermissionIndexes;
    return valid.length ? [[scope, valid] as const] : [];
  }));
  const eligibility = parseStudentProfile(data.eligibility);
  if (eligibility.grantedPermissionIndexes.length) throw new Error('Permission reports need a semester and campus.');
  return {
    school: school.trim(), degreeType, catalogYear,
    intendedMajors: names(data.intendedMajors, 'intended majors', 20, programName),
    minorPlans: names(data.minorPlans, 'minor plans', 20, programName),
    inProgressCourses: names(data.inProgressCourses, 'in-progress courses', 100, courseCode),
    plannedCourses: names(data.plannedCourses, 'planned future courses', 100, courseCode),
    equivalentCredits: credits(data.equivalentCredits), eligibility, permissionsBySource,
  };
}

export function eligibilityForSource(profile: AcademicPlanningProfile, source: string): StudentProfile {
  return { ...profile.eligibility, grantedPermissionIndexes: Object.hasOwn(profile.permissionsBySource, source) ? profile.permissionsBySource[source] : [] };
}

export function readAcademicProfile(saved: string | null): AcademicPlanningProfile | null {
  if (saved === null) return null;
  if (saved.length > 48_000) throw new Error('Saved academic profile is too large.');
  const envelope = object(JSON.parse(saved));
  if (envelope.version !== 1) throw new Error('Unsupported academic profile version.');
  return parseAcademicProfile(envelope.profile);
}
export function serializeAcademicProfile(profile: AcademicPlanningProfile): string {
  return JSON.stringify({ version: 1, profile: parseAcademicProfile(profile) });
}
