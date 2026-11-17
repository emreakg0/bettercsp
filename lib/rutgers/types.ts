// Unmodeled Rutgers metadata remains available on the server, including future fields.
export interface RawMeeting extends Record<string, unknown> {
  meetingDay: string;
  startTimeMilitary: string;
  endTimeMilitary: string;
}
export interface RawSection extends Record<string, unknown> {
  index: string;
  number: string;
  meetingTimes: RawMeeting[];
}
export interface RawCourse extends Record<string, unknown> {
  courseString: string;
  title: string;
  subject: string;
  subjectDescription: string;
  campusCode: string;
  supplementCode: string;
  credits: number | null;
  sections: RawSection[];
}
