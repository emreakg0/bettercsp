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
Phase 3 generation, authentication, and registration automation remain outside this audit.
