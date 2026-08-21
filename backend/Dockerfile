# --- build stage ------------------------------------------------------------
FROM node:20-slim AS build

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm ci installs exactly the lockfile, so the image cannot drift from what was
# reviewed and scanned.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Drop dev dependencies from the tree that gets copied forward.
RUN npm prune --omit=dev

# --- runtime stage ----------------------------------------------------------
FROM node:20-slim AS runtime

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

# The base image ships an unprivileged `node` user. Running as root inside a
# container that handles PII gives a code-execution bug more room than it needs.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node package.json ./

USER node

EXPOSE 3001

CMD ["node", "dist/index.js"]
