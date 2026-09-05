#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const configPath = resolve('e2e.config.yaml');
const suiteFeatures = resolve('suite/features');
if (!existsSync(configPath)) {
  console.error('Missing e2e.config.yaml');
  process.exit(1);
}
if (!existsSync(suiteFeatures)) {
  console.error('Missing suite/features. Generate the suite before checking coverage.');
  process.exit(1);
}

const config = parse(readFileSync(configPath, 'utf8'));
const journeys = Array.isArray(config.journeys) ? config.journeys : [];
const featureFiles = [];
const visit = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) visit(path);
    else if (entry.endsWith('.feature')) featureFiles.push(path);
  }
};
visit(suiteFeatures);
const featureText = featureFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
const uncovered = journeys.filter((journey) => !journey?.id || !new RegExp(`(^|\\s)@${String(journey.id).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(\\s|$)`, 'm').test(featureText));

if (featureFiles.length === 0) {
  console.error('No .feature files found under suite/features.');
  process.exit(1);
}
if (uncovered.length > 0) {
  console.error('Uncovered configured journeys:');
  for (const journey of uncovered) console.error(`- ${journey.id}`);
  process.exit(1);
}

console.log(`Coverage manifest passed: ${journeys.length} configured journey(s) mapped to ${featureFiles.length} feature file(s).`);
