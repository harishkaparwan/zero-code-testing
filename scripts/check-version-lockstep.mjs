#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const suitePackage = JSON.parse(readFileSync('assets/template/package.json', 'utf8'));
const dockerfile = readFileSync('Dockerfile', 'utf8');

const rootVersion = rootPackage.dependencies?.playwright;
const suiteVersion = suitePackage.devDependencies?.['@playwright/test']?.replace(/^[~^]/, '');
const dockerVersion = dockerfile.match(/mcr\.microsoft\.com\/playwright:v([0-9.]+)-/)?.[1];
const versions = { root: rootVersion, suiteTemplate: suiteVersion, dockerImage: dockerVersion };

if (!rootVersion || !suiteVersion || !dockerVersion || new Set(Object.values(versions)).size !== 1) {
  console.error('Playwright versions are not synchronized:');
  for (const [location, version] of Object.entries(versions)) console.error(`- ${location}: ${version || 'missing'}`);
  process.exit(1);
}

console.log(`Playwright version lockstep passed: ${rootVersion}`);
