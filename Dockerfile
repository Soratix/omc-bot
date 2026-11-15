# syntax=docker/dockerfile:1

# ── Étape 1 : compilation TypeScript ──────────────────────────────
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Étape 2 : dépendances de production uniquement ────────────────
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Étape 3 : image finale légère, utilisateur non-root ───────────
FROM node:26-alpine
# tzdata pour l'heure de Paris ; npm est retiré de l'image finale (inutile à l'exécution).
RUN apk add --no-cache tzdata \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production \
    TZ=Europe/Paris
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist/index.js"]
