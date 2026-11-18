# Phase 2.5 Rutgers data and warning audit

Reviewed 2026-11-17. This record adds source evidence and unresolved meanings that the
architecture overview does not track. The local Spring 2027 New Brunswick snapshot
was inspected without refreshing or modifying it. No live seat or eligibility check was made.

## Evidence and corrections

| Concern | Verified evidence | Implemented interpretation |
| --- | --- | --- |
| Course delivery | [SOC](https://classes.rutgers.edu/soc/) associates `courseType_T`, `_H`, and `_O` filter values with face-to-face, hybrid, and online/remote. Its [renderer](https://classes.rutgers.edu/soc/js/soc_app.js) builds those classes from `sectionCourseType`. | All 549 H sections are classified as hybrid delivery, independently of honors evidence. The 1,419 O and 9,560 T sections also receive readable delivery labels. Unknown codes remain unverified. |
| Arabic I | [AMESALL](https://amesall.rutgers.edu/academics/undergraduate-program/course-descriptions/course-descriptions-details/200-140-elementary-arabic) describes `01:013:140` as hybrid. Snapshot section 01/index 13139 has type H, hybrid instruction comments, two timed lectures, and one online B component. | Hybrid, with two calendar meetings and asynchronous content. No honors designation is inferred. |
| Honors calculus | [Rutgers Honors Spring 2027 list](https://honorscollege.rutgers.edu/academics/curriculum/honors-designated-courses) explicitly lists `01:640:251:H1`, index 15919. The [Math schedule](https://iw3.math.rutgers.edu/schedule/undergraduate-2027-spring-table.html) confirms its lecture/recitation bundle. Snapshot type is T, section notes explicitly designate honors, and add-permission code 03 has description Department staff. | Clearly labeled Honors section, with face-to-face delivery. Permission and note evidence remain visible, with no eligibility guarantee. |
| Asynchronous and arranged | SOC [ByArrangementUtils](https://classes.rutgers.edu/soc/js/soc_utils.js) recognizes `baClassHours: B`; its renderer labels online/remote campus locations O/T asynchronous and other locations by arrangement. [Rutgers terminology](https://success.rutgers.edu/tips-tutorials/rutgers-lingo-101) explains the distinction. | Explicit B plus blank day/time fields and O/T location is asynchronous; other explicitly untimed B components are arranged. Blank online timing without B is unknown. Scheduled online meetings still count for conflicts. |
| Contradictory timing | Snapshot `01:991:170`, index 16983, has B flags alongside two complete day/time ranges. | Preserve and check those supplied intervals conservatively and show a source-inconsistency warning. Do not hide actual times or silently certify the source. |
| Cross-listing | Arabic's `crossListedSectionsText` supplies `01:074:140:01 (13140)`. [Rutgers terminology](https://success.rutgers.edu/tips-tutorials/rutgers-lingo-101) explains cross-listing and duplicate-credit limits. | Prefer Rutgers' readable text; format structured unit/subject/course/section/index fields if text is absent. Preserve original metadata. Do not infer required enrollment links or automatically merge selections. |
| Other warning displays | SOC supplies comment descriptions and `openToText` alongside code arrays. | Prefer readable descriptions and open-to wording, preserving raw fields. Show honors program codes with an explicit verification caveat. Expand campus labels O/T to online/remote. Correct singular course/section counts. |

## Classification boundaries

- Delivery and honors are separate normalized fields. An explicit section-note designation
  beginning with `HONORS SECTION` produces an honors section label. Nonempty `honorPrograms`
  produces an honors-program-information label, not a membership decision. Section numbers,
  delivery H, prerequisite mentions, and negative honors notes do not establish eligibility.
- The conservative honors rule finds 10 explicit designations and 104 program-information
  sections. Other genuinely honors offerings may lack either source signal: a section number
  such as H1 alone remains unclassified. The Honors website verifies the regression example;
  it is not imported as an exhaustive honors database.
- Of 16,571 meeting components, 10,385 have scheduled intervals, 1,696 have evidenced
  asynchronous content, and 4,490 are arranged. The current snapshot has no remaining unknown
  timing components under these rules; malformed/unsupported future records remain unknown.
- Asynchronous content occupies no required weekly interval, but still has coursework and
  possible assessment requirements. Arranged meetings are legitimate source data, not missing
  fields; their eventual overlaps remain unverified until instructor/student coordination.
- The saved schedule format is unchanged: stored IDs resolve against the updated normalizer,
  so refreshed schedules gain corrected classifications without carrying stale copied warnings.

## Remaining unknowns and unchanged limits

- `honorPrograms` code-to-program mappings, membership combinations, and enforcement are not
  verified. Their absence does not prove a section is unrestricted or non-honors.
- `crossListedSectionType` values 0–6 and the operational meaning of primary-registration
  indexes are not decoded. Cross-listing does not establish separately required sections.
- Major/minor/unit-major code inclusion/exclusion and combinations, and permission add/drop
  enforcement, are not inferred. Source descriptions are shown; Rutgers must confirm them.
- `legendKey`, session date indicators, special session/date behavior, and exam-code behavior
  remain uninterpreted beyond source text. Semester calendar exceptions and commute gaps are
  outside current conflict checking. Unknown raw fields are retained, not assigned new meanings.
- Availability is a snapshot with unknown capture time. Open status, an honors label, or a
  timetable without overlaps does not establish a student's registration eligibility.

Regression coverage uses actual Arabic, Calculus H1, arranged, scheduled-online,
restriction, and inconsistent-arrangement records, plus malformed/unknown-field variants.
Phase 3 generation was outside the original Phase 2.5 audit. Its relationship follow-up is recorded below; authentication and registration automation remain unimplemented.

## Phase 3 relationship investigation

The snapshot has no structured co-requisite/required-section linkage field. Data Structures
`01:198:112` has 45 registration indexes; index 14315 already contains two lectures and a recitation.
Multivariable Calculus `01:640:251` has 30 indexes; index 15895 similarly contains two lectures and a
recitation. The [Math Spring 2027 schedule](https://iw3.math.rutgers.edu/schedule/undergraduate-2027-spring-table.html)
shows shared lecture groups plus specific recitations, and the
[Data Structures course site](https://ds.cs.rutgers.edu/) requires the registered recitation for quizzes.
These sources support preserving each index's supplied meeting bundle, rather than choosing an
arbitrary lecture and recitation independently. They do not establish a universal linkage rule.

Separate registration is a real, different case: current snapshot `01:070:407:01`, index 13302,
explicitly says to register for `01:070:408`; the latter's section 01/index 13303 reciprocates.
Cross-listed `01:595:402`/`403` have analogous notes. A departmental
[Spring 2017 syllabus](https://anthropology.rutgers.edu/images/documents/syllabi/407-408mostrecent.pdf)
independently describes separate lecture/lab registrations; its historical date is not evidence of
current section pairing. The current-term notes are retained as required-component limitations.
The generator never invents a section pair, auto-adds an unseen lab, or claims to have satisfied a
textual co-requisite. Students must inspect source notes and confirm the registration bundle.

[SEBS cross-listing policy](https://sebscourseapproval.rutgers.edu/policies/course-cross-listing-policy/)
and Rutgers terminology support preventing duplicate enrollment under cross-listed course codes.
The generator blocks course-code groups evidenced by structured cross-list metadata, transitively
and conservatively, even when two indexes have no timed overlap. It preserves each enrollment
identity. The meanings of cross-list type codes and primary-index operations are still unverified.
Mutual-credit exclusions or co-requisites written only in arbitrary prose are surfaced, not executed
as machine-verified eligibility rules. At the end of Phase 3, no eligibility engine existed; Phase 4 adds the limited checks documented below, not a complete degree audit.

Phase 3 excludes arranged, unknown, and inconsistent-source timing from generated timetables,
with per-course exclusion counts; these sections remain available in manual planning. Evidence-backed
asynchronous components remain candidates without occupying a weekly interval. Closed snapshot
sections can be planning alternatives with explicit warnings, never guaranteed available seats.

## Phase 4 eligibility follow-up

[Eligibility rules](ELIGIBILITY_RULES.md) records official Math admission, SAS/CS permission and
prerequisite guidance, supported source-text checks, and unresolved rule meanings. In particular,
Calculus H1/index 15919 needs invitation/departmental admission review; honors membership alone
neither grants admission nor proves incompatibility. Source delivery H remains hybrid.
Positive single-category readable Open To lists and exact standing restrictions now support limited
comparisons with optional explicit student facts; mixed raw-code combinations are still unverified.
Prerequisite, grade, placement, equivalency, and permission requirements are evaluated separately.
Generation retains unknown eligibility and only excludes supported explicit mismatches by opt-in.
