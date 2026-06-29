# syntax=docker/dockerfile:1

# ---------- Build stage: install ALL deps (incl. dev) and build ----------
FROM node:22-slim AS build
WORKDIR /app

# Install dependencies against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (vite -> dist/) and bundle the server (esbuild -> dist/server.cjs).
COPY . .
RUN npm run build

# ---------- Runtime stage: only production deps + built artifacts ----------
FROM node:22-slim AS runtime
WORKDIR /app

# NODE_ENV=production makes the server serve the prebuilt dist/ (static) and skip
# the dev-only vite middleware, so `vite` is never required at runtime.
ENV NODE_ENV=production
# Cloud Run injects PORT (8080); the server already honors process.env.PORT.
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the build output from the build stage.
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.cjs"]
