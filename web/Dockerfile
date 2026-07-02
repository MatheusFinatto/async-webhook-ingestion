FROM node:22-slim AS builder
WORKDIR /app
ARG VITE_API_URL=http://localhost:3000
ARG VITE_DEMO_WEBHOOK_HMAC_SECRET=demo-hmac-secret-public
ARG VITE_DEMO_ADMIN_API_KEY=demo-admin-key-public
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEMO_WEBHOOK_HMAC_SECRET=$VITE_DEMO_WEBHOOK_HMAC_SECRET
ENV VITE_DEMO_ADMIN_API_KEY=$VITE_DEMO_ADMIN_API_KEY
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
