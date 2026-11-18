// Browser coverage uses an externally supplied Playwright installation; no application dependency is added.
// Start the production app, then set PLANNER_URL, PLAYWRIGHT_MODULE, and optionally CHROME_PATH.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../lib/rutgers/normalize.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const origin = process.env.PLANNER_URL || 'http://localhost:3000';
const key = 'bettercsp:planner:v1:2027-1-NB';
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), { id: '2027-1-NB', label: 'Spring 2027', file: '', capturedAt: null });
const calculus = catalog.find(c => c.code === '01:640:251');
const cs = catalog.find(c => c.code === '01:198:112');
async function search(page, query, code) {
  if (await page.getByRole('button', { name: 'Courses', exact: true }).isVisible()) await page.getByRole('button', { name: 'Courses', exact: true }).click();
  await page.getByLabel('Find a course', { exact: true }).fill(query);
  const course = page.locator('.planner-course').filter({ has: page.locator('.course-code', { hasText: code }) });
  await course.waitFor();
  return course;
}
async function generate(page) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/planner/generate') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate schedules', exact: true }).click();
  const answer = await response;
  assert.equal(answer.status(), 200);
  const result = await answer.json();
  assert.ok(result.schedules.length, JSON.stringify(result.issues));
  await page.getByRole('button', { name: 'Apply this schedule', exact: true }).waitFor();
  return { ...result, request: answer.request().postDataJSON() };
}
async function seed(page, selections, statuses = {}, locks = []) {
  await page.goto(origin);
  await page.evaluate(([key, ids, statuses, locks]) => localStorage.setItem(key, JSON.stringify({ version: 1, sourceId: '2027-1-NB', sectionIds: ids, registrationStatuses: statuses, lockedSectionIds: locks })), [key, selections.map(s => s.id), statuses, locks]);
  await page.goto(`${origin}/planner`);
  await page.locator(`#selected-${selections[0].index}`).waitFor();
}
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/planner`);
    assert.equal(await page.locator('#rescue-panel input').first().isVisible(), false);
    assert.equal(await page.locator('.academic-profile input').first().isVisible(), false);
    for (const [query, code] of [['Data Structures', '01:198:112'], ['Multivariable Calculus', '01:640:251'], ['Discrete Structures', '01:198:205'], ['College Writing', '01:355:101']]) {
      const course = await search(page, query, code);
      await course.getByRole('button', { name: 'Add course', exact: true }).click();
    }
    assert.equal(await page.locator('.generator-choices > li').count(), 4);
    assert.equal(await page.getByLabel('Earliest start (Eastern)', { exact: true }).isVisible(), false);
    for (const label of ['Prefer days off', 'Avoid early mornings', 'Minimize schedule gaps', 'Minimize campus changes', 'Avoid late evenings']) {
      assert.equal(await page.getByLabel(label, { exact: true }).isChecked(), true);
    }
    const result = await generate(page);
    assert.ok(result.request.choices.every(c => c.required));
    const savedBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.deepEqual(savedBefore.sectionIds, []);
    assert.equal(await page.getByText('Class days', { exact: true }).first().isVisible(), true);
    assert.equal(await page.getByText(/search steps\./).isVisible(), false);
    assert.equal(await page.locator('.generation-results .week-calendar').isVisible(), true);
    await page.getByRole('button', { name: 'Pin this schedule for comparison' }).click();
    await page.getByRole('button', { name: 'Next schedule →' }).click();
    assert.equal(await page.locator('.schedule-comparison').isVisible(), true);
    const current = page.locator('.generation-navigation strong');
    assert.equal(await current.textContent(), 'Schedule 2 of 10 loaded');
    const next = page.getByRole('button', { name: 'Next schedule →' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let requests = 0;
    const delayFirst = async route => {
      if (route.request().postDataJSON().discoveryCursor) {
        requests++;
        await gate;
        await route.fulfill({ status: 503, json: { error: 'Test failure' } });
      } else await route.continue();
    };
    await page.route('**/api/planner/generate', delayFirst);
    for (let step = 2; step < 8; step++) await next.click();
    await page.getByText('Loading next schedules…', { exact: true }).waitFor();
    for (let step = 0; step < 5; step++) await next.click();
    assert.equal(await current.textContent(), 'Schedule 10 of 10 loaded');
    assert.equal(requests, 1);
    release();
    await page.getByRole('button', { name: 'Retry next batch' }).waitFor();
    assert.equal(await current.textContent(), 'Schedule 10 of 10 loaded');
    await page.unroute('**/api/planner/generate', delayFirst);
    await page.getByRole('button', { name: 'Retry next batch' }).click();
    await current.filter({ hasText: 'Schedule 11 of 20 loaded' }).waitFor();
    const previous = page.getByRole('button', { name: '← Previous schedule' });
    await previous.click();
    assert.equal(await current.textContent(), 'Schedule 10 of 20 loaded');
    assert.equal(await page.locator('.schedule-comparison').isVisible(), true);
    if (result.discovery.resumable) {
      const seenCursors = new Set();
      const pages = [];
      const record = response => {
        const firstCursor = response.url().endsWith('/api/planner/generate') && response.request().postDataJSON()?.discoveryCursor;
        if (firstCursor) {
          assert.ok(!seenCursors.has(firstCursor));
          seenCursors.add(firstCursor);
          pages.push(response.json());
        }
      };
      page.on('response', record);
      for (let target = 11; target <= 61; target++) {
        await next.click();
        await current.filter({ hasText: 'Schedule ' + target + ' of ' }).waitFor();
      }
      await current.filter({ hasText: 'Schedule 61 of 70 loaded' }).waitFor();
      page.off('response', record);
      const batches = await Promise.all(pages);
      assert.equal(batches.length, 5);
      assert.ok(batches.at(-1).discovery.windowSteps > 0);
      assert.ok(batches.at(-1).discovery.uniqueValid > result.discovery.uniqueValid);
      await previous.click();
      assert.equal(await current.textContent(), 'Schedule 60 of 70 loaded');
      assert.equal(await page.locator('.schedule-comparison').isVisible(), true);
    }
    await page.getByRole('button', { name: 'Apply this schedule', exact: true }).click();
    await page.getByText('4 selected courses · 15 credits', { exact: true }).waitFor();
    assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).sectionIds.length, 4);
    await page.getByRole('button', { name: 'Restore pre-generation schedule' }).click();
    await page.getByText('0 selected courses · 0 credits', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 1440) {
      const optional = page.locator('.generator-choices > li').last();
      await optional.locator('summary').click();
      await optional.getByLabel('Required course', { exact: true }).uncheck();
      const alternative = await generate(page);
      assert.equal(alternative.request.choices.filter(c => !c.required).length, 1);
      for (const outcome of ['expired', 'exhausted', 'limited']) {
        const handler = async route => {
          if (!route.request().postDataJSON().discoveryCursor) {
            await route.fulfill({ json: { ...result, schedules: result.schedules.slice(0, 1) } });
          } else if (outcome === 'expired') {
            await route.fulfill({ status: 409, json: { error: 'Expired test cursor' } });
          } else {
            await route.fulfill({ json: { ...result, issues: [], schedules: [], truncated: outcome === 'limited',
              discovery: { ...result.discovery, nextCursor: null, exhausted: outcome === 'exhausted', sessionLimited: outcome === 'limited' } } });
          }
        };
        await page.route('**/api/planner/generate', handler);
        await generate(page);
        await current.filter({ hasText: 'Schedule 1 of 1 loaded' }).waitFor();
        await next.click();
        const message = { expired: /continuation expired or changed/, exhausted: /Search exhausted. All shortlisted/, limited: /reached its session limit/ }[outcome];
        await page.getByText(message).first().waitFor();
        assert.equal(await current.textContent(), 'Schedule 1 of 1 loaded');
        assert.equal(await next.isDisabled(), true);
        await page.unroute('**/api/planner/generate', handler);
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(result.schedules[0].selections.length, 4);
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/planner`);
  const course = await search(page, '01:640:251', '01:640:251');
  await course.getByText('Choose a specific section', { exact: true }).click();
  await course.locator('.section > summary').first().click();
  await course.getByRole('button', { name: `Choose section ${calculus.sections[0].number}`, exact: true }).click();
  assert.equal(await page.locator('.selected-section').count(), 1);
  await (await search(page, '01:198:112', '01:198:112')).getByRole('button', { name: 'Add course', exact: true }).click();
  const protectedResult = await generate(page);
  assert.ok(protectedResult.schedules.every(s => s.selections.some(item => item.section.id === calculus.sections[0].id)));
  assert.ok(protectedResult.request.constraints.lockedSectionIds.includes(calculus.sections[0].id));
  const manualChoice = page.locator('.generator-choices > li').filter({ hasText: calculus.code });
  await manualChoice.locator('summary').click();
  await manualChoice.getByLabel(`Keep section ${calculus.sections[0].number}`, { exact: true }).uncheck();
  const flexible = await generate(page);
  assert.equal(flexible.request.constraints.lockedSectionIds.includes(calculus.sections[0].id), false);
  // A preference change makes the preview stale; no result may be applied.
  await page.getByText('Edit schedule preferences', { exact: true }).click();
  await page.getByLabel('Prefer days off', { exact: true }).uncheck();
  assert.equal(await page.getByRole('button', { name: 'Apply this schedule', exact: true }).isDisabled(), true);
  const registered = cs.sections.find(s => s.availability === 'open');
  await seed(page, [calculus.sections[0], registered], { [calculus.sections[0].id]: 'failed', [registered.id]: 'registered' }, [registered.id]);
  assert.equal(await page.locator('.generator-choices > li').count(), 2);
  assert.equal(await page.locator(`#selected-${registered.index}`).getByRole('button', { name: `Remove section ${registered.number}` }).isDisabled(), true);
  await page.getByRole('button', { name: `Find a repair for ${calculus.code}`, exact: true }).click();
  const rescue = page.locator('#rescue-panel');
  assert.equal(await rescue.getAttribute('open'), '');
  await rescue.getByLabel('Try a server-side SOC check', { exact: false }).uncheck();
  await rescue.getByRole('button', { name: 'Find minimum-change repairs', exact: true }).click();
  await rescue.getByRole('heading', { name: 'Proposed repairs', exact: true }).waitFor();
  const applyRepair = rescue.getByRole('button', { name: 'Apply approved repair', exact: true });
  assert.equal(await applyRepair.isDisabled(), true);
  await page.locator(`#selected-${calculus.sections[0].index} .registration-report select`).selectOption('needs-verification');
  assert.equal(await applyRepair.isDisabled(), true);
  await page.locator(`#selected-${calculus.sections[0].index} .registration-report select`).selectOption('failed');
  await rescue.getByRole('button', { name: 'Find minimum-change repairs', exact: true }).click();
  await rescue.getByRole('heading', { name: 'Proposed repairs', exact: true }).waitFor();
  await rescue.getByLabel('I approve the complete before/after', { exact: false }).check();
  await applyRepair.click();
  await page.getByRole('button', { name: 'Undo applied repair', exact: true }).click();
  assert.equal(await page.locator(`#selected-${calculus.sections[0].index} .registration-report select`).inputValue(), 'failed');
  assert.equal(await page.locator(`#selected-${registered.index} .registration-report select`).inputValue(), 'registered');
  // Registration settings remain optional and accessible; changing them invalidates previews.
  await page.locator('.registration-settings > summary').click();
  await page.locator('.academic-profile > summary').click();
  assert.equal(await page.getByRole('button', { name: 'Update readiness', exact: true }).isVisible(), true);
  await page.route('**/api/planner/generate', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Try again shortly.' }) }));
  await page.getByRole('button', { name: 'Generate schedules', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Try again shortly.' }).waitFor();
  assert.equal(await page.locator('.selected-section').count(), 2);
  await page.unroute('**/api/planner/generate');
  const honors = calculus.sections.find(s => s.index === '15919');
  await seed(page, [honors]);
  const blocker = page.locator('.saved-schedule .readiness-permission-required[open]');
  assert.equal(await blocker.count(), 1);
  assert.match(await blocker.getByRole('link', { name: 'Rutgers permission instructions' }).getAttribute('href'), /math.sas.rutgers.edu/);
  const routine = page.locator('.saved-schedule details').filter({ has: page.getByText(/^Needs verification ·/) });
  assert.equal(await routine.locator(':scope > summary').filter({ hasText: 'Needs verification' }).count(), 1);
  assert.equal(await routine.filter({ has: page.getByText(/^Confirm prerequisites, placement/) }).locator(':scope > p').first().isVisible(), false);
  await page.getByRole('button', { name: `Review recovery options for ${calculus.code}`, exact: true }).click();
  assert.equal(await page.locator('#rescue-panel').getAttribute('open'), '');
  console.log('PASS: desktop/mobile four-course workflow, defaults, previews/comparison, apply/undo, manual-section preservation, saved drafts, stale results, registered locks, contextual Rescue consent/undo, optional registration settings.');
} finally { await browser.close(); }
