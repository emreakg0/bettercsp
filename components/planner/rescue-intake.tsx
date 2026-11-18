import { evaluateEligibility } from '@/lib/eligibility/evaluate';
import { sourceLinks, type StudentProfile } from '@/lib/eligibility/types';
import { formatDay, formatTime, type TimeConflict } from '@/lib/scheduling/meetings';
import type { Selection } from '@/lib/scheduling/selection';
import { ReadinessFindings } from './registration-readiness';

// Rescue needs focused guidance for the student's report, while readiness lists all known findings.
export const rescueReasons = {
  closed: 'My preferred section is closed.',
  rejected: 'WebReg rejected my registration.',
  permission: 'I need a special permission number.',
  prerequisite: 'I’m missing a prerequisite or placement result.',
  conflict: 'Two classes conflict.',
  replace: 'I need to replace a section without disrupting my other classes.',
} as const;
export type RescueReason = keyof typeof rescueReasons;

export function RescueGuidance({ reason, affected, selections, conflicts, profile }: {
  reason: RescueReason; affected: Selection; selections: Selection[]; conflicts: TimeConflict[]; profile: StudentProfile;
}) {
  const { course, section } = affected;
  const findings = evaluateEligibility(course, section, profile).findings;
  const relevant = findings.filter(finding => reason === 'permission'
    ? finding.category === 'permission' || finding.category === 'honors'
    : reason === 'prerequisite' && (finding.category === 'prerequisite' || finding.category === 'placement'));
  const permission = relevant.find(f => f.status === 'permission-required');
  const permissionLink = permission?.evidence.at(-1);
  const missing = [...new Set(relevant.flatMap(finding => finding.missing))];
  const actions = {
    closed: 'Verify current seats in Rutgers’ Schedule of Classes or WebReg. Review the alternatives above if your preferred section is unavailable.',
    rejected: 'Check the exact error in WebReg. Have the course and registration index ready when you contact the offering department or an academic adviser. If you identify the cause, choose that situation above.',
    permission: permission?.nextStep ?? 'Check the WebReg message and follow the offering department’s permission instructions. If there is no published process, ask the department which approval applies to this section.',
    prerequisite: 'Compare your recorded course credit or placement with the course requirement. Ask the offering department to verify any unrecognized credit, placement, or possible override.',
    conflict: conflicts.length ? 'Use More repair options if you want to consider moving either conflicting section. Protections still apply.' : 'Check the other section’s times with Rutgers and add that section to your plan if it is missing.',
    replace: 'Review the options above. Rescue starts with replacements that keep every other section in place.',
  };
  return <div className="schedule-status">
    <h3>What happened</h3>
    {reason === 'closed' && <p>You reported a closed section. {section.availability === 'unknown' ? 'The snapshot has no seat status for this section.' : <>The snapshot lists it as <strong>{section.availability}</strong>.</>} Current seats are unverified.</p>}
    {reason === 'rejected' && <p>You reported a WebReg rejection. BetterCSP cannot establish the cause from the report.</p>}
    {reason === 'permission' && <p>You reported a permission issue. {permission ? permission.category === 'honors' ? 'Rutgers Math guidance identifies a separate honors admission process.' : 'Rutgers section data lists an add-permission requirement.' : 'The available Rutgers information does not confirm which approval is required.'}</p>}
    {reason === 'prerequisite' && <p>You reported a prerequisite or placement issue. {relevant.length ? 'The course or section data has relevant requirements, but BetterCSP cannot verify the academic record WebReg used.' : 'There is no specific requirement BetterCSP can confirm from the available data.'}{!!missing.length && <> To check: {missing.join(', ')}.</>}</p>}
    {reason === 'conflict' && (conflicts.length ? <ul className="generation-notes">{conflicts.map(conflict => {
      const a = selections.find(s => s.section.id === conflict.firstId)!;
      const b = selections.find(s => s.section.id === conflict.secondId)!;
      const first = a.section.meetings[conflict.firstMeeting], second = b.section.meetings[conflict.secondMeeting];
      return <li key={JSON.stringify(conflict)}>{formatDay(first.dayCode)}: {a.course.code} section {a.section.number}, {formatTime(first.startMinute)}–{formatTime(first.endMinute)}, overlaps {b.course.code} section {b.section.number}, {formatTime(second.startMinute)}–{formatTime(second.endMinute)} (Eastern).</li>;
    })}</ul> : <p>There is no recorded meeting overlap for this section. Arranged or unknown meeting times cannot be checked.</p>)}
    {reason === 'replace' && <p>You chose to look for another section of {course.code}.</p>}
    <h3>What you can do</h3>
    <p>{actions[reason]}</p>
    {reason === 'closed' && <a className="back-link" href={sourceLinks.soc}>Rutgers Schedule of Classes ↗</a>}
    {reason === 'permission' && <a className="back-link" href={permissionLink?.url ?? (course.code.startsWith('01:198:') ? sourceLinks.csPermission : sourceLinks.registration)}>Rutgers permission instructions ↗</a>}
    {(reason === 'rejected' || reason === 'prerequisite') && <a className="back-link" href={sourceLinks.registration}>Rutgers registration guidance ↗</a>}
    <h3>What happens to your schedule</h3>
    <p>{reason === 'prerequisite' ? 'Your plan stays the same. Another section may have the same requirement.' : reason === 'permission' ? 'You can keep this section while requesting permission or review a replacement.' : 'Your draft stays the same until you approve a repair.'}</p>
    {!!relevant.length && <details><summary>Rutgers requirements and source evidence</summary><ReadinessFindings findings={relevant} /></details>}
  </div>;
}
