# Phase 5 Registration Rescue

Rescue proposes the smallest safe planner repair; it never changes WebReg enrollment.
Phase 1–4 features and the existing semester/campus-scoped v1 local save remain in use.

## Reports and protection

Selected sections have self-reported states: Planned, Registered, Registration failed,
Needs permission, or Needs verification. Reports are stored in the optional
`registrationStatuses` field alongside saved section IDs and locks. Older saves load with
Planned defaults. Reports are validated and scoped by `year-term-campus:index`; corrupt reports
retain the prior save and enter the existing retry/reset flow. No Rutgers credentials are requested.

Registered sections are hard-protected throughout manual removal/replacement, ordinary generation,
and Rescue. Manual locks are protected independently. Reporting Registered is not an official
confirmation. Changing a report never enrolls or drops a class.

Rescue distinguishes student reports, snapshot/current-availability evidence, academic findings,
and timetable problems. Snapshot closure is a possible problem, not a confirmed present-day closure:
it cannot force unrelated planned changes. Student reports and permission findings are diagnostic.
Only an explicit request to replace the index, a supported eligibility incompatibility, or verified
current closure can make a replacement mandatory in a repair. A snapshot closure is not evidence
that a registered student’s existing enrollment failed.

## Deterministic algorithm

`lib/recovery` composes the existing Phase 3 solver and Phase 4 evaluator. It does not implement a
second timetable or eligibility algorithm.

1. Resolve the baseline IDs against the trusted catalog, retain exact course identities, and capture
   a canonical signature of selections, locks, and registration reports.
2. Detect problems and their provenance. Freeze all registered/locked indexes unless the student
   has explicitly authorized exploring a change to that specific index. A protected forced-change
   problem returns an explanation before search, without silently weakening its protection.
3. Exclude specifically failed/replacement indexes. New candidates must not be closed according to
   the usable availability source, have a supported explicit eligibility mismatch, or require an
   unreported permission. Unknown eligibility remains visible as a provisional alternative.
   Existing unaffected sections may remain as warned snapshot-closed planning backups.
4. Make every original course required; no course is silently removed, merged, or substituted.
   All supplied lecture/recitation/lab meetings in each index stay together. Existing cross-list
   duplicate-credit checks and timing semantics are reused.
5. Search increasing total change budgets, starting with the forced replacements. Budget 1 attempts
   to replace just one failed section; higher budgets permit the smallest necessary number of
   additional planned changes. The solver prefers original indexes and rejects branches exceeding
   the current budget. At the first feasible stage, retain up to five alternatives ranked by
   changed-index count, then the existing weighted preference penalty and deterministic ID ties.
6. Return complete before/after selections, source problems, protected indexes, new restriction
   findings, eligibility assessments, availability evidence, and explicit limitations.

Hard constraints remain hard: registered/locked indexes, all original courses, explicit section/
campus exclusions, required days off, start/end limits, and the Phase 3 timed-meeting/cross-list
checks. Arranged/unknown/inconsistent timing cannot be certified as conflict-free; protected
sections with such timing may make automatic recovery impossible. Ask the instructor/department
for verified timing instead of treating it as free time.

The solver gains optional internal baseline/change-budget parameters; ordinary Phase 3 requests
keep their existing objective and ordering. Baseline identity is passed separately from filtered
candidates, so removing a failed original index cannot make its replacement disappear from the
change count. The total search budget across stages is 25,000 steps (internal cap 50,000), with the
existing bounded candidates/pair cache and no stored Cartesian product. Truncation returns the
best found repair, with no global-optimality or impossibility claim. Original courses are always
retained in this phase; when section-level repair is impossible, explain the constraints and offer
manual department/constraint review rather than inventing substitute courses.

A diagnosis without an actionable timetable problem or a replacement requirement does not start
the solver. New replacement candidates that require permission continue to be excluded. Confirmed eligibility filtering remains in effect.

## Availability investigation and guarantees

