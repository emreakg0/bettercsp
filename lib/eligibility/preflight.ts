import type { AcademicPlanningProfile } from '../academic/profile.ts';
import { calendarCampus, calendarCampuses } from '../catalog/calendar-campus.ts';
import { exclusionReason } from '../scheduling/candidates.ts';
import { formatDay, formatTime, isScheduled, meetingsOverlap, needsTimingVerification } from '../scheduling/meetings.ts';
import type { HardConstraints } from '../scheduling/generation-types.ts';
import type { Selection } from '../scheduling/selection.ts';
import { evaluateEligibility } from './evaluate.ts';
import { sourceLinks, type EligibilityFinding, type StudentProfile } from './types.ts';

const travelGuidance = 'https://sasundergrad.rutgers.edu/resources/faq/faq-detail/travel-conflict';
const travelTerm = '2027-1-NB:'; // Confirmed by the New Brunswick registrar for Spring 2027.
export const preflightLabels = {
  conflict: 'Known conflict',
  action: 'Permission or other action required',
  verify: 'Needs verification',
  clear: 'No known issue under supported checks',
} as const;
export type PreflightLevel = keyof typeof preflightLabels;
const priority: PreflightLevel[] = ['conflict', 'action', 'verify', 'clear'];
type PreflightIssue = {
  level: Exclude<PreflightLevel, 'clear'>;
  title: string;
  scope: 'course' | 'section' | 'timetable' | 'seats';
  detail: string;
  next: string;
  url?: string;
  finding?: EligibilityFinding;
  alternate?: boolean;
};
export interface PreflightRow {
  selection: Selection;
  level: PreflightLevel;
  issues: PreflightIssue[];
  evidence: EligibilityFinding[];
}
export type PlanningContext = Pick<AcademicPlanningProfile, 'inProgressCourses' | 'plannedCourses' | 'equivalentCredits'>;

function findingTitle(finding: EligibilityFinding): string {
  if (finding.category === 'school-major') {
    const field = finding.evidence[0]?.text;
    if (finding.supported && field?.startsWith('MAJ:')) return 'Major restriction';
    if (finding.supported && field?.startsWith('MINOR:')) return 'Minor restriction';
    return finding.supported ? 'School restriction' : 'Enrollment restriction needs interpretation';
  }
  switch (finding.category) {
    case 'honors': return 'Honors admission requirement';
    case 'permission': return finding.supported ? 'Special permission required' : 'Permission requirement needs verification';
    case 'standing': return 'Class-standing restriction';
    case 'prerequisite': return 'Prerequisite needs verification';
    case 'placement': return 'Placement requirement needs verification';
    default: return 'Registration condition needs verification';
  }
}

export function sectionWarning(course: Selection['course'], section: Selection['section'], profile: StudentProfile): string {
  const labels = evaluateEligibility(course, section, profile).findings
    .filter(finding => finding.scope === 'section' && finding.supported)
    .map(findingTitle);
  return [...new Set(labels)].slice(0, 2).join(' · ');
}

function planningNotes(finding: EligibilityFinding, planning: PlanningContext): string[] {
  if (finding.category !== 'prerequisite') return [];
  const codes = new Set(finding.evidence[0]?.text.match(/\b\d{2}:\d{3}:\d{3}\b/g));
  const progressing = planning.inProgressCourses.filter(code => codes.has(code));
  const planned = planning.plannedCourses.filter(code => codes.has(code));
  const credits = planning.equivalentCredits.filter(credit => credit.courseCode && codes.has(credit.courseCode));
  return [
    ...(progressing.length ? ['In progress in your profile: ' + progressing.join(', ') + '. Ask Rutgers whether and when it can be recognized for registration.'] : []),
    ...(planned.length ? ['Planned in your profile: ' + planned.join(', ') + '. Planned study does not establish completion.'] : []),
    ...credits.map(credit => credit.status === 'rutgers-accepted'
      ? credit.courseCode + ' is listed as Rutgers-accepted credit in your profile. Confirm whether Rutgers applies it to this prerequisite.'
      : credit.courseCode + ' is listed as an unverified equivalent in your profile. Ask Rutgers to evaluate the equivalency.'),
  ];
}

