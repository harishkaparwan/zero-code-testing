#!/usr/bin/env node
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const requireSecrets = process.argv.includes('--require-secrets');
const configPath = resolve(process.env.E2E_CONFIG || 'e2e.config.yaml');
if (!existsSync(configPath)) {
  console.error(`Missing ${configPath}`);
  process.exit(1);
}

let config;
try {
  config = parse(readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(`Invalid YAML: ${error.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

if (!isObject(config?.app)) errors.push('app is required');
if (!text(config?.app?.name)) errors.push('app.name is required');
if (!text(config?.app?.url)) errors.push('app.url is required');

let appUrl;
try {
  appUrl = new URL(config.app.url);
  if (!['http:', 'https:'].includes(appUrl.protocol)) errors.push('app.url must use http:// or https://');
  if (appUrl.username || appUrl.password) errors.push('app.url must not contain credentials');
} catch {
  errors.push('app.url must be an absolute URL');
}

if (config.app.start_url !== undefined) {
  try {
    const startUrl = new URL(config.app.start_url);
    if (appUrl && startUrl.origin !== appUrl.origin) errors.push('app.start_url must stay on the same origin as app.url');
    if (startUrl.username || startUrl.password) errors.push('app.start_url must not contain credentials');
  } catch {
    errors.push('app.start_url must be an absolute URL');
  }
}

if (config.app.authorization_confirmed !== true) {
  warnings.push('app.authorization_confirmed is not true; mutating journeys will be blocked by the runner');
}

const preflight = config.preflight;
if (!isObject(preflight)) errors.push('preflight is required');
if (preflight?.enabled !== true) errors.push('preflight.enabled must be true so generation cannot bypass reachability checks');
if (preflight?.timeout_ms !== undefined && (!Number.isInteger(preflight.timeout_ms) || preflight.timeout_ms < 1_000 || preflight.timeout_ms > 120_000)) {
  errors.push('preflight.timeout_ms must be an integer from 1000 to 120000');
}
if (preflight?.max_age_minutes !== undefined && (!Number.isInteger(preflight.max_age_minutes) || preflight.max_age_minutes < 1 || preflight.max_age_minutes > 1_440)) {
  errors.push('preflight.max_age_minutes must be an integer from 1 to 1440');
}
for (const field of ['run_before_execution', 'screenshot', 'fail_on_console_errors', 'fail_on_request_errors']) {
  if (preflight?.[field] !== undefined && typeof preflight[field] !== 'boolean') errors.push(`preflight.${field} must be true or false`);
}

const redirectOrigins = preflight?.allowed_redirect_origins;
if (redirectOrigins !== undefined && (!Array.isArray(redirectOrigins) || redirectOrigins.some((origin) => !text(origin)))) {
  errors.push('preflight.allowed_redirect_origins must be an array of absolute origins');
} else {
  for (const origin of redirectOrigins || []) {
    try {
      const parsedOrigin = new URL(origin);
      if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin.replace(/\/$/, '')) {
        errors.push(`preflight redirect entry must be an origin without a path: ${origin}`);
      }
      if (parsedOrigin.username || parsedOrigin.password) errors.push(`preflight redirect origin must not contain credentials: ${origin}`);
    } catch {
      errors.push(`invalid preflight redirect origin: ${origin}`);
    }
  }
}

const preflightPages = Array.isArray(preflight?.pages) ? preflight.pages : [];
if (preflightPages.length === 0) errors.push('preflight.pages must contain at least one page');
const preflightIds = new Set();
for (const [index, page] of preflightPages.entries()) {
  if (!isObject(page) || !text(page.id)) errors.push(`preflight.pages[${index}].id is required`);
  else if (!/^[A-Za-z0-9_-]+$/.test(page.id)) errors.push(`preflight page id must contain only letters, numbers, hyphens, and underscores: ${page.id}`);
  else if (preflightIds.has(page.id)) errors.push(`duplicate preflight page id: ${page.id}`);
  else preflightIds.add(page.id);

  const pageLocation = page?.url ?? page?.path;
  if (pageLocation !== undefined && !text(pageLocation)) errors.push(`preflight page ${page?.id || index} URL/path must be non-empty`);
  if (page?.url !== undefined && page?.path !== undefined) errors.push(`preflight page ${page?.id || index} must use path or url, not both`);
  if (text(pageLocation) && appUrl) {
    try {
      const resolvedPage = new URL(pageLocation, config.app.start_url || config.app.url);
      if (!['http:', 'https:'].includes(resolvedPage.protocol)) errors.push(`preflight page ${page?.id || index} must use http:// or https://`);
      if (resolvedPage.origin !== appUrl.origin) errors.push(`preflight page ${page?.id || index} must begin on the app origin`);
      if (resolvedPage.username || resolvedPage.password) errors.push(`preflight page ${page?.id || index} must not contain credentials`);
    } catch {
      errors.push(`invalid preflight URL/path for ${page?.id || index}`);
    }
  }
  if (page?.wait_until !== undefined && !['load', 'domcontentloaded', 'networkidle', 'commit'].includes(page.wait_until)) {
    errors.push(`preflight page ${page?.id || index}.wait_until is invalid`);
  }
  if (page?.status_range !== undefined && (!Array.isArray(page.status_range) || page.status_range.length !== 2 || page.status_range.some((status) => !Number.isInteger(status) || status < 100 || status > 599) || page.status_range[0] > page.status_range[1])) {
    errors.push(`preflight page ${page?.id || index}.status_range must be [minimum, maximum] HTTP statuses`);
  }
  if (page?.minimum_dom_chars !== undefined && (!Number.isInteger(page.minimum_dom_chars) || page.minimum_dom_chars < 0)) {
    errors.push(`preflight page ${page?.id || index}.minimum_dom_chars must be a non-negative integer`);
  }
  if (page?.expect !== undefined && !isObject(page.expect)) errors.push(`preflight page ${page?.id || index}.expect must be a mapping`);
  for (const field of ['selector', 'title_contains', 'text_contains']) {
    if (page?.expect?.[field] !== undefined && !text(page.expect[field])) errors.push(`preflight page ${page?.id || index}.expect.${field} must be non-empty text`);
  }
}

