# Reusable step library

These steps ship in every scaffolded project (`steps/common.steps.ts`) and work on any web app without extra code. Write features using these first; only add custom steps when a journey genuinely cannot be expressed here.

Verified working across unrelated apps (a React store and a server-rendered demo site) with no app-specific code.

## Given — starting point

| Step | Notes |
|---|---|
| `Given I open the app` | Opens `START_URL` (or the base URL), then dismisses common overlays |
| `Given I open the page "/checkout"` | Any path or full URL |
| `Given I am signed in` | Uses `TEST_USER` / `TEST_PASSWORD` from `.env` |

## When — actions

| Step | Notes |
|---|---|
| `When I click "Add to cart"` | Resolves buttons → links → tabs → menu items → aria-labels → text, in that priority, and only picks visible elements |
| `When I fill "Email" with "a@b.com"` | Finds inputs by label, placeholder, role, name, or id |
| `When I type "hello" into "Search"` | Types character by character (for autocomplete) |
| `When I search for "cordless drill"` | Finds the app's search box however it's marked up |
| `When I select "Price (low to high)" from the dropdown` | Native `select` or ARIA combobox |
| `When I select "Large" from "Size"` | Named dropdown |
| `When I check "I agree"` | Checkbox by label |
| `When I go back` | Browser back |
| `When I remember the text of "Total"` | Stores a value for later comparison |
| `When I wait for the page to settle` | Waits for network idle; use only when no specific visible state is available |

## Then — checks

| Step | Notes |
|---|---|
| `Then I see "Order confirmed"` | Visible text anywhere on the page |
| `Then I do not see "Error"` | Absence check |
| `Then I see the "Password" field` | Input is present |
| `Then I see the "Submit" button` | Button is present |
| `Then the page title contains "Acme"` | Tolerates curly vs. straight apostrophes |
| `Then the URL contains "/checkout"` | Route assertion |
| `Then I see at least 6 results` | Counts only visible list/card/product items |
| `Then I see prices` | Detects $, £, €, ₹ amounts |
| `Then the page has no obvious error` | Catches "Access Denied", 500s, "something went wrong", 404s |
| `Then the page loads successfully` | Page is not blank |
| `Then I see an error message containing "do not match"` | Finds the error element that actually carries the text |
| `Then the results relate to "drill"` | Relevance check on search results |
| `Then the page works on mobile` | Fails on horizontal overflow |

## Grouped controls (combinatorial)

| Step | Notes |
|---|---|
| `When I set "radioval" to "rd2"` | Radio option or dropdown value, by group name/id/label |
| `When I set the checkbox "cb1" in "checkboxes[]" to "checked"` | One checkbox in a group |
| `Then "dropdown" is set to "Option 2"` | Selection took effect |
| `Then the checkbox "cb1" in "checkboxes[]" is "checked"` | Checkbox state |
| `Then every option of "dropdown" is available` | Group still offers its choices |

See `combinatorial-coverage.md` for how these are generated automatically from a locator inventory.

## Design notes for extending

- Resolve interactive elements by trying strategies in priority order and returning the first that matches a **visible** element. A plain `.or()` union picks document order instead, which clicks a "Login Page" heading rather than the "Login" button.
- Filter list counts with `.filter({ visible: true })` — hidden templates match generic card/item selectors on many apps.
- When asserting error text, add `.filter({ hasText })` — apps commonly render several empty error containers next to the real one.
- Never add hard sleeps to assertions; use `expect.poll` or web-first assertions.
- Never put credentials directly into a feature file. The sign-in step reads a dedicated test account from local environment variables.
