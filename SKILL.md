---
name: zero-code-e2e-runner
description: Build and run authorized, generic web-app E2E tests from e2e.config.yaml. Use when a user wants to test an application URL with role-based accounts and plain-English journeys, generate a reusable Playwright suite, and execute it in Docker. Do not use for penetration testing, load testing, or unauthorized targets.
metadata:
  author: hkaparwan
  version: "0.3.0"
---

# Zero-Code E2E Runner

This repository is the controller for a portable, zero-code-for-the-user E2E workflow. The user edits `e2e.config.yaml` and supplies secret values through `.env`; the agent generates the underlying Playwright/BDD suite in `suite/`. Routine execution is deterministic and does not require an AI model.

## Read before acting

1. Read `e2e.config.yaml`.
2. Run `npm run validate:config`.
3. Run `npm run preflight` before exploring, inventorying, or generating any test code. Stop if it fails.
4. Never print or commit values from `.env`.
5. Confirm the target is authorized. Prefer staging, preview, or local environments.
6. Treat production as read-only. Do not make purchases, send messages, delete records, change permissions, or create real accounts without explicit authorization for that action class and safe test data.

## Model policy

The YAML model policy is provider-neutral. Use a free/local model for code generation when the host supports it. Use `none/deterministic` for test execution. Use a low-cost model only for optional failure classification or report wording. Escalate to a high-reasoning model only for a genuinely new or ambiguous workflow after the configured number of failed repair attempts.

Windsurf may require the user to choose the active model in its UI; a repository YAML file cannot force a proprietary editor setting unless Windsurf exposes a supported model-routing interface. The policy must therefore be treated as an orchestrator contract, not as proof that a particular model was selected.

Never send credentials, session state, or unnecessary page content to an AI provider. Keep expected statuses, role permissions, destructive-action decisions, and pass/fail assertions deterministic.

## Configuration contract

`e2e.config.yaml` defines:

- `app`: name, URL, exact start page, environment, and authorization confirmation.
- `preflight`: mandatory browser reachability pages, redirect allowlist, timeouts, rendering expectations, and evidence policy.
- `discovery`: read-only crawl boundaries, page limit, excluded routes, and patterns for suppressing known dynamic text.
- `roles`: role names plus `username_env` and `password_env` references. Raw credentials are forbidden.
- `journeys`: business capabilities, relevant paths, role, mutation flag, description, and tags. Every journey ID must appear as a tag in at least one generated `.feature` file.
- `model_policy`: code-generation, execution, failure-analysis, and escalation providers/models.
- `execution`: safe mode, browser, workers, retries, and smoke/full mode.

The supplied example describes offer creation, editing, approval, cancellation, and table verification. Replace it with the target application's journeys; do not assume those rules apply to every application.

## Preflight gate

Run the containerized Chromium check before application exploration or suite generation:

```bash
npm run preflight
```

Each configured preflight page must resolve, return an allowed main-document status, remain on the app origin or an explicitly allowed redirect origin, render a visible expected selector, and meet its minimum DOM size. Optional title/text expectations make the check more application-specific. Console and subresource failures are recorded but do not fail the gate unless the YAML explicitly enables those policies.

The command writes `reports/preflight/report.json` and redacted screenshots. `scripts/scaffold.mjs` verifies that this report passed, matches the current YAML hash, and has not expired. Never fabricate or manually mark a preflight report as passed. A preflight failure is an environment/configuration blocker, not an application feature defect; do not generate speculative scenarios from an unavailable page.

## Generate the suite

Use the bundled scripts, writing only into the empty `suite/` directory:

```bash
node scripts/scaffold.mjs <url> suite
node scripts/explore.mjs <url>
node scripts/inventory.mjs <url> --paths /a,/b --out inventory.json
```

`scripts/scaffold.mjs` refuses to generate the suite unless the current configuration has a fresh passing preflight report.

## Synchronize application changes

After the initial suite exists, run this before asking an AI to update tests:

```bash
npm run sync
```

The command repeats preflight, performs a read-only semantic crawl, and compares routes, headings, controls, forms, tables, and links with `.e2e/baseline/inventory.json`. It records only structural metadata—never input values, page body text, cookies, or credentials. Review `reports/sync/change-report.md` and update only the listed or genuinely impacted journeys. Treat changed paths without a journey mapping as a coverage question for the user, not automatically as a defect.

Do not regenerate the entire suite for an ordinary application change. Preserve custom steps and update the smallest affected feature/page/step set. Execute existing tests first when the change report is empty. Use a model only when code must be generated or repaired; inventory comparison and unchanged regression execution are deterministic.

After the affected tests and full regression pass, explicitly record the reviewed state:

```bash
npm run sync:accept
```

This command checks configured journey coverage when a suite exists and then updates the committed baseline. Never accept a baseline containing unavailable pages. In CI, `npm run sync:check` returns a nonzero status when structural drift or unavailable pages are detected.

Then write features from the journey descriptions. Use the reusable steps and references in this repository. Add app-specific steps only when generic roles, labels, tables, or state assertions cannot express the behavior. Tag each feature with the configured journey ID, for example `@offer-approve`.

For control combinations, run `scripts/combos.mjs` and include the generated coverage matrix. Do not describe control-selection coverage as proof of business correctness; add an explicit outcome assertion after save, approve, or cancel.

For authentication, use separate role sessions and app-specific setup when possible. Keep `.auth/` ignored and out of artifacts. SSO, MFA, passkeys, CAPTCHA, and unusual custom controls may require a manual session or adapter.

## Coverage gate

Before execution, run:

```bash
npm run coverage:check
```

This fails when a configured journey has no matching feature tag. It is a minimum traceability gate, not a substitute for reviewing role/state coverage and expected outcomes.

## Execute in Docker

Create the local secret file once, then validate and run:

```bash
cp .env.example .env
npm install
npm run validate:config
npm run preflight
npm run sync
npm run run:smoke
npm run run
```

The root runner validates the configuration and coverage manifest, blocks unauthorized mutating journeys in safe mode, then starts the pinned Playwright container. It mounts `suite/` so reports and generated tests remain available on the host. The image version must match the Playwright version in `suite/package.json`.

The container is the execution boundary. It installs the generated suite's npm dependencies, runs `bddgen` and Playwright, and returns the exit code. It does not call an AI service.

## Results and reruns

Read the generated suite's Markdown/HTML/JSON reports. On a rerun, execute the existing suite first. Re-explore or invoke AI only for changed pages, missing coverage, or reproducible failures. Keep reports free of passwords, tokens, payment data, and personal information.

## Safe genericity boundary

The utility can generically discover and validate user-visible web behavior, but URL + credentials + role cannot reveal every business rule. A complete pre-production check needs the user's journey manifest, expected state transitions, safe test data, and cleanup strategy. Never convert an uncertain expectation into an application defect.
