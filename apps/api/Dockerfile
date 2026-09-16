# ── build ────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp -R src/db/migrations dist/db/migrations

# ── runtime ──────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini curl && addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/storage && chown -R app:app /app
USER app
EXPOSE 3333
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
