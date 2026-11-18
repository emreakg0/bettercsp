// Standalone comparison of production replay and a resumable search prototype.
// Run from the repository root: node --expose-gc benchmarks/schedule-discovery.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../lib/rutgers/normalize.ts';
import { exclusionReason, sectionsOverlap } from '../lib/scheduling/candidates.ts';
import { generateSchedules } from '../lib/scheduling/generate.ts';
import { defaultConstraints, defaultWeights } from '../lib/scheduling/generation-types.ts';
import { equivalentCourseGroups } from '../lib/scheduling/relationships.ts';
import { scoreSchedule } from '../lib/scheduling/scoring.ts';

const budget = 25_000;
const pageSize = 10;
const inlineSource = { id: '2027-1-NB', label: 'Spring 2027 New Brunswick', file: '', capturedAt: null };
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), inlineSource);
const codes = ['01:198:112', '01:640:251', '01:198:205', '01:355:101', '01:750:203', '01:830:101', '01:013:140'];
const rank = (a, b) => a.score - b.score || (a.id < b.id ? -1 : Number(a.id > b.id));
const idOf = sections => sections.map(section => section.id).sort().join('|');
const ranked = result => result.schedules.map(({ id, score }) => ({ id, score }));
const bit = index => 1n << BigInt(index);
const masks = sections => sections.map((_, index) => bit(index));
function retain(best, item, limit) {
  if (best.length < limit || rank(item, best.at(-1)) < 0) {
    best.push(item);
    best.sort(rank);
    if (best.length > limit) best.pop();
  }
}

// Each prototype window charges branch attempts, computed conflict pairs, mask intersections,
// and scored solutions. These counters are separate from production's recursive/probe counter.
// The fixture uses distinct, required courses and default hard constraints.
function advance(courses, settings, checkpoint, sampleHeap = () => {}) {
  const domains = courses.map(course => ({
    course,
    sections: course.sections.filter(section => !exclusionReason(section, settings.constraints))
      .sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id)),
  })).sort((a, b) => a.sections.length - b.sections.length || (a.course.id < b.course.id ? -1 : 1));
  const groups = equivalentCourseGroups(domains.map(domain => domain.course));
  assert.equal(new Set(groups.values()).size, domains.length);
  const bits = domains.map(domain => masks(domain.sections));
  const allowed = domains.map(domain => bit(domain.sections.length) - 1n);
  const maxDepth = domains.length - 1;
  const rows = new Map();
  const operational = { branches: 0, pairs: 0, intersections: 0, scored: 0 };
  let used = 0;
  let nextSample = 128;
  const best = [], ids = [];
  const picked = checkpoint?.picked ?? [];
  const frames = checkpoint?.frames.map(frame => ({ allowed: frame.allowed.map(x => BigInt(x)), next: frame.next }))
    ?? [{ allowed, next: 0 }];

  // The bounded operation count includes first-use row construction. An incomplete child
  // is retried next window, whereas any scored leaf has already advanced its parent frame.
  function fits(cost) { return used + cost <= budget; }
  function spend(key, cost = 1) { operational[key] += cost; used += cost; }
  function children(depth, chosen, current) {
    let cost = 0;
    for (let future = depth + 1; future <= maxDepth; future++) {
      const key = (depth * 2000 + chosen) * domains.length + future;
      cost += 1 + (rows.has(key) ? 0 : domains[future].sections.length);
    }
    if (!fits(cost)) return undefined;
    const filtered = current.slice();
    for (let future = depth + 1; future <= maxDepth; future++) {
      const key = (depth * 2000 + chosen) * domains.length + future;
      let row = rows.get(key);
      if (row === undefined) {
        row = 0n;
        const chosenSection = domains[depth].sections[chosen];
        for (const [index, section] of domains[future].sections.entries()) {
          spend('pairs');
          if (!sectionsOverlap(chosenSection, section)) row |= bits[future][index];
        }
        rows.set(key, row);
      }
      spend('intersections');
      filtered[future] &= row;
      if (filtered[future] === 0n) return null;
    }
    return filtered;
  }

  while (frames.length && fits(2)) {
    const depth = frames.length - 1;
    const frame = frames[depth];
    if (frame.next >= domains[depth].sections.length) {
      frames.pop();
      picked.pop();
      continue;
    }
    const choice = frame.next;
    spend('branches');
    if ((frame.allowed[depth] & bits[depth][choice]) === 0n) {
      frame.next++;
      continue;
    }
    if (depth === maxDepth) {
      const sections = [...picked, choice].map((index, level) => domains[level].sections[index]);
      const id = idOf(sections);
      spend('scored');
      ids.push(id);
      retain(best, { id, score: scoreSchedule(sections, settings.weights, settings.preferredInstructors).score }, pageSize);
      frame.next++;
    } else {
      const filtered = children(depth, choice, frame.allowed);
      if (filtered === undefined) break;
      frame.next++;
      if (filtered) {
        picked.push(choice);
        frames.push({ allowed: filtered, next: 0 });
      }
    }
    if (used >= nextSample) {
      sampleHeap();
      nextSample = used + 128;
    }
  }
  sampleHeap();
  const next = frames.length ? JSON.stringify({
    picked, frames: frames.map(frame => ({ ...frame, allowed: frame.allowed.map(String) })),
  }) : null;
  return { best, ids, used, operational, next };
}

