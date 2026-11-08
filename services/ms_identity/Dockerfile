# Build context: repository root
FROM node:24-bookworm-slim AS infrastructure
WORKDIR /packages/shared-infrastructure
COPY packages/shared-infrastructure/package*.json packages/shared-infrastructure/tsconfig.json ./
COPY packages/shared-infrastructure/src ./src
RUN npm ci --ignore-scripts && npm run build

FROM infrastructure AS dependencies
WORKDIR /app
COPY services/ms_identity/package.json services/ms_identity/package-lock.json services/ms_identity/.npmrc ./
RUN SCARF_ANALYTICS=false npm ci
FROM dependencies AS build
COPY services/ms_identity/nest-cli.json services/ms_identity/tsconfig*.json ./
COPY services/ms_identity/src ./src
RUN npm run build
FROM infrastructure AS production-dependencies
WORKDIR /app
COPY services/ms_identity/package.json services/ms_identity/package-lock.json services/ms_identity/.npmrc ./
RUN SCARF_ANALYTICS=false npm ci --omit=dev && npm cache clean --force
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/ms_identity/package.json ./
USER node
EXPOSE 3011
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3011)+'/api/v2/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
