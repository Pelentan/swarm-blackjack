FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json index.ts ./
RUN npx tsc

FROM node:20-slim
WORKDIR /app
COPY --from=busybox:stable-musl /bin/wget /usr/local/bin/wget
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3011
CMD ["node", "dist/index.js"]
