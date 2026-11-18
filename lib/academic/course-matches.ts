import type { AcademicPlanningProfile } from './profile.ts';
import type { CourseRule, DegreeProgramRequirements, DegreeRequirement } from './requirements.ts';
import { csPrograms, csRescueTerm, introTransition, supportedScienceTracks } from './rutgers-cs.ts';

export function rescueDegreeProgram(profile: AcademicPlanningProfile, sourceId: string): DegreeProgramRequirements | null {
  const school = profile.school.toLowerCase();
  const cs = profile.eligibility.majors.includes('198') || profile.intendedMajors.some(major => /^(computer science|cs|198)$/i.test(major));
  const { degreeType } = profile;
  return sourceId === csRescueTerm && profile.catalogYear === 2026 && cs &&
    ['sas', 'school of arts and sciences', 'rutgers school of arts and sciences'].includes(school) &&
    (degreeType === 'BA' || degreeType === 'BS') ? csPrograms[degreeType] : null;
}

export function courseProgress(profile: AcademicPlanningProfile, code: string) {
  if (profile.eligibility.completedCourses.includes(code)) return 'reported-completion';
  if (profile.inProgressCourses.includes(code)) return 'in-progress';
  if (profile.equivalentCredits.some(credit => credit.courseCode === code && credit.status === 'rutgers-accepted')) return 'reported-accepted-credit';
  if (profile.equivalentCredits.some(credit => credit.courseCode === code)) return 'unverified-credit';
  if (profile.plannedCourses.includes(code)) return 'planned';
  return 'unreported';
}

export function ruleCourses(rule: CourseRule): string[] {
  return rule.kind === 'course' ? [rule.courseCode] : rule.kind === 'unverified' ? [] : rule.rules.flatMap(ruleCourses);
}

export function reportedMatch(rule: CourseRule, completed: readonly string[]): boolean {
  switch (rule.kind) {
    case 'course': return completed.includes(rule.courseCode);
    case 'all': return rule.rules.every(part => reportedMatch(part, completed));
    case 'choose': return rule.rules.filter(part => reportedMatch(part, completed)).length >= rule.count;
    case 'unverified': return false;
  }
}

export function degreeDependents(program: DegreeProgramRequirements, code: string, profile: AcademicPlanningProfile) {
  return program.prerequisites.filter(edge => ruleCourses(edge.prerequisite).includes(code) &&
    courseProgress(profile, edge.courseCode) !== 'reported-completion' &&
    !reportedMatch(edge.prerequisite, profile.eligibility.completedCourses.filter(completed => completed !== code)));
}

export interface DegreeCourseMatch {
  code: string;
  group: 'required' | 'elective';
  requirement: DegreeRequirement;
  scienceTrack?: readonly string[];
}

// Only propose exact catalog choices. Coursework and possible equivalencies hold back duplicate suggestions
// without declaring a requirement completed or counting credits toward a total.
export function degreeCourseMatches(program: DegreeProgramRequirements, profile: AcademicPlanningProfile,
  retainedCodes: string[], failedCode: string): DegreeCourseMatch[] {
  const reported = new Set([...profile.eligibility.completedCourses, ...profile.inProgressCourses,
    ...profile.equivalentCredits.flatMap(credit => credit.courseCode ? [credit.courseCode] : []), ...retainedCodes]);
  const planningCodes = new Set([...reported, ...profile.plannedCourses, failedCode]);
  const eligible = (code: string) => code !== failedCode && !reported.has(code) && !program.relationships.some(relationship => {
    if (relationship.kind === 'equivalent') return relationship.toCourseCode === code && reported.has(relationship.fromCourseCode);
    return relationship.courseCodes.includes(code) && relationship.courseCodes.some(other => reported.has(other));
  });
  const introProgress = courseProgress(profile, '01:198:111');
  const legacyIntro = (code: string) => !introTransition.includes(code) || (code === '01:198:112' &&
    ['reported-completion', 'in-progress', 'reported-accepted-credit'].includes(introProgress) &&
    !introTransition.slice(2).some(other => planningCodes.has(other)));
  return program.requirements.flatMap((requirement): DegreeCourseMatch[] => {
    if (requirement.kind === 'course') return eligible(requirement.courseCode) && legacyIntro(requirement.courseCode)
      ? [{ code: requirement.courseCode, group: 'required', requirement }] : [];
    if (requirement.kind === 'elective-pool') {
      const completed = requirement.eligibleCourses.filter(code => profile.eligibility.completedCourses.includes(code));
      const upper = (code: string) => Number(code.slice(-3)) >= 300;
      if (completed.length >= requirement.count && completed.filter(upper).length >= requirement.upperLevelMinimum) return [];
      return requirement.eligibleCourses.filter(code => eligible(code) && (upper(code) ||
        completed.length < requirement.count - Math.max(0, requirement.upperLevelMinimum - completed.filter(upper).length)))
        .map(code => ({ code, group: 'elective', requirement }));
    }
    if (requirement.id !== 'bs-science' || requirement.kind !== 'choose') return [];
    const paths = requirement.rules.map(ruleCourses);
    if (paths.some(path => path.every(code => reported.has(code)))) return [];
    const indicated = [...planningCodes].filter(code => paths.some(path => path.includes(code)));
    return supportedScienceTracks.filter(track => indicated.every(code => track.includes(code)))
      .flatMap(scienceTrack => scienceTrack.filter((code, index) => eligible(code) &&
        (!index || profile.eligibility.completedCourses.includes(scienceTrack[0]) ||
          profile.inProgressCourses.includes(scienceTrack[0]) || profile.equivalentCredits.some(credit => credit.courseCode === scienceTrack[0])))
        .map(code => ({ code, group: 'required', requirement, scienceTrack })));
  });
}
