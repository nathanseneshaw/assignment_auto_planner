FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install Chromium's system libraries (apt packages) at build time as root.
# The browser binary itself is downloaded at runtime via spawnSync in index.js.
# PLAYWRIGHT_BROWSERS_PATH is absolute so Render's HOME=/opt/render override
# cannot change where Playwright looks for the browser.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install-deps chromium
RUN npx playwright install chromium chromium-headless-shell

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