function eligibilityIssue(finding: EligibilityFinding, planning: PlanningContext, selection: Selection, profile: StudentProfile): PreflightIssue {
  const level = finding.excludable ? 'conflict' : finding.status === 'permission-required' ? 'action' : 'verify';
  const title = findingTitle(finding);
  const sourceText = finding.evidence[0]?.text ?? '';
  const names = [...sourceText.matchAll(/\(([^()]+)\)/g)].map(match => match[1]);
  const condition = finding.supported && finding.category === 'school-major' && names.length ? 'Rutgers lists ' + names.join(', ') + ' for this section.'
    : finding.supported && finding.category === 'standing' ? 'Rutgers lists this class standing: ' + sourceText.toLowerCase() + '.'
      : finding.supported && finding.category === 'prerequisite' ? 'Course codes listed by Rutgers: ' +
        [...new Set(sourceText.match(/\b\d{2}:\d{3}:\d{3}\b/g))].join(', ') + '. See the full prerequisite for alternatives.'
        : finding.category === 'placement' && profile.placementMetFor.includes(selection.course.code) ? 'You report qualifying placement. Rutgers still needs to recognize it for this course.'
          : finding.category === 'placement' && profile.placementNotMetFor.includes(selection.course.code) ? 'You report that the required placement has not been met.'
            : '';
  const detail = finding.status === 'no-known-blocker'
    ? 'Reported completions match the supported part of this prerequisite. Rutgers’ record and any grade or credit conditions still need confirmation.'
    : finding.category === 'prerequisite' && finding.status === 'potentially-ineligible' ? finding.message
    : finding.excludable ? 'This requirement conflicts with the information you reported.'
    : level === 'action' ? 'Rutgers lists a separate approval for this enrollment.'
      : finding.supported && finding.missing.length ? 'There is not enough recorded information to compare this requirement with your profile.'
        : 'The available information does not establish whether this requirement is met.';
  return { level, title, scope: finding.scope, finding, detail: [condition, detail, ...planningNotes(finding, planning)].filter(Boolean).join(' '),
    next: finding.nextStep, url: finding.category === 'prerequisite' || level === 'action'
      ? finding.evidence.at(-1)?.url ?? sourceLinks.registration : sourceLinks.registration,
    alternate: finding.scope === 'section' && (level === 'conflict' || level === 'action') };
}

