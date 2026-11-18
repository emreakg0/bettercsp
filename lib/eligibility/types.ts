import type { Course, Section } from '../catalog/types.ts';

// Eligibility contracts are independent of timetable generation and never require identifiers.
export type EligibilityStatus = 'no-known-blocker' | 'permission-required' | 'potentially-ineligible' | 'verification-needed';
export type Standing = 'first-year' | 'sophomore' | 'junior' | 'senior';
export interface StudentProfile {
  schools: string[]; majors: string[]; minors: string[]; declarationsComplete: boolean;
  standing: Standing | 'unknown'; honors: 'unknown' | 'honors-college' | 'sas-honors' | 'other' | 'none';
  completedCourses: string[]; notCompletedCourses: string[];
  placementMetFor: string[]; placementNotMetFor: string[]; grantedPermissionIndexes: string[];
}
export const emptyProfile: StudentProfile = { schools: [], majors: [], minors: [], declarationsComplete: false,
  standing: 'unknown', honors: 'unknown', completedCourses: [], notCompletedCourses: [],
  placementMetFor: [], placementNotMetFor: [], grantedPermissionIndexes: [] };
export interface Evidence { field: string; text: string; url: string }
export interface EligibilityFinding {
  rule: string; category: 'honors' | 'prerequisite' | 'permission' | 'standing' | 'school-major' | 'placement' | 'other';
  status: EligibilityStatus; message: string; missing: string[]; nextStep: string;
  evidence: Evidence[]; excludable: boolean;
}
export interface EligibilityResult {
  sectionId: string; status: EligibilityStatus; findings: EligibilityFinding[]; confirmedIncompatible: boolean;
}
export type EligibilityCourse = Pick<Course, 'id' | 'code' | 'prerequisites' | 'notes'>;
export type EligibilitySection = Pick<Section, 'id' | 'index' | 'number' | 'notices' | 'honors'>;
export const eligibilityPriority: EligibilityStatus[] = ['potentially-ineligible', 'permission-required', 'verification-needed', 'no-known-blocker'];
export const statusLabels: Record<EligibilityStatus, string> = {
  'no-known-blocker': 'No known blocker', 'permission-required': 'Permission required',
  'potentially-ineligible': 'Potentially ineligible', 'verification-needed': 'Verification needed',
};
export const sourceLinks = {
  soc: 'https://classes.rutgers.edu/soc/',
  registration: 'https://sasundergrad.sas.rutgers.edu/resources/faq/registration-faqs',
  mathHonors: 'https://math.sas.rutgers.edu/academics/undergraduate/honors/honors-menu/honors-courses-for-undergraduates',
  csPermission: 'https://www.cs.rutgers.edu/academics/undergraduate/course-registration-and-special-permission',
  prerequisiteOverride: 'https://alc.rutgers.edu/images/Forms/PREREQUISITE_OVERRIDE_FORM.pdf',
};
