import type { Meeting, Section } from '../catalog/types.ts';

// Shared meeting semantics keep section disclosures, calendar, and conflict checks aligned.
// SOC day-filter labels: H = Thursday, U = Sunday (verified 2026-11-17 in Phase 1).
export const weekDays = ['M', 'T', 'W', 'H', 'F', 'S', 'U'] as const;
const dayNames: Record<string, string> = { M: 'Mon', T: 'Tue', W: 'Wed', H: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
export function formatDay(code: string): string {
  return Object.hasOwn(dayNames, code) ? dayNames[code] : (code ? `Day code ${code}` : 'Day not specified');
}
export function formatTime(minute: number | null): string {
  if (minute === null) return 'Time not specified';
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
export function isScheduled(meeting: Meeting): meeting is Meeting & { startMinute: number; endMinute: number } {
  const { startMinute: start, endMinute: end } = meeting;
  return meeting.timing === 'scheduled' && Object.hasOwn(dayNames, meeting.dayCode) && start !== null && end !== null
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end < 1440 && start < end;
}
export function needsTimingVerification(meeting: Meeting): boolean {
  return meeting.timing !== 'asynchronous' && !isScheduled(meeting);
}
export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  return isScheduled(a) && isScheduled(b) && a.dayCode === b.dayCode
    && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}
export interface TimeConflict { firstId: string; secondId: string; firstMeeting: number; secondMeeting: number }
export function findConflicts(sections: Pick<Section, 'id' | 'meetings'>[]): TimeConflict[] {
  const conflicts: TimeConflict[] = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      sections[i].meetings.forEach((a, firstMeeting) => sections[j].meetings.forEach((b, secondMeeting) => {
        if (meetingsOverlap(a, b)) conflicts.push({ firstId: sections[i].id, secondId: sections[j].id, firstMeeting, secondMeeting });
      }));
    }
  }
  return conflicts;
}
