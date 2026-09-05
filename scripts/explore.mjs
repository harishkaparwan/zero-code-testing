#!/usr/bin/env node
/**
 * explore.mjs — lightweight same-origin crawler for the zero-code E2E agent.
 * Usage: node explore.mjs <url> [maxPages=25]
 * Output: sitemap.json in the current directory.
 * Requires: playwright installed in the current project (see references/project-setup.md).
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const projectRequire = createRequire(resolve(process.cwd(), 'package.json'));
let chromium;
try {
  ({ chromium } = projectRequire('playwright'));
} catch {
  console.error('Playwright is not installed in the current project. Run npm install first.');
  process.exit(1);
}

const start = process.argv[2];
if (!start) { console.error('Usage: node explore.mjs <url> [maxPages]'); process.exit(1); }
const maxPages = Number(process.argv[3] ?? 25);
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) {
  console.error('maxPages must be an integer from 1 to 200.');
  process.exit(1);
}

let startUrl;
try {
  startUrl = new URL(start);
} catch {
  console.error('URL must be absolute, for example: https://staging.example.com');
  process.exit(1);
}
if (!['http:', 'https:'].includes(startUrl.protocol) || startUrl.username || startUrl.password) {
  console.error('Use an http(s) URL without embedded credentials.');
  process.exit(1);
}
const origin = startUrl.origin;

const normalize = (u) => {
  const x = new URL(u, origin);
  if (!['http:', 'https:'].includes(x.protocol)) throw new Error('unsupported protocol');
  x.hash = '';
  x.search = '';
  return x.href;
};
const queue = [normalize(start)];
const seen = new Set(queue);
const pages = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

while (queue.length && pages.length < maxPages) {
  const url = queue.shift();
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    status = resp?.status() ?? null;
  } catch (e) {
    pages.push({ url, error: String(e.message).slice(0, 200) });
    continue;
  }
  const info = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')].map((f) => ({
      action: f.getAttribute('action') || '',
      method: (f.getAttribute('method') || 'get').toLowerCase(),
      fields: [...f.querySelectorAll('input,select,textarea')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        label: el.labels?.[0]?.textContent?.trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
        required: el.hasAttribute('required'),
      })),
      submitText: f.querySelector('button[type=submit],input[type=submit]')?.textContent?.trim()
        || f.querySelector('input[type=submit]')?.value || '',
    }));
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
    const buttons = [...document.querySelectorAll('button,[role=button]')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 40);
    const authWall = !!document.querySelector('input[type=password]');
    return { title: document.title, h1: document.querySelector('h1')?.textContent?.trim() || '', forms, links, buttons, authWall };
  });
  pages.push({ url, status, title: info.title, h1: info.h1, authWall: info.authWall, forms: info.forms, buttons: info.buttons });
  for (const href of info.links) {
    try {
      const n = normalize(href);
      if (new URL(n).origin === origin && !seen.has(n) && !/\.(pdf|zip|png|jpe?g|svg|gif|mp4|webm|css|js)$/i.test(n)) {
        seen.add(n); queue.push(n);
      }
    } catch { /* ignore invalid URLs */ }
  }
}

await browser.close();
writeFileSync('sitemap.json', JSON.stringify({ origin, crawledAt: new Date().toISOString(), pageCount: pages.length, unvisited: queue.length, pages }, null, 2));
console.log(`sitemap.json written: ${pages.length} pages crawled, ${queue.length} left unvisited.`);
