#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const mode = process.argv[2] || 'full';
const allowedModes = new Set(['smoke', 'full', 'list']);
if (!allowedModes.has(mode)) {
  console.error(`Usage: npm run run:smoke | npm run run | npm run run:list`);
  process.exit(1);
}

if (!existsSync(resolve('.env'))) {
  console.error('Missing .env. Copy .env.example to .env and fill test-account values locally.');
  process.exit(1);
}

let config;
try {
  config = parse(readFileSync('e2e.config.yaml', 'utf8'));
} catch (error) {
  console.error(`Invalid e2e.config.yaml: ${error.message}`);
  console.error('Fix the YAML, then rerun npm run validate:config.');
  process.exit(1);
}
execFileSync(process.execPath, ['scripts/validate-config.mjs', '--require-secrets'], { stdio: 'inherit' });
if (config.preflight?.run_before_execution !== false) {
  execFileSync(process.execPath, ['scripts/run-preflight.mjs'], { stdio: 'inherit' });
}
const mutating = (config.journeys || []).some((journey) => journey.mutates === true);
if (mutating && config.execution?.safe_mode === true && config.app?.authorization_confirmed !== true) {
  console.error('Blocked: mutating journeys require app.authorization_confirmed: true.');
  console.error('Use an authorized staging/preview environment and set the flag only after reviewing the exact scope.');
  process.exit(2);
}
if (!existsSync(resolve('suite/package.json'))) {
  console.error('No generated suite found in ./suite. Ask the skill to scaffold and implement it first.');
  process.exit(2);
}
execFileSync(process.execPath, ['scripts/check-coverage.mjs'], { stdio: 'inherit' });

const suiteCommand = mode === 'smoke' ? ['npm', 'run', 'test:smoke'] : mode === 'list' ? ['npm', 'run', 'list'] : ['npm', 'test'];
const runnerEnv = {
  ...process.env,
  BASE_URL: process.env.BASE_URL || config.app.url,
  START_URL: process.env.START_URL || config.app.start_url || config.app.url,
  WORKERS: String(config.execution?.workers ?? 1),
  RETRIES: String(config.execution?.retries ?? 1),
};
execFileSync('docker', ['compose', 'run', '--rm', '--build', 'e2e', ...suiteCommand], { stdio: 'inherit', env: runnerEnv });
