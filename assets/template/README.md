# __APP_NAME__ — End-to-End Test Suite

Automated tests for __APP_NAME__. **This is an ordinary Playwright project.** It runs on your own machine with no AI, no API keys, and no service other than the website being tested. Generated __DATE__.

## Run it (two commands)

```bash
npm install && npx playwright install chromium
npm test
```

See the results:

```bash
npm run report
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Run every test (desktop + mobile) |
| `npm run test:smoke` | Run only the critical checks — faster |
| `npm run test:headed` | Watch the browser while it tests |
| `npm run test:ui` | Interactive runner: step through tests visually |
| `npm run verify` | Check the project is complete and every scenario is wired up |
| `npm run list` | List all tests without running them |
| `npm run report` | Open the HTML results report |

## What it tests

The scenarios are written in plain English in the `features/` folder. Open any `.feature` file to read exactly what is checked. Ask a developer or the testing agent to change step wording or add scenarios, because each step must match an implementation in `steps/`.

## Testing a different environment

```bash
BASE_URL=https://staging.example.com npm test
```

Or copy `.env.example` to `.env` and set it once. `BASE_URL` controls how relative paths resolve; `START_URL` is the exact page opened by the “open the app” step. Set both when the app lives below `/`.

## Signed-in tests

Put a **test** account (never a personal one) in `.env`:

```
TEST_USER=your-test-user
TEST_PASSWORD=your-test-password
```

## If you see "Access Denied"

Some sites restrict automated browsers. Treat that as an execution limitation, not an application defect. Do not bypass the restriction. Options:

1. Run against staging or a local build: `BASE_URL=http://localhost:3000 npm test`
2. Ask the site operator for an approved test route or allowlist
3. Run an authorized visible session for debugging: `HEADLESS=false npm test`

## Layout

```
features/   Plain-English scenarios — start here
steps/      Code that carries out each step (common.steps.ts works for most apps)
pages/      Page objects — where on-screen elements are defined
support/    Test data and setup hooks
reports/    Results after each run
.github/    Ready-to-use CI workflow
```

Requires Node.js 20 or newer.
