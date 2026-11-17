import type { SourceNotice } from '../catalog/types.ts';
import type { Selection } from './selection.ts';

// Generation contracts are new; manual selections remain the shared output representation.
export interface CourseChoice { courseId: string; required: boolean }
export interface HardConstraints {
  earliestStart: number; latestEnd: number; daysOff: string[];
  excludedSectionIds: string[]; excludedCampuses: string[]; lockedSectionIds: string[];
}
export interface PreferenceWeights {
  daysOff: number; laterStarts: number; gaps: number; campusChanges: number;
  commuteDays: number; instructors: number;
}
export interface GenerationRequest {
  choices: CourseChoice[]; constraints: HardConstraints; weights: PreferenceWeights;
  preferredInstructors: string[];
}
export const defaultConstraints: HardConstraints = {
  earliestStart: 0, latestEnd: 1439, daysOff: [], excludedSectionIds: [], excludedCampuses: [], lockedSectionIds: [],
};
export const defaultWeights: PreferenceWeights = { daysOff: 2, laterStarts: 1, gaps: 2, campusChanges: 1, commuteDays: 2, instructors: 1 };
export interface ScheduleMetrics {
  classDays: number; earliestStart: number | null; gapMinutes: number; campusTransitions: number;
  commuteDays: number; meanFirstStart: number | null; unmatchedInstructors: number;
}
export interface ScorePart { label: string; amount: number }
export interface RankedSchedule {
  id: string; selections: Selection[]; score: number; metrics: ScheduleMetrics;
  breakdown: ScorePart[]; optionalIncluded: number; omittedCourses: string[];
  restrictions: (SourceNotice & { courseCode: string; sectionIndex: string })[];
  limitations: string[];
}
export interface CandidateReport {
  courseId: string; code: string; total: number; candidates: number; exclusions: Record<string, number>;
}
export interface GenerationResult {
  schedules: RankedSchedule[]; reports: CandidateReport[]; issues: string[];
  visited: number; completed: number; truncated: boolean;
}
