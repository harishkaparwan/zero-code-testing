import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { stringify } from 'yaml';

const compareScript = resolve('scripts/compare-inventory.mjs');

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'zero-code-sync-'));
  const config = {
    app: { url: 'https://example.test', start_url: 'https://example.test/' },
    preflight: { max_age_minutes: 30 },
    journeys: [{ id: 'offers', paths: ['/offers'] }],
  };
  const configText = stringify(config);
  const configPath = resolve(root, 'e2e.config.yaml');
  const currentPath = resolve(root, 'reports/current.json');
  const baselinePath = resolve(root, 'baseline/inventory.json');
  const reportDir = resolve(root, 'reports/sync');
  write(configPath, configText);
  const env = {
    ...process.env,
    E2E_CONFIG: configPath,
    DISCOVERY_OUTPUT: currentPath,
    DISCOVERY_BASELINE: baselinePath,
    SYNC_REPORT_DIR: reportDir,
  };
  const makeInventory = (pages, extra = {}) => ({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configSha256: createHash('sha256').update(configText).digest('hex'),
    appOrigin: 'https://example.test',
    pageCount: pages.length,
    truncated: false,
    pages,
    errors: [],
    ...extra,
  });
  const page = (path, semantic = {}) => ({
    path,
    status: 200,
    semantic: { title: '', headings: [], controls: [], forms: [], tables: [], links: [], ...semantic },
  });
  const run = (...args) => spawnSync(process.execPath, [compareScript, ...args], { env, encoding: 'utf8' });
  return { root, currentPath, baselinePath, reportDir, makeInventory, page, run };
}

test('creates an initial change report and accepts a reviewed baseline', () => {
  const f = fixture();
  write(f.currentPath, JSON.stringify(f.makeInventory([f.page('/'), f.page('/offers')])))
  const first = f.run('check');
  assert.equal(first.status, 0, first.stderr);
  const initial = JSON.parse(readFileSync(resolve(f.reportDir, 'change-report.json'), 'utf8'));
  assert.equal(initial.baselineExists, false);
  assert.deepEqual(initial.addedPages, ['/', '/offers']);

  const accepted = f.run('accept');
  assert.equal(accepted.status, 0, accepted.stderr);
  const unchanged = f.run('check');
  assert.equal(unchanged.status, 0, unchanged.stderr);
  const report = JSON.parse(readFileSync(resolve(f.reportDir, 'change-report.json'), 'utf8'));
  assert.equal(report.hasChanges, false);
});

test('maps structural changes to journeys and fails the CI drift gate', () => {
  const f = fixture();
  const before = f.makeInventory([f.page('/offers')]);
  write(f.baselinePath, JSON.stringify(before));
  const after = f.makeInventory([
    f.page('/offers', { controls: [{ role: 'button', name: 'Duplicate offer' }] }),
    f.page('/bulk'),
  ]);
  write(f.currentPath, JSON.stringify(after));

  const result = f.run('check', '--fail-on-change');
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(readFileSync(resolve(f.reportDir, 'change-report.json'), 'utf8'));
  assert.deepEqual(report.impactedJourneys, ['offers']);
  assert.deepEqual(report.unmappedChangedPaths, ['/bulk']);
  assert.equal(report.changedPages[0].controlsAdded[0].name, 'Duplicate offer');
});

test('does not misclassify an unavailable page as removed and refuses acceptance', () => {
  const f = fixture();
  write(f.baselinePath, JSON.stringify(f.makeInventory([f.page('/offers')])))
  write(f.currentPath, JSON.stringify(f.makeInventory([], { errors: [{ path: '/offers', error: 'HTTP 503' }] })));

  const checked = f.run('check');
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(readFileSync(resolve(f.reportDir, 'change-report.json'), 'utf8'));
  assert.deepEqual(report.removedPages, []);
  assert.equal(report.unavailablePages.length, 1);
  const accepted = f.run('accept');
  assert.equal(accepted.status, 1);
});

test('blocks incomplete inventories that reached the crawl limit', () => {
  const f = fixture();
  write(f.currentPath, JSON.stringify(f.makeInventory([f.page('/')], { truncated: true, undiscoveredDueToLimit: 1 })));
  const result = f.run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reached max_pages/);
});
