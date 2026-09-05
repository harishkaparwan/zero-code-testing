# Locator inventory and combinatorial coverage

Use this mode for pages where combinations of radio groups, native selects, and checkboxes materially affect behavior. It supplements journey tests; it does not replace assertions about business outcomes.

## 1. Inventory controls

```bash
node <skill-dir>/scripts/inventory.mjs <url> --paths /form,/checkout,/settings --out inventory.json
```

For each visible interactive element, the inventory records available locator information in this preference order:

1. role and accessible name
2. label text
3. explicit test ID
4. stable `id` or `name`
5. placeholder or value
6. generated CSS
7. generated XPath

Generated CSS and XPath are diagnostic fallbacks. If a shipped test depends on one, call it out as a maintainability risk.

The script automatically creates parameters for native radio groups, native selects, and checkbox groups. It excludes disabled controls and obvious non-selectable placeholder options. Custom dropdowns, tabs, switches, and controls revealed only after interaction remain in the raw inventory but require manual grouping or app-specific steps.

## 2. Generate combinations

```bash
node <skill-dir>/scripts/combos.mjs inventory.json --outdir <project> --max 30
```

- If the Cartesian product for a page is at most `--max`, every combination is generated.
- Above the limit, a greedy all-pairs set is generated and verified so every pair of parameter values appears at least once.
- Each page produces a separate feature and a separate coverage section.
- Each checkbox is an independent checked/unchecked parameter.

Use `--submit "Submit"` only when clicking that control is authorized and safe. The generator will verify the chosen states and click the control, but a generic “no obvious error” check is not proof of a successful business transaction. Add an app-specific outcome step after generation, such as a confirmation message or persisted value.

## 3. Interpret the generated scenario

Without `--submit`, the generated Scenario Outline proves that every selected row can be applied to the controls and that the page remains free of obvious error text. Its title deliberately says the controls “can be selected.”

With `--submit`, the generated scenario also submits the row and checks for obvious error text. Before treating the row as a functional pass, add a meaningful outcome assertion.

Example:

```gherkin
  @combinatorial @iteration-1
  Scenario Outline: Every generated combination of controls can be selected
    Given I open the page "/preferences"
    When I set "plan" to "<plan>"
    And I set the checkbox "email" in "notifications" to "<notifications_email>"
    Then "plan" is set to "<plan>"
    And the checkbox "email" in "notifications" is "<notifications_email>"
    And the page has no obvious error

    Examples:
      | plan | notifications_email |
      | Free | checked             |
      | Pro  | unchecked           |
```

## 4. Review the matrix

The generator writes `reports/coverage-matrix.md` with:

- the page and iteration
- full or pairwise strategy
- Cartesian size and generated row count
- every parameter value and its exercise count
- pairwise verification status when reduction was used

Any zero-count value or failed pairwise verification is a generator error; do not ship the suite.

## Boundaries

- Do not generate combinations that create excessive records or external side effects.
- Do not combine mutually incompatible states merely because controls appear on the same page; split them by reachable state or encode valid preconditions.
- Do not describe pairwise coverage as exhaustive Cartesian coverage.
- Re-inventory dynamic forms after a choice reveals new controls, and treat the revealed state as a new iteration.
