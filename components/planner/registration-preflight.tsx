'use client';

import { useEffect, useRef, useState } from 'react';
import {
  evaluatePreflight, preflightLabels, rankPreflightAlternatives, type PlanningContext, type PreflightRow,
} from '@/lib/eligibility/preflight';
import { sourceLinks, type StudentProfile } from '@/lib/eligibility/types';
import type { HardConstraints } from '@/lib/scheduling/generation-types';
import { formatDay, formatTime, isScheduled } from '@/lib/scheduling/meetings';
import type { Selection } from '@/lib/scheduling/selection';
import { ReadinessFindings } from './registration-readiness';

interface PreflightProps {
  selections: Selection[];
  profile: StudentProfile;
  planning: PlanningContext;
  constraints: HardConstraints | null;
  protectedIds: string[];
  stale?: boolean;
  unresolved?: number;
  id?: string;
  onRescue?: (sectionId: string) => void;
  rescueLabel?: string;
}

export function RegistrationPreflight({ selections, profile, planning, constraints, protectedIds, stale, unresolved = 0, id, onRescue, rescueLabel }: PreflightProps) {
  const [open, setOpen] = useState(false);
  const rows = open ? evaluatePreflight(selections, profile, planning) : [];
  const attention = rows.filter(row => row.issues.length);
  const clear = rows.filter(row => !row.issues.length);
  const actionable = attention.filter(row => row.level === 'conflict' || row.level === 'action').length;
  const verification = attention.length - actionable;
  const countText = (count: number): string => count + (count === 1 ? ' section needs ' : ' sections need ');
  return <details id={id} className="registration-preflight" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Check registration readiness</summary>
    {open && <div aria-label="Registration preflight">
      {!selections.length && <p>Add a section or generate a schedule to check specific registration indexes.</p>}
      {!!unresolved && <p role="status">Preflight could not check {unresolved} unavailable saved {unresolved === 1 ? 'section' : 'sections'}. Review those indexes in Rutgers.</p>}
      {stale && <p role="status">This preview is stale. Generate it again before applying it or starting a repair.</p>}
      {!!selections.length && <>
        <h3>{actionable ? countText(actionable) + 'attention before registration'
          : verification ? countText(verification) + 'verification' : 'No known issue under supported checks'}</h3>
        {actionable > 0 && verification > 0 && <p className="muted">{countText(verification)}verification only.</p>}
        <p className="muted">Seat labels come from the catalog snapshot. Current availability and enrollment must be confirmed with Rutgers.</p>
        {attention.map(row => {
          const { section, course } = row.selection;
          const protectedSection = protectedIds.includes(section.id);
          const canCompare = !protectedSection && !stale && constraints && row.issues.some(issue => issue.alternate);
          return <article className="preflight-section" key={section.id}>
            <h4>{course.title} ({course.code}) · Section {section.number} · Index {section.index}</h4>
            <p><strong>{preflightLabels[row.level]}</strong> · {seatLabel(section)}</p>
            <ul className="generation-notes">{row.issues.map((issue, i) => <li key={i}>
              <strong>{issue.scope === 'course' ? 'Course requirement' : issue.scope === 'section' ? 'Section restriction' : issue.scope === 'timetable' ? 'Timetable' : 'Seats'} · {issue.title}</strong>
              <p>{issue.detail}</p>
              <p><strong>Next step: </strong>{issue.next} {issue.url && <a className="back-link" href={issue.url}>Rutgers guidance ↗</a>}</p>
            </li>)}</ul>
            {row.issues.some(issue => issue.scope === 'course' && issue.finding?.category === 'prerequisite') &&
              <p className="muted">This prerequisite is listed for the course. Switching sections does not resolve it by itself.</p>}
            {protectedSection && row.issues.some(issue => issue.alternate) && <p className="muted">This section is protected. Preflight keeps it in your plan. Verify the issue with Rutgers.</p>}
            {canCompare && <PreflightAlternatives row={row} selections={selections} profile={profile} planning={planning}
              constraints={constraints} onRescue={onRescue} rescueLabel={rescueLabel} />}
            {!!row.evidence.length && <details><summary>Registration evidence for index {section.index}</summary><ReadinessFindings findings={row.evidence} /></details>}
          </article>;
        })}
        {!!clear.length && <details><summary>No known issue under supported checks · {clear.length}</summary><ul className="generation-notes">{clear.map(({ selection, evidence }) => <li key={selection.section.id}>
          {selection.course.code} · Index {selection.section.index} · {seatLabel(selection.section)}
          {!!evidence.length && <ReadinessFindings findings={evidence} />}
        </li>)}</ul></details>}
        <p className="muted">Travel checks apply to recognized New Brunswick locations in the Spring 2027 snapshot. Confirm meeting dates, linked classes, and actual travel time with Rutgers.</p>
      </>}
    </div>}
  </details>;
}

