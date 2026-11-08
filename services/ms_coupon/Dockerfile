# Build context: repository root
FROM node:22-bookworm-slim AS infrastructure
WORKDIR /packages/shared-infrastructure
COPY packages/shared-infrastructure/package*.json packages/shared-infrastructure/tsconfig.json ./
COPY packages/shared-infrastructure/src ./src
COPY packages/shared-infrastructure/sql ./sql
RUN npm ci --ignore-scripts && npm run build

FROM infrastructure AS build
WORKDIR /app
COPY services/ms_coupon/package*.json services/ms_coupon/.npmrc ./
RUN npm ci
COPY services/ms_coupon/tsconfig*.json services/ms_coupon/nest-cli.json ./
COPY services/ms_coupon/src ./src
RUN npm run build

FROM infrastructure AS production-dependencies
WORKDIR /app
COPY services/ms_coupon/package*.json services/ms_coupon/.npmrc ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3018
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/ms_coupon/package.json ./
USER node
EXPOSE 3018
CMD ["npm", "run", "start:prod"]
