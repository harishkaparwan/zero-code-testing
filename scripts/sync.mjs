#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const action = process.argv[2] || 'check';
const failOnChange = process.argv.includes('--fail-on-change');
if (!['check', 'accept'].includes(action)) {
  console.error('Usage: node scripts/sync.mjs check [--fail-on-change] | accept');
  process.exit(1);
}

try {
  execFileSync(process.execPath, ['scripts/validate-config.mjs'], { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}

if (action === 'accept') {
  if (existsSync(resolve('suite/features'))) {
    try {
      execFileSync(process.execPath, ['scripts/check-coverage.mjs'], { stdio: 'inherit' });
    } catch (error) {
      console.error('Baseline was not accepted because configured journey coverage is incomplete.');
      process.exit(error.status || 1);
    }
  }
  try {
    execFileSync(process.execPath, ['scripts/compare-inventory.mjs', 'accept'], { stdio: 'inherit' });
  } catch (error) {
    process.exit(error.status || 1);
  }
  process.exit(0);
}

try {
  execFileSync(process.execPath, ['scripts/run-preflight.mjs'], { stdio: 'inherit' });
  execFileSync('docker', ['compose', 'run', '--rm', '--build', 'discovery'], { stdio: 'inherit' });
  const args = ['scripts/compare-inventory.mjs', 'check'];
  if (failOnChange) args.push('--fail-on-change');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
} catch (error) {
  if (error.code === 'ENOENT') console.error('Docker is required for containerized application synchronization.');
  process.exit(error.status || 1);
}
