#!/usr/bin/env node
/**
 * inventory.mjs — discover every interactive control on a page and record ALL usable
 * locator strategies for each, plus the groups they belong to.
 *
 * Usage:
 *   node inventory.mjs <url> [--paths /a,/b,/c] [--out inventory.json]
 *
 * Output: inventory.json — one entry per page/state:
 *   { url, controls: [ { kind, locators: {...}, preferred, group, value, label } ],
 *     groups: [ { id, kind, label, values: [...] } ] }
 *
 * Locator strategies collected per control (in stability order):
 *   role+accessible name, label text, testid, id, name, aria-label, placeholder,
 *   value, css, xpath.
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

const args = process.argv.slice(2);
const url = args[0];
if (!url) { console.error('Usage: node inventory.mjs <url> [--paths /a,/b] [--out inventory.json]'); process.exit(1); }
const getArg = (flag, dflt) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : dflt; };
const paths = (getArg('--paths', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const outFile = getArg('--out', 'inventory.json');
const headless = process.env.HEADLESS !== 'false';

let rootUrl;
try {
  rootUrl = new URL(url);
} catch {
  console.error('URL must be absolute, for example: https://staging.example.com');
  process.exit(1);
}
if (!['http:', 'https:'].includes(rootUrl.protocol) || rootUrl.username || rootUrl.password) {
  console.error('Use an http(s) URL without embedded credentials.');
  process.exit(1);
}
if (!outFile || typeof outFile !== 'string') {
  console.error('--out requires a file path.');
  process.exit(1);
}

const EXTRACT = () => {
  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const xPath = (el) => {
    if (el.id) return `//*[@id="${el.id}"]`;
    const segs = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let i = 1;
      let sib = node.previousElementSibling;
      while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
      segs.unshift(`${node.tagName.toLowerCase()}[${i}]`);
      node = node.parentElement;
      if (node && node.tagName === 'BODY') { segs.unshift('body'); break; }
    }
    return '/' + segs.join('/');
  };

  const labelOf = (el) => {
    if (el.labels && el.labels.length) return el.labels[0].textContent.trim();
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = document.getElementById(labelledby);
      if (t) return t.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping) return wrapping.textContent.trim();
    return '';
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (['text', 'email', 'tel', 'url', 'password', ''].includes(type)) return 'textbox';
      return type || 'textbox';
    }
    return '';
  };

  const groupLabelOf = (el) => {
    const fs = el.closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    if (legend) return legend.textContent.trim();
    const grp = el.closest('[role="radiogroup"], [role="group"]');
    if (grp) {
      const al = grp.getAttribute('aria-label');
      if (al) return al.trim();
    }
    return '';
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const SELECTOR = [
    'input:not([type=hidden])', 'select', 'textarea', 'button',
    '[role=button]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=switch]',
    '[role=combobox]', '[role=listbox]', 'a[href]',
  ].join(',');

  const controls = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = roleOf(el);
    const label = labelOf(el);
    const name = el.getAttribute('name') || '';
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '';
    const accessibleName = label || (el.value && ['submit', 'button'].includes(type) ? el.value : '') || el.textContent.trim().slice(0, 60);

    const entry = {
      kind: tag === 'select' ? (el.multiple ? 'multiselect' : 'select') : (type || role || tag),
      tag,
      role,
      label,
      accessibleName,
      value: el.getAttribute('value') || '',
      required: el.hasAttribute('required'),
      disabled: el.disabled === true,
      groupName: name,
      groupLabel: groupLabelOf(el),
      locators: {
        role: role && accessibleName ? { role, name: accessibleName } : null,
        label: label || null,
        testid: testid || null,
        id: el.id || null,
        name: name || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        placeholder: el.getAttribute('placeholder') || null,
        value: el.getAttribute('value') || null,
        css: cssPath(el),
        xpath: xPath(el),
      },
    };

    if (tag === 'select') {
      // Disabled options (and placeholders like "Please select") cannot be chosen,
      // so they must never enter the combination space.
      entry.options = [...el.options]
        .filter((o) => {
          const label = o.textContent.trim();
          const looksLikePlaceholder = o.value === '' && /^(--|please\s+)?(select|choose|pick)\b/i.test(label);
          return !o.disabled && !looksLikePlaceholder;
        })
        .map((o) => ({ label: o.textContent.trim(), value: o.value }));
      entry.disabledOptions = [...el.options].filter((o) => o.disabled).map((o) => o.textContent.trim());
    }
    controls.push(entry);
  }

  // ---- group related controls into parameters ----
  const groups = [];
  const memberIdentifiers = (members) => {
    const preferred = members.map((member, index) =>
      member.value || member.label || member.accessibleName || `#${index + 1}`
    );
    return preferred.map((value, index) => {
      if (preferred.indexOf(value) === preferred.lastIndexOf(value)) return value;
      return members[index].label || members[index].accessibleName || `#${index + 1}`;
    });
  };
  const radioByName = {};
  const checkboxByName = {};
  for (const c of controls) {
    if (c.disabled) continue; // a disabled control has no selectable states
    if (c.kind === 'radio') {
      const key = c.groupName || c.groupLabel || 'radios';
      (radioByName[key] ||= []).push(c);
    } else if (c.kind === 'checkbox') {
      // Unnamed checkboxes still form a group if they sit together — fall back to
      // the fieldset label, then to a single implicit group for the page.
      const key = c.groupName || c.groupLabel || 'checkboxes';
      (checkboxByName[key] ||= []).push(c);
    }
  }
  for (const [key, members] of Object.entries(radioByName)) {
    groups.push({
      id: key,
      kind: 'radio',
      label: members[0].groupLabel || key,
      values: [...new Set(memberIdentifiers(members).filter(Boolean))],
      memberLabels: members.map((m) => m.label || m.accessibleName),
    });
  }
  for (const c of controls) {
    if (c.kind === 'select' && c.options && c.options.length > 1) {
      groups.push({
        id: c.groupName || c.locators.id || c.label || 'select',
        kind: 'select',
        label: c.label || c.groupName || c.locators.id || 'dropdown',
        values: [...new Set(c.options.map((o) => o.label).filter(Boolean))],
      });
    }
  }
  for (const [key, members] of Object.entries(checkboxByName)) {
    groups.push({
      id: key,
      kind: 'checkbox-group',
      label: members[0].groupLabel || key,
      // Identify each box by value/label where possible; otherwise by position,
      // so poorly marked-up forms are still covered.
      values: [...new Set(memberIdentifiers(members))],
      note: 'checkboxes are independent on/off parameters',
    });
  }

  return { title: document.title, heading: (document.querySelector('h1,h2') || {}).textContent?.trim() || '', controls, groups };
};

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 768 },
});
const page = await ctx.newPage();

const targets = paths.length ? paths.map((p) => new URL(p, rootUrl).href) : [rootUrl.href];
if (targets.some((target) => new URL(target).origin !== rootUrl.origin)) {
  console.error('--paths must stay on the same origin as the target URL.');
  await browser.close();
  process.exit(1);
}
const pages = [];

for (const target of targets) {
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    const data = await page.evaluate(EXTRACT);
    pages.push({ url: target, ...data });
    const groupSummary = data.groups.map((g) => `${g.label}(${g.values.length})`).join(', ') || 'none';
    console.log(`${target} -> ${data.controls.length} controls, groups: ${groupSummary}`);
  } catch (e) {
    pages.push({ url: target, error: String(e.message).slice(0, 200) });
    console.log(`${target} -> ERROR ${String(e.message).slice(0, 120)}`);
  }
}

await browser.close();
writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), pages }, null, 2));
console.log(`\nWrote ${outFile}`);