function seatLabel(section: Selection['section']): string {
  return section.availability === 'unknown' ? 'No seat status in snapshot' : (section.availability === 'open' ? 'Open' : 'Closed') + ' in snapshot';
}

function PreflightAlternatives({ row, selections, profile, planning, constraints, onRescue, rescueLabel }: Pick<PreflightProps, 'selections' | 'profile' | 'planning' | 'onRescue' | 'rescueLabel'> & {
  row: PreflightRow; constraints: HardConstraints;
}) {
  const [sections, setSections] = useState<Selection['section'][] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const { course, section } = row.selection;
  useEffect(() => () => request.current?.abort(), []);
  async function load(): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/planner/sections?' + new URLSearchParams({ course: course.id }), { signal: controller.signal });
      if (!response.ok) throw new Error('Section list unavailable');
      const body: { sections: Selection['section'][] } = await response.json();
      if (!controller.signal.aborted) setSections(body.sections);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const ranked = sections ? rankPreflightAlternatives(row.selection, sections, selections, profile, planning, constraints) : null;
  return <div className="preflight-alternatives">
    {!sections && <button className="text-button" onClick={() => void load()} disabled={loading}>{loading ? 'Loading sections…' : error ? 'Retry alternate sections' : 'See alternate sections'}</button>}
    {error && <p role="alert">Could not load sections. Your schedule has not changed.</p>}
    {ranked && <>
      <h5>Other sections of {course.code}</h5>
      {ranked.length ? <ul className="generation-notes">{ranked.slice(0, 6).map(candidate => {
        const option = candidate.selection.section;
        return <li key={option.id}><strong>Section {option.number} · Index {option.index}</strong> · {seatLabel(option)}
          <div>{option.meetings.map(meeting => isScheduled(meeting)
            ? formatDay(meeting.dayCode) + ' ' + formatTime(meeting.startMinute) + '–' + formatTime(meeting.endMinute) + ' ' + meeting.campus
            : meeting.timing === 'asynchronous' ? 'Asynchronous content'
              : meeting.timing === 'arranged' ? 'Hours by arrangement' : 'Meeting time unverified').join(' · ')}</div>
          <div>{candidate.issues.map(issue => issue.title).join(' · ') || preflightLabels.clear}</div>
        </li>;
      })}</ul> : <p>No alternate section fits around the remaining sections and your current constraints. Rescue may find a repair that moves another unlocked section.</p>}
      {!!ranked.length && <p className="muted">Showing up to six sections with fewer known blockers first. Check current seats and requirements before choosing.</p>}
    </>}
    {onRescue && <button className="text-button" onClick={() => onRescue(section.id)}>{rescueLabel ?? 'Review a repair in Registration Rescue'}</button>}
    {!onRescue && <p className="muted">Rescue works from your working draft. Use this schedule before starting a repair.</p>}
    {row.issues.some(issue => issue.url?.includes('travel-conflict')) &&
      <p className="muted">Recheck campus gaps after any Rescue repair. Rescue does not currently enforce this travel policy.</p>}
    <a className="back-link" href={sourceLinks.soc}>Verify seats in Rutgers Schedule of Classes ↗</a>
  </div>;
}