function timetableIssues(selection: Selection, selections: Selection[]): PreflightIssue[] {
  const { section } = selection;
  const issues: PreflightIssue[] = [];
  if (!section.meetings.length || section.meetings.some(needsTimingVerification)
    || section.notices.some(n => n.field === 'Meeting timing inconsistency')) {
    issues.push({ level: 'verify', scope: 'timetable', title: 'Meeting times need verification',
      detail: 'Some meeting times are incomplete, arranged, or inconsistent.', next: 'Confirm when all components meet before registration.', url: sourceLinks.soc });
  }
  for (const other of selections) {
    const same = section.id === other.section.id;
    if (same && selection !== other) continue;
    for (const [i, meeting] of section.meetings.entries()) for (const [j, next] of other.section.meetings.entries()) {
      if ((same && j <= i) || !isScheduled(meeting) || !isScheduled(next) || meeting.dayCode !== next.dayCode) continue;
      const label = other.course.code + ' · index ' + other.section.index;
      if (meetingsOverlap(meeting, next)) {
        issues.push({ level: 'conflict', scope: 'timetable', title: 'Meeting times overlap', alternate: true,
          detail: formatDay(meeting.dayCode) + ' ' + formatTime(meeting.startMinute) + '–' + formatTime(meeting.endMinute) +
            ' overlaps ' + label + ' at ' + formatTime(next.startMinute) + '–' + formatTime(next.endMinute) + ' Eastern.',
          next: 'Look for a different section and confirm actual meeting dates with Rutgers.', url: sourceLinks.soc });
        continue;
      }
      if (!section.id.startsWith(travelTerm) || !other.section.id.startsWith(travelTerm)) continue;
      const a = calendarCampus(meeting.campus), b = calendarCampus(next.campus);
      const offCampus = ['online', 'other', 'camden', 'newark'];
      if (a === b || offCampus.includes(a) || offCampus.includes(b)) continue;
      const pair = [a, b].sort().join('/');
      const minimum = pair === 'busch/livingston' || pair === 'college-avenue/downtown' ? 30 : 40;
      const gap = Math.max(next.startMinute - meeting.endMinute, meeting.startMinute - next.endMinute);
      if (gap < minimum) issues.push({ level: 'action', scope: 'timetable', title: 'Campus gap below Rutgers travel minimum', alternate: true,
        detail: formatDay(meeting.dayCode) + ': ' + gap + ' minutes between ' + calendarCampuses[a] + ' and ' + calendarCampuses[b] +
          ' for meetings with ' + label + '. Rutgers publishes a ' + minimum + '-minute minimum for this pair.',
        next: 'Compare sections with a longer gap. Verify meeting dates and locations with Rutgers.', url: travelGuidance });
    }
  }
  return issues;
}

/** Reuse the eligibility evaluator and draw only advisory conclusions from planning and seat data. */
export function evaluatePreflight(selections: Selection[], profile: StudentProfile, planning: PlanningContext): PreflightRow[] {
  return selections.map(selection => preflightRow(selection, selections, profile, planning))
    .sort((a, b) => priority.indexOf(a.level) - priority.indexOf(b.level));
}

function preflightRow(selection: Selection, selections: Selection[], profile: StudentProfile, planning: PlanningContext): PreflightRow {
  const { course, section } = selection;
  const evidence = evaluateEligibility(course, section, profile).findings;
  const issues = [
    ...evidence.filter(finding => finding.status !== 'no-known-blocker' ||
      // A course-only match is self-reported and may still depend on Rutgers-recognized grades or credit.
      finding.category === 'prerequisite').map(finding => eligibilityIssue(finding, planning, selection, profile)),
    ...timetableIssues(selection, selections),
  ];
  if (section.availability !== 'open') issues.push({ level: 'verify', scope: 'seats', title: 'Snapshot seat status',
    detail: section.availability === 'closed' ? 'Closed in the snapshot. Current seats are unverified.' : 'The snapshot has no seat status. Current seats are unverified.',
    next: 'Check current sections and seats in Rutgers systems before registering.', url: sourceLinks.soc, alternate: section.availability === 'closed' });
  issues.sort((a, b) => priority.indexOf(a.level) - priority.indexOf(b.level));
  return { selection, level: issues[0]?.level ?? 'clear', issues, evidence };
}

export function rankPreflightAlternatives(target: Selection, sections: Selection['section'][], selections: Selection[],
  profile: StudentProfile, planning: PlanningContext, constraints: HardConstraints): PreflightRow[] {
  const kept = selections.filter(s => s.section.id !== target.section.id);
  return sections.filter(section => section.id !== target.section.id && !exclusionReason(section, constraints))
    .flatMap(section => {
      const candidate = { course: target.course, section };
      const row = preflightRow(candidate, [candidate, ...kept], profile, planning);
      return row.issues.some(issue => issue.scope === 'timetable' && issue.level !== 'verify') ? [] : [row];
    })
    .sort((a, b) => priority.indexOf(b.level) - priority.indexOf(a.level)
      || a.issues.filter(issue => issue.level !== 'verify').length - b.issues.filter(issue => issue.level !== 'verify').length
      || a.issues.length - b.issues.length || a.selection.section.index.localeCompare(b.selection.section.index));
}
