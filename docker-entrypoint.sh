#!/bin/sh
set -eu

cd /work/suite

if [ ! -f package.json ]; then
  echo "No generated suite found in ./suite. Ask the skill to scaffold the suite first." >&2
  exit 2
fi

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  echo "Warning: suite/package-lock.json is missing; using npm install. Commit the lockfile for reproducible CI." >&2
  npm install --no-audit --no-fund
fi

exec "$@"
