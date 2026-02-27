# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Compile COBOL programs
# GnuCOBOL compiles .cob → native binary via C intermediate.
# Only the binaries land in the final image — no compiler, no C toolchain.
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS cobol-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gnucobol \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /cobol
COPY cobol/ ./

# Compile each program to a standalone executable
RUN cobc -x -o VALIDATE-DEBIT  VALIDATE-DEBIT.cob  && \
    cobc -x -o CALC-PAYOUT     CALC-PAYOUT.cob     && \
    cobc -x -o CALC-CREDIT     CALC-CREDIT.cob

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build Go HTTP layer
# ─────────────────────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS go-builder

WORKDIR /app
COPY go/go.mod ./
# go.sum is generated here — no need to commit it
RUN go mod tidy || true

COPY go/ ./
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bank-service .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime
# Needs libcob4 (GnuCOBOL runtime library) for compiled COBOL binaries.
# Everything else stripped out.
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcob4 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/local/bin/cobol
COPY --from=cobol-builder /cobol/VALIDATE-DEBIT  /usr/local/bin/cobol/
COPY --from=cobol-builder /cobol/CALC-PAYOUT     /usr/local/bin/cobol/
COPY --from=cobol-builder /cobol/CALC-CREDIT     /usr/local/bin/cobol/
COPY --from=go-builder    /app/bank-service      /usr/local/bin/bank-service

RUN useradd -r -s /bin/false bankuser
USER bankuser

ENV PORT=3005
ENV COBOL_BIN_DIR=/usr/local/bin/cobol

EXPOSE 3005
CMD ["/usr/local/bin/bank-service"]
