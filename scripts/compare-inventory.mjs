#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const action = process.argv[2] || 'check';
const failOnChange = process.argv.includes('--fail-on-change');
const configPath = resolve(process.env.E2E_CONFIG || 'e2e.config.yaml');
const currentPath = resolve(process.env.DISCOVERY_OUTPUT || 'reports/sync/current-inventory.json');
const baselinePath = resolve(process.env.DISCOVERY_BASELINE || '.e2e/baseline/inventory.json');
const reportDir = resolve(process.env.SYNC_REPORT_DIR || 'reports/sync');

function fail(message) {
  console.error(`Sync comparison error: ${message}`);
  process.exit(1);
}

if (!['check', 'accept'].includes(action)) fail('action must be check or accept');
if (!existsSync(configPath)) fail(`missing ${configPath}`);
if (!existsSync(currentPath)) fail(`missing ${currentPath}; run npm run sync first`);

const configText = readFileSync(configPath, 'utf8');
const config = parse(configText);
const current = JSON.parse(readFileSync(currentPath, 'utf8'));
const configSha256 = createHash('sha256').update(configText).digest('hex');
if (current.configSha256 !== configSha256) fail('current inventory belongs to a different e2e.config.yaml; rerun discovery');
if (current.truncated === true) fail('discovery reached max_pages; increase the limit or narrow included paths before comparing');

if (action === 'accept') {
  if ((current.errors || []).length > 0) fail('cannot accept a baseline while discovery contains unavailable pages');
  const maximumAgeMs = (config.preflight?.max_age_minutes ?? 30) * 60_000;
  if (!current.generatedAt || Date.parse(current.generatedAt) + maximumAgeMs <= Date.now()) fail('current inventory is stale; run npm run sync again');
  mkdirSync(dirname(baselinePath), { recursive: true });
  copyFileSync(currentPath, baselinePath);
  console.log(`Accepted ${current.pageCount} page(s) as the reviewed inventory baseline.`);
  process.exit(0);
}

const baselineExists = existsSync(baselinePath);
const baseline = baselineExists ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { pages: [] };
if (baseline.schemaVersion !== undefined && baseline.schemaVersion !== current.schemaVersion) {
  fail('baseline schema differs from current inventory; review and accept a new baseline');
}
if (baseline.appOrigin && baseline.appOrigin !== current.appOrigin) {
  fail('baseline belongs to a different application origin');
}

const byPath = (inventory) => new Map((inventory.pages || []).map((page) => [page.path, page]));
const before = byPath(baseline);
const after = byPath(current);
const addedPages = [...after.keys()].filter((path) => !before.has(path)).sort();
const unavailablePaths = new Set((current.errors || []).map((error) => error.path));
const removedPages = [...before.keys()].filter((path) => !after.has(path) && !unavailablePaths.has(path)).sort();
const stable = (value) => JSON.stringify(value ?? null);
const signature = (value) => stable(value);
const setDiff = (left = [], right = []) => {
  const rightKeys = new Set(right.map(signature));
  return left.filter((entry) => !rightKeys.has(signature(entry)));
};
const markdownSafe = (value) => String(value).replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1');
const describeControl = (control) => markdownSafe([control.role || control.type, control.name || control.fieldName || control.testId].filter(Boolean).join(': ') || 'unnamed control');
const describeLink = (link) => markdownSafe(`${link.name || 'unnamed link'} -> ${link.path}`);

const changedPages = [];
for (const path of [...after.keys()].filter((entry) => before.has(entry)).sort()) {
  const oldSemantic = before.get(path).semantic || {};
  const newSemantic = after.get(path).semantic || {};
  if (stable(oldSemantic) === stable(newSemantic)) continue;
  changedPages.push({
    path,
    titleChanged: oldSemantic.title !== newSemantic.title,
    headingsAdded: setDiff(newSemantic.headings, oldSemantic.headings),
    headingsRemoved: setDiff(oldSemantic.headings, newSemantic.headings),
    controlsAdded: setDiff(newSemantic.controls, oldSemantic.controls),
    controlsRemoved: setDiff(oldSemantic.controls, newSemantic.controls),
    linksAdded: setDiff(newSemantic.links, oldSemantic.links),
    linksRemoved: setDiff(oldSemantic.links, newSemantic.links),
    formsChanged: stable(oldSemantic.forms) !== stable(newSemantic.forms),
    tablesChanged: stable(oldSemantic.tables) !== stable(newSemantic.tables),
  });
}

