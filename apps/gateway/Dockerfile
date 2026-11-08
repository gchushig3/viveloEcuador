FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/apps/gateway
COPY apps/gateway/package*.json ./
RUN npm ci

FROM dependencies AS build
COPY apps/gateway/nest-cli.json apps/gateway/tsconfig*.json ./
COPY apps/gateway/src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app/apps/gateway
COPY apps/gateway/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
WORKDIR /app/apps/gateway
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app/apps/gateway/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/gateway/dist ./dist
COPY --chown=node:node apps/gateway/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