const discovery = config.discovery;
if (!isObject(discovery)) errors.push('discovery is required');
if (discovery?.enabled !== true) errors.push('discovery.enabled must be true for application change detection');
if (discovery?.max_pages !== undefined && (!Number.isInteger(discovery.max_pages) || discovery.max_pages < 1 || discovery.max_pages > 200)) {
  errors.push('discovery.max_pages must be an integer from 1 to 200');
}
if (discovery?.timeout_ms !== undefined && (!Number.isInteger(discovery.timeout_ms) || discovery.timeout_ms < 1_000 || discovery.timeout_ms > 120_000)) {
  errors.push('discovery.timeout_ms must be an integer from 1000 to 120000');
}
if (discovery?.follow_links !== undefined && typeof discovery.follow_links !== 'boolean') errors.push('discovery.follow_links must be true or false');
for (const field of ['start_paths', 'include_path_prefixes', 'exclude_path_patterns', 'ignore_text_patterns']) {
  if (discovery?.[field] !== undefined && (!Array.isArray(discovery[field]) || discovery[field].some((value) => !text(value)))) {
    errors.push(`discovery.${field} must be an array of non-empty strings`);
  }
}
if (!Array.isArray(discovery?.start_paths) || discovery.start_paths.length === 0) errors.push('discovery.start_paths must contain at least one safe path');
if (!Array.isArray(discovery?.include_path_prefixes) || discovery.include_path_prefixes.length === 0) errors.push('discovery.include_path_prefixes must contain at least one path prefix');
for (const prefix of discovery?.include_path_prefixes || []) {
  if (!prefix.startsWith('/')) errors.push(`discovery include prefix must start with /: ${prefix}`);
}
for (const location of discovery?.start_paths || []) {
  try {
    const discoveryUrl = new URL(location, config.app.start_url || config.app.url);
    if (appUrl && discoveryUrl.origin !== appUrl.origin) errors.push(`discovery start path must stay on the app origin: ${location}`);
    if (discoveryUrl.username || discoveryUrl.password) errors.push(`discovery start path must not contain credentials: ${location}`);
  } catch {
    errors.push(`invalid discovery start path: ${location}`);
  }
}
for (const field of ['exclude_path_patterns', 'ignore_text_patterns']) {
  for (const pattern of discovery?.[field] || []) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`invalid regular expression in discovery.${field}: ${pattern}`);
    }
  }
}

