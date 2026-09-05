/**
 * Reusable step library — works on ANY web application.
 *
 * These steps cover the majority of user journeys without app-specific code.
 * Write app-specific steps in `steps/app.steps.ts` only when a journey needs
 * logic these can't express.
 *
 * Locator strategy: accessible roles and labels first (resilient to redesigns),
 * with text and attribute fallbacks so it still works on poorly marked-up apps.
 */
import { createBdd } from 'playwright-bdd';
import { expect, Page, Locator } from '@playwright/test';
import { state } from '../support/world';

const { Given, When, Then } = createBdd();

/* ------------------------- locator helpers ------------------------- */

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const cssAttr = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Anything a user would click, resolved in priority order.
 *
 * Order matters: a page with a heading "Login Page" and a "Login" button must
 * click the button. A plain `.or()` union would pick whichever comes first in
 * the document, so each strategy is tried in turn and the first that matches a
 * visible element wins.
 */
async function resolveClickable(page: Page, name: string): Promise<Locator> {
  const n = rx(name);
  const strategies = (): Locator[] => [
    page.getByRole('button', { name: n }),
    page.getByRole('link', { name: n }),
    page.getByRole('tab', { name: n }),
    page.getByRole('menuitem', { name: n }),
    page.getByRole('checkbox', { name: n }),
    page.getByRole('radio', { name: n }),
    page.locator('button, [role="button"], a, summary').filter({ hasText: n }),
    page.locator(`[aria-label*="${cssAttr(name)}" i], [title*="${cssAttr(name)}" i]`),
    page.getByTestId(name),
    page.getByText(n),
  ];

  // Two passes: the app may still be rendering on the first.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const strategy of strategies()) {
      const visible = strategy.filter({ visible: true }).first();
      if ((await visible.count().catch(() => 0)) > 0) return visible;
    }
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
  }
  // Nothing matched — return the button locator so the failure message is meaningful.
  return page.getByRole('button', { name: n }).first();
}

/** Any input a user would type into, found by label, placeholder, name, or aria-label. */
function field(page: Page, name: string): Locator {
  const n = rx(name);
  return page
    .getByLabel(n)
    .or(page.getByPlaceholder(n))
    .or(page.getByRole('textbox', { name: n }))
    .or(page.locator(`input[name="${cssAttr(name)}" i], textarea[name="${cssAttr(name)}" i]`))
    .or(page.locator(`[aria-label*="${cssAttr(name)}" i]`))
    .or(page.locator(`input[id*="${cssAttr(name)}" i], textarea[id*="${cssAttr(name)}" i]`))
    .first();
}

/** The app's main search box, however it's marked up. */
function searchBox(page: Page): Locator {
  return page
    .getByRole('searchbox')
    .or(page.getByRole('combobox', { name: /search|find/i }))
    .or(page.locator('input[type="search"]'))
    .or(page.locator('input[placeholder*="search" i], input[placeholder*="find" i]'))
    .or(page.locator('input[name*="search" i], input[id*="search" i]'))
    .first();
}

/** Dismiss cookie banners, newsletter popups, and app tours that block interaction. */
export async function dismissOverlays(page: Page): Promise<void> {
  const patterns = [
    /accept (all )?(cookies)?/i,
    /agree|got it|ok, got it|continue/i,
    /no thanks|not now|maybe later|dismiss|skip/i,
    /^close$/i,
  ];
  for (const p of patterns) {
    const btn = page.getByRole('button', { name: p }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await btn.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
    }
  }
  const x = page.locator('[aria-label="Close" i], button.close, [data-dismiss]').first();
  if (await x.isVisible().catch(() => false)) await x.click({ timeout: 3000 }).catch(() => {});
}

async function screenshot(page: Page, label: string): Promise<void> {
  const safe = label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).toLowerCase();
  await page.screenshot({ path: `artifacts/checkpoints/${safe}-${Date.now()}.png` }).catch(() => {});
}

/* ------------------------------ Given ------------------------------ */

Given('I open the app', async ({ page }) => {
  const startUrl = process.env.START_URL || (process.env.BASE_URL ? '/' : '__START_URL__');
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
});

