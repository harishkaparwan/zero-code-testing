# Zero-Code E2E Runner

This repository lets a user describe an authorized web application in YAML, provide role credentials through local secrets, and have an AI coding agent generate a reusable Playwright E2E suite. The suite executes in a pinned Docker image, so routine runs do not require AI tokens.

## Quick start

```bash
cp .env.example .env
npm install
npm run validate:config
npm run preflight
```

`preflight` starts Chromium in the pinned Playwright container and verifies the configured public/start pages are reachable and rendered. It writes a short-lived result and screenshots under `reports/preflight/`. Test scaffolding is blocked until that result passes.

Open this repository in Windsurf and ask the agent to use `SKILL.md` and build the suite from `e2e.config.yaml`. It will place generated tests under `suite/` only after the preflight gate passes.

Once the suite exists:

```bash
npm run sync
npm run coverage:check
npm run run:smoke
npm run run
```

`run:smoke` executes critical tagged journeys. `run` executes the full generated suite. Reports and screenshots remain under `suite/reports/` and `suite/artifacts/`.

The runner repeats preflight before test execution by default. Set `preflight.run_before_execution: false` only when an external CI health gate provides equivalent protection; generation still requires a fresh local preflight report.

## Preflight configuration

Add one entry for every page that must be available before tests are generated:

```yaml
preflight:
  enabled: true
  timeout_ms: 30000
  max_age_minutes: 30
  run_before_execution: true
  screenshot: true
  allowed_redirect_origins: []
  pages:
    - id: login
      path: /login
      status_range: [200, 399]
      expect:
        selector: 'input[type="password"]'
        title_contains: Sign in
```

Keep console/subresource failures non-blocking unless the application is expected to load without third-party noise. If SSO redirects to another origin, add only that authorized identity-provider origin to `allowed_redirect_origins`.

## Keeping tests current

Run this whenever the application may have changed:

```bash
npm run sync
```

The sync command runs preflight, crawls only the configured safe paths with GET navigation, and compares semantic page structure with the reviewed baseline. It creates:

```text
reports/sync/current-inventory.json
reports/sync/change-report.json
reports/sync/change-report.md
```

The report identifies added, removed, and changed pages; changed controls/forms/tables; potentially impacted journey IDs; and changed paths with no journey mapping. It deliberately does not collect field values, cookies, full page text, or credentials.

After reviewing the report, update only affected tests and run the regression suite. Then accept the new state:

```bash
npm run sync:accept
```

This writes `.e2e/baseline/inventory.json`, which should be committed when the repository is private or its route/control metadata is safe to disclose. Review it before publishing a public repository. CI can use `npm run sync:check` to fail when structural drift is detected. Known timestamps or build identifiers can be removed from comparisons through `discovery.ignore_text_patterns`.

Discovery is anonymous by default. Applications whose feature navigation appears only after login need either explicit reachable `discovery.start_paths` or a future application-specific authenticated discovery adapter; the utility will not guess a login flow or send credentials to AI.

## Secrets

Use dedicated test accounts only. `.env` is ignored by Git and passed to Docker at runtime. Never put passwords directly in `e2e.config.yaml`, a feature file, a Dockerfile, a screenshot, or a committed browser-state file.

## Model usage

The model policy in `e2e.config.yaml` is intentionally separate from test execution:

- Code generation can use a free/local model when the host supports one.
- Existing test execution is deterministic and model-free.
- Failure analysis can use a low-cost model optionally.
- High-reasoning models are an opt-in escalation path for novel workflows.

Windsurf model selection may still be controlled by its own UI or supported integration. The YAML records the intended policy; it cannot override an editor setting that has no public configuration interface.

## Container notes

The Dockerfile uses `mcr.microsoft.com/playwright:v1.63.0-noble`. Keep that tag synchronized with `@playwright/test` in the generated suite. The official Playwright image includes browsers and system dependencies; the suite's npm dependencies are installed at container start.

