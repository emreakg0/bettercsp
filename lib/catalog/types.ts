import type { RawCourse, RawSection } from '../rutgers/types.ts';

export interface CatalogSource {
  id: string;
  label: string;
  file: string;
  capturedAt: string | null;
}
export interface Meeting {
  dayCode: string;
  startMinute: number | null;
  endMinute: number | null;
  mode: string;
  campus: string;
  building: string;
  room: string;
}
export interface SourceNotice { field: string; text: string }
export interface Section {
  id: string;
  index: string;
  number: string;
  instructors: string[];
  meetings: Meeting[];
  campuses: string[];
  availability: 'open' | 'closed' | 'unknown';
  notices: SourceNotice[];
  raw: RawSection;
}
export interface Course {
  id: string;
  code: string;
  title: string;
  shortTitle: string;
  subject: string;
  department: string;
  campusCode: string;
  supplement: string;
  credits: number | null;
  creditsLabel: string;
  prerequisites: string;
  notes: SourceNotice[];
  sections: Section[];
  searchText: string;
  raw: RawCourse;
}
export interface SearchResult { courses: Course[]; total: number; page: number; pages: number }
