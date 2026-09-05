#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parse } from 'yaml';

const configPath = resolve(process.env.E2E_CONFIG || process.argv[2] || 'e2e.config.yaml');
const outputPath = resolve(process.env.DISCOVERY_OUTPUT || 'reports/sync/current-inventory.json');
const preflightReportPath = resolve(process.env.PREFLIGHT_REPORT || 'reports/preflight/report.json');

function fail(message) {
  console.error(`Discovery error: ${message}`);
  process.exit(1);
}

if (!existsSync(configPath)) fail(`missing ${configPath}`);
const configText = readFileSync(configPath, 'utf8');
let config;
try {
  config = parse(configText);
} catch (error) {
  fail(`invalid YAML: ${error.message}`);
}

const configSha256 = createHash('sha256').update(configText).digest('hex');
if (!existsSync(preflightReportPath)) fail('missing passing preflight report; run npm run preflight first');
try {
  const preflight = JSON.parse(readFileSync(preflightReportPath, 'utf8'));
  if (preflight.passed !== true || preflight.configSha256 !== configSha256 || Date.parse(preflight.expiresAt) <= Date.now()) {
    fail('preflight report is failed, expired, or belongs to different YAML');
  }
} catch (error) {
  fail(`could not validate preflight report: ${error.message}`);
}

const settings = config.discovery;
if (!settings || settings.enabled !== true) fail('discovery.enabled must be true');
const appUrl = new URL(config.app.start_url || config.app.url);
const appOrigin = new URL(config.app.url).origin;
const maxPages = settings.max_pages ?? 30;
const timeout = settings.timeout_ms ?? 30_000;
const includePrefixes = settings.include_path_prefixes?.length ? settings.include_path_prefixes : ['/'];
let excludePatterns;
let ignoredTextPatterns;
try {
  excludePatterns = (settings.exclude_path_patterns || []).map((pattern) => new RegExp(pattern, 'i'));
  ignoredTextPatterns = (settings.ignore_text_patterns || []).map((pattern) => new RegExp(pattern, 'gi'));
} catch (error) {
  fail(`invalid discovery pattern: ${error.message}`);
}

const blockedExtension = /\.(?:avif|css|csv|docx?|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|txt|webm|webp|xlsx?|xml|zip)$/i;
const clean = (value, limit = 120) => {
  let output = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const pattern of ignoredTextPatterns) output = output.replace(pattern, '<ignored>');
  return output.slice(0, limit);
};
const normalizeUrl = (value) => {
  const url = new URL(value, appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== appOrigin) return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url;
};
const pathAllowed = (pathname) => includePrefixes.some((prefix) => pathname.startsWith(prefix))
  && !excludePatterns.some((pattern) => pattern.test(pathname))
  && !blockedExtension.test(pathname);

const startLocations = settings.start_paths?.length ? settings.start_paths : [appUrl.pathname || '/'];
const queue = [];
const queued = new Set();
for (const location of startLocations) {
  const url = normalizeUrl(location);
  if (!url || !pathAllowed(url.pathname)) fail(`unsafe or excluded discovery start path: ${location}`);
  if (!queued.has(url.href)) {
    queued.add(url.href);
    queue.push(url.href);
  }
}

