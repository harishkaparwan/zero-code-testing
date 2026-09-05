#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { parse } from 'yaml';

const configPath = resolve(process.env.E2E_CONFIG || process.argv[2] || 'e2e.config.yaml');
const reportDir = resolve(process.env.PREFLIGHT_REPORT_DIR || 'reports/preflight');

function finishWithError(message) {
  console.error(`Preflight configuration error: ${message}`);
  process.exit(1);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '<invalid-url>';
  }
}

function fileSlug(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

if (!existsSync(configPath)) finishWithError(`missing ${configPath}`);

const configText = readFileSync(configPath, 'utf8');
let config;
try {
  config = parse(configText);
} catch (error) {
  finishWithError(`invalid YAML: ${error.message}`);
}

const settings = config?.preflight;
if (!settings || settings.enabled !== true) finishWithError('preflight.enabled must be true');
if (!Array.isArray(settings.pages) || settings.pages.length === 0) finishWithError('preflight.pages must contain at least one page');

const baseUrl = config?.app?.start_url || config?.app?.url;
let appOrigin;
try {
  appOrigin = new URL(config.app.url).origin;
} catch {
  finishWithError('app.url must be an absolute URL');
}

const allowedOrigins = new Set([appOrigin]);
for (const value of settings.allowed_redirect_origins || []) {
  try {
    allowedOrigins.add(new URL(value).origin);
  } catch {
    finishWithError(`invalid allowed redirect origin: ${value}`);
  }
}

const timeout = settings.timeout_ms ?? 30_000;
const maxAgeMinutes = settings.max_age_minutes ?? 30;
const results = [];
let browser;

try {
  browser = await chromium.launch({ headless: true });

  for (const pageConfig of settings.pages) {
    const id = pageConfig.id;
    const location = pageConfig.url ?? pageConfig.path;
    const target = location === undefined ? new URL(baseUrl).href : new URL(location, baseUrl).href;
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const page = await context.newPage();
    const counters = { consoleErrors: 0, pageErrors: 0, failedRequests: 0 };
    page.on('console', (message) => {
      if (message.type() === 'error') counters.consoleErrors += 1;
    });
    page.on('pageerror', () => { counters.pageErrors += 1; });
    page.on('requestfailed', () => { counters.failedRequests += 1; });

    const result = {
      id,
      targetUrl: safeUrl(target),
      finalUrl: null,
      status: null,
      passed: false,
      durationMs: 0,
      ...counters,
      screenshot: null,
      error: null,
    };
    const startedAt = Date.now();

    try {
      const response = await page.goto(target, {
        waitUntil: pageConfig.wait_until || 'domcontentloaded',
        timeout,
      });
      result.status = response?.status() ?? null;
      result.finalUrl = safeUrl(page.url());

      const finalOrigin = new URL(page.url()).origin;
      if (!allowedOrigins.has(finalOrigin)) {
        throw new Error(`redirected to an unapproved origin: ${finalOrigin}`);
      }

      const [minimumStatus, maximumStatus] = pageConfig.status_range || [200, 399];
      if (result.status === null || result.status < minimumStatus || result.status > maximumStatus) {
        throw new Error(`main document returned HTTP ${result.status ?? 'unknown'}; expected ${minimumStatus}-${maximumStatus}`);
      }

      const expected = pageConfig.expect || {};
      const selector = expected.selector || 'body';
      await page.locator(selector).first().waitFor({ state: 'visible', timeout });

      if (expected.title_contains) {
        const title = await page.title();
        if (!title.includes(expected.title_contains)) throw new Error('page title did not contain the configured text');
      }
      if (expected.text_contains) {
        await page.getByText(expected.text_contains, { exact: false }).first().waitFor({ state: 'visible', timeout });
      }

      const domCharacters = await page.evaluate(() => document.documentElement?.outerHTML.length ?? 0);
      const minimumDomCharacters = pageConfig.minimum_dom_chars ?? 20;
      if (domCharacters < minimumDomCharacters) {
        throw new Error(`rendered DOM was too small (${domCharacters} characters; expected at least ${minimumDomCharacters})`);
      }

      if (settings.fail_on_console_errors === true && (counters.consoleErrors > 0 || counters.pageErrors > 0)) {
        throw new Error(`browser reported ${counters.consoleErrors} console error(s) and ${counters.pageErrors} page error(s)`);
      }
      if (settings.fail_on_request_errors === true && counters.failedRequests > 0) {
        throw new Error(`browser reported ${counters.failedRequests} failed request(s)`);
      }

      result.passed = true;
    } catch (error) {
      result.error = error.message;
    } finally {
      Object.assign(result, counters);
      result.durationMs = Date.now() - startedAt;
      if (settings.screenshot !== false) {
        mkdirSync(reportDir, { recursive: true });
        const screenshotPath = resolve(reportDir, `${fileSlug(id)}.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          result.screenshot = `${fileSlug(id)}.png`;
        } catch {
          // A navigation failure may leave no page that can be captured.
        }
      }
      await context.close();
    }

    results.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${id}: ${result.finalUrl || result.targetUrl}${result.status ? ` [HTTP ${result.status}]` : ''}`);
    if (!result.passed) console.error(`  ${result.error}`);
  }
} catch (error) {
  console.error(`Preflight could not start Chromium: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

mkdirSync(reportDir, { recursive: true });
const generatedAt = new Date();
const passed = results.length === settings.pages.length && results.every((result) => result.passed);
const report = {
  schemaVersion: 1,
  passed,
  generatedAt: generatedAt.toISOString(),
  expiresAt: new Date(generatedAt.getTime() + maxAgeMinutes * 60_000).toISOString(),
  configSha256: createHash('sha256').update(configText).digest('hex'),
  appOrigin,
  pages: results,
};
writeFileSync(resolve(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

if (!passed) {
  console.error(`Preflight failed: ${results.filter((result) => !result.passed).length} of ${settings.pages.length} page(s) did not pass.`);
  process.exit(1);
}

console.log(`Preflight passed: ${results.length} page(s) rendered successfully.`);
