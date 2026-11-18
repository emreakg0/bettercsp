import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const origin = process.env.PLANNER_URL || 'http://localhost:3000';
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(origin);
    await page.evaluate(() => {
      const sourceId = '2027-1-NB';
      localStorage.setItem('bettercsp:planner:v1:' + sourceId, JSON.stringify({ version: 1, sourceId,
        sectionIds: ['14315', '14411', '14758', '15897'].map(index => sourceId + ':' + index) }));
    });
    await page.goto(origin + '/planner');
    await page.getByRole('button', { name: 'Generate schedules', exact: true }).click();
    const toolbar = page.getByRole('navigation', { name: 'Generated schedule navigation' });
    await toolbar.getByText('Schedule 1 of 10 loaded').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-keyshortcuts') === 'ArrowLeft ArrowRight');
    const calendar = page.locator('.generation-results .calendar-scroll');
    if (width > 760) {
      const box = await calendar.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height + 1, JSON.stringify(box));
    } else {
      assert.ok(await calendar.evaluate(el => el.clientWidth < el.scrollWidth));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    const scroll = await page.evaluate(() => window.scrollY);
    for (let current = 2; current <= 20; current++) {
      await toolbar.press('ArrowRight');
      await toolbar.getByText(new RegExp('^Schedule ' + current + ' of ')).waitFor();
      assert.equal(await page.evaluate(() => window.scrollY), scroll);
    }
    await toolbar.press('ArrowLeft');
    await toolbar.getByText(/^Schedule 19 of /).waitFor();
    const event = calendar.locator('.calendar-event').first();
    await event.press('Enter');
    const details = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close details' }) });
    await details.getByText(/Registration index/).first().waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await details.isVisible(), false);
    assert.equal(await page.evaluate(() => window.scrollY), scroll);
    for (const name of ['Morning plan', 'Alternate week', 'Backup plan']) {
      await page.getByRole('button', { name: 'Save as new named schedule' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save generated schedule' });
      await dialog.getByLabel('Schedule name').fill(name);
      await dialog.getByRole('button', { name: 'Save schedule', exact: true }).click();
      await page.getByRole('status').filter({ hasText: name + ' saved.' }).waitFor();
      await toolbar.getByText(/^Schedule 19 of /).waitFor();
    }
    await page.getByRole('button', { name: 'Expand calendar' }).click();
    assert.ok((await calendar.boundingBox()).height > height);
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    await page.getByRole('button', { name: 'Edit courses' }).click();
    await page.getByLabel('Find a course').waitFor();
    await page.getByRole('button', { name: 'Browse schedules' }).click();
    await toolbar.getByText(/^Schedule 19 of /).waitFor();
    await page.evaluate(() => {
      const sourceId = '2027-1-NB';
      const sectionIds = ['14413', '14786'].map(index => sourceId + ':' + index);
      localStorage.setItem('bettercsp:planner:v1:' + sourceId, JSON.stringify({ version: 1, sourceId, sectionIds, lockedSectionIds: sectionIds }));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Generate schedules', exact: true }).click();
    const early = calendar.getByRole('button', { name: /8:30 AM/ }).first();
    const late = calendar.getByRole('button', { name: /7:45 PM/ }).first();
    await early.waitFor({ state: 'attached' });
    await late.waitFor({ state: 'attached' });
    for (const block of [early, late]) {
      const positioned = await block.evaluate(el => el.offsetTop >= 0 && el.offsetTop + el.offsetHeight <= el.parentElement.offsetHeight + 1);
      assert.ok(positioned);
    }
    console.log(`PASS ${width}×${height}: calendar fit, 20 schedules, stable viewport, keyboard, details, 3 gallery saves, and return to Build.`);
    await page.close();
  }
} finally { await browser.close(); }
