// Compare both modes of the production route against the same catalog and request.
// Start a fallback server at :3108 and a signed server at :3109, then run with node --expose-gc.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../lib/rutgers/normalize.ts';
import { generateSchedules } from '../lib/scheduling/generate.ts';
import { defaultConstraints, defaultWeights } from '../lib/scheduling/generation-types.ts';

const sourceId = '2027-1-NB';
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), { id: sourceId });
const courseCodes = ['01:198:112', '01:640:251', '01:198:205', '01:355:101', '01:750:203', '01:830:101', '01:013:140'];
const route = '/api/planner/generate';
const median = xs => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function measure(origin, settings, cursor, label) {
  const times = [];
  let page, bytes;
  for (let attempt = 0; attempt < 8; attempt++) {
    const start = performance.now();
    const response = await fetch(origin + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, discoveryCursor: cursor }),
    });
    const body = await response.text();
    if (attempt) times.push(performance.now() - start);
    assert.equal(response.status, 200, body);
    page = JSON.parse(body);
    bytes = Buffer.byteLength(body);
  }
  const { discovery } = page;
  console.log(JSON.stringify({ label, latencyMs: +median(times).toFixed(2), bytes, cursorBytes: discovery.nextCursor?.length ?? 0,
    work: discovery.windowSteps ?? page.visited, totalSteps: page.visited, exhausted: discovery.exhausted,
    valid: discovery.uniqueValid, offered: discovery.retained, pageBestScore: page.schedules[0]?.score }));
  return page;
}
function heapDelta(run) {
  const deltas = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const result = run();
    assert.ok(result.discovery);
    deltas.push((process.memoryUsage().heapUsed - before) / 1048576);
  }
  return +median(deltas).toFixed(2);
}

for (const count of [2, 4, 7]) {
  const choices = courseCodes.slice(0, count).map(code => ({ courseId: catalog.find(c => c.code === code).id, required: true }));
  const request = { sourceId, choices, constraints: defaultConstraints,
    weights: { ...defaultWeights, lateEvenings: 4 }, preferredInstructors: [] };
  const fallback = process.env.BENCH_REPLAY_ORIGIN || 'http://localhost:3108';
  const signed = process.env.BENCH_SIGNED_ORIGIN || 'http://localhost:3109';
  console.log(JSON.stringify({ courses: count, codes: courseCodes.slice(0, count) }));
  const legacy = await measure(fallback, request, null, 'Replay first');
  await measure(fallback, request, legacy.discovery.nextCursor, 'Replay second');
  const first = await measure(signed, request, null, 'Checkpoint first');
  assert.equal(first.discovery.resumable, true);
  assert.deepEqual(first.schedules, legacy.schedules);
  let page = await measure(signed, request, first.discovery.nextCursor, 'Checkpoint buffered second');
  const ids = new Set([...first.schedules, ...page.schedules].map(item => item.id));
  const append = next => {
    for (const schedule of next.schedules) { assert.ok(!ids.has(schedule.id)); ids.add(schedule.id); }
  };
  let internal = generateSchedules(catalog, request, { checkpoint: null });
  const heap = {
    replay: heapDelta(() => generateSchedules(catalog, request, { discoveryOffset: 0 })),
    first: heapDelta(() => generateSchedules(catalog, request, { checkpoint: null })),
    buffered: heapDelta(() => generateSchedules(catalog, request, { checkpoint: internal.checkpoint })),
  };
  for (let buffered = 0; buffered < 4 && page.discovery.nextCursor; buffered++) {
    const response = await fetch(signed + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, discoveryCursor: page.discovery.nextCursor }),
    });
    assert.equal(response.status, 200);
    page = await response.json();
    append(page);
  }
  for (let buffered = 0; buffered < 5 && internal.checkpoint; buffered++) {
    internal = generateSchedules(catalog, request, { checkpoint: internal.checkpoint });
  }
  if (page.discovery.nextCursor) {
    for (let resumed = 1; resumed <= 3; resumed++) {
      page = await measure(signed, request, page.discovery.nextCursor, 'Checkpoint resumed ' + resumed);
      append(page);
    }
    heap.resumed = heapDelta(() => generateSchedules(catalog, request, { checkpoint: internal.checkpoint }));
  }
  console.log(JSON.stringify({ heapDeltaMiB: heap, totalDisplayed: ids.size, upperBound: first.discovery.upperBound }));
}
