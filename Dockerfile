FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
COPY . .
RUN npm run db:generate

FROM base AS api
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["npm", "run", "start", "-w", "@resonance/api"]

FROM base AS web-build
ENV API_URL=http://api:4000
RUN npm run build -w @resonance/web

FROM web-build AS web
ENV NODE_ENV=production
EXPOSE 3000
RUN chown -R node:node /app/apps/web/.next
USER node
CMD ["npm", "run", "start", "-w", "@resonance/web"]
