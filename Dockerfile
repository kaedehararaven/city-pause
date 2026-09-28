# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm test
RUN --mount=type=secret,id=browser_ak,required=true \
    VITE_BAIDU_BROWSER_AK="$(cat /run/secrets/browser_ak)" pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server-dist ./server-dist
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server-dist/production.js"]
