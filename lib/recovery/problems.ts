import { evaluateEligibility } from '../eligibility/evaluate.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { exclusionReason } from '../scheduling/candidates.ts';
import { findConflicts } from '../scheduling/meetings.ts';
import { reportedAvailability } from '../availability/evidence.ts';
import type { AvailabilityEvidence, RescueDraft, RescueProblem, RescueRequest } from './types.ts';

// Detection records provenance: student reports never masquerade as SOC or WebReg confirmations.
export function detectProblems(draft: RescueDraft, request: RescueRequest, availability: AvailabilityEvidence): RescueProblem[] {
  const problems: RescueProblem[] = [];
  for (const { course, section } of draft.selections) {
    const registered = draft.statuses[section.id] === 'registered';
    const report = draft.statuses[section.id];
    if (report === 'failed' || report === 'needs-permission' || report === 'needs-verification') problems.push({ sectionId: section.id, source: 'student', message: `You reported ${report.replaceAll('-', ' ')}.`, requiresReplacement: false });
    if (request.replaceSectionIds.includes(section.id)) problems.push({ sectionId: section.id, source: 'student', message: 'You requested a different registration index.', requiresReplacement: true });
    if (!registered && reportedAvailability(section, availability) === 'closed') problems.push({ sectionId: section.id, source: 'availability', message: availability.state === 'fresh' ? 'Reported closed by a verified current availability check.' : 'Closed in the development snapshot; current closure is not confirmed. Select this index for replacement if it is unavailable now.', requiresReplacement: availability.state === 'fresh' });
    const eligibility = evaluateEligibility(course, section, request.settings.eligibility?.profile ?? emptyProfile);
    if (eligibility.confirmedIncompatible || (!registered && eligibility.status === 'permission-required')) problems.push({ sectionId: section.id, source: 'eligibility', message: eligibility.findings.filter(f => f.excludable || f.status === 'permission-required').map(f => f.message).join(' '), requiresReplacement: eligibility.confirmedIncompatible });
    if (!eligibility.confirmedIncompatible && eligibility.status === 'potentially-ineligible') problems.push({ sectionId: section.id, source: 'eligibility', message: 'Reported prerequisite or academic facts need departmental review; a section swap alone may not resolve this.', requiresReplacement: false });
    const hardReason = exclusionReason(section, request.settings.constraints);
    if (hardReason) problems.push({ sectionId: section.id, source: 'timetable', message: `The current section fails a timetable check: ${hardReason}.`, requiresReplacement: false });
  }
  for (const conflict of findConflicts(draft.selections.map(s => s.section))) {
    for (const id of [conflict.firstId, conflict.secondId]) problems.push({ sectionId: id, source: 'timetable', message: 'Supplied meeting times overlap another selected section. At least one section must change.', requiresReplacement: false });
  }
  return problems;
}
