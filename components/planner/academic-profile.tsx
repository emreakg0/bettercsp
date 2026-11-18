'use client';
import { useState } from 'react';
import { parseStudentProfile } from '@/lib/eligibility/profile';
import { emptyProfile, type StudentProfile } from '@/lib/eligibility/types';

const listFields = [
  ['schools', 'School codes', '01'], ['majors', 'Declared major codes', '198'], ['minors', 'Declared minor codes', '640'],
  ['completedCourses', 'Known completed courses · relevant courses only', '01:640:152, 01:198:111'],
  ['notCompletedCourses', 'Courses you explicitly have not completed', '01:640:152'],
  ['placementMetFor', 'Course codes for which Rutgers has applied qualifying placement', '01:013:141'],
  ['placementNotMetFor', 'Course codes for which placement is explicitly not met', '01:013:141'],
  ['grantedPermissionIndexes', 'Indexes with explicitly granted add permission · do not enter SPNs', '15919'],
] as const;
type Field = typeof listFields[number][0];
const blankLists = Object.fromEntries(listFields.map(([key]) => [key, ''])) as Record<Field, string>;
// A separate optional form is needed; the existing search form has no academic-context fields.
export function AcademicProfile({ profile, onChange }: { profile: StudentProfile; onChange: (profile: StudentProfile) => void }) {
  const [draft, setDraft] = useState(profile), [lists, setLists] = useState(blankLists), [message, setMessage] = useState('');
  function field(key: Field) {
    const [, label, placeholder] = listFields.find(([name]) => name === key)!;
    return <label key={key}>{label}<input name={key} value={lists[key]} maxLength={1800} placeholder={placeholder}
      onChange={e => { setLists({ ...lists, [key]: e.target.value }); setMessage('Edits are not applied yet. Choose Update readiness.'); }} /></label>;
  }
  return <details className="academic-profile"><summary>Optional academic information for registration checks</summary>
    <p className="muted">Share only facts you want checked. No name, NetID, password, RUID, SPN, grades, or complete academic record is needed. Missing information stays unknown.</p>
    <form onSubmit={event => {
      event.preventDefault();
      try {
        const data = Object.fromEntries(listFields.map(([key]) => [key, lists[key].split(',').map(s => s.trim()).filter(Boolean)]));
        onChange(parseStudentProfile({ ...draft, ...data })); setMessage('Academic information updated for this tab. Regenerate existing previews before applying.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Check the academic codes.'); }
    }}>
      <div className="generation-fields">{field('schools')}{field('majors')}{field('minors')}
        <label>Class standing · as recorded by Rutgers<select value={draft.standing} onChange={e => { setDraft({ ...draft, standing: e.target.value as StudentProfile['standing'] }); setMessage('Edits are not applied yet. Choose Update readiness.'); }}>
          <option value="unknown">Not provided / unsure</option><option value="first-year">First-year</option><option value="sophomore">Sophomore</option><option value="junior">Junior</option><option value="senior">Senior</option>
        </select></label>
        <label>Honors membership<select value={draft.honors} onChange={e => { setDraft({ ...draft, honors: e.target.value as StudentProfile['honors'] }); setMessage('Edits are not applied yet. Choose Update readiness.'); }}>
          <option value="unknown">Not provided / unsure</option><option value="honors-college">Honors College</option><option value="sas-honors">SAS Honors Program</option><option value="other">Another honors program</option><option value="none">Not in an honors program</option>
        </select></label>
      </div>
      <label className="academic-checkbox"><input type="checkbox" checked={draft.declarationsComplete} onChange={e => { setDraft({ ...draft, declarationsComplete: e.target.checked }); setMessage('Edits are not applied yet. Choose Update readiness.'); }} />The school/major/minor lists above include all my current declarations. Leave unchecked if unsure.</label>
      <div className="generation-fields">{field('completedCourses')}{field('grantedPermissionIndexes')}</div>
      <details><summary>Additional prerequisite and placement facts</summary><div className="generation-fields">{field('notCompletedCourses')}{field('placementMetFor')}{field('placementNotMetFor')}</div></details>
      <p className="muted">Use comma-separated Rutgers codes. Leaving a course out never means you have not completed it. Permission is checked by registration index and does not waive prerequisites or other restrictions.</p>
      <div className="generation-actions"><button className="button" type="submit">Update readiness</button><button className="text-button" type="button" onClick={() => {
        setDraft(structuredClone(emptyProfile)); setLists({ ...blankLists }); onChange(structuredClone(emptyProfile)); setMessage('Academic information cleared. Saved sections and locks are unchanged.');
      }}>Clear academic information</button></div>
      <p role="status" className="muted">{message}</p>
    </form>
    <p className="muted">Academic information is session-only and separate from saved schedules. It is used locally for readiness and sent with generation settings for server computation.</p>
  </details>;
}
