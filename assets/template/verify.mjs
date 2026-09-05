#!/usr/bin/env node
/** Validate a generated suite before it is packaged or handed off. */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const run = (command) => execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let failed = false;
const ok = (message) => console.log(`  PASS  ${message}`);
const bad = (message, detail) => {
  failed = true;
  console.log(`  FAIL  ${message}`);
  if (detail) console.log(String(detail).split('\n').slice(0, 12).join('\n'));
};

function featureFiles(dir = 'features') {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (entry.endsWith('.feature')) files.push(path);
    }
  };
  if (existsSync(dir)) visit(dir);
  return files;
}

/** Count concrete scenario instances, including multiple Examples blocks. */
function countScenarioInstances(text) {
  const lines = text.split(/\r?\n/);
  let total = 0;
  let inOutline = false;
  let inExamples = false;
  let sawExamplesHeader = false;
  let inDocString = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('"""')) {
      inDocString = !inDocString;
      continue;
    }
    if (inDocString || !trimmed || trimmed.startsWith('#')) continue;

    if (/^Scenario Outline\s*:/i.test(trimmed)) {
      inOutline = true;
      inExamples = false;
      sawExamplesHeader = false;
      continue;
    }
    if (/^Scenario\s*:/i.test(trimmed)) {
      inOutline = false;
      inExamples = false;
      sawExamplesHeader = false;
      total++;
      continue;
    }
    if (inOutline && /^Examples\s*:/i.test(trimmed)) {
      inExamples = true;
      sawExamplesHeader = false;
      continue;
    }
    if (inExamples && /^\|.*\|$/.test(trimmed)) {
      if (sawExamplesHeader) total++;
      else sawExamplesHeader = true;
      continue;
    }
    if (inExamples && !trimmed.startsWith('@')) {
      inExamples = false;
      sawExamplesHeader = false;
    }
  }
  return total;
}

console.log('\nVerifying test project...\n');

const files = featureFiles();
const scenarios = files.reduce((count, file) => count + countScenarioInstances(readFileSync(file, 'utf8')), 0);
if (files.length === 0) bad('At least one feature file exists');
else ok(`${files.length} feature file(s) found`);
if (scenarios === 0) bad('At least one concrete scenario exists');
else ok(`${scenarios} concrete scenario instance(s) found`);

try {
  run('npx tsc --noEmit');
  ok('TypeScript compiles');
} catch (error) {
  bad('TypeScript compiles', `${error.stdout || ''}${error.stderr || ''}`);
}

try {
  run('npx bddgen');
  ok('Every scenario step has a definition');
} catch (error) {
  bad('Every scenario step has a definition', `${error.stdout || ''}${error.stderr || ''}`);
}

let listed = 0;
try {
  const output = run('npx playwright test --list');
  listed = Number((output.match(/Total:\s*(\d+)\s*tests?/i) || [])[1] || 0);
  if (listed > 0) ok(`Playwright discovered ${listed} test(s) across configured projects`);
  else bad('Playwright discovered at least one test');
} catch (error) {
  bad('Playwright lists tests', `${error.stdout || ''}${error.stderr || ''}`);
}

if (scenarios > 0 && listed >= scenarios) ok('Every concrete scenario is represented by a discovered test');
else if (scenarios > 0) bad(`${scenarios} scenario instance(s) exist but only ${listed} test(s) were discovered`);

console.log(failed ? '\nProject is NOT ready.\n' : '\nProject is complete and runnable.\n');
process.exit(failed ? 1 : 0);
