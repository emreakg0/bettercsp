import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emptyAcademicProfile, parseAcademicProfile } from '../academic/profile.ts';
import { emptyProfile } from '../eligibility/types.ts';
import { normalizeCatalog } from '../rutgers/normalize.ts';
import { defaultConstraints, defaultWeights } from '../scheduling/generation-types.ts';
import { findCourseFallbacks } from './course-fallback.ts';
import { applicablePreparation, preparationLifetime, preparationScope, readPreparation, type Preparation } from './prepared.ts';
import { resolveRescueDraft } from './rescue.ts';
import { draftSignature } from './state.ts';
import type { RegistrationStatus, RescueRequest } from './types.ts';

const sourceId = '2027-1-NB', revision = 'revision', binding = 'binding';
const now = 1_790_000_000_000;
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')),
  { id: sourceId, label: '', file: '', capturedAt: null });
const sectionIds = ['14315', '14411', '14758', '15897'].map(index => sourceId + ':' + index);
const request: RescueRequest = { sectionIds, statuses: {}, replaceSectionIds: [], overrideProtectionIds: [],
  settings: { choices: [], constraints: defaultConstraints, weights: defaultWeights, preferredInstructors: [] } };
const draft = resolveRescueDraft(catalog, request);
const target = draft.selections.find(s => s.section.id === sectionIds[3])!;
const ds = draft.selections.find(s => s.section.id === sectionIds[0])!;
const backup = findCourseFallbacks(catalog, request, target.section.id, []);
const cache: Preparation = { version: 1, sourceId, catalogRevision: revision, binding, preparedAt: now,
  entries: [{ targetId: target.section.id, options: backup.options, truncated: false }] };

test('prepared cache rejects malformed projections, wrong identity and age', () => {
  const raw = JSON.stringify(cache);
  assert.deepEqual(readPreparation(raw, sourceId, revision, binding, now), cache);
  assert.equal(readPreparation(raw, '2027-1-NK', revision, binding, now), null);
  assert.equal(readPreparation(raw, sourceId, 'changed', binding, now), null);
  assert.equal(readPreparation(raw, sourceId, revision, 'changed', now), null);
  assert.equal(readPreparation(raw, sourceId, revision, binding, now + preparationLifetime), null);
  for (const key of ['index', 'meetings', 'availability', 'delivery', 'honors'] as const) {
    const corrupt = structuredClone(cache);
    Object.assign(corrupt.entries[0].options[0].selection.section, { [key]: 42 });
    assert.equal(readPreparation(JSON.stringify(corrupt), sourceId, revision, binding, now), null);
  }
  assert.equal(readPreparation('malformed', sourceId, revision, binding, now), null);
});

test('three new registered reports can reuse an unchanged timetable; protection and settings still apply', () => {
  const statuses = Object.fromEntries<RegistrationStatus>(sectionIds.map(id => [id, id === target.section.id ? 'failed' : 'registered']));
  const current = { ...draft, statuses };
  const scope = preparationScope(sourceId, revision, draft, emptyAcademicProfile, request.settings);
  assert.equal(preparationScope(sourceId, revision, current, emptyAcademicProfile, request.settings), scope);
  assert.notEqual(preparationScope(sourceId, revision, current, emptyAcademicProfile, {}), scope);
  assert.notEqual(preparationScope(sourceId, revision, current, parseAcademicProfile({ intendedMajors: ['Computer Science'] }), request.settings), scope);
  const options = applicablePreparation(cache, current, target, emptyAcademicProfile, emptyProfile, defaultConstraints, now);
  assert.ok(options?.options.length);
  assert.equal(options.basis, draftSignature(current));
  assert.equal(applicablePreparation(cache, { ...current, locks: [target.section.id] }, target, emptyAcademicProfile, emptyProfile, defaultConstraints, now), null);
  assert.equal(applicablePreparation(cache, current, target, emptyAcademicProfile, emptyProfile, { ...defaultConstraints, latestEnd: 500 }, now), null);
  assert.equal(applicablePreparation(cache, { ...current, statuses: { ...statuses, [sourceId + ':99999']: 'registered' } },
    target, emptyAcademicProfile, emptyProfile, defaultConstraints, now), null);
});

test('degree alternatives requiring the failed course are held unless a reported documented route is available', () => {
  const academic = parseAcademicProfile({ school: 'SAS', intendedMajors: ['Computer Science'], degreeType: 'BA', catalogYear: 2026 });
  const choices = findCourseFallbacks(catalog, request, ds.section.id, ['01:198:211', '01:640:250']).options;
  assert.ok(choices.some(option => option.selection.course.code === '01:198:211'));
  const prepared = { ...cache, entries: [{ targetId: ds.section.id, options: choices, truncated: false }] };
  const current = { ...draft, statuses: { [ds.section.id]: 'failed' } as const };
  const options = applicablePreparation(prepared, current, ds, academic, emptyProfile, defaultConstraints, now);
  assert.ok(options);
  assert.ok(options.options.some(option => option.selection.course.code === '01:640:250'));
  assert.ok(!options.options.some(option => option.selection.course.code === '01:198:211'));
  const equivalent = { ...emptyProfile, completedCourses: ['14:332:351'] };
  const withRoute = applicablePreparation(prepared, current, ds, academic, equivalent, defaultConstraints, now);
  assert.ok(withRoute?.options.some(option => option.selection.course.code === '01:198:211'));
  assert.ok(applicablePreparation(prepared, { ...current, statuses: { ...current.statuses, [target.section.id]: 'failed' } },
    ds, academic, emptyProfile, defaultConstraints, now)?.options.length);
});
