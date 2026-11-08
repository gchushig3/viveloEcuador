# Contexto de build: raiz del repositorio
# docker build -f services/ms_billing_profile/Dockerfile -t ms_billing_profile .
FROM node:22-bookworm-slim AS infrastructure
WORKDIR /packages/shared-infrastructure
COPY packages/shared-infrastructure/package*.json packages/shared-infrastructure/tsconfig.json ./
COPY packages/shared-infrastructure/src ./src
COPY packages/shared-infrastructure/sql ./sql
RUN npm ci --ignore-scripts && npm run build

FROM infrastructure AS build
WORKDIR /app
COPY services/ms_billing_profile/package*.json services/ms_billing_profile/.npmrc ./
RUN npm ci
COPY services/ms_billing_profile/tsconfig*.json services/ms_billing_profile/nest-cli.json ./
COPY services/ms_billing_profile/src ./src
RUN npm run build

FROM infrastructure AS production-dependencies
WORKDIR /app
COPY services/ms_billing_profile/package*.json services/ms_billing_profile/.npmrc ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3009
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/ms_billing_profile/package.json ./
USER node
EXPOSE 3009
CMD ["npm", "run", "start:prod"]