function benchmark(run) {
  const times = [];
  run();
  for (let repeat = 0; repeat < 7; repeat++) {
    global.gc?.();
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return +times.sort((a, b) => a - b)[3].toFixed(2);
}
function memoryProbe(run) {
  global.gc?.();
  const start = process.memoryUsage().heapUsed;
  let observed = start;
  const sample = () => { observed = Math.max(observed, process.memoryUsage().heapUsed); };
  run(sample);
  const end = process.memoryUsage().heapUsed;
  const toMiB = bytes => +(bytes / 1048576).toFixed(2);
  return { endMiB: toMiB(end - start), sampledMiB: toMiB(Math.max(observed, end) - start) };
}
function summary({ best }) {
  return {
    returned: best.length,
    bestScore: best[0]?.score ?? null,
    meanScore: best.length ? +(best.reduce((total, item) => total + item.score, 0) / best.length).toFixed(3) : null,
  };
}

for (const courseCount of [2, 4, 7]) {
  const courses = codes.slice(0, courseCount).map(code => catalog.find(course => course.code === code));
  const settings = {
    choices: courses.map(course => ({ courseId: course.id, required: true })),
    constraints: defaultConstraints,
    weights: { ...defaultWeights, lateEvenings: 4 },
    preferredInstructors: [],
  };
  const production = offset => generateSchedules(catalog, settings, offset);
  const first = production({ discoveryOffset: 0 });
  const revision = first.discovery.nextCursor?.split(':')[1];
  const offsets = [0, 10, 20, 30, 40, 50].slice(0, Math.ceil(first.discovery.retained / pageSize));
  const shortlist = offsets.flatMap(discoveryOffset => ranked(production({ discoveryOffset, discoveryRevision: revision })));
  assert.equal(new Set(shortlist.map(item => item.id)).size, shortlist.length);
  const prototype = [];
  let checkpoint = null;
  const validatedPrefix = [];
  const rankForBaselinePrefix = [];
  const sectionsById = new Map(courses.flatMap(course => course.sections.map(section => [section.id, section])));
  for (let window = 0; window < 4; window++) {
    const run = sample => advance(courses, settings, checkpoint ? JSON.parse(checkpoint) : null, sample);
    const batch = run();
    assert.deepEqual(batch, run());
    const seenBefore = validatedPrefix.length;
    for (const [ordinal, id] of batch.ids.entries()) {
      const sections = id.split('|').map(sectionId => sectionsById.get(sectionId));
      assert.equal(sections.length, courseCount);
      assert.ok(sections.every((section, i) => !exclusionReason(section, settings.constraints)
        && sections.slice(i + 1).every(other => !sectionsOverlap(section, other))));
      if (seenBefore + ordinal < first.discovery.uniqueValid) {
        retain(rankForBaselinePrefix, { id, score: scoreSchedule(sections, settings.weights, []).score }, shortlist.length);
      }
    }
    validatedPrefix.push(...batch.ids);
    prototype.push({
      ...summary(batch), found: batch.ids.length, work: batch.used, workParts: batch.operational,
      medianMs: benchmark(run), heap: memoryProbe(run),
      newBeyondShortlist: batch.best.filter(item => !shortlist.some(prior => prior.id === item.id)).length,
      beyondBaselineFrontier: Math.max(0, validatedPrefix.length - Math.max(seenBefore, first.discovery.uniqueValid)),
      returnedBeyondFrontier: batch.best.filter(item => batch.ids.indexOf(item.id) + seenBefore >= first.discovery.uniqueValid).length,
      cursorBytes: Buffer.byteLength(batch.next ?? ''),
      exhausted: !batch.next,
    });
    checkpoint = batch.next;
    if (!checkpoint) break;
  }
  assert.equal(new Set(validatedPrefix).size, validatedPrefix.length);
  if (validatedPrefix.length >= first.discovery.uniqueValid) {
    // Same domain/choice ordering, and matching all 60 retained results from the baseline prefix.
    assert.deepEqual(rankForBaselinePrefix, shortlist);
  }
  if (!first.truncated) assert.equal(validatedPrefix.length, first.discovery.uniqueValid);

  const baseline = offsets.slice(0, 2).map(discoveryOffset => {
    const run = () => production({ discoveryOffset, discoveryRevision: revision });
    const result = run();
    return {
      ...summary({ best: ranked(result) }), work: result.visited, found: result.discovery.uniqueValid,
      medianMs: benchmark(run), heap: { endMiB: memoryProbe(run).endMiB }, exhausted: !result.truncated,
    };
  });
  console.log(JSON.stringify({
    courseCount, codes: codes.slice(0, courseCount),
    rawProduct: courses.reduce((total, course) => total * course.sections.length, 1),
    filteredProduct: first.discovery.upperBound, baselineRetained: shortlist.length,
    baselineHasContinuation: Boolean(first.discovery.nextCursor), baseline,
    prototypeTotal: validatedPrefix.length, prototype,
  }));
}
