import { sourceLinks, type EligibilityCourse, type EligibilitySection, type EligibilityFinding, type Evidence, type Standing, type StudentProfile } from './types.ts';

const standings: Record<string, Standing[]> = {
  'JUNIORS AND SENIORS': ['junior', 'senior'], '1ST YEAR ONLY': ['first-year'],
  'ALL EXCEPT 1ST YEAR': ['sophomore', 'junior', 'senior'], 'ALL EXCEPT SENIORS': ['first-year', 'sophomore', 'junior'],
  'SENIORS ONLY': ['senior'], 'SOPHOMORES AND JUNIORS': ['sophomore', 'junior'],
  '1ST YEAR AND SOPHOMORES': ['first-year', 'sophomore'], 'SOPHOMORES ONLY': ['sophomore'], 'JUNIORS ONLY': ['junior'],
};
export function sourceEvidence(section: EligibilitySection, field: string, text: string): Evidence {
  const scope = section.id.match(/^(\d{4})-([139])-([A-Z]+):/);
  const url = scope ? `https://classes.rutgers.edu/soc/api/courses.json?year=${scope[1]}&term=${scope[2]}&campus=${scope[3]}` : sourceLinks.soc;
  return { field, text, url };
}
export function standingFinding(section: EligibilitySection, profile: StudentProfile): EligibilityFinding | null {
  const text = section.notices.find(n => n.field === 'sectionEligibility')?.text;
  if (!text) return null;
  const allowed = Object.hasOwn(standings, text) ? standings[text] : null;
  const incompatible = !!allowed && profile.standing !== 'unknown' && !allowed.includes(profile.standing);
  return { rule: 'soc.standing.exact.v1', scope: 'section', supported: !!allowed, category: 'standing', status: incompatible ? 'potentially-ineligible' : allowed && profile.standing !== 'unknown' ? 'no-known-blocker' : 'verification-needed',
    excludable: incompatible, message: `Class-standing restriction: ${text}.`, missing: profile.standing === 'unknown' ? ['Rutgers class standing'] : [],
    nextStep: incompatible ? 'Choose a section for your standing, or ask the department to confirm an exception.' : allowed ? 'Confirm your standing in Rutgers records before registration.' : 'Ask the department to interpret this standing requirement.',
    evidence: [sourceEvidence(section, 'sectionEligibility', text)] };
}
export function declarationFinding(section: EligibilitySection, profile: StudentProfile): EligibilityFinding | null {
  const notice = section.notices.find(n => n.field === 'openToText');
  if (!notice) return null;
  let reduced = notice.text;
  while (/\([^()]*\)/.test(reduced)) reduced = reduced.replace(/\([^()]*\)/g, '');
  const match = reduced.trim().match(/^(UNIT|MAJ|MINOR):\s*(\d+(?:\s*,\s*\d+)*)$/);
  const category = match?.[1], codes = match?.[2].split(/\s*,\s*/) ?? [];
  const width = category === 'UNIT' ? 2 : 3;
  const supported = !!match && codes.every(code => code.length === width);
  const supplied = category === 'UNIT' ? profile.schools : category === 'MAJ' ? profile.majors : profile.minors;
  const matches = supported && codes.some(code => supplied.includes(code));
  const known = matches || (supported && profile.declarationsComplete && (category !== 'UNIT' || supplied.length > 0));
  const incompatible = known && !matches;
  return { rule: 'soc.open-to.single-category.v1', scope: 'section', supported, category: 'school-major', excludable: incompatible,
    status: incompatible ? 'potentially-ineligible' : known ? 'no-known-blocker' : 'verification-needed',
    message: `Enrollment restriction: ${notice.text}.`, missing: supported && !known ? ['Complete applicable school/major/minor declarations (optional)'] : [],
    nextStep: supported ? 'Check that your declaration is recorded by Rutgers; otherwise choose an unrestricted section or contact the department.' : 'Ask the department how these combined restrictions apply; code combinations are not interpreted automatically.',
    evidence: [sourceEvidence(section, notice.field, notice.text)] };
}
// Only simple, complete course-only AND or OR expressions are evaluated; mixed/prose rules stay unknown.
export function prerequisiteFinding(course: EligibilityCourse, section: EligibilitySection, profile: StudentProfile): EligibilityFinding | null {
  if (!course.prerequisites) return null;
  const compact = course.prerequisites.replace(/\((\d{2}:\d{3}:\d{3})([^()]*)\)/g, (whole, code: string, title: string) => /\d{2}:\d{3}:\d{3}/.test(title) ? whole : code).trim();
  const parsed = !/\b(?:GRADE|GPA|PLACEMENT|CREDITS?|CONCURRENT|PERMISSION)\b|\b[ABCD][+-]?\s+OR\s+BETTER/i.test(course.prerequisites) && /^(\d{2}:\d{3}:\d{3})(?:\s+(?:AND|OR)\s+\d{2}:\d{3}:\d{3})*$/i.test(compact)
    && !(/\bAND\b/i.test(compact) && /\bOR\b/i.test(compact));
  const codes = parsed ? compact.match(/\d{2}:\d{3}:\d{3}/g)! : [];
  const has = (code: string): boolean => profile.completedCourses.includes(code);
  const not = (code: string): boolean => profile.notCompletedCourses.includes(code);
  const alternative = /\bOR\b/i.test(compact);
  const met = parsed && (alternative ? codes.some(has) : codes.every(has));
  const reportedMissing = parsed && (alternative ? codes.every(not) : codes.some(not));
  return { rule: 'soc.prerequisites.flat.v1', scope: 'course', supported: parsed, category: 'prerequisite', excludable: false,
    status: met ? 'no-known-blocker' : reportedMissing ? 'potentially-ineligible' : 'verification-needed',
    message: met ? 'Reported course completions match the supported prerequisite expression.' : reportedMissing ? 'You explicitly reported not completing a listed prerequisite route.' : 'Prerequisite completion or the rule interpretation needs verification.',
    missing: !met && !reportedMissing ? ['Relevant completed courses, accepted placement/equivalency, required grades, or override'] : [],
    nextStep: 'Confirm required grades and Rutgers-applied credit, equivalencies, placement, or a prerequisite override. An add permission/SPN does not waive prerequisites.',
    evidence: [sourceEvidence(section, 'preReqNotes', course.prerequisites), { field: 'Rutgers prerequisite override guidance', text: 'Prerequisite approval and special-permission registration are separate.', url: sourceLinks.prerequisiteOverride }] };
}
