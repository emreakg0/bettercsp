import { declarationFinding, prerequisiteFinding, sourceEvidence, standingFinding } from './academic-rules.ts';
import { emptyProfile, eligibilityPriority, sourceLinks, type EligibilityCourse, type EligibilitySection, type EligibilityFinding, type EligibilityResult, type StudentProfile } from './types.ts';

const addPermissionDescriptions: Record<string, string> = { '03': 'Department staff', '04': 'Instructor', '24': 'Academic Advisor',
  '20': 'Program', '17': 'Honors Program, call 932-7964.', '14': 'Program Director', '16': 'Department',
  '26': 'GSE-Office of Student Academic Services', '21': 'Office of Academic Services', '07': 'Dean - School of Business' };
function permissionFindings(course: EligibilityCourse, section: EligibilitySection, profile: StudentProfile): EligibilityFinding[] {
  const code = section.notices.find(n => n.field === 'specialPermissionAddCode');
  const description = section.notices.find(n => n.field === 'specialPermissionAddCodeDescription');
  const mathHonors = /^01:640:(151|152|251|252|244|291|292)$/.test(course.code)
    && (section.honors?.kind === 'designated' || /^H\d+$/.test(section.number) || /:(291|292)$/.test(course.code));
  if (!code && !mathHonors) return [];
  const granted = profile.grantedPermissionIndexes.includes(section.index);
  const confirmedRule = mathHonors || (!!code && !!description && Object.hasOwn(addPermissionDescriptions, code.text) && addPermissionDescriptions[code.text] === description.text);
  const evidence = code ? [sourceEvidence(section, code.field, code.text), ...(description ? [sourceEvidence(section, description.field, description.text)] : [])] : [];
  if (mathHonors) evidence.push({ field: 'Math honors admission policy', text: 'Honors calculus normally requires invitation; other applicants request departmental honors permission.', url: sourceLinks.mathHonors });
  else evidence.push({ field: 'Department permission instructions', text: 'Request permission through the department; it is separate from prerequisites.', url: course.code.startsWith('01:198:') ? sourceLinks.csPermission : sourceLinks.registration });
  return [{ rule: mathHonors ? 'math.honors-admission.v1' : 'soc.add-permission.v1', category: mathHonors ? 'honors' : 'permission', excludable: false,
    status: granted && confirmedRule ? 'no-known-blocker' : confirmedRule ? 'permission-required' : 'verification-needed',
    message: granted ? 'You report add permission for this registration index; other requirements are still evaluated separately.'
      : mathHonors ? 'Honors calculus admission normally requires an invitation or departmental honors permission. Membership alone does not approve entry.'
        : confirmedRule ? `Rutgers lists an add-permission requirement: ${description!.text} (code ${code!.text}).` : `Uninterpreted add-permission code ${code!.text}.`,
    missing: granted ? [] : ['Approval for this section, if already granted'],
    nextStep: mathHonors ? 'Follow the Math honors admission process and confirm approval for this index. Do not enter an SPN or invitation code here.' : 'Follow the department instructions and confirm permission for this index. An SPN does not override prerequisites.', evidence }];
}
function honorsFinding(course: EligibilityCourse, section: EligibilitySection, profile: StudentProfile): EligibilityFinding | null {
  const note = section.notices.find(n => n.field === 'sectionNotes' && n.text === 'OPEN TO HONORS COLLEGE ONLY');
  const programs = section.notices.find(n => n.field === 'Honors program codes');
  if (!section.honors && !note && !programs) return null;
  if (note) {
    const known = profile.honors === 'honors-college' || profile.honors === 'none', incompatible = profile.honors === 'none';
    return { rule: 'soc.honors-college-only.v1', category: 'honors', excludable: incompatible,
      status: incompatible ? 'potentially-ineligible' : known ? 'no-known-blocker' : 'verification-needed', message: note.text,
      missing: known ? [] : ['Honors College membership (optional)'], nextStep: 'Confirm membership recorded by Rutgers, or ask the department about an exception.',
      evidence: [sourceEvidence(section, note.field, note.text)] };
  }
  if (/^01:640:(151|152|251|252|244|291|292)$/.test(course.code) && !programs) return null;
  return { rule: 'soc.honors-evidence.v1', category: 'honors', status: 'verification-needed', excludable: false,
    message: programs ? 'Honors program codes are supplied, but their program mappings and combined requirements are unverified.' : 'An honors designation is supplied; the department must confirm its enrollment conditions.',
    missing: ['Applicable departmental honors approval or membership rules'], nextStep: 'Review the section notes with the department. Missing program codes do not mean unrestricted enrollment.',
    evidence: [sourceEvidence(section, programs?.field ?? 'honors designation', programs?.text ?? section.honors!.evidence)] };
}
function otherFindings(course: EligibilityCourse, section: EligibilitySection, profile: StudentProfile): EligibilityFinding[] {
  const notes = [...course.notes, ...section.notices];
  const findings: EligibilityFinding[] = [];
  const handled = new Set(['sectionEligibility', 'openToText', 'specialPermissionAddCode', 'specialPermissionAddCodeDescription', 'Honors program codes']);
  for (const note of notes) {
    if (handled.has(note.field) || (note.field === 'sectionNotes' && (note.text === 'OPEN TO HONORS COLLEGE ONLY' || /^HONORS SECTION$/i.test(note.text)))) continue;
    const placement = /placement|test (?:req|required)/i.test(note.text);
    const relevant = placement || /prereq|co[ -]?requis|permission|\bSPN\b|restricted|must (?:also )?(?:register|enroll)|grade|credit not given|(?:majors?|students?|seniors?|juniors?) only|open (?:only )?to/i.test(note.text)
      || /eligib|permission|major|minor|honor|openTo/i.test(note.field);
    if (!relevant) continue;
    const met = placement && profile.placementMetFor.includes(course.code), notMet = placement && profile.placementNotMetFor.includes(course.code);
    findings.push({ rule: placement ? 'soc.placement-note.v1' : 'soc.uninterpreted-restriction.v1', category: placement ? 'placement' : 'other', excludable: false,
      status: 'verification-needed', message: placement ? `${met ? 'You report placement met' : notMet ? 'You report placement not met' : 'Placement information is needed'}: ${note.text}` : `Registration condition needs review: ${note.text}`,
      missing: placement && !met && !notMet ? ['Placement outcome applied by Rutgers for this course (optional)'] : [],
      nextStep: placement ? 'Confirm the required placement level and any alternative course-credit route with the department; this note is not a decoded placement rule.' : 'Ask the department how this source condition applies. Approval for another condition does not waive it.',
      evidence: [sourceEvidence(section, note.field, note.text)] });
  }
  return findings;
}
// This evaluator consumes normalized evidence only; it does not import React, scheduling, or network code.
export function evaluateEligibility(course: EligibilityCourse, section: EligibilitySection, profile: StudentProfile = emptyProfile): EligibilityResult {
  const findings = [standingFinding(section, profile), declarationFinding(section, profile), prerequisiteFinding(course, section, profile),
    ...permissionFindings(course, section, profile), honorsFinding(course, section, profile), ...otherFindings(course, section, profile)]
    .filter((finding): finding is EligibilityFinding => finding !== null);
  const status = eligibilityPriority.find(status => findings.some(f => f.status === status)) ?? 'no-known-blocker';
  return { sectionId: section.id, status, findings, confirmedIncompatible: findings.some(f => f.excludable) };
}
