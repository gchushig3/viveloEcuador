FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY services/ms-cliente/package.json services/ms-cliente/package-lock.json ./
RUN npm ci --omit=dev
FROM dependencies AS build
RUN npm ci
COPY services/ms-cliente/nest-cli.json services/ms-cliente/tsconfig*.json ./
COPY services/ms-cliente/src ./src
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3018
CMD ["node","dist/main.js"]
