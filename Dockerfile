FROM mcr.microsoft.com/playwright:v1.59.1-noble

# Stay in /app as your base of operations
WORKDIR /app

# Copy dependency files and install
COPY package.json package-lock.json ./
# Clean install for production (ignores devDependencies)
RUN npm ci --omit=dev

# Verify browser binaries are present — fails the build early if the image is wrong
RUN ls /ms-playwright/

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

# Copy your code folders while maintaining the structure
COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

# Run the command FROM the root /app 
# This ensures index.js can find node_modules in /app/node_modules
CMD ["node", "src/server/index.js"]