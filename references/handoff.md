# Offline handoff package

Every completed run must leave a self-contained project that a developer can run with no agent involvement and no internet beyond the app under test, the npm registry, and any external systems the app itself uses.

## Required contents

```
<domain>/
├── README.md                 # plain-English: how to run, what each command does
├── package.json              # scripts: test, test:smoke, test:headed, test:ui, report
├── playwright.config.ts
├── tsconfig.json
├── .env.example              # BASE_URL, START_URL, credential placeholders
├── .gitignore                # node_modules, .auth, artifacts, reports, .env
├── features/*.feature        # human-readable scenarios
├── steps/*.ts                # step definitions (must cover EVERY step in features)
├── pages/*.ts                # page objects
├── support/                  # fixtures, test data, global auth setup
├── .github/workflows/e2e.yml # CI: install, run smoke, upload report artifact
└── reports/                  # the plain-English report from this run
```

## Rules

1. **Every Gherkin step must have a matching definition.** Undefined steps make the project useless offline. Verify with `npx bddgen && npx playwright test --list` — the count of listed tests must equal the number of scenarios (x projects).
2. **No agent-only dependencies.** Plain `@playwright/test` + `playwright-bdd` + TypeScript. No API keys, no LLM calls at runtime.
3. **Configurable target.** The base URL comes from `BASE_URL` env var (default to the tested site), so the same suite runs against local, staging, and production.
4. **Two-command start.** README must open with exactly:
   ```
   npm install && npx playwright install chromium
   npm test
   ```
5. **No secrets or session state.** Include `.env.example` only; never include `.env`, `.auth/`, cookies, storage-state files, or screenshots that expose credentials or tokens.
6. **Strip generated dependencies and transient state.** Remove `node_modules`, `.features-gen`, transient HTML/JSON reports, and browser artifacts before zipping. Keep the plain-English Markdown report and intentionally selected, redacted evidence.
7. **State the runtime.** The bundled project requires Node.js 20 or newer.
8. **Keep automation opt-in.** The CI workflow may run on pushes, pull requests, and manual dispatch. Do not add a schedule unless the user asks for recurring execution.

## README tone

Written for a non-technical reader who may forward it to a developer. Include: what this suite tests (a plain-English journey list), how to run it, how to read results (`npm run report` opens the HTML report), how to point it at a different environment, and known limitations such as external services, payments, accounts, or automation restrictions.

## When tests ran via the browser-agent fallback

Still ship the full project, and say plainly in the README which scenarios were manually verified because the current environment could not execute the scripted browser. Do not claim that the generated suite itself passed. Recommend running it against an authorized staging or local environment.
