import { formatDay, weekDays } from '@/lib/scheduling/meetings';
import { defaultConstraints, defaultWeights, type HardConstraints, type PreferenceWeights } from '@/lib/scheduling/generation-types';

// The existing search form cannot express scheduling constraints; these controls reuse its primitives.
export interface GenerationSettings {
  hard: HardConstraints; weights: PreferenceWeights; instructors: string; excludedIndexes: string;
}
export const initialSettings: GenerationSettings = { hard: defaultConstraints, weights: { ...defaultWeights, lateEvenings: 4 }, instructors: '', excludedIndexes: '' };
const weights: [keyof PreferenceWeights, string][] = [
  ['daysOff', 'Prefer days off'], ['laterStarts', 'Prefer later starts'], ['gaps', 'Minimize gaps'],
  ['campusChanges', 'Minimize campus changes'], ['lateEvenings', 'Avoid late evenings'], ['commuteDays', 'Minimize days on campus'], ['instructors', 'Prefer listed instructors'],
];
function clockValue(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
export function GenerationControls({ value, onChange, campuses }: {
  value: GenerationSettings; onChange: (value: GenerationSettings) => void; campuses: string[];
}) {
  function hard(patch: Partial<HardConstraints>): void { onChange({ ...value, hard: { ...value.hard, ...patch } }); }
  return <section className="generation-preferences" aria-label="Schedule preferences">
    <h3>Preferences <span className="muted">· optional</span></h3>
    <div className="generation-checks">{weights.slice(0, 5).map(([key, label]) => <label key={key}>
      <input type="checkbox" checked={(value.weights[key] ?? 0) > 0} onChange={e => onChange({ ...value, weights: { ...value.weights, [key]: e.target.checked ? (initialSettings.weights[key] || 2) : 0 } })} />{key === 'laterStarts' ? 'Avoid early mornings' : key === 'gaps' ? 'Minimize schedule gaps' : label}</label>)}</div>
    <p className="muted">Avoid late evenings gives less preference to meetings that end after 7 PM. It still allows them.</p>
    <details><summary>Advanced Preferences</summary>
    <div className="generation-fields">
      <label>Earliest start (Eastern)<input type="time" required value={clockValue(value.hard.earliestStart)} onChange={e => {
        if (e.target.value) { const [h, m] = e.target.value.split(':').map(Number); hard({ earliestStart: h * 60 + m }); }
      }} /></label>
      <label>Latest acceptable class end (Eastern) · hard cutoff<input type="time" required value={clockValue(value.hard.latestEnd)} onChange={e => {
        if (e.target.value) { const [h, m] = e.target.value.split(':').map(Number); hard({ latestEnd: h * 60 + m }); }
      }} /></label>
    </div>
    <fieldset><legend>Required days without classes</legend><div className="generation-checks">{weekDays.map(day => <label key={day}>
      <input type="checkbox" checked={value.hard.daysOff.includes(day)} onChange={e => hard({ daysOff: e.target.checked ? [...value.hard.daysOff, day] : value.hard.daysOff.filter(d => d !== day) })} />{formatDay(day)}</label>)}</div></fieldset>
    <details><summary>Section and campus exclusions</summary>
      <label>Exclude registration indexes (comma separated)<input value={value.excludedIndexes} maxLength={600} placeholder="14315, 15919" onChange={e => onChange({ ...value, excludedIndexes: e.target.value })} /></label>
      <fieldset><legend>Excluded campus locations</legend><div className="generation-checks">{campuses.map(campus => <label key={campus}>
        <input type="checkbox" checked={value.hard.excludedCampuses.includes(campus)} onChange={e => hard({ excludedCampuses: e.target.checked ? [...value.hard.excludedCampuses, campus] : value.hard.excludedCampuses.filter(c => c !== campus) })} />{campus}</label>)}</div></fieldset>
      {!campuses.length && <p className="muted">Choose courses to see their campus locations.</p>}
    </details>
    <fieldset><legend>Soft preferences · 0 = ignore, 5 = strongest</legend><div className="generation-fields">{weights.map(([key, label]) =>
      <label key={key}>{label}<select value={value.weights[key] ?? 0} onChange={e => onChange({ ...value, weights: { ...value.weights, [key]: Number(e.target.value) } })}>
        {[0, 1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n}{n === 0 ? ' · ignore' : ''}</option>)}
      </select></label>)}</div></fieldset>
    <label>Preferred instructors · one name or surname per line<textarea rows={2} maxLength={1500} value={value.instructors}
      onChange={e => onChange({ ...value, instructors: e.target.value })} placeholder="Instructor name" /></label>
    <p className="muted">Optional-course coverage ranks first. Lower weighted penalties rank next. Campus changes count transitions between known physical campuses; they do not estimate bus travel time. Unknown instructor/location data limits these preferences.</p>
    </details>
  </section>;
}
