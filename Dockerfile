FROM node:20-alpine

# Alpine's Chromium package is compiled for musl/Alpine and is maintained
# by the Alpine security team — far fewer CVEs than Debian-based images.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Skip Playwright's CDN browser download; we use the system Chromium above.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# playwright-launch.js reads CHROMIUM_PATH and passes it as executablePath.
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
