FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# Strip dev dependencies in place so the production stage can reuse node_modules
# without a second npm ci (two parallel installs OOM the build).
RUN npm prune --omit=dev

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
# Role (api | worker) is selected at runtime via APP_ROLE; both share this image (D-008).
CMD ["node", "dist/main.js"]
