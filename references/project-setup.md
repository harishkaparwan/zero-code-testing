# Playwright BDD project conventions

Read this when generating or extending a suite. The bundled scaffold is the source of truth for versions and baseline configuration.

## Create the project

Run the scaffold from the skill directory and use an empty destination:

```bash
node <skill-dir>/scripts/scaffold.mjs <url> e2e-agent/<domain>
cd e2e-agent/<domain>
npm install
npx playwright install chromium
```

Node.js 20 or newer is required by the bundled `playwright-bdd` version.

## Layout

```text
e2e-agent/<domain>/
├── package.json
├── playwright.config.ts
├── sitemap.json
├── inventory.json
├── features/
├── steps/
├── pages/
├── support/
├── .auth/
├── reports/
└── artifacts/
```

`sitemap.json` and `inventory.json` are exploration inputs, not executable tests. `.auth/`, `.env`, generated tests, browser artifacts, and session-bearing reports must remain ignored and must not be distributed.

## Step definition conventions

```ts
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Then } = createBdd();

Then('I should see the order confirmation', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /order confirmed/i })).toBeVisible();
});
```

- Reuse `steps/common.steps.ts` before adding a new phrase. `npx bddgen export` can list available definitions.
- Prefer `getByRole`, `getByLabel`, and `getByTestId`; use CSS only when necessary and XPath only as a last resort.
- Use web-first assertions and wait for visible application state, requests, responses, downloads, or URLs. Do not use fixed timeouts as a substitute for readiness.
- Add page objects for complex, repeated page behavior, not as one-to-one wrappers around every locator.
- Keep tests independent and safe to retry. Use deterministic fixtures and unique values for records the test is allowed to create.

## Authentication

The generic `Given I am signed in` step is a fallback and signs in through the UI. For a stable app-specific suite, create an authentication setup project, save state under `.auth/user.json`, and make browser projects depend on it.

Authentication state can contain impersonation-capable cookies and headers. Keep `.auth/` in `.gitignore`, never place it in the ZIP, and regenerate it when expired. Use separate accounts when parallel tests mutate server-side state.

## Run order

```bash
npm run verify
npm run test:smoke
npm test
```

Use the JSON report to build the user-facing summary. Do not paste raw test output into a report for a non-technical user.
