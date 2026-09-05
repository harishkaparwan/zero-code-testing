#!/usr/bin/env node
/**
 * scaffold.mjs — generate a complete, runnable Playwright + BDD project for ANY web app.
 *
 * Usage: node scaffold.mjs <url> [outputDir]
 * Example: node scaffold.mjs https://shop.example.com e2e-agent/shop-example-com
 *
 * Produces a self-contained project: config, generic step library, page object base,
 * hooks, test data, README, CI workflow, .env.example, .gitignore, verifier.
 * No AI and no network access are required to run the generated project.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(__dirname, '../assets/template');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scaffold.mjs <url> [outputDir]');
  process.exit(1);
}
let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error('URL must be absolute, for example: https://staging.example.com');
  process.exit(1);
}
if (!['http:', 'https:'].includes(parsed.protocol)) {
  console.error('Only http:// and https:// targets are supported.');
  process.exit(1);
}
if (parsed.username || parsed.password) {
  console.error('Do not put credentials in the URL. Use TEST_USER and TEST_PASSWORD in a local .env file.');
  process.exit(1);
}
parsed.hash = '';

const controllerConfigPath = resolve(process.cwd(), 'e2e.config.yaml');
const preflightReportPath = resolve(process.cwd(), 'reports/preflight/report.json');
if (!existsSync(controllerConfigPath) || !existsSync(preflightReportPath)) {
  console.error('A fresh passing browser preflight is required before test generation.');
  console.error('Run npm run preflight from the controller repository, then retry.');
  process.exit(2);
}

let controllerConfig;
let preflightReport;
const controllerConfigText = readFileSync(controllerConfigPath, 'utf8');
try {
  controllerConfig = parseYaml(controllerConfigText);
  preflightReport = JSON.parse(readFileSync(preflightReportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the preflight gate: ${error.message}`);
  console.error('Run npm run preflight again, then retry.');
  process.exit(2);
}

const currentConfigHash = createHash('sha256').update(controllerConfigText).digest('hex');
const configuredOrigin = new URL(controllerConfig.app.url).origin;
if (parsed.origin !== configuredOrigin) {
  console.error(`Scaffold URL origin must match app.url (${configuredOrigin}).`);
  process.exit(2);
}
if (preflightReport.passed !== true || preflightReport.configSha256 !== currentConfigHash) {
  console.error('Preflight is missing, failed, or belongs to a different configuration.');
  console.error('Run npm run preflight again, then retry.');
  process.exit(2);
}
if (!preflightReport.expiresAt || Date.parse(preflightReport.expiresAt) <= Date.now()) {
  console.error('Preflight has expired. Run npm run preflight again before generating tests.');
  process.exit(2);
}

const domain = parsed.hostname.replace(/^www\./, '');
const slug = domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const appName = domain;
const baseUrl = `${parsed.protocol}//${parsed.host}`;
const startUrl = parsed.href;
const outDir = resolve(process.argv[3] || join(process.cwd(), slug));

if (!existsSync(TEMPLATE)) {
  console.error(`Template not found at ${TEMPLATE}`);
  process.exit(1);
}

const relativeToTemplate = relative(TEMPLATE, outDir);
if (relativeToTemplate === '' || (!relativeToTemplate.startsWith('..') && !isAbsolute(relativeToTemplate))) {
  console.error('Output directory cannot be the bundled template or one of its subdirectories.');
  process.exit(1);
}
const existingEntries = existsSync(outDir) ? readdirSync(outDir).filter((entry) => entry !== '.gitkeep') : [];
if (existingEntries.length > 0) {
  console.error(`Output directory is not empty: ${outDir}`);
  console.error('Choose a new directory so existing work is not overwritten.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
cpSync(TEMPLATE, outDir, { recursive: true });

// Dotfiles are stored without the leading dot so they survive packaging; restore them.
const renames = [
  ['gitignore', '.gitignore'],
  ['env.example', '.env.example'],
  ['github', '.github'],
];
for (const [from, to] of renames) {
  const src = join(outDir, from);
  if (existsSync(src)) renameSync(src, join(outDir, to));
}

// Token replacement across all text files.
const tokens = {
  __BASE_URL__: baseUrl,
  __START_URL__: startUrl,
  __APP_NAME__: appName,
  __PROJECT_NAME__: `${slug}-e2e`,
  __DOMAIN__: domain,
  __DATE__: new Date().toISOString().slice(0, 10),
};
const TEXT = /\.(ts|js|mjs|json|md|yml|yaml|feature|example|gitignore)$/i;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.test(entry) && entry !== '.gitignore' && entry !== '.env.example') continue;
    let content = readFileSync(p, 'utf8');
    let changed = false;
    for (const [token, value] of Object.entries(tokens)) {
      if (content.includes(token)) { content = content.replaceAll(token, value); changed = true; }
    }
    if (changed) writeFileSync(p, content);
  }
}
walk(outDir);

for (const d of ['reports', 'artifacts/checkpoints']) mkdirSync(join(outDir, d), { recursive: true });

console.log(`Scaffolded ${appName} project at ${outDir}`);
console.log('Next: write features/*.feature, then run:');
console.log(`  cd ${outDir} && npm install && npx playwright install chromium && npm run verify`);
