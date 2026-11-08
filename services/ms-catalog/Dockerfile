# Build context: repository root
FROM node:24-bookworm-slim AS infrastructure
WORKDIR /packages/shared-infrastructure
COPY packages/shared-infrastructure/package*.json packages/shared-infrastructure/tsconfig.json ./
COPY packages/shared-infrastructure/src ./src
RUN npm ci --ignore-scripts && npm run build

FROM infrastructure AS dependencies
WORKDIR /app
COPY services/ms-catalog/package.json services/ms-catalog/package-lock.json services/ms-catalog/.npmrc ./
RUN npm ci

FROM dependencies AS build
COPY services/ms-catalog/nest-cli.json services/ms-catalog/tsconfig*.json ./
COPY services/ms-catalog/src ./src
RUN npm run build

FROM infrastructure AS production-dependencies
WORKDIR /app
COPY services/ms-catalog/package.json services/ms-catalog/package-lock.json services/ms-catalog/.npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/ms-catalog/package.json ./
COPY --chown=node:node contracts/grpc/inventory.proto ./contracts/grpc/inventory.proto
USER node
EXPOSE 3014
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v2/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
