# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Production image for the Plannr Express API, deployed on Render.
#
# The API server is self-contained under src/server and runs off the repo-root
# dependencies (there is no src/server/package.json). The Vue frontend is built
# and hosted separately and points at this API via VITE_API_BASE, so it is
# intentionally NOT bundled in this image.
#
# Required env vars on Render (Dashboard → Environment):
#   SUPABASE_URL, SUPABASE_ANON_KEY  — ICS feed + auth routes
#   ANTHROPIC_API_KEY                — syllabus parsing (keep server-side only)
#   ALLOWED_ORIGINS                  — REQUIRED in production; the server refuses
#                                      to boot with an empty allowlist, e.g.
#                                      https://app.yourdomain.com
#
# Render injects PORT automatically and the server binds 0.0.0.0:$PORT.
# Set the Render "Health Check Path" to /api/health.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim
WORKDIR /app

# `playwright` is pulled in only by the (currently disabled) UTD scraper. Skip
# its browser download so the image stays small and the build stays fast.
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install production dependencies as their own cached layer — re-run only when
# the manifests change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the API server source (the frontend is hosted elsewhere).
COPY src/server ./src/server

# Run unprivileged: the base image ships a non-root `node` user, and uploads use
# multer memoryStorage so no writable volume is required.
USER node

# Documentation only — Render routes traffic to $PORT regardless of EXPOSE.
EXPOSE 3001

# Self-contained health check (Node 22 ships global fetch — no curl needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
