# Phase 4 eligibility rules and evidence

This document records recognized rules separately from the Phase 2.5/3 source audit. Reviewed
2026-11-17 against the existing Spring 2027 New Brunswick snapshot and official Rutgers sources.
No student academic record, live seat availability, or WebReg transaction was accessed.

## Evidence and supported checks

| Rule | Source evidence | Deterministic handling |
| --- | --- | --- |
| `math.honors-admission.v1` | [Math honors admission](https://math.sas.rutgers.edu/academics/undergraduate/honors/honors-menu/honors-courses-for-undergraduates) describes invitations and honors special-permission admission for honors calculus. [Rutgers Honors](https://honorscollege.rutgers.edu/academics/curriculum/honors-designated-courses) lists Spring 2027 `01:640:251:H1`, index 15919. The snapshot also has explicit honors notes and add code 03/Department staff. | Flag admission permission for supported Math honors offerings, including H1. Honors membership alone does not establish approval, and non-membership alone does not establish incompatibility. A reported grant applies only to that index; prerequisites and all other conditions remain independent. |
| `soc.add-permission.v1` | SOC add-code/description pairs; [SAS registration FAQ](https://sasundergrad.sas.rutgers.edu/resources/faq/registration-faqs) explains department-owned SPNs; [CS Spring 2027 instructions](https://www.cs.rutgers.edu/academics/undergraduate/course-registration-and-special-permission) provides its specific process. | Known add-code/description pairs produce Permission required unless approval for that index is reported. Unknown/changed pairs remain Verification needed. A missing user grant is not a confirmed incompatibility and is never auto-filtered. |
| `soc.standing.exact.v1` | SOC `sectionEligibility` readable restrictions. Its [renderer](https://classes.rutgers.edu/soc/js/soc_app.js) displays this as section restrictions. | Exact support for nine observed phrases: juniors/seniors; first-year only; all except first-year; all except seniors; seniors only; sophomores/juniors; first-year/sophomores; sophomores only; juniors only. Compare to optional Rutgers-recorded standing. Missing/unsupported standing remains unknown. |
| `soc.open-to.single-category.v1` | SOC `openToText`, displayed as section Open To in its renderer; [SAS FAQ](https://sasundergrad.sas.rutgers.edu/resources/faq/registration-faqs) warns that sections may restrict majors/populations. | Recognize only a complete positive single-category UNIT, MAJ, or MINOR list, stripping parenthesized display names. Require explicit confirmation that supplied declarations are complete before declaring a mismatch. Empty schools remain unknown. Mixed categories, unit/major combinations, exclusions, or unsupported text remain Verification needed. Raw code-array direction is not inferred. |
| `soc.honors-college-only.v1` | Exact current snapshot note `OPEN TO HONORS COLLEGE ONLY`, index 14915. | Evaluate this literal requirement against optional Honors College membership. Other honors programs are neither silently substituted nor treated as proof of non-membership; only an explicit no-membership report establishes mismatch. Missing membership stays unknown. Exceptions still need department confirmation. |
| `soc.honors-evidence.v1` | Explicit honors notes and `honorPrograms` metadata, preserved by the adapter. | Generic designation/program codes prompt verification; program-code mappings and compound membership rules are not decoded. Delivery type H is hybrid and never supplies honors evidence. |
| `soc.prerequisites.flat.v1` | `preReqNotes` source expressions; [Rutgers prerequisite override guidance](https://alc.rutgers.edu/images/Forms/PREREQUISITE_OVERRIDE_FORM.pdf) distinguishes prerequisite approval from SPNs. | Support full course-only single/AND/OR expressions with one course identity per leaf and one operator family. Known completions can match that expression, subject to required grades and applied credit. Omitting a course means unknown, never failure. Explicit non-completion may produce Potentially ineligible but is not filterable because equivalency/placement/override alternatives may exist. Mixed/nested/prose/grade-bearing expressions remain unverified. |
| `soc.placement-note.v1` | Section/course placement notes; SAS FAQ describes placement and its application to registration. | Show supplied met/not-met placement facts for that course alongside the exact note. Do not invent a score threshold, conflate test completion with placement level, or override prerequisites automatically. Ask the department to confirm the route. |
| `soc.uninterpreted-restriction.v1` | Restrictive notes, grade/credit conditions, co-requisites, permission-drop codes, and future eligibility metadata. | Preserve evidence and give a review step. Do not execute free-form prose as a complete eligibility rule. Separate required registrations remain unresolved. |

Recognized add-code labels in this snapshot: 03 Department staff; 04 Instructor; 24 Academic
Advisor; 20 Program; 17 Honors Program (source phone description retained); 14 Program Director;
16 Department; 26 GSE Office of Student Academic Services; 21 Office of Academic Services;
07 Dean - School of Business. These labels identify the source permission signal/contact,
not a verified SPN issuance, override, or enforcement algorithm. Drop-code meanings are not decoded.

## Status and exclusion policy

All findings retain category, stable rule ID, source field/text/link, missing facts, and next step.
Summary precedence is Potentially ineligible, Permission required, Verification needed, then
No known blocker. The latter means only that supported checks found no blocker; it is never
verified enrollment, eligibility certification, or a seat reservation.

The default generator keeps candidates with eligibility warnings. The optional exclusion policy
uses only supported mismatches against explicitly reported standing, explicitly complete positive
declarations, or the literal Honors College-only requirement. These are confirmations of mismatch
against user input, not an official student-record decision. Unknowns, ambiguous rules, permission
requests, and incomplete prerequisite/placement interpretations are never silently excluded.
A conflicting locked/retained section makes generation fail visibly rather than changing the lock.
Filtered-candidate explanations include the evidence and reason (up to 20 examples per course,
with aggregate counts covering all exclusions). Existing timetable filters remain separate.

Eligibility never changes weighted preference scores or interprets an open snapshot seat as
student eligibility. Generated results include assessments; the UI recomputes readiness from the
current profile for both manual and preview schedules. Profile/policy changes invalidate Apply
until regeneration. Manual sections, locks, saved IDs, and undo behavior remain unchanged.

## Optional academic information and privacy

Students may supply school/major/minor codes, standing, honors membership, relevant known completed
or explicitly uncompleted courses, course-scoped applied-placement facts, and approved registration
indexes. No sensitive identifier, credential, actual SPN, grades, or full academic record is required.
Invalid/contradictory codes are rejected. Unknown extra API fields are not copied to the profile.

The academic profile is session-only unless the student opts into separate browser-local storage.
It is not written into schedule saves. Eligibility inputs can be sent with generation or Rescue.
Planning-only facts, including in-progress and planned courses and equivalent credit, stay local.

## Registration Preflight

Preflight checks the actual indexes in saved and generated schedules. It reuses the eligibility
evaluator and labels each finding by scope. Course prerequisites remain visible even when a student
reports a matching completion. Intended majors are planning notes. In-progress classes and reported
AP or transfer credit add context to prerequisite verification. Preflight does not infer completion,
recognition, or conditional enrollment. Rutgers distinguishes prerequisite approval from section
permission in its [prerequisite override form](https://alc.rutgers.edu/images/Forms/PREREQUISITE_OVERRIDE_FORM.pdf).
No general conditional rule for in-progress prerequisites was established for the supported catalog.

Section selection surfaces source-backed warnings for supported section-specific requirements.
Preflight separates those requirements from known timetable overlaps and unverified snapshot seat
status. For recognized physical New Brunswick campuses in Spring 2027, the
[Registrar](https://nbregistrar.rutgers.edu/undergrad/s27prereg.htm) and
[SAS travel guidance](https://sasundergrad.rutgers.edu/resources/faq/faq-detail/travel-conflict)
support a 40-minute gap, with 30 minutes permitted for Busch/Livingston and College Avenue/Downtown.
The check uses scheduled weekly meetings and known campus aliases. Meeting dates, unknown
locations, and actual travel duration remain unverified. Travel is advisory and does not change
the generation or Rescue solver.

For an affected, unprotected index, Preflight can fetch same-course sections and rank those that
fit around the other picks with fewer known blockers first. Uncertain eligibility is retained.
The handoff opens Rescue with the index already selected and replacement intent set. A generated
preview requires explicit application before it becomes the Rescue baseline. Rescue still requires
explicit approval of a proposed repair.

## Remaining limits

Program-code mappings, complex major/minor/unit combinations, grade evaluation, all equivalencies,
placement thresholds, departmental exceptions, prose co-requisites/duplicate-credit rules, and
separate required-section matching are incomplete. Official rules and SOC data may change.
Snapshot capture time remains unknown. Weekly conflicts, eligibility evidence, and seat availability
are distinct. Preflight checks the published travel minimum where it has enough location and term
evidence. Special dates, exams, and complete degree auditing remain outside these checks.
