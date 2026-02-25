FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum .
ENV GONOSUMDB=* GOFLAGS=-insecure
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o observability-service .

# Scratch container — static binary only, no shell, no attack surface
FROM scratch
COPY --from=builder /app/observability-service /observability-service
EXPOSE 3009
ENTRYPOINT ["/observability-service"]
