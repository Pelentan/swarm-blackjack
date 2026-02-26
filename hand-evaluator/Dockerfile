FROM haskell:9.6-slim AS builder
WORKDIR /app
COPY hand-evaluator.cabal .
RUN cabal update && cabal build --only-dependencies
COPY Main.hs .
RUN cabal build && \
    cp "$(cabal list-bin hand-evaluator)" /app/hand-evaluator-exe

FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgmp10 locales wget && \
    rm -rf /var/lib/apt/lists/* && \
    echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen && \
    locale-gen
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
WORKDIR /root/
COPY --from=builder /app/hand-evaluator-exe ./hand-evaluator
EXPOSE 3003
CMD ["./hand-evaluator"]
