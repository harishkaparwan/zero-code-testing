import { Page, Locator } from '@playwright/test';

/**
 * Base for app-specific page objects.
 * Most apps need no page objects at all — the generic steps in
 * `steps/common.steps.ts` cover the common cases. Extend this only when a page
 * has complex, repeated interactions worth naming.
 */
export class BasePage {
  constructor(protected page: Page) {}

  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  /** Prefer accessible names; fall back to text and attributes for poorly marked-up apps. */
  protected byName(name: string): Locator {
    const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return this.page
      .getByRole('button', { name: rx })
      .or(this.page.getByRole('link', { name: rx }))
      .or(this.page.getByTestId(name))
      .or(this.page.getByText(rx))
      .first();
  }
}
