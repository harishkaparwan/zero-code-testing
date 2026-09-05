#!/usr/bin/env node
/**
 * Generate full or pairwise Gherkin examples from inventory.mjs output.
 *
 * Usage:
 *   node combos.mjs inventory.json [--max 30] [--outdir .] [--submit "Submit"]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const inventoryFile = args[0];
if (!inventoryFile) {
  console.error('Usage: node combos.mjs inventory.json [--max 30] [--outdir .] [--submit "Submit"]');
  process.exit(1);
}

const getArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index > -1 ? args[index + 1] : fallback;
};
const maxFull = Number(getArg('--max', 30));
const outDir = getArg('--outdir', '.');
const submitLabel = getArg('--submit', '');

if (!Number.isInteger(maxFull) || maxFull < 1 || maxFull > 10000) {
  console.error('--max must be an integer from 1 to 10000.');
  process.exit(1);
}
if (!outDir || typeof outDir !== 'string') {
  console.error('--outdir requires a directory path.');
  process.exit(1);
}
if (args.includes('--submit') && typeof submitLabel !== 'string') {
  console.error('--submit requires a visible control name.');
  process.exit(1);
}

let inventory;
try {
  inventory = JSON.parse(readFileSync(inventoryFile, 'utf8'));
} catch (error) {
  console.error(`Could not read inventory JSON: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(inventory.pages)) {
  console.error('Inventory must contain a pages array.');
  process.exit(1);
}

const pairKey = (leftIndex, leftValue, rightIndex, rightValue) =>
  JSON.stringify([leftIndex, String(leftValue), rightIndex, String(rightValue)]);

function cartesian(params) {
  return params.reduce(
    (rows, param) => rows.flatMap((row) => param.values.map((value) => [...row, value])),
    [[]],
  );
}

function requiredPairs(params) {
  const pairs = new Set();
  for (let left = 0; left < params.length; left++) {
    for (let right = left + 1; right < params.length; right++) {
      for (const leftValue of params[left].values) {
        for (const rightValue of params[right].values) {
          pairs.add(pairKey(left, leftValue, right, rightValue));
        }
      }
    }
  }
  return pairs;
}

function missingPairs(params, rows) {
  const missing = requiredPairs(params);
  for (const row of rows) {
    for (let left = 0; left < params.length; left++) {
      for (let right = left + 1; right < params.length; right++) {
        missing.delete(pairKey(left, row[left], right, row[right]));
      }
    }
  }
  return missing;
}

/** Deterministic greedy all-pairs generation. */
function pairwise(params) {
  if (params.length < 2) return cartesian(params);

  const needed = requiredPairs(params);
  const rows = [];
  const maximumProgressSteps = needed.size;

  for (let step = 0; needed.size > 0 && step < maximumProgressSteps; step++) {
    const [seed] = needed;
    const [leftIndex, leftValue, rightIndex, rightValue] = JSON.parse(seed);
    const row = new Array(params.length).fill(null);
    row[leftIndex] = leftValue;
    row[rightIndex] = rightValue;

    for (let column = 0; column < params.length; column++) {
      if (row[column] !== null) continue;
      let bestValue = params[column].values[0];
      let bestGain = -1;
      for (const candidate of params[column].values) {
        let gain = 0;
        for (let other = 0; other < params.length; other++) {
          if (other === column || row[other] === null) continue;
          const key = other < column
            ? pairKey(other, row[other], column, candidate)
            : pairKey(column, candidate, other, row[other]);
          if (needed.has(key)) gain++;
        }
        if (gain > bestGain) {
          bestGain = gain;
          bestValue = candidate;
        }
      }
      row[column] = bestValue;
    }

    for (let left = 0; left < params.length; left++) {
      for (let right = left + 1; right < params.length; right++) {
        needed.delete(pairKey(left, row[left], right, row[right]));
      }
    }
    rows.push(row);
  }

  const missing = missingPairs(params, rows);
  if (missing.size > 0) {
    throw new Error(`Pairwise generation failed: ${missing.size} value pairs are missing.`);
  }
  return rows;
}

