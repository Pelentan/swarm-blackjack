FROM golang:1.22 AS builder
WORKDIR /app
COPY go.mod .
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o deck-service .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=busybox:stable-musl /bin/busybox /wget
COPY --from=builder /app/deck-service /deck-service
EXPOSE 3002
ENTRYPOINT ["/deck-service"]
