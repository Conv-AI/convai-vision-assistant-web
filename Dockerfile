# The app and its /api routes in one image. The Convai API key is given when the
# container starts, never at build time:
#
#   docker build -t vision-assistant .
#   docker run --env-file .env.local -p 8080:8080 vision-assistant

# Build: the whole repository, so `pnpm build` can type-check it.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Run: the built app and the server only, with no dependency installed.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# package.json says "type": "module", which is how Node loads the server's files.
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/handler.ts /app/server/http.ts /app/server/start.ts ./server/
USER node
EXPOSE 8080
CMD ["node", "server/start.ts"]