const changedPaths = [...new Set([...addedPages, ...removedPages, ...changedPages.map((page) => page.path)])].sort();
const journeys = Array.isArray(config.journeys) ? config.journeys : [];
const pathMatches = (changedPath, configuredPath) => {
  const cleanPath = configuredPath.endsWith('/') && configuredPath !== '/' ? configuredPath.slice(0, -1) : configuredPath;
  if (cleanPath === '/') return true;
  return changedPath === cleanPath || changedPath.startsWith(`${cleanPath}/`) || cleanPath.startsWith(`${changedPath}/`);
};
const impactedJourneys = journeys
  .filter((journey) => Array.isArray(journey.paths) && journey.paths.some((configuredPath) => changedPaths.some((changedPath) => pathMatches(changedPath, configuredPath))))
  .map((journey) => journey.id)
  .sort();
const mappedPaths = new Set();
for (const journey of journeys) {
  for (const configuredPath of journey.paths || []) {
    for (const changedPath of changedPaths) if (pathMatches(changedPath, configuredPath)) mappedPaths.add(changedPath);
  }
}
const unmappedChangedPaths = changedPaths.filter((path) => !mappedPaths.has(path));
const hasChanges = changedPaths.length > 0 || (current.errors || []).length > 0;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baselineExists,
  hasChanges,
  summary: {
    addedPages: addedPages.length,
    removedPages: removedPages.length,
    changedPages: changedPages.length,
    unavailablePages: (current.errors || []).length,
  },
  addedPages,
  removedPages,
  changedPages,
  unavailablePages: current.errors || [],
  impactedJourneys,
  unmappedChangedPaths,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(resolve(reportDir, 'change-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

const markdown = [];
markdown.push('# Application change report', '');
markdown.push(`Generated: ${report.generatedAt}`, '');
if (!baselineExists) markdown.push('No reviewed baseline exists. Every discovered page is currently considered new.', '');
markdown.push('## Summary', '');
markdown.push(`- Added pages: ${report.summary.addedPages}`);
markdown.push(`- Removed pages: ${report.summary.removedPages}`);
markdown.push(`- Changed pages: ${report.summary.changedPages}`);
markdown.push(`- Unavailable pages: ${report.summary.unavailablePages}`, '');

if (addedPages.length) markdown.push('## Added pages', '', ...addedPages.map((path) => `- ${markdownSafe(path)}`), '');
if (removedPages.length) markdown.push('## Removed pages', '', ...removedPages.map((path) => `- ${markdownSafe(path)}`), '');
if (changedPages.length) {
  markdown.push('## Changed pages', '');
  for (const page of changedPages) {
    markdown.push(`### ${markdownSafe(page.path)}`, '');
    if (page.titleChanged) markdown.push('- Page title changed');
    for (const heading of page.headingsAdded) markdown.push(`- Added heading: ${markdownSafe(heading)}`);
    for (const heading of page.headingsRemoved) markdown.push(`- Removed heading: ${markdownSafe(heading)}`);
    for (const control of page.controlsAdded) markdown.push(`- Added control: ${describeControl(control)}`);
    for (const control of page.controlsRemoved) markdown.push(`- Removed control: ${describeControl(control)}`);
    for (const link of page.linksAdded) markdown.push(`- Added link: ${describeLink(link)}`);
    for (const link of page.linksRemoved) markdown.push(`- Removed link: ${describeLink(link)}`);
    if (page.formsChanged) markdown.push('- Form structure changed');
    if (page.tablesChanged) markdown.push('- Table structure changed');
    markdown.push('');
  }
}
if (report.unavailablePages.length) {
  markdown.push('## Pages unavailable during discovery', '');
  for (const page of report.unavailablePages) markdown.push(`- ${markdownSafe(page.path)}: ${markdownSafe(page.error)}`);
  markdown.push('');
}
markdown.push('## Potentially impacted journeys', '');
markdown.push(...(impactedJourneys.length ? impactedJourneys.map((id) => `- ${markdownSafe(id)}`) : ['- None mapped']), '');
if (unmappedChangedPaths.length) {
  markdown.push('## Changed paths without journey mapping', '', ...unmappedChangedPaths.map((path) => `- ${markdownSafe(path)}`), '');
}
markdown.push('Review these differences before changing tests. After affected tests pass, run `npm run sync:accept` to record the new baseline.', '');
writeFileSync(resolve(reportDir, 'change-report.md'), `${markdown.join('\n')}\n`, { mode: 0o600 });

console.log(`Sync report: ${addedPages.length} added, ${removedPages.length} removed, ${changedPages.length} changed, ${(current.errors || []).length} unavailable.`);
if (impactedJourneys.length) console.log(`Potentially impacted journeys: ${impactedJourneys.join(', ')}`);
if (unmappedChangedPaths.length) console.log(`Changed paths without journey mapping: ${unmappedChangedPaths.join(', ')}`);
if (!hasChanges) console.log('Application inventory matches the reviewed baseline.');
if (hasChanges && failOnChange) process.exit(2);
