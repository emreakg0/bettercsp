import type { Section } from '../catalog/types.ts';
import { isScheduled, weekDays } from './meetings.ts';
import { eveningThreshold, type PreferenceWeights, type ScheduleMetrics, type ScorePart } from './generation-types.ts';

// Metrics and weighted penalties are pure and separate from eligibility and seat status.
export function isPhysicalCampus(campus: string): boolean {
  return !!campus && !/online|remote|^ONL$|^O$|^T$/i.test(campus);
}
export function scoreSchedule(sections: Section[], weights: PreferenceWeights, preferred: string[]): {
  score: number; metrics: ScheduleMetrics; breakdown: ScorePart[];
} {
  const events = sections.flatMap(s => s.meetings.filter(isScheduled));
  let gapMinutes = 0, campusTransitions = 0, commuteDays = 0;
  const firstStarts: number[] = [];
  for (const day of weekDays) {
    const daily = events.filter(m => m.dayCode === day).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
    if (daily.length) firstStarts.push(daily[0].startMinute);
    for (let i = 1; i < daily.length; i++) gapMinutes += Math.max(0, daily[i].startMinute - daily[i - 1].endMinute);
    const physical = daily.filter(m => isPhysicalCampus(m.campus));
    if (physical.length) commuteDays++;
    for (let i = 1; i < physical.length; i++) if (physical[i].campus !== physical[i - 1].campus) campusTransitions++;
  }
  const metrics: ScheduleMetrics = {
    classDays: firstStarts.length, earliestStart: firstStarts.length ? Math.min(...firstStarts) : null,
    meanFirstStart: firstStarts.length ? firstStarts.reduce((a, b) => a + b, 0) / firstStarts.length : null,
    gapMinutes, campusTransitions, commuteDays,
    unmatchedInstructors: preferred.length ? sections.filter(s => !s.instructors.some(name =>
      preferred.some(p => name.toLowerCase().includes(p.trim().toLowerCase())))).length : 0,
  };
  const eveningWeight = weights.lateEvenings ?? 0;
  const breakdown: ScorePart[] = [
    { label: 'Class days', amount: weights.daysOff * metrics.classDays },
    { label: 'Earlier daily starts', amount: weights.laterStarts * (metrics.meanFirstStart === null ? 0 : 24 - metrics.meanFirstStart / 60) },
    ...(eveningWeight > 0 ? [{
      label: 'Meeting hours after 7 PM',
      amount: eveningWeight * events.reduce((total, meeting) => total + Math.max(0, meeting.endMinute - eveningThreshold), 0) / 60,
    }] : []),
    { label: 'Hours between classes', amount: weights.gaps * metrics.gapMinutes / 60 },
    { label: 'Campus changes (proxy)', amount: weights.campusChanges * metrics.campusTransitions },
    { label: 'Days on campus', amount: weights.commuteDays * metrics.commuteDays },
    { label: 'Sections without a preferred instructor', amount: weights.instructors * metrics.unmatchedInstructors },
  ].map(part => ({ ...part, amount: Math.round(part.amount * 1000) / 1000 }));
  return { score: Math.round(breakdown.reduce((sum, part) => sum + part.amount, 0) * 1000) / 1000, metrics, breakdown };
}
