#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gen-certs.sh — Generate mTLS certificates for Swarm Blackjack services
#
# Creates a self-signed CA and per-service certificates.
# Each service gets a cert signed by the swarm CA.
# Services verify each other's certs against the CA — mutual TLS.
#
# Run once before first `docker compose up`:
#   chmod +x infra/scripts/gen-certs.sh
#   ./infra/scripts/gen-certs.sh
#
# Production: replace with real PKI (Vault, cert-manager, etc.)
# K8s path: cert-manager handles this automatically per pod.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CERTS_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERTS_DIR"

SERVICES=(
  "gateway"
  "game-state"
  "deck-service"
  "hand-evaluator"
  "dealer-ai"
  "bank-service"
  "auth-service"
  "chat-service"
  "email-service"
)

echo "🔐 Generating Swarm Blackjack mTLS certificates"
echo "   Output: $CERTS_DIR"
echo ""

# ── Certificate Authority ─────────────────────────────────────────────────────
echo "→ Creating Swarm CA..."
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
  -keyout "$CERTS_DIR/ca.key" \
  -out "$CERTS_DIR/ca.crt" \
  -subj "/C=US/O=Swarm Blackjack/CN=Swarm CA" \
  2>/dev/null

echo "  ✓ CA certificate: $CERTS_DIR/ca.crt"
echo ""

# ── Per-Service Certificates ──────────────────────────────────────────────────
for SERVICE in "${SERVICES[@]}"; do
  echo "→ Generating cert for $SERVICE..."

  # Generate private key and CSR
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$CERTS_DIR/$SERVICE.key" \
    -out "$CERTS_DIR/$SERVICE.csr" \
    -subj "/C=US/O=Swarm Blackjack/CN=$SERVICE" \
    2>/dev/null

  # Create SAN extension for Docker DNS names
  cat > "$CERTS_DIR/$SERVICE.ext" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature, keyEncipherment
extendedKeyUsage=serverAuth, clientAuth
subjectAltName=DNS:$SERVICE,DNS:localhost,IP:127.0.0.1
EOF

  # Sign with CA
  openssl x509 -req -days 365 \
    -in "$CERTS_DIR/$SERVICE.csr" \
    -CA "$CERTS_DIR/ca.crt" \
    -CAkey "$CERTS_DIR/ca.key" \
    -CAcreateserial \
    -out "$CERTS_DIR/$SERVICE.crt" \
    -extfile "$CERTS_DIR/$SERVICE.ext" \
    2>/dev/null

  # Clean up CSR and ext file
  rm "$CERTS_DIR/$SERVICE.csr" "$CERTS_DIR/$SERVICE.ext"

  echo "  ✓ $CERTS_DIR/$SERVICE.{key,crt}"
done

echo ""
echo "✅ Certificate generation complete."
echo ""
echo "Files created:"
ls -1 "$CERTS_DIR/"
echo ""
echo "Next steps:"
echo "  1. docker compose up --build"
echo "  2. Open http://localhost:3000 — Game UI"
echo "  3. Open http://localhost:8080/health — Gateway health check"
echo ""
echo "NOTE: mTLS enforcement is configured per-service."
echo "      Current skeleton uses HTTP internally — mTLS wiring is next phase."
echo "      Certs are generated and ready to mount."
