// Browser coverage uses an externally supplied Playwright installation; no application dependency is added.
// Start the production app, then set PLANNER_URL, PLAYWRIGHT_MODULE, and optionally CHROME_PATH.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../lib/rutgers/normalize.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const origin = process.env.PLANNER_URL || 'http://localhost:3000';
const key = 'bettercsp:planner:v1:2027-1-NB';
const academicKey = 'bettercsp:academic-profile:v1';
const catalog = normalizeCatalog(JSON.parse(readFileSync('data/rutgers/spring-2027.json', 'utf8')), { id: '2027-1-NB', label: 'Spring 2027', file: '', capturedAt: null });
const calculus = catalog.find(c => c.code === '01:640:251');
const cs = catalog.find(c => c.code === '01:198:112');
const discrete = catalog.find(c => c.code === '01:198:205');
async function show(page, destination) {
  const tab = page.getByRole('navigation', { name: 'Planner workspace' }).getByRole('button', { name: destination, exact: true });
  if (await tab.getAttribute('aria-current') !== 'page') await tab.click();
  await page.locator('.planner-tabs button[aria-current="page"]').filter({ hasText: destination }).waitFor();
}
async function search(page, query, code) {
  await show(page, 'Build');
  await page.getByLabel('Find a course', { exact: true }).fill(query);
  const course = page.locator('.planner-course').filter({ has: page.locator('.course-code', { hasText: code }) });
  await course.waitFor();
  return course;
}
async function generate(page) {
  await show(page, 'Build');
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
  await page.goto(`${origin}/planner?view=schedule`);
  await page.locator(`#selected-${selections[0].index}`).waitFor();
}
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/planner`);
    assert.equal(await page.locator('#rescue-panel input').first().isVisible(), false);
    assert.equal(await page.locator('.academic-profile input').first().isVisible(), false);
    const rescueEntry = page.getByRole('navigation', { name: 'Planner workspace' }).getByRole('button', { name: 'Rescue', exact: true });
    await page.locator('.planner-course button:not(:disabled)').first().waitFor();
    await rescueEntry.press('Enter');
    await page.getByText('Rescue needs a plan', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Find minimum-change repairs' }).count(), 0);
    await page.getByRole('button', { name: 'Find the affected course' }).click();
    await page.waitForFunction(() => document.activeElement?.id === 'course-search');

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
    assert.equal(await page.locator('.generation-results .calendar-legend li').count(), 10);
    const previewPreflight = page.locator('.generation-results .registration-preflight');
    await previewPreflight.locator('summary').first().press('Enter');
    await previewPreflight.getByText(/Current availability and enrollment must be confirmed/).waitFor();
    assert.ok(await previewPreflight.getByRole('heading', { name: /Index/ }).count());
    await previewPreflight.locator('summary').first().press('Enter');

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
    await page.locator('#manual-schedule .calendar-legend').waitFor();
    assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).sectionIds.length, 4);
    await page.getByRole('button', { name: 'Restore pre-generation schedule' }).click();
    await page.getByText('0 selected courses · 0 credits', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 1440) {
      await show(page, 'Build');
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
        const message = { expired: /continuation expired or changed/, exhausted: /Search finished. All shortlisted/, limited: /reached its session limit/ }[outcome];
        await page.getByText(message).first().waitFor();
        assert.equal(await current.textContent(), 'Schedule 1 of 1 loaded');
        assert.equal(await next.isDisabled(), true);
        await page.unroute('**/api/planner/generate', handler);
      }
      const partial = async route => {
        const cursor = route.request().postDataJSON().discoveryCursor;
        const items = !cursor ? result.schedules.slice(0, 1) : cursor === 'next-page' ? result.schedules.slice(1, 3) : [];
        await route.fulfill({ json: { ...result, schedules: items, discovery: { ...result.discovery,
          nextCursor: !cursor ? 'empty-page' : cursor === 'empty-page' ? 'next-page' : null, exhausted: cursor === 'next-page', sessionLimited: false } } });
      };
      await page.route('**/api/planner/generate', partial);
      await generate(page);
      await next.click();
      await page.getByText('The last batch found no new schedules.', { exact: false }).waitFor();
      assert.equal(await current.textContent(), 'Schedule 1 of 1 loaded');
      assert.equal(await next.isEnabled(), true);
      await next.click();
      await current.filter({ hasText: 'Schedule 2 of 3 loaded' }).waitFor();
      await previous.click();
      assert.equal(await current.textContent(), 'Schedule 1 of 3 loaded');
      await page.unroute('**/api/planner/generate', partial);
    }

    const discreteSection = discrete.sections.find(s => s.index === '14411');
    await seed(page, [discreteSection]);
    const savedDiscrete = await page.evaluate(key => localStorage.getItem(key), key);
    const alternativeFailure = route => route.fulfill({ status: 503, json: { error: 'Could not check alternatives.' } });
    await page.route('**/api/planner/rescue', alternativeFailure);
    await page.getByRole('button', { name: 'Find a replacement for 01:198:205', exact: true }).press('Enter');
    const fallback = page.getByRole('region', { name: 'Section and course alternatives' });
    await fallback.getByRole('alert').getByText('Could not check alternatives. Your schedule is unchanged.', { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'planner-rescue-heading');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), savedDiscrete);
    await page.unroute('**/api/planner/rescue', alternativeFailure);
    await fallback.getByRole('button', { name: 'Retry alternatives' }).click();
    await fallback.getByRole('heading', { name: 'Other sections of 01:198:205' }).waitFor();
    assert.equal(await page.getByLabel('Which section is affected?').inputValue(), discreteSection.index);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), savedDiscrete);
    assert.match(page.url(), /view=rescue&section=14411/);
    await page.goBack();
    await page.getByRole('heading', { name: /^My Schedule/ }).waitFor();
    assert.equal(await fallback.isVisible(), false);
    await page.goForward();
    await fallback.getByRole('heading', { name: 'Other sections of 01:198:205' }).waitFor();
    await fallback.getByRole('button', { name: /^Review section/ }).first().click();
    await fallback.getByRole('heading', { name: 'Review before applying' }).waitFor();
    assert.equal(await fallback.getByRole('button', { name: 'Apply approved replacement', exact: true }).isDisabled(), true);
    const copy = fallback.getByRole('button', { name: /^Copy registration index/ }).first();
    const copied = (await copy.getAttribute('aria-label')).slice(-5);
    await copy.click();
    await fallback.getByText(`Copied ${copied}.`, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copied);
    await fallback.getByLabel('I approve this planner change', { exact: false }).check();
    await fallback.getByRole('button', { name: 'Apply approved replacement' }).click();
    await page.getByText('Alternative applied to your planner.', { exact: false }).waitFor();
    assert.equal(await page.locator(`#selected-${copied} .registration-report select`).inputValue(), 'planned');
    await page.getByRole('button', { name: 'Undo applied course alternative' }).click();
    await page.locator(`#selected-${discreteSection.index}`).waitFor();
    await page.goto(`${origin}/planner?q=01%3A198%3A205`);
    await page.getByRole('region', { name: 'Course search results' }).getByText('01:198:205', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Find a course', { exact: true }).inputValue(), '01:198:205');
    await show(page, 'My Schedule');
    await page.goBack();
    await page.getByRole('region', { name: 'Course search results' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'course-search');
    const restored = await generate(page);
    assert.deepEqual(restored.request.constraints.lockedSectionIds, []);
    assert.ok(restored.schedules.length > 1);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), savedDiscrete);
    await page.getByLabel(`Keep section ${discreteSection.number} for 01:198:205`, { exact: true }).check();
    const single = await generate(page);
    assert.deepEqual(single.request.constraints.lockedSectionIds, [discreteSection.id]);
    await page.getByText('Every course is fixed to a section.', { exact: true }).waitFor();
    const releasePins = page.waitForResponse(r => r.url().endsWith('/api/planner/generate') && !r.request().postDataJSON()?.discoveryCursor);
    await page.getByRole('button', { name: 'Try other sections', exact: true }).click();
    assert.deepEqual((await releasePins).request().postDataJSON().constraints.lockedSectionIds, []);
    await current.filter({ hasText: /Schedule 1 of [2-9] loaded/ }).waitFor();
    if (width === 1440) {
      await page.getByText('Edit schedule preferences', { exact: true }).click();
      await page.getByText('Advanced Preferences', { exact: true }).click();
      await page.getByText('Section and campus exclusions', { exact: true }).click();
      await page.getByLabel(/Exclude registration indexes/).fill(discrete.sections.filter(s => s !== discreteSection).map(s => s.index).join(','));
      const constrained = await generate(page);
      assert.equal(constrained.schedules.length, 1);
      await page.getByText('Only one compatible timetable matches these choices and constraints.', { exact: true }).waitFor();
      assert.equal(await next.isDisabled(), true);
    }

    const [failed, ...registered] = ['14315', '14411', '14758', '15897'].map(index => catalog.flatMap(c => c.sections).find(s => s.index === index));
    await seed(page, [failed, ...registered], { [failed.id]: 'failed', ...Object.fromEntries(registered.map(s => [s.id, 'registered'])) }, [registered[0].id]);
    const protectedDraft = await generate(page);
    assert.deepEqual([...protectedDraft.request.constraints.lockedSectionIds].sort(), registered.map(s => s.id).sort());
    assert.ok(protectedDraft.schedules.every(s => registered.every(section => s.selections.some(item => item.section.id === section.id))));
    await show(page, 'My Schedule');
    await page.getByRole('button', { name: 'Find a replacement for 01:198:112', exact: true }).click();
    await fallback.getByRole('heading', { name: 'Replacement options', exact: true }).waitFor();
    const academic = page.locator('.academic-profile');
    await academic.locator(':scope > summary').click();
    await academic.getByLabel('Rutgers school', { exact: true }).fill('SAS');
    await academic.getByLabel('Declared or intended majors').fill('Computer Science');
    await academic.getByLabel('Intended degree type').selectOption('BA');
    await academic.getByLabel('Program or catalog year').fill('2026');
    await academic.getByLabel('Courses in progress').fill('01:640:151');
    const update = academic.getByRole('button', { name: 'Update profile' });
    async function findCoursesAndConfirmPrivacy(trigger) {
      const search = page.waitForResponse(r => r.url().endsWith('/api/planner/rescue') && r.request().postDataJSON()?.courseFallback?.candidateCodes.length);
      await trigger();
      const answer = await search;
      assert.equal(answer.status(), 200);
      const request = answer.request().postDataJSON();
      for (const field of ['inProgressCourses', 'plannedCourses', 'intendedMajors', 'catalogYear']) assert.ok(!JSON.stringify(request).includes(field));
      assert.equal(request.courseFallback.targetId, failed.id);
      await fallback.getByRole('heading', { name: 'Courses that may advance your degree', exact: true }).waitFor();
    }
    await findCoursesAndConfirmPrivacy(() => update.click());
    await fallback.getByText('Plan 01:198:112 for a later term', { exact: true }).press('Enter');
    await fallback.getByText(/Postponing 01:198:112 could delay 01:198:211/).waitFor();
    await fallback.getByRole('button', { name: 'Add 01:198:112 to planned future courses' }).click();
    assert.equal(await academic.getByLabel('Planned future courses').inputValue(), '01:198:112');
    await findCoursesAndConfirmPrivacy(() => update.click());
    const calculusII = fallback.locator('article').filter({ has: page.getByRole('heading', { name: /01:640:152/ }) });
    await calculusII.locator('summary').filter({ hasText: 'Prerequisite needs verification' }).first().click();
    await calculusII.getByText(/In progress in your profile: 01:640:151/).first().waitFor();
    const review = fallback.locator('article').first().getByRole('button', { name: /^Review section/ }).first();
    await review.press('Enter');
    const applyAlternative = fallback.getByRole('button', { name: 'Apply approved replacement' });
    assert.equal(await applyAlternative.isDisabled(), true);
    const approval = fallback.getByLabel('I approve this planner change', { exact: false });
    await approval.check();
    await academic.getByLabel('Program or catalog year').fill('2025');
    await update.click();
    await fallback.getByRole('heading', { name: 'Courses that may advance your degree' }).waitFor({ state: 'hidden' });
    assert.equal(await applyAlternative.count(), 0);
    await academic.getByLabel('Program or catalog year').fill('2026');
    await findCoursesAndConfirmPrivacy(() => update.click());
    const selectedAlternative = (await review.getAttribute('aria-label')).match(/index (\d{5})/)[1];
    await review.press('Enter');
    await approval.check();
    await applyAlternative.click();
    assert.equal(await page.locator(`#selected-${failed.index}`).count(), 0);
    assert.equal(await page.locator(`#selected-${selectedAlternative} .registration-report select`).inputValue(), 'planned');
    for (const section of registered) assert.equal(await page.locator(`#selected-${section.index} .registration-report select`).inputValue(), 'registered');
    await page.getByRole('button', { name: 'Undo applied course alternative' }).click();
    assert.equal(await page.locator(`#selected-${failed.index} .registration-report select`).inputValue(), 'failed');
    await show(page, 'Build');
    assert.equal(await page.locator('.generator-choices').getByText('01:198:112', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.equal(result.schedules[0].selections.length, 4);
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/planner`);
  const course = await search(page, '01:640:251', '01:640:251');
  await course.getByText('Choose a specific section', { exact: true }).click();
  assert.ok(await course.locator('details.section > summary').filter({ hasText: 'Index 15919' }).getByText(/Honors admission requirement/).isVisible());
  await course.locator('.section > summary').first().click();
  await course.getByRole('button', { name: `Choose section ${calculus.sections[0].number}`, exact: true }).click();
  assert.equal(await page.locator('.selected-section').count(), 1);
  await (await search(page, '01:198:112', '01:198:112')).getByRole('button', { name: 'Add course', exact: true }).click();
  const protectedResult = await generate(page);
  assert.ok(protectedResult.schedules.every(s => s.selections.some(item => item.section.id === calculus.sections[0].id)));
  assert.ok(protectedResult.request.constraints.lockedSectionIds.includes(calculus.sections[0].id));
  const manualChoice = page.locator('.generator-choices > li').filter({ hasText: calculus.code });
  await manualChoice.getByLabel(`Keep section ${calculus.sections[0].number} for ${calculus.code}`, { exact: true }).uncheck();
  const flexible = await generate(page);
  assert.equal(flexible.request.constraints.lockedSectionIds.includes(calculus.sections[0].id), false);
  // A preference change makes the preview stale; no result may be applied.
  await page.getByText('Edit schedule preferences', { exact: true }).click();
  await page.getByLabel('Prefer days off', { exact: true }).uncheck();
  assert.equal(await page.getByRole('button', { name: 'Apply this schedule', exact: true }).isDisabled(), true);
  const protectedThree = ['14315', '14411', '14758'].map(index => catalog.flatMap(c => c.sections).find(s => s.index === index));
  const failed = calculus.sections[0];
  const statuses = { [failed.id]: 'failed', ...Object.fromEntries(protectedThree.map(section => [section.id, 'registered'])) };
  await seed(page, [failed, ...protectedThree], statuses, [protectedThree[0].id]);
  assert.equal(await page.locator('.generator-choices > li').count(), 4);
  for (const section of protectedThree) {
    assert.equal(await page.locator('#selected-' + section.index).getByRole('button', { name: 'Remove section ' + section.number }).isDisabled(), true);
  }
  await page.getByRole('button', { name: 'Find a replacement for ' + calculus.code, exact: true }).click();
  const rescue = page.locator('#rescue-panel');
  const guidance = rescue.getByText('Why might registration have failed?', { exact: true });
  const advanced = rescue.getByText('More repair options', { exact: true });
  await guidance.click();
  await rescue.getByText('BetterCSP cannot establish the cause', { exact: false }).waitFor();
  assert.equal(await rescue.getByRole('button', { name: 'Find minimum-change repairs' }).count(), 0);
  await rescue.getByLabel('What went wrong with registration?').selectOption('closed');
  assert.equal(await rescue.getByLabel('Which section is affected?').inputValue(), failed.index);
  await advanced.click();
  const searchRescue = rescue.getByRole('button', { name: 'Find minimum-change repairs', exact: true });
  const savedBefore = await page.evaluate(key => localStorage.getItem(key), key);
  const rescueFailure = route => route.request().postDataJSON().courseFallback ? route.continue()
    : route.fulfill({ status: 503, json: { error: 'Rescue is temporarily unavailable.' } });
  await page.route('**/api/planner/rescue', rescueFailure);
  await searchRescue.click();
  await rescue.getByRole('alert').filter({ hasText: 'Rescue is temporarily unavailable.' }).waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), savedBefore);
  await page.unroute('**/api/planner/rescue', rescueFailure);
  await searchRescue.click();
  await rescue.getByRole('heading', { name: 'Proposed repairs', exact: true }).waitFor();
  await rescue.getByText('1 section changes · 3 unchanged.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const proposals = rescue.getByRole('region', { name: 'Rescue proposals' });
  await proposals.locator('.week-calendar').waitFor();
  await proposals.getByRole('region', { name: 'Weekly calendar', exact: false }).focus();
  assert.equal(await rescue.getByRole('button', { name: 'Apply approved repair' }).isDisabled(), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const section of protectedThree) {
    const row = rescue.getByRole('row').filter({ hasText: section.index });
    assert.match(await row.first().innerText(), /Preserved/);
  }
  await rescue.locator('.calendar-event[data-campus]').first().waitFor();
  await proposals.getByRole('list', { name: 'Calendar campus and availability legend' }).waitFor();
  const applyRepair = rescue.getByRole('button', { name: 'Apply approved repair', exact: true });
  assert.equal(await applyRepair.isDisabled(), true);
  await rescue.getByLabel('I approve the complete before/after', { exact: false }).check();
  await show(page, 'My Schedule');
  await page.locator('#selected-' + failed.index + ' .registration-report select').selectOption('needs-verification');
  await show(page, 'Rescue');
  assert.equal(await applyRepair.isDisabled(), true);
  await show(page, 'My Schedule');
  await page.locator('#selected-' + failed.index + ' .registration-report select').selectOption('failed');
  await show(page, 'Rescue');
  await applyRepair.click();
  await page.getByText('Repair applied to your planner.', { exact: false }).waitFor();
  const applied = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.ok(!applied.sectionIds.includes(failed.id));
  assert.ok(protectedThree.every(section => applied.sectionIds.includes(section.id) && applied.registrationStatuses[section.id] === 'registered'));
  await page.getByRole('button', { name: 'Undo applied repair', exact: true }).click();
  assert.equal(await page.locator('#selected-' + failed.index + ' .registration-report select').inputValue(), 'failed');
  const academic = page.locator('.academic-profile');
  await academic.locator(':scope > summary').click();
  const remember = academic.getByLabel('Remember my academic profile on this browser');
  const updateProfile = academic.getByRole('button', { name: 'Update profile', exact: true });
  assert.equal(await remember.isChecked(), false);
  await academic.getByLabel('Rutgers school', { exact: true }).fill('School of Arts and Sciences');
  await academic.getByLabel('Declared or intended majors').fill('Computer Science');
  await academic.getByLabel('Intended degree type').selectOption('BS');
  await academic.getByLabel('Program or catalog year').fill('2026');
  await academic.getByLabel('Completed courses', { exact: true }).fill('01:198:111');
  await academic.getByLabel('Courses in progress').fill('01:198:112');
  await academic.getByLabel('Planned future courses').fill('01:198:205');
  await academic.getByText('AP, transfer, or equivalent credit', { exact: true }).click();
  await academic.getByRole('button', { name: 'Add equivalent credit' }).click();
  const firstCredit = academic.getByRole('group', { name: 'Credit 1' });
  await firstCredit.getByLabel('Acceptance status').selectOption('rutgers-accepted');
  await firstCredit.getByLabel('Equivalent Rutgers course code', { exact: false }).fill('01:640:151');
  await academic.getByRole('button', { name: 'Add equivalent credit' }).click();
  const otherCredit = academic.getByRole('group', { name: 'Credit 2' });
  await otherCredit.getByLabel('Credit source').selectOption('transfer');
  await otherCredit.getByLabel('Equivalent Rutgers course code', { exact: false }).fill('01:640:152');
  await updateProfile.click();
  await academic.getByRole('status').filter({ hasText: 'Profile updated for this tab.' }).waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), academicKey), null);
  await remember.check();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), academicKey), null);
  await updateProfile.click();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), academicKey);
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.profile.equivalentCredits.map(credit => credit.status), ['rutgers-accepted', 'unverified']);
  await page.reload();
  await academic.locator(':scope > summary').click();
  await academic.getByRole('status').filter({ hasText: 'Profile loaded from this browser.' }).waitFor();
  assert.equal(await academic.getByLabel('Courses in progress').inputValue(), '01:198:112');
  assert.equal(await academic.getByLabel('Intended degree type').inputValue(), 'BS');
  assert.equal(await remember.isChecked(), true);
  await page.route('**/api/planner/generate', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Try again shortly.' }) }));
  const nextRequest = page.waitForRequest(r => r.url().endsWith('/api/planner/generate') && r.method() === 'POST');
  await show(page, 'Build');
  await page.getByRole('button', { name: 'Generate schedules', exact: true }).click();
  const payload = (await nextRequest).postDataJSON().eligibility.profile;
  assert.deepEqual(payload.completedCourses, ['01:198:111']);
  assert.equal(payload.equivalentCredits, undefined);
  assert.equal(payload.inProgressCourses, undefined);
  await page.getByRole('alert').filter({ hasText: 'Try again shortly.' }).waitFor();
  assert.equal(await page.locator('.selected-section').count(), 4);
  await page.unroute('**/api/planner/generate');
  await academic.getByLabel('Declared or intended majors').fill('Mathematics');
  await updateProfile.click();
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).profile.intendedMajors, academicKey), ['Mathematics']);
  await remember.uncheck();
  await updateProfile.click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), academicKey), null);
  assert.equal(await academic.getByLabel('Declared or intended majors').inputValue(), 'Mathematics');
  await remember.check();
  await updateProfile.click();
  const scheduleBeforeClear = await page.evaluate(key => localStorage.getItem(key), key);
  await academic.getByRole('button', { name: 'Clear academic profile' }).click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), academicKey), null);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), scheduleBeforeClear);
  assert.equal(await academic.getByLabel('Declared or intended majors').inputValue(), '');
  const honors = calculus.sections.find(s => s.index === '15919');
  await seed(page, [honors]);
  const preflight = page.locator('#saved-preflight');
  await preflight.getByText('Check registration readiness', { exact: true }).click();
  await preflight.getByRole('heading', { name: /Index 15919/ }).waitFor();
  assert.match(await preflight.getByRole('link', { name: 'Rutgers guidance' }).first().getAttribute('href'), /math.sas.rutgers.edu/);
  await preflight.getByText('Switching sections does not resolve it by itself.', { exact: false }).waitFor();
  await academic.locator(':scope > summary').click();
  await academic.getByLabel('Courses in progress').fill('01:640:152');
  await updateProfile.click();
  await preflight.getByText('In progress in your profile: 01:640:152', { exact: false }).waitFor();
  await academic.getByLabel('Completed courses', { exact: true }).fill('01:640:152');
  await academic.getByLabel('Courses in progress').fill('');
  await updateProfile.click();
  await preflight.getByText('Reported completions match', { exact: false }).waitFor();
  await preflight.getByText('Section restriction · Honors admission requirement', { exact: true }).waitFor();
  const baselineBeforePreflight = await page.evaluate(key => localStorage.getItem(key), key);
  await preflight.getByRole('button', { name: 'See alternate sections' }).click();
  await preflight.getByRole('heading', { name: 'Other sections of 01:640:251' }).waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), baselineBeforePreflight);
  await preflight.getByRole('button', { name: 'Review a repair in Registration Rescue' }).click();
  await guidance.click();
  const reason = rescue.getByLabel('What went wrong with registration?');
  await reason.selectOption('permission');
  assert.equal(await rescue.getByLabel('Which section is affected?').inputValue(), honors.index);
  assert.match(await rescue.getByRole('link', { name: 'Rutgers permission instructions' }).getAttribute('href'), /math.sas.rutgers.edu/);
  assert.equal(await rescue.getByRole('heading', { name: 'Proposed repairs' }).count(), 0);
  await advanced.click();
  await searchRescue.click();
  await rescue.getByRole('heading', { name: 'Proposed repairs', exact: true }).waitFor();
  await reason.selectOption('prerequisite');
  await rescue.getByText('cannot verify the academic record', { exact: false }).waitFor();
  await rescue.getByText('Another section may have the same requirement.', { exact: false }).waitFor();
  assert.equal(await rescue.getByRole('heading', { name: 'Proposed repairs' }).count(), 0);

  await seed(page, [honors]);
  await show(page, 'Build');
  await page.getByLabel(`Keep section ${honors.number} for ${calculus.code}`, { exact: true }).check();
  await generate(page);
  const generatedPreflight = page.locator('.generation-results .registration-preflight');
  await generatedPreflight.locator('summary').first().click();
  await generatedPreflight.getByRole('heading', { name: /Index 15919/ }).waitFor();
  await generatedPreflight.getByRole('button', { name: 'Apply this preview and open Registration Rescue' }).click();
  await rescue.getByLabel('Which section is affected?').waitFor();
  assert.equal(await rescue.getByLabel('Which section is affected?').inputValue(), honors.index);
  assert.equal(await rescue.getByRole('heading', { name: 'Proposed repairs' }).count(), 0);

  await seed(page, [honors], { [honors.id]: 'registered' });
  await preflight.getByText('Check registration readiness', { exact: true }).click();
  await preflight.getByText('This section is protected.', { exact: false }).waitFor();
  assert.equal(await preflight.getByRole('button', { name: 'See alternate sections' }).count(), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const conflictMath = calculus.sections.find(s => s.index === '15897');
  const conflictCs = cs.sections.find(s => s.index === '14332');
  await seed(page, [conflictMath, conflictCs], { [conflictMath.id]: 'registered', [conflictCs.id]: 'registered' });
  await show(page, 'Rescue');
  await rescue.getByLabel('Which section is affected?').selectOption(conflictMath.index);
  await guidance.click();
  await reason.selectOption('conflict');
  await rescue.locator('.schedule-status').getByText(/overlaps.*Eastern/).first().waitFor();
  await rescue.getByRole('button', { name: 'Review protected repair options' }).click();
  await searchRescue.click();
  await rescue.getByRole('heading', { name: 'No repair found under these protections' }).waitFor();
  await rescue.getByText('Explicitly authorize exploring protected changes', { exact: true }).click();
  await rescue.getByLabel('I authorize exploring changes to ' + calculus.code, { exact: false }).check();
  await searchRescue.click();
  await rescue.getByRole('heading', { name: 'Proposed repairs', exact: true }).waitFor();
  await rescue.getByText('1 section changes · 1 unchanged.', { exact: true }).waitFor();
  await rescue.getByLabel('I approve the complete before/after', { exact: false }).check();
  assert.equal(await applyRepair.isDisabled(), true);
  await rescue.getByLabel('I explicitly approve changing protected indexes', { exact: false }).check();
  assert.equal(await applyRepair.isEnabled(), true);
  await applyRepair.click();
  await page.getByText('Earlier registered self-reports need WebReg verification', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Undo applied repair', exact: true }).click();
  assert.equal(await page.locator('#selected-' + conflictMath.index + ' .registration-report select').inputValue(), 'registered');
  const sites = ['ONL', 'BUS', 'CAC', 'DOUGLAS/COOK', 'LIV', 'DNB', 'Rutgers–Camden', 'Rutgers–Newark', 'Unverified site'];
  const colors = ['online', 'busch', 'college-avenue', 'cook-douglass', 'livingston', 'downtown', 'camden', 'newark', 'other'];
  const meeting = calculus.sections[0].meetings[0];
  const meetings = sites.map((campus, i) => ({ ...meeting, campus, timing: 'scheduled', dayCode: 'M', startMinute: 480 + i * 60, endMinute: 537 + i * 60 }));
  meetings.push({ ...meeting, campus: 'ONLINE', timing: 'asynchronous', startMinute: null, endMinute: null });
  await page.route('**/api/planner/sections?*', route => route.fulfill({ json: { selections: [
    { course: calculus, section: { ...calculus.sections[0], meetings, availability: 'closed' } },
  ] } }));
  await seed(page, [calculus.sections[0]]);
  const blocks = page.locator('#manual-schedule .calendar-event');
  assert.equal(await blocks.count(), 9);
  const styling = await blocks.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { campus: element.dataset.campus, outline: style.outlineStyle, bg: style.backgroundColor, text: style.color };
  }));
  assert.deepEqual(styling.map(item => item.campus), colors);
  assert.ok(styling.every(item => item.outline === 'dashed'));
  assert.equal(new Set(styling.map(item => item.bg)).size, 9);
  const luminance = rgb => rgb.match(/\d+/g).map(Number).map(n => n / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  assert.ok(styling.every(item => (luminance(item.bg) + 0.05) / (luminance(item.text) + 0.05) >= 4.5));
  assert.match(await blocks.last().innerText(), /Unverified site[\s\S]*Closed in snapshot/);
  await blocks.first().focus();
  assert.equal(await blocks.first().evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  for (const mode of ['corrupt', 'blocked']) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addInitScript(({ key, mode }) => {
      if (mode === 'corrupt') localStorage.setItem(key, '{"version":9}');
      else {
        for (const method of ['getItem', 'setItem', 'removeItem']) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (name, ...args) {
            if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
            return original.call(this, name, ...args);
          };
        }
      }
    }, { key: academicKey, mode });
    const mobile = await context.newPage();
    await mobile.goto(origin + '/planner');
    const mobileProfile = mobile.locator('.academic-profile');
    await mobileProfile.locator(':scope > summary').click();
    const notice = mode === 'corrupt' ? 'The saved academic profile could not be read.' : 'Browser storage is unavailable.';
    await mobileProfile.getByRole('status').filter({ hasText: notice }).waitFor();
    await mobileProfile.getByLabel('Declared or intended majors').fill('Computer Science');
    await mobileProfile.getByLabel('Remember my academic profile on this browser').check();
    await mobileProfile.getByRole('button', { name: 'Update profile' }).click();
    await mobileProfile.getByRole('status').filter({ hasText: mode === 'blocked' ? 'Profile updated for this tab.' : 'Profile updated and saved' }).waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
  }
  console.log('PASS: desktop/mobile planner navigation and focus, restored flexibility and protections, single-schedule explanations, signed and partial discovery, contextual replacement and retry, clipboard, Preflight, degree-aware alternatives, stale results, approval, undo, and profile privacy.');
} finally { await browser.close(); }
