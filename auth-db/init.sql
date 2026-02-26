-- Auth Service Database
-- Owned exclusively by auth-service. No other service has credentials.

CREATE TABLE IF NOT EXISTS players (
  id         UUID        PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  name       VARCHAR(50)  NOT NULL,
  verified   BOOLEAN      NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One player can have multiple passkeys (phone, laptop, hardware key)
CREATE TABLE IF NOT EXISTS passkey_credentials (
  credential_id  TEXT        PRIMARY KEY,  -- base64url credential ID from WebAuthn
  player_id      UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  public_key     BYTEA       NOT NULL,     -- COSE-encoded public key
  counter        BIGINT      NOT NULL DEFAULT 0,
  device_type    VARCHAR(32) NOT NULL,     -- 'singleDevice' | 'multiDevice'
  backed_up      BOOLEAN     NOT NULL DEFAULT false,
  transports     TEXT[],                   -- usb | nfc | ble | internal | hybrid
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_player_id
  ON passkey_credentials(player_id);

-- Short-lived challenges — prevent replay attacks
-- Cleaned up by auth-service on use or expiry
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge   TEXT        PRIMARY KEY,  -- base64url encoded random bytes
  player_id   UUID        REFERENCES players(id) ON DELETE CASCADE,
  type        VARCHAR(32) NOT NULL,     -- 'registration' | 'authentication'
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at
  ON webauthn_challenges(expires_at);

-- Seed demo player (matches in-memory seed in auth-service)
INSERT INTO players (id, email, name, verified) VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo@swarm.local', 'Demo Player', true)
ON CONFLICT DO NOTHING;
