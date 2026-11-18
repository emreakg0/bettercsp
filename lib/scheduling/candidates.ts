import type { Course, Section } from '../catalog/types.ts';
import type { HardConstraints } from './generation-types.ts';
import { isScheduled, meetingsOverlap } from './meetings.ts';

// Candidate filtering reuses normalized meeting semantics; unknown timing is never certified.
export function exclusionReason(section: Pick<Section, 'id' | 'meetings' | 'notices' | 'campuses'>, hard: HardConstraints): string | null {
  if (hard.excludedSectionIds.includes(section.id)) return 'Excluded section';
  if (!section.meetings.length || section.meetings.some(m => !isScheduled(m) && m.timing !== 'asynchronous')) return 'Arranged or unknown timing';
  if (section.notices.some(n => n.field === 'Meeting timing inconsistency')) return 'Inconsistent source timing';
  for (const meeting of section.meetings) {
    if (hard.excludedCampuses.length && !meeting.campus) return 'Unknown campus under campus exclusions';
    if (hard.excludedCampuses.some(c => c.toLowerCase() === meeting.campus.toLowerCase())) return 'Excluded campus';
    if (isScheduled(meeting)) {
      if (meeting.startMinute < hard.earliestStart) return 'Before earliest start';
      if (meeting.endMinute > hard.latestEnd) return 'After latest end';
      if (hard.daysOff.includes(meeting.dayCode)) return 'Required day off';
    }
  }
  if (section.campuses.some(c => hard.excludedCampuses.some(excluded => excluded.toLowerCase() === c.toLowerCase()))) return 'Excluded campus';
  for (let i = 0; i < section.meetings.length; i++) for (let j = i + 1; j < section.meetings.length; j++) {
    if (meetingsOverlap(section.meetings[i], section.meetings[j])) return 'Overlaps within section';
  }
  return null;
}
export function sectionsOverlap(a: Section, b: Section): boolean {
  return a.id === b.id || a.meetings.some(x => b.meetings.some(y => meetingsOverlap(x, y)));
}
export interface Candidate { course: Course; section: Section }