The official endpoint investigated is
[Spring 2027 open sections](https://classes.rutgers.edu/soc/api/openSections.json?year=2027&term=1&campus=NB).
A successful inspection on 2026-11-17 returned HTTP 200, JSON string indexes, and `max-age=30`.
It contained 12,671 unique five-digit indexes, including 3,860 outside the 11,528-section NB
snapshot. A separately retrieved NB courses response had the same course/section counts as the
snapshot, but 15 known-index statuses disagreed with the open-index response. Different update/cache
times could contribute; campus scoping, uniqueness across campuses, and completeness were not proved.
The downloaded development snapshot was not rewritten or refreshed.

Consequently **production Rescue remains snapshot-only for availability decisions**. A syntactically
valid endpoint response is `unverified`, not a claim that a New Brunswick index is currently open.
Absence from that unverified list is never converted into closure. The API returns no operational
open-index set from an unverified response. It records the actual successful retrieval timestamp,
which is not a Rutgers publication/update timestamp or a WebReg confirmation.

The server adapter coalesces concurrent checks and caches success/failure for 60 seconds per
process. Fetch has a five-second timeout and response validation/size limits. It never polls.
The student can disable the check for snapshot-only/offline work. After a failed refresh, the
prior successful retrieval timestamp is retained with `stale` state; a first failure is `failed`.
Neither state upgrades the snapshot. Tests exercise verified-fresh evidence separately so the
pure recovery engine has a strict contract for future integration; the current server adapter
never emits that assurance. Even verified SOC availability could change before WebReg accepts a
registration and cannot establish eligibility or reserve a seat.

## Interface, approval, and undo

Registration Rescue appears above the planner workspace and can be opened from the saved schedule.
Guided intake asks what went wrong and which section is affected. Empty plans link to course search.
Closure and requested swaps offer replacement search. Known meeting overlaps show both meeting
times and offer a repair without selecting either section for mandatory replacement. Permission
guidance offers an explicit alternative search. Prerequisite or placement concerns and unexplained
WebReg rejections lead to verification with Rutgers. No search runs when the student selects an
intake answer. The existing hard constraints and preferences also apply to Rescue. Academic facts
remain session-only. Optional server availability checks are off by default.

Alternatives lead with their goal, changed sections, preserved count, and remaining verification,
followed by before/after tables and a calendar preview. Disclosures retain comparison, readiness,
source, and diagnostic details. New restrictions and remaining blockers are visible in the proposal. Unknown eligibility is labeled
provisional/verification-needed, never a successful resolution. Permission instructions are available
through the reused current/proposed section readiness views. Timetable, academic eligibility, seats,
and registration confirmation remain four separate questions.

Finding a proposal does not write the local draft. Applying it requires an explicit checkbox and
Apply action. Protected changes first require exploration consent after a no-repair result, then a
second explicit apply-time approval listing the protected indexes. The pure apply helper verifies
the baseline signature, original course set, protected sections, and meeting conflicts before any
state update. The UI additionally invalidates results when facts, preferences, targets, overrides,
reports, or checks change, and disables Apply during another pending request.

Unchanged section reports are retained; replacement indexes start as Planned, never Registered.
A deliberately replaced registered index keeps its prior self-report outside the new draft.
The planner prominently asks the student to verify that actual WebReg enrollment; subsequent
automatic planning is paused until that prior report is explicitly reconciled or the repair is
undone. This prevents a planner replacement from masquerading as a WebReg drop.

Apply creates an in-memory pre-change backup of sections, locks, and reports. Undo restores it
atomically only while the expected post-apply signature still matches. Later report/lock/selection
changes disable unsafe undo. Backups are not named durable saves; the current draft/reports persist
normally. No real enrollment is changed by Apply, Undo, or clearing a self-report.

## Validation and performance

Local Node 24 measurements, median of five warm runs after one warm-up, excluding HTTP/catalog load:

| Representative recovery | Median | Steps | Changes | Retained | Search |
| --- | --- | --- | --- | --- | --- |
| Failed Multivariable Calculus; registered Data Structures preserved | 2.36 ms | 47 | 1 | 5 | Complete |
| Simultaneous Calculus and Data Structures failures | 2.85 ms | 419 | 2 | 5 | Complete |
| Calculus H1/index 15919 permission failure | 1.25 ms | 49 | 1 | 5 | Complete |

Focused tests cover real Rutgers bundles, closure/replacement, multiple failures, H1 permission,
registered/manual locks, minimum-change ordering and staged expansion, infeasible hard constraints,
unknown eligibility, missing/stale/unverified availability, cache timestamps/failures, saved reports,
atomic approval/undo/stale protection, unrelated selections, and bounded large products. Existing
Phase 1–4 tests remain part of `npm test`.

## Unresolved Rutgers rules and non-goals

The [data audit](RUTGERS_DATA_AUDIT.md) and [eligibility rules](ELIGIBILITY_RULES.md) remain authoritative
for unknown program mappings, compound major/minor/unit rules, grades, placement/equivalencies,
separate required sections, cross-list type/primary-index operations, departmental exceptions,
calendar exceptions, exams, and campus travel requirements. No unknown is treated as proof of a
successful registration. If protection/constraints prevent a repair, verify the existing enrollment
and department guidance before explicitly relaxing them.

No authentication, degree roadmap, friend scheduling, ratings, AI, monitoring/notifications,
autonomous registration, or Phase 6 feature is implemented.
