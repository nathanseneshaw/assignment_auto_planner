FROM node:20-bookworm

WORKDIR /app

# Pin the browser cache to a fixed absolute path so it is immune to
# Render overriding HOME=/opt/render at container runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers

COPY package.json package-lock.json ./

# Prevent Playwright's npm postinstall hook from auto-downloading browsers;
# we install them explicitly in the next step so the version matches exactly.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install production dependencies only (skips Vite, Tailwind, PostCSS, etc.)
RUN npm ci --omit=dev

# apt-get update must run in the same layer as --with-deps so the package lists
# are fresh when Playwright calls apt-get install internally.
# The full bookworm image (not slim) is required so dpkg is fully initialised.
RUN apt-get update && \
    npx playwright install chromium --with-deps && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
