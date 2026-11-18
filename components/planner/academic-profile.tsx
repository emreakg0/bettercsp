'use client';
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import {
  academicProfileKey, creditLimit, degreeTypes, eligibilityForSource, emptyAcademicProfile,
  parseAcademicProfile, readAcademicProfile, serializeAcademicProfile,
  type AcademicPlanningProfile, type EquivalentCredit,
} from '@/lib/academic/profile';
import { parseStudentProfile } from '@/lib/eligibility/profile';

const eligibilityLists = [
  ['schools', 'Rutgers school codes', '01'], ['majors', 'Declared major codes', '198'], ['minors', 'Declared minor codes', '640'],
  ['completedCourses', 'Completed courses', '01:640:152, 01:198:111'],
  ['notCompletedCourses', 'Courses you explicitly have not completed', '01:640:152'],
  ['placementMetFor', 'Courses where Rutgers has recorded qualifying placement', '01:013:141'],
  ['placementNotMetFor', 'Courses where placement is explicitly not met', '01:013:141'],
  ['grantedPermissionIndexes', 'Registration indexes with permission for this semester · do not enter SPNs', '15919'],
] as const;
type EligibilityList = typeof eligibilityLists[number][0];
type CreditRow = EquivalentCredit & { id: number };
const pendingMessage = 'Edits are pending. Choose Update profile to apply them.';
function commaList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

