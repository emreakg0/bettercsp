// Sourced program rules remain separate from student reports and registration eligibility.
export interface RequirementSource { url: string; reviewedOn: string }
export interface CourseDependency {
  courseCode: string;
  prerequisite: CourseRule;
  source: RequirementSource;
}
export type CourseRule =
  | { kind: 'course'; courseCode: string }
  | { kind: 'all'; rules: readonly CourseRule[] }
  | { kind: 'choose'; count: number; rules: readonly CourseRule[] }
  | { kind: 'unverified'; note: string };

export type DegreeRequirement = { id: string; title: string; source: RequirementSource } & (
  | CourseRule
  | { kind: 'elective-pool'; count: number; eligibleCourses: readonly string[]; inDepartmentMinimum: number; upperLevelMinimum: number }
  | { kind: 'general-education'; category: string; count: number; eligibleCourses: readonly string[] }
);
export type CourseRelationship = { source: RequirementSource } & (
  | { kind: 'equivalent'; fromCourseCode: string; toCourseCode: string }
  | { kind: 'cross-listed'; courseCodes: readonly string[] }
  | { kind: 'exclusive-credit'; courseCodes: readonly string[] }
);
export interface DegreeProgramRequirements {
  programId: string;
  schoolId: string;
  campus: string;
  degreeType: string;
  catalogYear: number;
  requirements: readonly DegreeRequirement[];
  prerequisites: readonly CourseDependency[];
  relationships: readonly CourseRelationship[];
  source: RequirementSource;
}
export type RequirementMatch =
  | { status: 'verified-match'; requirementId: string; courseCodes: readonly string[]; evidence: RequirementSource }
  | { status: 'unknown' | 'unverified'; requirementId: string; reason: string };