const roles = Array.isArray(config.roles) ? config.roles : [];
const roleNames = new Set();
for (const [index, role] of roles.entries()) {
  if (!isObject(role) || !text(role.name)) errors.push(`roles[${index}].name is required`);
  else if (roleNames.has(role.name)) errors.push(`duplicate role name: ${role.name}`);
  else roleNames.add(role.name);
  if (role?.username !== undefined || role?.password !== undefined || role?.token !== undefined) {
    errors.push(`roles[${index}] must reference *_env variables; do not store credentials in YAML`);
  }
  if (role?.username_env !== undefined && !text(role.username_env)) errors.push(`roles[${index}].username_env must be a non-empty environment variable name`);
  if (role?.password_env !== undefined && !text(role.password_env)) errors.push(`roles[${index}].password_env must be a non-empty environment variable name`);
  for (const envName of [role?.username_env, role?.password_env]) {
    if (envName && !/^[A-Z][A-Z0-9_]*$/.test(envName)) errors.push(`invalid environment variable name: ${envName}`);
  }
  const missing = [role?.username_env, role?.password_env].filter((envName) => envName && !process.env[envName]);
  if (missing.length > 0) {
    const message = `${role?.name || `roles[${index}]`} is missing ${missing.join(' and ')}`;
    if (requireSecrets) errors.push(message);
    else warnings.push(message);
  }
}

const journeys = Array.isArray(config.journeys) ? config.journeys : [];
const journeyIds = new Set();
for (const [index, journey] of journeys.entries()) {
  if (!isObject(journey) || !text(journey.id)) errors.push(`journeys[${index}].id is required`);
  else if (!/^[A-Za-z0-9_-]+$/.test(journey.id)) errors.push(`journey id must contain only letters, numbers, hyphens, and underscores: ${journey.id}`);
  else if (journeyIds.has(journey.id)) errors.push(`duplicate journey id: ${journey.id}`);
  else journeyIds.add(journey.id);
  if (!text(journey?.description)) errors.push(`journeys[${index}].description is required`);
  if (journey?.role && !roleNames.has(journey.role)) errors.push(`journey ${journey?.id || index} references unknown role ${journey.role}`);
  if (journey?.tags !== undefined && (!Array.isArray(journey.tags) || journey.tags.some((tag) => !text(tag)))) errors.push(`journey ${journey?.id || index}.tags must be an array of non-empty strings`);
  if (!Array.isArray(journey?.paths) || journey.paths.length === 0 || journey.paths.some((path) => !text(path) || !path.startsWith('/'))) {
    errors.push(`journey ${journey?.id || index}.paths must contain at least one application path beginning with /`);
  }
}

const policy = config.model_policy || {};
for (const section of ['code_generation', 'execution', 'failure_analysis', 'escalation']) {
  if (policy[section] !== undefined && !isObject(policy[section])) errors.push(`model_policy.${section} must be a mapping`);
}
if (!isObject(config.execution)) errors.push('execution is required');
if (config.execution?.safe_mode !== true) warnings.push('execution.safe_mode is not true; review mutation policy carefully');
if (config.execution?.workers !== undefined && (!Number.isInteger(config.execution.workers) || config.execution.workers < 1)) errors.push('execution.workers must be a positive integer');
if (config.execution?.retries !== undefined && (!Number.isInteger(config.execution.retries) || config.execution.retries < 0)) errors.push('execution.retries must be a non-negative integer');
if (config.execution?.browser !== undefined && config.execution.browser !== 'chromium') errors.push('the Docker runner currently supports browser: chromium only');
if (config.execution?.mode !== undefined && !['smoke', 'full'].includes(config.execution.mode)) errors.push('execution.mode must be smoke or full');

if (errors.length > 0) {
  console.error('Configuration is invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Configuration valid: ${config.app.name} (${config.app.environment || 'unspecified environment'})`);
console.log(`Preflight pages: ${preflightPages.length} · Discovery limit: ${discovery?.max_pages || 'unspecified'} · Roles: ${roles.length} · Journeys: ${journeys.length} · Code generation: ${policy.code_generation?.provider || 'unspecified'}/${policy.code_generation?.model || 'unspecified'} · Execution: ${policy.execution?.provider || 'unspecified'}/${policy.execution?.model || 'unspecified'}`);
for (const warning of warnings) console.log(`WARNING: ${warning}`);
