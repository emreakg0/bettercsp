import type { CourseDependency, CourseRelationship, CourseRule, DegreeProgramRequirements, DegreeRequirement } from './requirements.ts';

const reviewedOn = '2026-11-18';
const source = (url: string) => ({ url, reviewedOn });
const department = 'https://www.cs.rutgers.edu/academics/undergraduate/';
const synopsis = (slug: string) => source(department + 'course-synopses/course-details/' + slug);
const catalog = source('https://newbrunswick-26-27-undergrad.catalogs.rutgers.edu/pages/VSbgggHtgjolUCQloHSE#major-requirements1');
const electives = source(department + 'electives');
const math = source('https://www.math.rutgers.edu/academics/undergraduate/courses');
const physics = source('https://physics.rutgers.edu/academics/undergraduate-program/course-synopses/course-synopses');
const chemistry = source('https://chem.rutgers.edu/academics/undergraduate-program/undergraduate-course-descriptions');

export const csRescueTerm = '2027-1-NB';
export const csTransition = source(department + 'new-introductory-computer-science-course-sequence');
export const csAdvising = department + 'advising';
export const introTransition = ['01:198:111', '01:198:112', '01:198:120', '01:198:121', '01:198:122'];
const cs = (number: number) => `01:198:${number}`;
const course = (courseCode: string): CourseRule => ({ kind: 'course', courseCode });
const all = (...rules: CourseRule[]): CourseRule => ({ kind: 'all', rules });
const any = (...codes: string[]): CourseRule => ({ kind: 'choose', count: 1, rules: codes.map(course) });

// The catalog names complete alternatives. Only the two sequences with a supported single-course path are recommended here.
const scienceTracks = [
  ['01:750:193', '01:750:194'], ['01:160:161', '01:160:162', '01:160:171'],
  ['01:750:203', '01:750:204', '01:750:205', '01:750:206'], ['01:750:123', '01:750:124', '01:750:227', '01:750:229'],
  ['01:750:271', '01:750:272', '01:750:275', '01:750:276'], ['01:750:201', '01:750:202'],
  ['01:160:159', '01:160:160', '01:160:171'], ['01:160:163', '01:160:164', '01:160:171'],
];
export const supportedScienceTracks = scienceTracks.slice(0, 2);
const discreteI = synopsis('01-198-205-introduction-to-discrete-structures-i');
const discreteII = synopsis('01-198-206-introduction-to-discrete-structures-ii');
const architecture = synopsis('01-198-211-computer-architecture');
const dataStructures = source(department + 'admission-to-the-major?catid=72%3Acourses&id=1293%3A01-198-112-data-structures&view=article');

// Model documented routes for advising and ordering. This does not replace the term's enrollment checks.
const prerequisites: CourseDependency[] = [
  { courseCode: cs(112), prerequisite: course(cs(111)), source: dataStructures },
  { courseCode: cs(205), prerequisite: course(cs(111)), source: discreteI },
  { courseCode: cs(206), prerequisite: all(course(cs(205)), course('01:640:152')), source: discreteII },
  { courseCode: cs(211), prerequisite: any(cs(112), '14:332:351'), source: architecture },
  { courseCode: cs(344), prerequisite: all(course(cs(112)), course(cs(206))), source: synopsis('01-198-344-design-and-analysis-of-computer-algorithms') },
  { courseCode: '01:640:151', prerequisite: { kind: 'unverified', note: 'Verify precalculus or qualifying placement for Calculus I.' }, source: math },
  { courseCode: '01:640:152', prerequisite: any('01:640:151', '01:640:135'), source: math },
  { courseCode: '01:640:250', prerequisite: { kind: 'unverified', note: 'Verify precalculus or qualifying placement for Linear Algebra.' }, source: math },
  { courseCode: '01:750:194', prerequisite: course('01:750:193'), source: physics },
  { courseCode: '01:160:162', prerequisite: course('01:160:161'), source: chemistry },
  { courseCode: '01:160:171', prerequisite: course('01:160:161'), source: chemistry },
];

const relationships: CourseRelationship[] = [
  { kind: 'exclusive-credit', courseCodes: [cs(112), '14:332:351'], source: dataStructures },
  { kind: 'equivalent', fromCourseCode: '14:332:312', toCourseCode: cs(205), source: source(csAdvising) },
  ...['01:640:477', '01:960:381', '14:332:226'].map(fromCourseCode => ({ kind: 'equivalent' as const, fromCourseCode, toCourseCode: cs(206), source: source(csAdvising) })),
  { kind: 'equivalent', fromCourseCode: '14:332:331', toCourseCode: cs(211), source: source(csAdvising) },
  { kind: 'exclusive-credit', courseCodes: [cs(323), '01:640:373'], source: synopsis('01-198-323-numerical-analysis-and-computing') },
  { kind: 'exclusive-credit', courseCodes: [cs(431), '14:332:452'], source: source(csAdvising) },
  { kind: 'exclusive-credit', courseCodes: ['01:640:151', '01:640:135', '01:640:191'], source: math },
  { kind: 'exclusive-credit', courseCodes: ['01:640:152', '01:640:136', '01:640:138', '01:640:192'], source: math },
];

// A reviewed subset of the department list. Variable topics, external electives and special approvals need advising.
const electiveCodes = [210, 213, 214, 314, 323, 334, 336, 352, 416, 417, 419, 431, 437, 439, 440].map(cs);
const requiredCodes = [111, 112, 205, 206, 211, 344].map(cs).concat('01:640:151', '01:640:152', '01:640:250');
function program(degreeType: 'BA' | 'BS'): DegreeProgramRequirements {
  const ba = degreeType === 'BA';
  const degree = source(department + 'cs-degrees/' + (ba ? 'b-a-degree' : 'b-s-degree'));
  const requirements: DegreeRequirement[] = requiredCodes.map(courseCode => ({
    id: courseCode, title: courseCode.startsWith('01:198:') ? 'Required computer science course' : 'Required mathematics course',
    kind: 'course', courseCode, source: catalog,
  }));
  requirements.push({ id: 'cs-electives', title: 'Designated computer science elective', kind: 'elective-pool', count: ba ? 5 : 7,
    inDepartmentMinimum: ba ? 3 : 5, upperLevelMinimum: 2, eligibleCourses: electiveCodes, source: electives });
  if (!ba) requirements.push({ id: 'bs-science', title: 'B.S. science sequence', kind: 'choose', count: 1,
    rules: scienceTracks.map(track => all(...track.map(course))), source: degree });
  return { programId: `rutgers-nb-sas-cs-${degreeType.toLowerCase()}`, schoolId: 'SAS', campus: 'NB', degreeType,
    catalogYear: 2026, requirements, prerequisites: ba ? prerequisites.slice(0, -3) : prerequisites, relationships, source: catalog };
}

export const csPrograms = { BA: program('BA'), BS: program('BS') };
export const csFallbackCodes = new Set([...requiredCodes, ...electiveCodes, ...supportedScienceTracks.flat()]);
