FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o deck-service .

FROM alpine:3.19
WORKDIR /root/
COPY --from=builder /app/deck-service .
EXPOSE 3002
CMD ["./deck-service"]