const extractSemanticInventory = () => {
  const cleanText = (value, limit = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const label = (element) => {
    if (element.labels?.length) return cleanText(element.labels[0].textContent);
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return cleanText(ariaLabel);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) return cleanText(document.getElementById(labelledBy)?.textContent);
    return cleanText(element.textContent || element.getAttribute('placeholder'));
  };
  const implicitRole = (element) => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'button' || ['button', 'submit', 'reset'].includes(type)) return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox';
    return tag;
  };

  const controls = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=combobox]')]
    .filter(visible)
    .map((element) => ({
      role: implicitRole(element),
      name: label(element),
      type: cleanText(element.getAttribute('type') || element.tagName.toLowerCase(), 40),
      fieldName: cleanText(element.getAttribute('name'), 80),
      testId: cleanText(element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy'), 80),
      required: element.hasAttribute('required'),
      disabled: element.matches(':disabled,[aria-disabled="true"]'),
    }));

  const forms = [...document.querySelectorAll('form')].map((form) => ({
    method: cleanText(form.getAttribute('method') || 'get', 10).toLowerCase(),
    action: form.action || location.href,
    fields: [...form.querySelectorAll('input:not([type=hidden]),select,textarea')].map((element) => ({
      type: cleanText(element.getAttribute('type') || element.tagName.toLowerCase(), 40),
      name: cleanText(element.getAttribute('name'), 80),
      label: label(element),
      required: element.hasAttribute('required'),
    })),
  }));

  const tables = [...document.querySelectorAll('table,[role=grid]')].map((table) => ({
    name: cleanText(table.getAttribute('aria-label') || table.querySelector('caption')?.textContent),
    headers: [...table.querySelectorAll('th,[role=columnheader]')].map((header) => cleanText(header.textContent)).filter(Boolean),
  }));

  const links = [...document.querySelectorAll('a[href]')].filter(visible).map((link) => ({
    href: link.href,
    name: cleanText(link.textContent || link.getAttribute('aria-label')),
  }));

  return {
    title: cleanText(document.title),
    headings: [...document.querySelectorAll('h1,h2,[role=heading]')].filter(visible).map((heading) => cleanText(heading.textContent)).filter(Boolean).slice(0, 20),
    controls,
    forms,
    tables,
    links,
  };
};

const dedupeSort = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const pages = [];
const errors = [];
let skippedByLimit = 0;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();

while (queue.length > 0 && pages.length < maxPages) {
  const requestedUrl = queue.shift();
  const requestedPath = new URL(requestedUrl).pathname;
  try {
    const response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout });
    const status = response?.status() ?? null;
    const finalUrl = normalizeUrl(page.url());
    if (!finalUrl) throw new Error('page redirected outside the application origin');
    if (status === null || status >= 400) throw new Error(`main document returned HTTP ${status ?? 'unknown'}`);
    await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => {});
    const raw = await page.evaluate(extractSemanticInventory);

    const links = [];
    for (const link of raw.links) {
      const normalized = normalizeUrl(link.href);
      if (!normalized || !pathAllowed(normalized.pathname)) continue;
      links.push({ path: normalized.pathname, name: clean(link.name) });
      if (settings.follow_links === true && !queued.has(normalized.href)) {
        if (pages.length + queue.length < maxPages) {
          queued.add(normalized.href);
          queue.push(normalized.href);
        } else {
          skippedByLimit += 1;
        }
      }
    }

    const forms = raw.forms.map((form) => {
      const actionUrl = normalizeUrl(form.action || finalUrl.href);
      return {
        method: form.method,
        actionPath: actionUrl?.pathname || '<external>',
        fields: dedupeSort(form.fields.map((field) => ({
          ...field,
          name: clean(field.name, 80),
          label: clean(field.label),
        }))),
      };
    });
    const semantic = {
      title: clean(raw.title),
      headings: [...new Set(raw.headings.map((heading) => clean(heading)).filter(Boolean))].sort(),
      controls: dedupeSort(raw.controls.map((control) => ({
        ...control,
        name: clean(control.name),
        fieldName: clean(control.fieldName, 80),
        testId: clean(control.testId, 80),
      }))),
      forms: dedupeSort(forms),
      tables: dedupeSort(raw.tables.map((table) => ({
        name: clean(table.name),
        headers: table.headers.map((header) => clean(header)).filter(Boolean),
      }))),
      links: dedupeSort(links),
    };
    pages.push({ path: finalUrl.pathname, status, semantic });
    console.log(`DISCOVERED ${requestedPath} -> ${finalUrl.pathname} (${semantic.controls.length} controls)`);
  } catch (error) {
    errors.push({ path: requestedPath, error: clean(error.message, 200) });
    console.error(`UNAVAILABLE ${requestedPath}: ${clean(error.message, 160)}`);
  }
}

await browser.close();
const uniquePages = [...new Map(pages.map((entry) => [entry.path, entry])).values()].sort((a, b) => a.path.localeCompare(b.path));
if (uniquePages.length === 0) fail('no application pages could be inventoried');

mkdirSync(dirname(outputPath), { recursive: true });
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  configSha256,
  appOrigin,
  pageCount: uniquePages.length,
  truncated: queue.length > 0 || skippedByLimit > 0,
  undiscoveredDueToLimit: skippedByLimit,
  pages: uniquePages,
  errors,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(`Discovery inventory written: ${uniquePages.length} page(s), ${errors.length} unavailable page(s).`);
