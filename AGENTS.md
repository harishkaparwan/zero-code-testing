# Repository agent instructions

Before changing or running this repository, read `SKILL.md` and `e2e.config.yaml`.

Treat `SKILL.md` as the workflow contract. Run `npm run preflight` before exploring or generating a suite, and do not bypass the fresh passing-preflight check in `scripts/scaffold.mjs`. For an existing application, run `npm run sync`, read its change report, and preserve unaffected generated/custom code. Accept a new baseline only after affected tests and regression pass. Use the provided validation, coverage, synchronization, and Docker scripts instead of inventing a second test harness. Never print or commit `.env` values, credentials, authentication state, or sensitive screenshots.
