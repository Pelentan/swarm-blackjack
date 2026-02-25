FROM node:20-slim AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
ARG VITE_GATEWAY_URL=
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN npm run build

FROM nginx:stable
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
