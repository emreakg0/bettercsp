import type { Course } from '../catalog/types.ts';
import { evaluateEligibility } from '../eligibility/evaluate.ts';
import { timetableIssues } from '../eligibility/preflight.ts';
import { eligibilityPriority, emptyProfile, type EligibilityStatus } from '../eligibility/types.ts';
import { generateSchedules } from '../scheduling/generate.ts';
import { equivalentCourseGroups, linkageNotices } from '../scheduling/relationships.ts';
import { plannerCourse, type Selection } from '../scheduling/selection.ts';
import { resolveRescueDraft } from './rescue.ts';
import { draftSignature, protectedSections } from './state.ts';
import type { RescueRequest } from './types.ts';

export interface CourseFallbackOption {
  selection: Selection;
  score: number;
  eligibility: EligibilityStatus;
  needsComponentReview: boolean;
}
export interface CourseFallbackResult {
  basis: string;
  options: CourseFallbackOption[];
  issue?: string;
  truncated: boolean;
  visited: number;
}

// Course replacements are intentionally a single change. Use the normal solver with every other index fixed.
export function findCourseFallbacks(catalog: Course[], request: RescueRequest, targetId: string, candidateCodes: string[], maximumSteps = 8000): CourseFallbackResult {
  const draft = resolveRescueDraft(catalog, request);
  const result: CourseFallbackResult = { basis: draftSignature(draft), options: [], truncated: false, visited: 0 };
  const target = draft.selections.find(selection => selection.section.id === targetId);
  if (!target || draft.selections.length !== request.sectionIds.length || new Set(draft.selections.map(s => s.course.code)).size !== draft.selections.length) {
    return { ...result, issue: 'Resolve missing or duplicate courses in the saved plan and try again.' };
  }
  if (protectedSections(draft).includes(targetId) || Object.entries(draft.statuses).some(([id, status]) => status === 'registered' && !request.sectionIds.includes(id))) {
    return { ...result, issue: 'Verify the protected registration or lock in your saved schedule before replacing a course.' };
  }
  const kept = draft.selections.filter(selection => selection !== target);
  const keptIds = new Set(kept.map(s => s.course.id));
  const codes = [target.course.code, ...candidateCodes.filter(code => code !== target.course.code && !kept.some(s => s.course.code === code))];
  const profile = request.settings.eligibility?.profile ?? emptyProfile;
  const completed = new Set(profile.completedCourses);
  const relevant = catalog.filter(course => keptIds.has(course.id) || codes.includes(course.code) || completed.has(course.code));
  const retained = relevant.filter(course => keptIds.has(course.id));
  const crossLists = equivalentCourseGroups(relevant);
  const retainedGroups = new Set(retained.map(course => crossLists.get(course.id)));
  const completedGroups = new Set(relevant.filter(course => completed.has(course.code)).map(course => crossLists.get(course.id)));
  const budget = Math.max(1, Math.min(8000, Math.floor(maximumSteps)));
  const compare = (a: CourseFallbackOption, b: CourseFallbackOption) =>
    eligibilityPriority.indexOf(b.eligibility) - eligibilityPriority.indexOf(a.eligibility) ||
    Number(b.selection.section.availability === 'open') - Number(a.selection.section.availability === 'open') ||
    a.score - b.score || a.selection.section.id.localeCompare(b.selection.section.id);

  for (const code of codes) {
    const options: CourseFallbackOption[] = [];
    for (const course of relevant.filter(course => course.code === code)) {
      const group = crossLists.get(course.id);
      if (retainedGroups.has(group) || (code !== target.course.code && completedGroups.has(group))) continue;
      if (result.visited >= budget) { result.truncated = true; break; }
      const { sections, ...info } = plannerCourse(course);
      const viable = sections.filter(section => {
        if (section.id === targetId || section.availability === 'closed') return false;
        const eligibility = evaluateEligibility(info, section, profile);
        if (eligibility.confirmedIncompatible || eligibility.findings.some(finding => finding.status === 'permission-required')) return false;
        const option = { course: info, section };
        return !timetableIssues(option, [option, ...kept]).some(issue => issue.level !== 'verify');
      });
      const eligibleIds = new Set(viable.map(section => section.id));
      if (!eligibleIds.size) continue;
      const solved = generateSchedules([...retained, { ...course, sections: course.sections.filter(section => eligibleIds.has(section.id)) }], {
        ...request.settings,
        choices: [...kept.map(s => ({ courseId: s.course.id, required: true })), { courseId: course.id, required: true }],
        constraints: { ...request.settings.constraints, lockedSectionIds: kept.map(s => s.section.id) },
        eligibility: { profile, excludeConfirmed: false }, // Only the incoming section was screened. Preserve the reported registrations.
      }, { maxResults: 20, maxNodes: budget - result.visited });
      result.visited += solved.visited;
      result.truncated ||= solved.truncated;
      for (const schedule of solved.schedules) {
        const selection = schedule.selections.find(s => s.course.id === course.id)!;
        const eligibility = schedule.eligibility.find(item => item.sectionId === selection.section.id)!.status;
        const rawSection = course.sections.find(section => section.id === selection.section.id)!;
        options.push({ selection, score: schedule.score, eligibility, needsComponentReview: linkageNotices(course, rawSection).length > 0 });
      }
    }
    const unique = new Map<string, CourseFallbackOption>();
    for (const option of options.sort(compare)) if (!unique.has(option.selection.section.id)) unique.set(option.selection.section.id, option);
    result.options.push(...[...unique.values()].slice(0, 3));
  }
  return result;
}