Given('I open the page {string}', async ({ page }, path: string) => {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
});

/** Signs in using TEST_USER / TEST_PASSWORD from the environment. */
Given('I am signed in', async ({ page }) => {
  const user = process.env.TEST_USER;
  const pass = process.env.TEST_PASSWORD;
  expect(user, 'TEST_USER must be set in .env to run signed-in tests').toBeTruthy();
  expect(pass, 'TEST_PASSWORD must be set in .env to run signed-in tests').toBeTruthy();
  const startUrl = process.env.START_URL || (process.env.BASE_URL ? '/' : '__START_URL__');
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  const signInLink = await resolveClickable(page, 'sign in');
  if (await signInLink.isVisible().catch(() => false)) {
    await signInLink.click();
  } else {
    const logInLink = await resolveClickable(page, 'log in');
    if (await logInLink.isVisible().catch(() => false)) await logInLink.click();
  }
  await field(page, 'username').or(field(page, 'email')).first().fill(user!);
  await field(page, 'password').fill(pass!);
  await (await resolveClickable(page, 'log in')).click();
  await page.waitForLoadState('domcontentloaded');
});

/* ------------------------------- When ------------------------------ */

When('I click {string}', async ({ page }, name: string) => {
  const target = await resolveClickable(page, name);
  await target.click();
});

When('I fill {string} with {string}', async ({ page }, name: string, value: string) => {
  await field(page, name).fill(value);
});

When('I type {string} into {string}', async ({ page }, value: string, name: string) => {
  const f = field(page, name);
  await f.click();
  await f.pressSequentially(value, { delay: 80 });
});

When('I search for {string}', async ({ page }, term: string) => {
  const box = searchBox(page);
  await box.click();
  await box.fill(term);
  await box.press('Enter');
  await page.waitForLoadState('domcontentloaded');
});

When('I select {string} from the dropdown', async ({ page }, option: string) => {
  const select = page.locator('select').first();
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption({ label: option }).catch(async () => {
      await select.selectOption(option);
    });
  } else {
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: rx(option) }).first().click();
  }
});

When('I select {string} from {string}', async ({ page }, option: string, name: string) => {
  const select = page.getByLabel(rx(name)).or(page.locator(`select[name="${cssAttr(name)}" i]`)).first();
  await select.selectOption({ label: option });
});

When('I check {string}', async ({ page }, name: string) => {
  await page.getByRole('checkbox', { name: rx(name) }).first().check();
});

When('I go back', async ({ page }) => {
  await page.goBack({ waitUntil: 'domcontentloaded' });
});

When('I remember the text of {string}', async ({ page }, name: string) => {
  const target = await resolveClickable(page, name);
  state.remembered[name] = ((await target.textContent()) || '').trim();
});

When('I wait for the page to settle', async ({ page }) => {
  await page.waitForLoadState('networkidle').catch(() => {});
});

/* ------------------------------- Then ------------------------------ */

Then('I see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(rx(text)).first()).toBeVisible({ timeout: 20000 });
  await screenshot(page, `see-${text}`);
});

Then('I do not see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(rx(text)).first()).toBeHidden();
});

Then('I see the {string} field', async ({ page }, name: string) => {
  await expect(field(page, name)).toBeVisible({ timeout: 15000 });
});

Then('I see the {string} button', async ({ page }, name: string) => {
  await expect(page.getByRole('button', { name: rx(name) }).first()).toBeVisible({ timeout: 15000 });
});

