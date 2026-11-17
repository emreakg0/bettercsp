import type { RawCourse, RawMeeting, RawSection } from './types.ts';
import type { CatalogSource, Course, Meeting, Section, SourceNotice } from '../catalog/types.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected Rutgers object');
  }
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected Rutgers string');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected Rutgers array');
  return value;
}
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Never interpret SOC HTML as markup. Preserve spacing around prerequisite operators.
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}
function rawMeeting(value: unknown): RawMeeting {
  const r = record(value);
  return { ...r, meetingDay: string(r.meetingDay),
    startTimeMilitary: string(r.startTimeMilitary), endTimeMilitary: string(r.endTimeMilitary) };
}
function rawSection(value: unknown): RawSection {
  const r = record(value);
  const index = string(r.index);
  if (!/^\d{5}$/.test(index)) throw new Error('Invalid registration index');
  if (r.openStatus != null && typeof r.openStatus !== 'boolean') throw new Error('Invalid open status');
  return { ...r, index, number: string(r.number), meetingTimes: array(r.meetingTimes).map(rawMeeting) };
}
export function parseCourse(value: unknown): RawCourse {
  const r = record(value);
  if (r.credits !== null && (typeof r.credits !== 'number' || !Number.isFinite(r.credits) || r.credits < 0)) {
    throw new Error('Invalid course credits');
  }
  return { ...r, courseString: string(r.courseString), title: string(r.title),
    subject: string(r.subject), subjectDescription: string(r.subjectDescription),
    campusCode: string(r.campusCode), supplementCode: string(r.supplementCode),
    credits: r.credits as number | null, sections: array(r.sections).map(rawSection) };
}
export function minute(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const hours = Number(value.slice(0, 2)), minutes = Number(value.slice(2));
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
function describe(value: unknown): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, v]) => `${key}: ${describe(v)}`).join(', ');
  }
  return plainText(String(value));
}
function namedValues(value: unknown, field: string): string[] {
  return Array.isArray(value) ? value.map(v => plainText(record(v)[field])).filter(Boolean) : [];
}
function meeting(raw: RawMeeting): Meeting {
  const start = minute(raw.startTimeMilitary), end = minute(raw.endTimeMilitary);
  const validRange = start !== null && end !== null && end > start;
  // Match Rutgers SOC's ByArrangementUtils; blank online timing alone is not evidence.
  const explicitlyUntimed = raw.baClassHours === 'B' && !raw.meetingDay
    && !raw.startTimeMilitary && !raw.endTimeMilitary && !raw.startTime && !raw.endTime;
  const timing: Meeting['timing'] = validRange && /^[MTWHFSU]$/.test(raw.meetingDay) ? 'scheduled'
    : explicitlyUntimed ? (raw.campusLocation === 'O' || raw.campusLocation === 'T' ? 'asynchronous' : 'arranged') : 'unknown';
  return { timing, dayCode: raw.meetingDay, startMinute: validRange ? start : null,
    endMinute: validRange ? end : null, mode: plainText(raw.meetingModeDesc),
    campus: plainText(raw.campusName) || plainText(raw.campusAbbrev) || plainText(raw.campusLocation),
    building: plainText(raw.buildingCode), room: plainText(raw.roomNumber) };
}
function notices(raw: Record<string, unknown>, fields: string[]): SourceNotice[] {
  return fields.flatMap(field => {
    const text = describe(raw[field]);
    return text ? [{ field, text }] : [];
  });
}
// Delivery codes come from SOC's course-type filters, not honors eligibility.
function delivery(raw: RawSection): Section['delivery'] {
  const code = plainText(raw.sectionCourseType);
  const labels: Record<string, string> = { T: 'Traditional / face-to-face', H: 'Hybrid', O: 'Online / remote instruction' };
  return { code, label: Object.hasOwn(labels, code) ? labels[code]
    : code ? `Delivery code ${code} — meaning unverified` : 'Delivery format not specified' };
}
function honors(raw: RawSection): Section['honors'] {
  const notes = plainText(raw.sectionNotes);
  // An explicit designation is evidence; a section label or a mention in prerequisites is not.
  if (/^HONORS SECTION\b/i.test(notes)) return { kind: 'designated', evidence: notes };
  if (Array.isArray(raw.honorPrograms) && raw.honorPrograms.length) return {
    kind: 'program-information', evidence: 'Rutgers supplies honors program codes. Verify their membership and enrollment rules with Rutgers.' };
  return null;
}
function crossListings(raw: RawSection): string {
  const supplied = plainText(raw.crossListedSectionsText);
  if (supplied) return supplied;
  if (!Array.isArray(raw.crossListedSections)) return '';
  return raw.crossListedSections.map(value => {
    const link = record(value);
    const parts = [link.offeringUnitCode, link.subjectCode, link.courseNumber].map(plainText);
    if (!/^\d{2}$/.test(parts[0]) || !/^\d{3}$/.test(parts[1]) || !/^\d{3}$/.test(parts[2])) {
      return 'Cross-listed offering supplied; course identity needs verification with Rutgers';
    }
    const number = plainText(link.sectionNumber), index = plainText(link.registrationIndex);
    return `${parts.join(':')}${number ? `:${number}` : ''}${index ? ` (index ${index})` : ''}`;
  }).join('; ');
}
function section(raw: RawSection, source: CatalogSource): Section {
  const fields = Object.keys(raw).filter(key =>
    /honor|permission|eligib|major|minor|openTo|notes|comments|crossList|session|legend/i.test(key));
  const readableRestrictions = plainText(raw.openToText);
  const messages = notices(raw, fields.filter(key =>
    !['crossListedSectionType', 'crossListedSections', 'sessionDatePrintIndicator', 'comments', 'commentsText', 'crossListedSectionsText', 'honorPrograms'].includes(key)
    && !(readableRestrictions && ['majors', 'minors', 'unitMajors'].includes(key))));
  const comments = namedValues(raw.comments, 'description').join('; ') || plainText(raw.commentsText) || describe(raw.comments);
  if (comments) messages.push({ field: 'Section comments', text: comments });
  const links = crossListings(raw);
  if (links) messages.push({ field: 'Cross-listed sections', text: links });
  const programs = namedValues(raw.honorPrograms, 'code');
  if (describe(raw.honorPrograms)) messages.push({ field: 'Honors program codes',
    text: `${programs.length ? programs.join(', ') : describe(raw.honorPrograms)} — program names and eligibility rules need verification with Rutgers.` });
  if (raw.meetingTimes.some(m => m.baClassHours === 'B' && (m.meetingDay || m.startTimeMilitary || m.endTimeMilitary))) {
    messages.push({ field: 'Meeting timing inconsistency', text: 'Rutgers marks a meeting by arrangement but also supplies a day or time. Available times are shown and checked conservatively; confirm the actual meeting schedule with the instructor.' });
  }
  const instructors = namedValues(raw.instructors, 'name');
  return { id: `${source.id}:${raw.index}`, index: raw.index, number: raw.number,
    delivery: delivery(raw), honors: honors(raw),
    instructors: instructors.length ? instructors
      : plainText(raw.instructorsText) ? [plainText(raw.instructorsText)] : [], meetings: raw.meetingTimes.map(meeting),
    campuses: [...new Set(namedValues(raw.sectionCampusLocations, 'description')
      .map(name => name === 'O' ? 'Online' : name === 'T' ? 'Remote instruction' : name))],
    availability: raw.openStatus === true ? 'open' : raw.openStatus === false ? 'closed' : 'unknown',
    notices: messages, raw };
}
export function normalizeCourse(raw: RawCourse, source: CatalogSource): Course {
  const title = plainText(raw.expandedTitle) || plainText(raw.title);
  const creditsLabel = typeof raw.credits === 'number' ? `${raw.credits} credit${raw.credits === 1 ? '' : 's'}`
    : plainText(record(raw.creditsObject ?? {}).description) || 'Credits not specified';
  return { id: [source.id, raw.courseString, raw.campusCode, raw.supplementCode.trim() || '-'].join('~'),
    code: raw.courseString, title, shortTitle: plainText(raw.title), subject: raw.subject,
    department: raw.subjectDescription, campusCode: raw.campusCode, supplement: raw.supplementCode.trim(),
    credits: raw.credits, creditsLabel, prerequisites: plainText(raw.preReqNotes),
    notes: notices(raw, ['courseNotes', 'subjectNotes', 'subjectGroupNotes', 'unitNotes', 'courseDescription']),
    sections: raw.sections.map(s => section(s, source)),
    searchText: `${raw.courseString} ${raw.courseString.replaceAll(':', '')} ${title} ${raw.title}`.toLowerCase(), raw };
}
export function normalizeCatalog(value: unknown, source: CatalogSource): Course[] {
  const courses = array(value).map((v, i) => {
    try { return normalizeCourse(parseCourse(v), source); }
    catch (error) { throw new Error(`Invalid Rutgers course at record ${i}`, { cause: error }); }
  });
  if (new Set(courses.map(c => c.id)).size !== courses.length) throw new Error('Duplicate course identity');
  const indexes = courses.flatMap(c => c.sections.map(s => s.id));
  if (new Set(indexes).size !== indexes.length) throw new Error('Duplicate section identity');
  return courses;
}
