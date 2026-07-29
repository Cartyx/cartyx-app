FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/.cache

FROM node:22-alpine
ENV NODE_ENV=production
# ffmpeg carries ffprobe; both are required by src/ffmpeg.ts.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
USER node
CMD ["node", "dist/index.js"]
