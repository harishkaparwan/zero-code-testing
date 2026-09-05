#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

try {
  execFileSync(process.execPath, ['scripts/validate-config.mjs'], { stdio: 'inherit' });
  execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('Docker is required for the containerized preflight. Install/start Docker, then retry.');
  } else {
    console.error('Preflight prerequisites failed. Review the configuration and make sure Docker is running.');
  }
  process.exit(1);
}

try {
  execFileSync('docker', ['compose', 'run', '--rm', '--build', 'preflight'], { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}
