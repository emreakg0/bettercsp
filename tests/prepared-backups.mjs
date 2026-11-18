// Run against the production build with the same browser settings as planner-ux.mjs.
import assert from 'node:assert/strict';
import { parseAcademicProfile, serializeAcademicProfile } from '../lib/academic/profile.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const origin = process.env.PLANNER_URL || 'http://localhost:3000';
const sourceId = '2027-1-NB';
const draftKey = 'bettercsp:planner:v1:' + sourceId, cacheKey = 'bettercsp:prepared:v1:' + sourceId;
const indexes = ['14315', '14411', '14758', '15897'];
const statuses = ['01:198:112', '01:198:205', '01:355:101'];
const calculus = '01:640:251';
const prepTimes = [], failureTimes = [];

try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const profile = serializeAcademicProfile(parseAcademicProfile({ school: 'SAS', intendedMajors: ['Computer Science'], degreeType: 'BA', catalogYear: 2026 }));
    await page.evaluate(({ profile, key, draft }) => {
      localStorage.setItem('bettercsp:academic-profile:v1', profile);
      localStorage.setItem(key, JSON.stringify(draft));
    }, { profile, key: draftKey, draft: { version: 1, sourceId, sectionIds: indexes.map(index => sourceId + ':' + index),
      lockedSectionIds: [sourceId + ':14758'] } });
    await page.goto(origin + '/planner?view=schedule');
    const preparation = page.getByRole('region', { name: 'Registration backups' });
    const prepare = preparation.getByRole('button', { name: 'Prepare registration backups', exact: true });
    const mode = preparation.getByRole('button', { name: 'Registration Mode', exact: true });
    const failed = code => preparation.getByRole('button', { name: 'Couldn’t register for ' + code, exact: true });
    const alternatives = code => preparation.getByRole('region', { name: 'Backups for ' + code });
    const review = alternatives(calculus).getByRole('button', { name: /^Review section/ }).first();
    let rescueRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/planner/rescue')) rescueRequests++; });
    if (width === 1440) {
      const unavailable = route => route.fulfill({ status: 503, json: { error: 'Preparation temporarily unavailable.' } });
      await page.route('**/api/planner/rescue', unavailable);
      await prepare.click();
      await preparation.getByRole('alert').getByText(/Preparation temporarily unavailable/).waitFor();
      await page.unroute('**/api/planner/rescue', unavailable);
    }
    const beforePrep = rescueRequests;
    const sent = page.waitForResponse(response => response.url().endsWith('/api/planner/rescue'));
    const started = performance.now();
    await prepare.click();
    const response = await sent;
    assert.equal(response.status(), 200);
    assert.equal(rescueRequests - beforePrep, 1);
    assert.equal(response.request().postDataJSON().prepareBackups.length, 3);
    assert.ok(!response.request().postDataJSON().prepareBackups.some(item => item.targetId.endsWith(':14758')));
    await preparation.getByText(/Backups checked for 3 sections/).waitFor();
    const cache = await page.evaluate(key => sessionStorage.getItem(key), cacheKey);
    assert.ok(cache && !cache.includes('intendedMajors'));
    prepTimes.push({ width, milliseconds: Math.round(performance.now() - started), cacheBytes: Buffer.byteLength(cache) });

    await mode.press('Enter');
    for (const code of statuses) await preparation.getByRole('button', { name: 'Registered successfully for ' + code, exact: true }).click();
    const before = rescueRequests;
    await failed(calculus).evaluate(button => {
      window.preparedTiming = new Promise((resolve, reject) => {
        let started;
        const timeout = setTimeout(() => reject(new Error('Prepared option was not rendered after failure')), 8000);
        const observer = new MutationObserver(() => {
          const option = document.querySelector('[aria-label="Backups for 01:640:251"] button[aria-label^="Review section"]');
          if (option && started !== undefined) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve(performance.now() - started);
          }
        });
        observer.observe(document.querySelector('#registration-mode'), { childList: true, subtree: true });
        button.addEventListener('click', () => { started = performance.now(); }, { capture: true, once: true });
      });
    });
    await failed(calculus).click();
    await alternatives(calculus).getByText('Prepared alternatives for ' + calculus, { exact: true }).waitFor();
    await alternatives(calculus).getByRole('heading', { name: 'Other sections of ' + calculus }).waitFor();
    await alternatives(calculus).getByRole('heading', { name: 'Courses that may advance your degree' }).waitFor();
    failureTimes.push({ width, milliseconds: Number((await page.evaluate(() => window.preparedTiming)).toFixed(2)) });
    assert.equal(rescueRequests, before);
    await review.press('Enter');
    await alternatives(calculus).getByRole('heading', { name: 'Review before applying' }).waitFor();
    const apply = alternatives(calculus).getByRole('button', { name: 'Apply approved replacement' });
    assert.equal(await apply.isDisabled(), true);
    await alternatives(calculus).getByLabel(/I approve this planner change/).check();
    await apply.click();
    await page.getByText(/Alternative applied to your planner/).waitFor();
    await page.waitForFunction(key => !JSON.parse(localStorage.getItem(key)).sectionIds.some(id => id.endsWith(':15897')), draftKey);
    const repaired = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey);
    for (const index of indexes.slice(0, 3)) assert.equal(repaired.registrationStatuses[sourceId + ':' + index], 'registered');
    assert.deepEqual(repaired.lockedSectionIds, [sourceId + ':14758']);
    await page.getByRole('button', { name: 'Undo applied course alternative' }).click();
    await page.locator('#selected-15897').waitFor();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).sectionIds.some(id => id.endsWith(':15897')), draftKey);
    await page.reload();
    await preparation.getByText(/Backups checked for 3 sections/).waitFor();
    await mode.click();
    await failed(calculus).click();
    await review.waitFor();
    assert.equal(rescueRequests, before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await page.locator('#selected-14411 .registration-report select').selectOption('planned');
    await failed('01:198:205').click();
    await alternatives('01:198:205').getByText(/Other failed sections stay in this preview/).waitFor();
    assert.equal(rescueRequests, before);
    const academic = page.locator('.academic-profile');
    await academic.locator('summary').first().click();
    await academic.getByLabel('Program or catalog year').fill('2025');
    await academic.getByRole('button', { name: 'Update profile' }).click();
    await alternatives('01:198:205').getByText(/No current backups for this plan/).waitFor();
    assert.equal(rescueRequests, before);
    await page.evaluate(key => sessionStorage.setItem(key, '{broken'), cacheKey);
    await page.reload();
    await mode.click();
    await failed(calculus).click();
    await alternatives(calculus).getByText(/No current backups for this plan/).waitFor();
    assert.equal(rescueRequests, before);
    await alternatives(calculus).getByRole('button', { name: 'Search in Registration Rescue' }).click();
    await page.getByRole('heading', { name: 'Registration Rescue', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Other sections of ' + calculus }).waitFor();
    assert.equal(rescueRequests, before + 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: prepared four-course registration on desktop/mobile, 3 protected reports, locked targets, multiple failures, profile and cache invalidation, reload, server failure and on-demand recovery, approval and undo.');
  console.log(JSON.stringify({ prepare: prepTimes, clickToPreparedOption: failureTimes }));
} finally { await browser.close(); }
