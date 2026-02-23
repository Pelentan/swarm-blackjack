FROM haskell:9.6-slim AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY hand-evaluator.cabal .
RUN cabal update && cabal build --only-dependencies

# Build the application
COPY Main.hs .
RUN cabal build && \
    cp $(cabal list-bin hand-evaluator) /app/hand-evaluator-exe

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libgmp10 && rm -rf /var/lib/apt/lists/*
WORKDIR /root/
COPY --from=builder /app/hand-evaluator-exe ./hand-evaluator
EXPOSE 3003
CMD ["./hand-evaluator"]