const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const uniqueStrings = (values) => [...new Set((values || []).map(oneLine).filter(Boolean))];
const slugify = (value) => oneLine(value)
  .replace(/^https?:\/\//, '')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase()
  .slice(0, 60);
const escapeCell = (value) => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, '\\n');
const escapeStepString = (value) => oneLine(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const quote = (value) => `"${escapeStepString(value)}"`;
const markdownCell = (value) => oneLine(value).replace(/\|/g, '\\|') || '(unnamed)';

function buildParams(page) {
  const params = [];
  for (const group of page.groups || []) {
    const values = uniqueStrings(group.values);
    const id = oneLine(group.id || group.label);
    const label = oneLine(group.label || group.id || 'control');
    if (!id) continue;

    if ((group.kind === 'radio' || group.kind === 'select') && values.length > 1) {
      params.push({ id, label, kind: group.kind, values });
    } else if (group.kind === 'checkbox-group') {
      for (const optionValue of values) {
        params.push({
          id: `${id}:${optionValue}`,
          label: `${label} ${optionValue}`,
          kind: 'checkbox',
          values: ['checked', 'unchecked'],
          groupId: id,
          optionValue,
        });
      }
    }
  }
  return params;
}

function uniqueHeaders(params) {
  const used = new Map();
  return params.map((param, index) => {
    const source = param.kind === 'checkbox'
      ? `${param.groupId}_${param.optionValue}`
      : param.id || `param_${index + 1}`;
    const base = source.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '') || `param_${index + 1}`;
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function safeProduct(params) {
  return params.reduce((product, param) => {
    if (!Number.isFinite(product) || product > Number.MAX_SAFE_INTEGER / param.values.length) return Infinity;
    return product * param.values.length;
  }, 1);
}

mkdirSync(join(outDir, 'features'), { recursive: true });
mkdirSync(join(outDir, 'reports'), { recursive: true });

let matrix = '# Combinatorial coverage matrix\n\n';
matrix += 'This matrix describes generated control-state coverage. App-specific outcome assertions may still be required.\n';
let totalScenarios = 0;
let iteration = 0;
const usedSlugs = new Map();

for (const page of inventory.pages) {
  if (!page || page.error) continue;
  const params = buildParams(page);
  if (params.length === 0) continue;

  let parsedUrl;
  try {
    parsedUrl = new URL(page.url);
  } catch {
    console.warn(`Skipping page with invalid URL: ${oneLine(page.url)}`);
    continue;
  }

  iteration++;
  const product = safeProduct(params);
  const strategy = product <= maxFull ? 'full' : 'pairwise';
  const rows = strategy === 'full' ? cartesian(params) : pairwise(params);
  const pairwiseVerified = strategy === 'pairwise' ? missingPairs(params, rows).size === 0 : null;
  const headers = uniqueHeaders(params);
  totalScenarios += rows.length;

  const path = `${parsedUrl.pathname}${parsedUrl.search}` || '/';
  const pageTitle = oneLine(page.title || page.url);
  const scenarioTitle = submitLabel
    ? 'Every generated combination can be selected and submitted without an obvious page error'
    : 'Every generated combination of controls can be selected';

  let feature = `# Iteration ${iteration} — generated from ${oneLine(page.url)}\n`;
  feature += `# Cartesian size: ${Number.isFinite(product) ? product : 'over Number.MAX_SAFE_INTEGER'}; strategy: ${strategy}`;
  if (strategy === 'pairwise') feature += `; rows: ${rows.length}; all-pairs verified: ${pairwiseVerified ? 'yes' : 'no'}`;
  feature += '\n\n';
  feature += `Feature: Combinatorial control coverage — ${pageTitle}\n\n`;
  feature += `  @combinatorial @iteration-${iteration}\n`;
  feature += `  Scenario Outline: ${scenarioTitle}\n`;
  feature += `    Given I open the page ${quote(path)}\n`;

  for (const [index, param] of params.entries()) {
    const keyword = index === 0 ? 'When' : 'And';
    feature += param.kind === 'checkbox'
      ? `    ${keyword} I set the checkbox ${quote(param.optionValue)} in ${quote(param.groupId)} to "<${headers[index]}>"\n`
      : `    ${keyword} I set ${quote(param.id)} to "<${headers[index]}>"\n`;
  }

  for (const [index, param] of params.entries()) {
    const keyword = index === 0 ? 'Then' : 'And';
    feature += param.kind === 'checkbox'
      ? `    ${keyword} the checkbox ${quote(param.optionValue)} in ${quote(param.groupId)} is "<${headers[index]}>"\n`
      : `    ${keyword} ${quote(param.id)} is set to "<${headers[index]}>"\n`;
  }
  if (submitLabel) feature += `    And I click ${quote(submitLabel)}\n`;
  feature += '    And the page has no obvious error\n';
  feature += '\n    Examples:\n';
  feature += `      | ${headers.join(' | ')} |\n`;
  for (const row of rows) feature += `      | ${row.map(escapeCell).join(' | ')} |\n`;

  const baseSlug = slugify(path) || 'home';
  const slugCount = (usedSlugs.get(baseSlug) || 0) + 1;
  usedSlugs.set(baseSlug, slugCount);
  const fileSlug = slugCount === 1 ? baseSlug : `${baseSlug}-${slugCount}`;
  const file = join(outDir, 'features', `combinatorial-${fileSlug}.feature`);
  writeFileSync(file, feature);

  console.log(`Iteration ${iteration}: ${page.url}`);
  console.log(`  parameters: ${params.length}, cartesian: ${product}, strategy: ${strategy}, scenarios: ${rows.length}`);
  console.log(`  wrote ${file}`);

  matrix += `\n## Iteration ${iteration} — ${markdownCell(pageTitle)}\n\n`;
  matrix += `- Page: ${oneLine(page.url)}\n`;
  matrix += `- Parameters: ${params.length}\n`;
  matrix += `- Cartesian size: ${Number.isFinite(product) ? product : 'over Number.MAX_SAFE_INTEGER'}\n`;
  matrix += `- Strategy: **${strategy}**\n`;
  if (strategy === 'pairwise') matrix += `- All-pairs verification: **${pairwiseVerified ? 'passed' : 'failed'}**\n`;
  matrix += `- Generated rows: **${rows.length}**\n\n`;
  matrix += '| Parameter | Value | Times exercised |\n|---|---|---|\n';
  for (const [index, param] of params.entries()) {
    for (const value of param.values) {
      const count = rows.filter((row) => row[index] === value).length;
      matrix += `| ${markdownCell(param.label)} | ${markdownCell(value)} | ${count}${count === 0 ? ' NOT COVERED' : ''} |\n`;
    }
  }
}

if (iteration === 0) matrix += '\nNo supported multi-option control groups were found.\n';
matrix += `\n---\n\nTotal iterations: ${iteration} · Total generated rows: ${totalScenarios}\n`;
writeFileSync(join(outDir, 'reports', 'coverage-matrix.md'), matrix);
console.log(`\nTotal: ${iteration} iteration(s), ${totalScenarios} generated row(s). Coverage matrix at reports/coverage-matrix.md`);
