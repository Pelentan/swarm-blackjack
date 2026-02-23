FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY public ./public
COPY src ./src
ARG REACT_APP_GATEWAY_URL=http://localhost:8080
ENV REACT_APP_GATEWAY_URL=$REACT_APP_GATEWAY_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
