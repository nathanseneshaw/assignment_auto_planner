FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install BOTH chromium and chromium-headless-shell. The default headless mode
# in Playwright 1.49+ uses chrome-headless-shell — a separate binary from the
# full Chromium browser. Without it, launching with headless: true fails even
# if chromium is installed.
#
# PLAYWRIGHT_BROWSERS_PATH is an absolute path (not HOME-relative), so Render's
# runtime HOME=/opt/render override can't change where Playwright looks.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium chromium-headless-shell

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