export function AcademicProfile({ sourceId, onChange, ref }: {
  sourceId: string; onChange: (profile: AcademicPlanningProfile) => void; ref?: Ref<{ planCourse: (code: string) => void }>;
}) {
  const [profile, setProfile] = useState(emptyAcademicProfile);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [remember, setRemember] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const nextCreditId = useRef(0);
  const plannedInput = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    planCourse(code) {
      const field = plannedInput.current;
      if (!field || !ready) return;
      const courses = commaList(field.value);
      if (!courses.includes(code)) field.value = [...courses, code].join(', ');
      field.closest('details')!.open = true;
      setMessage(code + ' is in the future course field. Choose Update profile to keep it in your plan.');
      setError('');
      field.focus();
    },
  }), [ready]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      let saved: string | null;
      try { saved = localStorage.getItem(academicProfileKey); }
      catch { setMessage('Browser storage is unavailable. You can use an academic profile in this tab.'); setReady(true); return; }
      try {
        const restored = readAcademicProfile(saved);
        if (restored) {
          setProfile(restored);
          setCreditRows(restored.equivalentCredits.map(credit => ({ ...credit, id: nextCreditId.current++ })));
          setRemember(true);
          setFormVersion(current => current + 1);
          onChange(restored);
          setMessage('Profile loaded from this browser.');
        }
      } catch {
        setMessage('The saved academic profile could not be read. You can update it or clear it here.');
      }
      setReady(true);
    });
    return () => { active = false; };
  }, [onChange]);

  const eligible = eligibilityForSource(profile, sourceId);
  function field(key: EligibilityList) {
    const [, label, placeholder] = eligibilityLists.find(([name]) => name === key)!;
    return <label key={key === 'grantedPermissionIndexes' ? sourceId : key}>{label}
      <input name={key} defaultValue={eligible[key].join(', ')} maxLength={1800} placeholder={placeholder} />
    </label>;
  }
  function flagEdited(): void {
    setMessage(pendingMessage);
    setError('');
  }
  function editCredit(id: number, changes: Partial<EquivalentCredit>): void {
    setCreditRows(rows => rows.map(row => row.id === id ? { ...row, ...changes } : row));
    flagEdited();
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let next: AcademicPlanningProfile;
    try {
      const eligibility = parseStudentProfile({
        ...Object.fromEntries(eligibilityLists.map(([key]) => [key, commaList(form.get(key))])),
        standing: form.get('standing'), honors: form.get('honors'), declarationsComplete: form.has('declarationsComplete'),
      });
      const permissionsBySource = { ...profile.permissionsBySource };
      if (eligibility.grantedPermissionIndexes.length) permissionsBySource[sourceId] = eligibility.grantedPermissionIndexes;
      else delete permissionsBySource[sourceId];
      const year = String(form.get('catalogYear') ?? '').trim();
      next = parseAcademicProfile({
        school: form.get('school'), intendedMajors: commaList(form.get('intendedMajors')),
        minorPlans: commaList(form.get('minorPlans')), degreeType: form.get('degreeType') || null, catalogYear: year ? Number(year) : null,
        inProgressCourses: commaList(form.get('inProgressCourses')), plannedCourses: commaList(form.get('plannedCourses')),
        equivalentCredits: creditRows.map(row => ({ ...row, courseCode: row.courseCode?.trim() || null })),
        eligibility: { ...eligibility, grantedPermissionIndexes: [] }, permissionsBySource,
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check the academic profile fields.');
      return;
    }
    setError('');
    setProfile(next);
    onChange(next);
    try {
      if (remember) localStorage.setItem(academicProfileKey, serializeAcademicProfile(next));
      else localStorage.removeItem(academicProfileKey);
      setMessage(remember ? 'Profile updated and saved on this browser.' : 'Profile updated for this tab.');
    } catch {
      setMessage('Profile updated for this tab. Browser storage could not be changed. Any earlier saved copy may still be present.');
    }
  }
  function clear(): void {
    setProfile(emptyAcademicProfile);
    setCreditRows([]);
    setRemember(false);
    setError('');
    setFormVersion(current => current + 1);
    onChange(emptyAcademicProfile);
    try {
      localStorage.removeItem(academicProfileKey);
      setMessage('Academic profile cleared.');
    } catch {
      setMessage('Profile cleared for this tab. Browser storage could not be changed. A saved copy may still be present.');
    }
  }

  return <details className="academic-profile" id="academic-planning-profile"><summary>Academic planning profile (optional)</summary>
    <p className="muted">Use the fields that help you plan. Schedule generation and Registration Rescue are available with an empty profile.</p>
    <form key={formVersion} onSubmit={submit} onChange={flagEdited} autoComplete="off">
      <div className="generation-fields">
        <label>Rutgers school<input name="school" defaultValue={profile.school} placeholder="School of Arts and Sciences" maxLength={80} /></label>
        <label>Declared or intended majors<input name="intendedMajors" defaultValue={profile.intendedMajors.join(', ')} placeholder="Computer Science, Mathematics" maxLength={1660} /></label>
        <label>Intended degree type<select name="degreeType" defaultValue={profile.degreeType ?? ''}>
          <option value="">Not sure</option>{degreeTypes.map(type => <option key={type}>{type}</option>)}
        </select></label>
        <label>Program or catalog year<input name="catalogYear" defaultValue={profile.catalogYear ?? ''} type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="2026" /></label>
        <label>Declared or intended minors<input name="minorPlans" defaultValue={profile.minorPlans.join(', ')} placeholder="Statistics" maxLength={1660} /></label>
      </div>
      <p className="muted">Use comma-separated names for multiple programs and full Rutgers course codes for course lists. Leave unknown fields blank.</p>
      <div className="generation-fields">
        {field('completedCourses')}
        <label>Courses in progress<input name="inProgressCourses" defaultValue={profile.inProgressCourses.join(', ')} maxLength={1800} placeholder="01:198:112" /></label>
        <label>Planned future courses<input ref={plannedInput} name="plannedCourses" defaultValue={profile.plannedCourses.join(', ')} maxLength={1800} placeholder="01:198:205" /></label>
      </div>
      <details><summary>AP, transfer, or equivalent credit</summary>
        <p className="muted">Choose “Rutgers accepted” only for credit Rutgers has recorded. Leave the course code blank if the Rutgers equivalent is unknown. Keep estimated equivalents unverified. These entries do not count as course completions or confirm that a degree or registration requirement is met.</p>
        {creditRows.map((row, index) => <fieldset key={row.id} className="academic-credit">
          <legend>Credit {index + 1}</legend>
          <div className="generation-fields">
            <label>Credit source<select value={row.source} onChange={e => editCredit(row.id, { source: e.target.value as EquivalentCredit['source'] })}>
              <option value="ap">AP</option><option value="transfer">Transfer</option><option value="other">Other equivalent credit</option>
            </select></label>
            <label>Acceptance status<select value={row.status} onChange={e => editCredit(row.id, { status: e.target.value as EquivalentCredit['status'] })}>
              <option value="unverified">Unverified or estimated</option><option value="rutgers-accepted">Rutgers accepted (reported by you)</option>
            </select></label>
            <label>Equivalent Rutgers course code (if known)<input maxLength={10} value={row.courseCode ?? ''}
              placeholder="01:640:151" onChange={e => editCredit(row.id, { courseCode: e.target.value })} /></label>
          </div>
          <button type="button" className="text-button" onClick={() => { setCreditRows(rows => rows.filter(credit => credit.id !== row.id)); flagEdited(); }}>Remove credit {index + 1}</button>
        </fieldset>)}
        <button type="button" className="text-button" disabled={creditRows.length >= creditLimit} onClick={() => {
          const id = nextCreditId.current++;
          setCreditRows(rows => [...rows, { id, courseCode: null, source: 'ap', status: 'unverified' }]);
          flagEdited();
        }}>Add equivalent credit</button>
      </details>
      <details><summary>Advanced registration checks</summary>
        <p className="muted">Enter official declarations here if you want them considered for eligibility checks. The intended program names above are planning notes.</p>
        <div className="generation-fields">{field('schools')}{field('majors')}{field('minors')}
          <label>Class standing as recorded by Rutgers<select name="standing" defaultValue={eligible.standing}>
            <option value="unknown">Not provided / unsure</option><option value="first-year">First-year</option><option value="sophomore">Sophomore</option><option value="junior">Junior</option><option value="senior">Senior</option>
          </select></label>
          <label>Honors membership<select name="honors" defaultValue={eligible.honors}>
            <option value="unknown">Not provided / unsure</option><option value="honors-college">Honors College</option><option value="sas-honors">SAS Honors Program</option><option value="other">Another honors program</option><option value="none">Not in an honors program</option>
          </select></label>
        </div>
        <label className="academic-checkbox"><input type="checkbox" name="declarationsComplete" defaultChecked={eligible.declarationsComplete} />The codes above include all my current school, major, and minor declarations. Leave unchecked if unsure.</label>
        <div className="generation-fields">{field('notCompletedCourses')}{field('placementMetFor')}{field('placementNotMetFor')}{field('grantedPermissionIndexes')}</div>
      </details>
      <label className="academic-checkbox"><input type="checkbox" checked={remember} disabled={!ready} onChange={e => setRemember(e.target.checked)} />Remember my academic profile on this browser</label>
      <p className="muted">Choose Update profile to apply this setting. Saved profiles are shared across semesters on this device and browser and can be lost if browser data is cleared. Registration checks send only the eligibility fields to BetterCSP’s server during generation or Rescue. Leave out grades, transcripts, Rutgers IDs, usernames, passwords, and special permission numbers.</p>
      <div className="generation-actions"><button className="button" type="submit" disabled={!ready}>Update profile</button>
        <button className="text-button" type="button" disabled={!ready} onClick={clear}>Clear academic profile</button></div>
      {error && <p role="alert">{error}</p>}
      <p role="status" className="muted">{message}</p>
    </form>
  </details>;
}