The default compose service uses `ipc: host`, a disposable container, and private named volumes for `node_modules` and generated BDD files. The suite directory is mounted so reports persist locally.

## Coverage expectations

The journey list is the business-feature manifest. Every configured ID must tag at least one feature. Review role coverage, state transitions, negative cases, and table behavior separately; control-value coverage alone does not prove feature coverage.

For a new web application, clone the repository, configure one YAML file, add credentials locally, run preflight, and let Windsurf generate the tests.

## 1. Clone and install

Requirements:

- Node.js 20+
- Docker Desktop running
- Windsurf or another coding agent

```bash
git clone https://github.com/harishkaparwan/zero-code-testing.git
cd zero-code-testing
npm install
cp .env.example .env
```

## 2. Configure the application

Edit `e2e.config.yaml`:

```yaml
app:
  name: my-web-application
  url: https://staging.myapp.com
  start_url: https://staging.myapp.com/login
  environment: staging

  # Set true only when you are authorized to create/edit data.
  authorization_confirmed: true

preflight:
  enabled: true
  timeout_ms: 30000
  max_age_minutes: 30
  run_before_execution: true
  screenshot: true
  fail_on_console_errors: false
  fail_on_request_errors: false
  allowed_redirect_origins: []

  pages:
    - id: login-page
      path: /login
      status_range: [200, 399]
      expect:
        selector: 'input[type="password"]'

discovery:
  enabled: true
  max_pages: 30
  follow_links: true
  start_paths: [/login]
  include_path_prefixes: [/]
  exclude_path_patterns:
    - /logout
    - /delete
    - /checkout
  ignore_text_patterns: []
  timeout_ms: 30000

roles:
  - name: creator
    username_env: E2E_CREATOR_USERNAME
    password_env: E2E_CREATOR_PASSWORD

  - name: approver
    username_env: E2E_APPROVER_USERNAME
    password_env: E2E_APPROVER_PASSWORD

journeys:
  - id: item-create
    role: creator
    mutates: true
    paths: [/items, /items/new]
    description: Create an a new item and verify it appears in the table.
    tags: [smoke, regression]

  - id: item-approve
    role: approver
    mutates: true
    paths: [/items]
    description: Approve a a pending item and verify its status.
    tags: [smoke, regression]

  - id: item-table
    role: creator
    mutates: false
    paths: [/items]
    description: Verify table columns, filters, sorting and pagination.
    tags: [regression]
```

## 3. Add credentials

Edit `.env`:

```dotenv
E2E_CREATOR_USERNAME=creator@example.com
E2E_CREATOR_PASSWORD=creator-password

E2E_APPROVER_USERNAME=approver@example.com
E2E_APPROVER_PASSWORD=approver-password
```

Never commit `.env`.

## 4. Validate and and run preflight

```bash
npm run validate:config
npm run preflight
```

Preflight must pass before test generation. Results appear under:

```text
reports/preflight/
```

## 5. Generate tests with Windsurf

Open the repository in Windsurf and enter:

```text
Use $zero-code-e2e-runner.

Read SKILL.md and e2e.config.yaml. Run validation configuration validation and and
browser preflight. Explore the authorized staging application, generate the
Playwright BDD suite under suite/, cover every configured journey and role,
then run the coverage gate and smoke tests.

Do not print credentials or perform operations outside the configured journeys.
```

Windsurf will create:

```text
suite/
├── features/
├── pages/
├── steps/
├── support/
├── playwright.config.ts
└── package.json
```

## 6. Run tests

```bash
npm run coverage:check
npm run run:smoke
npm run run
```

Reports and evidence are stored under:

```text
suite/reports/html/
suite/reports/last-run.json
suite/artifacts/
```

## 7. Save the initial application baseline

After all generated tests pass:

```bash
npm run sync
npm run sync:accept
git add .
git commit -m "test: add E2E coverage for my application"
```

For future application releases:

```bash
git pull
npm install
npm run sync
```

Then review `reports/sync/change-report.md`, update only impacted tests, run regression, and execute `npm run sync:accept`.