Then('the page title contains {string}', async ({ page }, fragment: string) => {
  // Tolerate typographic apostrophes and quotes that differ from plain text.
  const pattern = fragment
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['\u2019\u2018\u00b4`]/g, "['\u2019\u2018\u00b4`]");
  await expect(page).toHaveTitle(new RegExp(pattern, 'i'));
});

Then('the URL contains {string}', async ({ page }, fragment: string) => {
  await expect(page).toHaveURL(rx(fragment));
});

Then('I see at least {int} results', async ({ page }, min: number) => {
  // Only count elements a user can actually see — hidden templates and offscreen
  // containers match these selectors on many apps.
  const candidates = page
    .locator('main li, [role="listitem"], [class*="card" i], [class*="item" i], [class*="product" i], article')
    .filter({ visible: true });
  await expect
    .poll(async () => candidates.count(), {
      timeout: 25000,
      message: `expected at least ${min} visible results on the page`,
    })
    .toBeGreaterThanOrEqual(min);
  await screenshot(page, 'results-list');
});

Then('I see prices', async ({ page }) => {
  const body = (await page.locator('main, body').first().textContent()) || '';
  expect(body).toMatch(/[$£€₹]\s?\d/);
});

Then('the page has no obvious error', async ({ page }) => {
  const body = (await page.locator('body').textContent()) || '';
  expect(
    body,
    'page shows an error message'
  ).not.toMatch(/access denied|something went wrong|internal server error|http 500|unexpected error|page not found|404 error/i);
});

Then('the page loads successfully', async ({ page }) => {
  await expect(page.locator('body')).toBeVisible();
  const body = (await page.locator('body').textContent()) || '';
  expect(body.trim().length, 'page appears blank').toBeGreaterThan(50);
});

Then('I see an error message containing {string}', async ({ page }, fragment: string) => {
  const wanted = rx(fragment);
  // Match the error element that actually carries the text — apps often render
  // several empty error containers alongside the real one.
  const err = page
    .getByRole('alert')
    .or(page.locator('[class*="error" i], [data-test*="error" i], [role="status"], [aria-live]'))
    .or(page.getByText(wanted))
    .filter({ hasText: wanted })
    .first();
  await expect(err).toBeVisible({ timeout: 15000 });
  await screenshot(page, `error-${fragment}`);
});

Then('the results relate to {string}', async ({ page }, term: string) => {
  const body = ((await page.locator('main, body').first().textContent()) || '').toLowerCase();
  const words = term.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  expect(words.some((w) => body.includes(w)), `results should mention "${term}"`).toBeTruthy();
});

Then('the page works on mobile', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 20
  );
  expect(overflow, 'page scrolls sideways on a phone screen').toBeFalsy();
});

/* ------------------- grouped controls (combinatorial) ------------------ */
/*
 * These steps drive a named GROUP of related controls — a set of radio buttons
 * sharing a name, a dropdown and its options, or a checkbox group. They are what
 * the generated combinatorial Scenario Outlines use, so the Examples table can
 * hold every combination without any app-specific code.
 *
 * The group is identified by whatever is most stable: name attribute, id,
 * label text, fieldset legend, or aria-label.
 */

const attr = cssAttr;

/** Find the <select> that represents a named group. */
function selectFor(page: Page, group: string): Locator {
  return page
    .locator(`select[name="${attr(group)}"], select[id="${attr(group)}"], select[data-testid="${attr(group)}"]`)
    .or(page.getByLabel(rx(group)).and(page.locator('select')))
    .first();
}

/** Find one option within a radio/checkbox group. */
function optionIn(page: Page, group: string, value: string, type: 'radio' | 'checkbox'): Locator {
  return page
    .locator(`input[type="${type}"][name="${attr(group)}"][value="${attr(value)}"]`)
    .or(page.locator(`input[type="${type}"][name="${attr(group)}"][id="${attr(value)}"]`))
    .first();
}

When('I set {string} to {string}', async ({ page }, group: string, value: string) => {
  // 1. Radio button identified by group name + option value.
  const radio = optionIn(page, group, value, 'radio');
  if ((await radio.count()) > 0) {
    await radio.check();
    return;
  }

  // 2. Dropdown identified by name/id/label.
  const select = selectFor(page, group);
  if ((await select.count()) > 0) {
    try {
      await select.selectOption({ label: value });
    } catch {
      await select.selectOption(value);
    }
    return;
  }

  // 3. Radio by its own accessible name, scoped to a fieldset/radiogroup labelled `group`.
  const scope = page
    .locator('fieldset', { has: page.locator('legend', { hasText: rx(group) }) })
    .or(page.getByRole('radiogroup', { name: rx(group) }))
    .first();
  if ((await scope.count()) > 0) {
    const scoped = scope.getByRole('radio', { name: rx(value) }).first();
    if ((await scoped.count()) > 0) {
      await scoped.check();
      return;
    }
  }

  // 4. Custom (non-native) dropdown: open it, then pick the option.
  const combo = page.getByRole('combobox', { name: rx(group) }).or(page.getByLabel(rx(group))).first();
  if ((await combo.count()) > 0) {
    await combo.click();
    await page.getByRole('option', { name: rx(value) }).first().click();
    return;
  }

  throw new Error(`Could not find a control group called "${group}" to set to "${value}"`);
});

/** Resolve one checkbox inside a group, by value, accessible name, or position ("#2"). */
async function checkboxIn(page: Page, group: string, value: string): Promise<Locator> {
  const byValue = optionIn(page, group, value, 'checkbox');
  if ((await byValue.count()) > 0) return byValue;

  const scope = page
    .locator('fieldset', { has: page.locator('legend', { hasText: rx(group) }) })
    .or(page.getByRole('group', { name: rx(group) }))
    .first();
  if ((await scope.count()) > 0) {
    const scopedByName = scope.getByRole('checkbox', { name: rx(value) }).first();
    if ((await scopedByName.count()) > 0) return scopedByName;
  }

  const byName = page.getByRole('checkbox', { name: rx(value) }).first();
  if ((await byName.count()) > 0) return byName;

  // Positional fallback for checkboxes with no name, value, or label.
  const ordinal = value.match(/^#?(\d+)$/);
  if (ordinal) {
    const named = page.locator(`input[type="checkbox"][name="${attr(group)}"]`);
    const scoped = (await scope.count()) > 0 ? scope.locator('input[type="checkbox"]') : page.locator('input[type="checkbox"]');
    const pool = (await named.count()) > 0 ? named : scoped;
    return pool.nth(Number(ordinal[1]) - 1);
  }
  return byValue;
}

When('I set the checkbox {string} in {string} to {string}', async ({ page }, value: string, group: string, desired: string) => {
  const box = await checkboxIn(page, group, value);
  if (/^(checked|on|yes|true)$/i.test(desired.trim())) await box.check();
  else await box.uncheck();
});

Then('{string} is set to {string}', async ({ page }, group: string, value: string) => {
  const radio = optionIn(page, group, value, 'radio');
  if ((await radio.count()) > 0) {
    await expect(radio).toBeChecked();
    return;
  }

  const select = selectFor(page, group);
  if ((await select.count()) > 0) {
    const selectedLabel = await select.evaluate(
      (el) => (el as HTMLSelectElement).options[(el as HTMLSelectElement).selectedIndex]?.textContent?.trim() ?? ''
    );
    const selectedValue = await select.inputValue();
    expect(
      selectedLabel === value || selectedValue === value,
      `"${group}" should be set to "${value}" but shows "${selectedLabel}"`
    ).toBeTruthy();
    return;
  }

  const accessibleRadio = page.getByRole('radio', { name: rx(value) }).first();
  if ((await accessibleRadio.count()) > 0) {
    await expect(accessibleRadio).toBeChecked();
    return;
  }
  await expect(page.getByRole('option', { name: rx(value), selected: true }).first()).toBeVisible();
});

Then('the checkbox {string} in {string} is {string}', async ({ page }, value: string, group: string, desired: string) => {
  const box = await checkboxIn(page, group, value);
  if (/^(checked|on|yes|true)$/i.test(desired.trim())) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
});

Then('every option of {string} is available', async ({ page }, group: string) => {
  const select = selectFor(page, group);
  if ((await select.count()) > 0) {
    const count = await select.locator('option').count();
    expect(count, `"${group}" should offer choices`).toBeGreaterThan(1);
    return;
  }
  const radios = page.locator(`input[type="radio"][name="${attr(group)}"]`);
  expect(await radios.count(), `"${group}" should offer choices`).toBeGreaterThan(1);
});
