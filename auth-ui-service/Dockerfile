FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o auth-ui-service .

# Scratch container — static binary, no shell, no attack surface
FROM scratch
COPY --from=busybox:stable-musl /bin/busybox /wget
COPY --from=builder /app/auth-ui-service /auth-ui-service
EXPOSE 3010
ENTRYPOINT ["/auth-ui-service"]
