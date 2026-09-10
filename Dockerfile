ARG NODE_VERSION=24-alpine

# The app has no native dependencies, so everything is built once on the native
# builder architecture and the per-arch runtime stage only copies files. That
# keeps the arm64 image from being assembled under QEMU emulation.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS builder
WORKDIR /build

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund

COPY web/ web/
RUN cd web && npm run build

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

COPY server/src server/src

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/app/data/babysitting.db
WORKDIR /app

RUN addgroup -S app && adduser -S -G app app \
 && mkdir -p /app/data && chown -R app:app /app

COPY --from=builder --chown=app:app /build/server/node_modules ./node_modules
COPY --from=builder --chown=app:app /build/server/src          ./src
COPY --from=builder --chown=app:app /build/server/public       ./public
COPY --chown=app:app server/package.json                       ./package.json

USER app
EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings=ExperimentalWarning", "src/index.js"]
