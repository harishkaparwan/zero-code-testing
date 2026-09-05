# Plain-English report format

The report is a Markdown file named `Test Report — <site> — <date>.md`, delivered with failure screenshots when available. Audience: a non-technical reader. No code, selectors, stack traces, or jargon ("locator", "assertion", "trace" are banned words).

## Structure

```markdown
# Test Report — <Site name>
<Date/time and timezone> · <environment URL> · <N> checks run · ✅ <passed> passed · ❌ <failed> failed · ⚠️ <skipped> skipped

Execution: <automated, manually verified, or mixed; identify any manual checks>

## Verdict
One or two sentences: is the app safe to ship / working overall? Lead with the most important finding.

## What changed since last run   ← only on re-runs
- 🔴 Newly broken: ...
- 🟢 Fixed: ...
- 🟡 Still broken: ...

## Problems found                ← most severe first
### 1. <Plain-English title, e.g. "Checkout fails at the payment step">
- **What I did:** Added a product to the cart, went to checkout, filled in card details, and clicked Pay.
- **What should happen:** An order confirmation page appears.
- **What actually happened:** The page showed "Something went wrong" and the order was not placed.
- **How bad is it:** Critical — customers cannot buy anything.
- **See it yourself:** numbered steps anyone can follow in a browser.
- Screenshot attached: <filename>.

## What's working
Grouped one-liners: "Sign-up, login, and password reset all work." Keep it short.

## What I tested
Journey list with scenario counts, e.g. "Checkout — 6 checks (happy path, empty cart, invalid card, ...)". Titles only, no Gherkin syntax.

## Coverage gaps
Things not tested and why (needs credentials, needs a real payment method, page behind invite-only access), each with what the user can provide to unlock it.

## Deliverables
- Reusable test suite: <zip filename>
- Evidence: <redacted screenshots or “none”>
```

## Severity scale

- **Critical** — a core journey is fully broken (can't buy, can't log in, data loss).
- **Major** — a journey is broken for some inputs or devices, or has a broken fallback.
- **Minor** — cosmetic, confusing text, slow but functional.

## Rules

- Every failed check appears under Problems found with a screenshot when available.
- Only genuine app defects are "Problems". Environment/test flakiness the agent fixed is not reported (optionally one line: "2 checks were unstable on the first try; I re-ran them and they passed.").
- Numbers must add up: passed + failed + skipped = checks run.
- Do not count a manually verified check as an automated pass. State the execution method prominently.
- Redact or omit screenshots containing passwords, tokens, personal data, payment data, or sensitive account content.
- For pairwise combinations, say “pairwise”; do not imply that every Cartesian combination ran.
- End the report with the reuse note: attach the suite zip next time to re-run instantly.
