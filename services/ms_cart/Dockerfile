# Contexto de build: raiz del repositorio
FROM node:24-bookworm-slim AS infrastructure
WORKDIR /packages/shared-infrastructure
COPY packages/shared-infrastructure/package*.json packages/shared-infrastructure/tsconfig.json ./
COPY packages/shared-infrastructure/src ./src
COPY packages/shared-infrastructure/sql ./sql
RUN npm ci --ignore-scripts && npm run build

FROM infrastructure AS build
WORKDIR /app
COPY services/ms_cart/package*.json services/ms_cart/.npmrc ./
RUN npm ci
COPY services/ms_cart/tsconfig*.json ./
COPY services/ms_cart/nest-cli.json ./
COPY services/ms_cart/src ./src
RUN npm run build

FROM infrastructure AS production-dependencies
WORKDIR /app
COPY services/ms_cart/package*.json services/ms_cart/.npmrc ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/ms_cart/package.json ./
COPY --chown=node:node contracts/grpc/inventory.proto ./contracts/grpc/inventory.proto
ENV INVENTORY_PROTO_PATH=/app/contracts/grpc/inventory.proto
USER node
CMD ["node", "dist/main.js"]
