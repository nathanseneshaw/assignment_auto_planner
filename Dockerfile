FROM mcr.microsoft.com/playwright:v1.59.0-noble

WORKDIR /app

# Tell Playwright npm package not to re-download browsers (they're already in the image)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy root package manifests (server uses root node_modules)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy server source and shared utilities it imports
COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

# Force headless + production mode in container
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
