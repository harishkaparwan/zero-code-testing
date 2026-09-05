# Keep this tag in lockstep with the @playwright/test version in suite/package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /runner
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY scripts/preflight-browser.mjs ./scripts/preflight-browser.mjs
COPY scripts/discover-browser.mjs ./scripts/discover-browser.mjs

WORKDIR /work
COPY docker-entrypoint.sh /usr/local/bin/e2e-entrypoint
RUN chmod +x /usr/local/bin/e2e-entrypoint

ENTRYPOINT ["/usr/local/bin/e2e-entrypoint"]
CMD ["npm", "test"]
