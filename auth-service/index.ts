/**
 * Auth Service
 * Language: TypeScript / Node.js
 *
 * Why TypeScript? The WebAuthn/passkey ecosystem is deepest here.
 * simplewebauthn is the gold standard library. Strong typing on the
 * ceremony objects catches errors at compile time that would be
 * silent runtime failures in plain JS.
 *
 * Auth posture:
 *   - Passkeys (WebAuthn/FIDO2) — primary, phishing-resistant
 *   - TOTP (authenticator apps) — fallback
 *   - Magic links — initial account creation / email verification ONLY
 *   - Issues short-lived JWTs (15min) + Redis refresh tokens
 *   - OPA (Open Policy Agent) as policy engine — "is this allowed?"
 */

import http from 'http';
import crypto from 'crypto';

const PORT = parseInt(process.env.PORT ?? '3006');
const SERVICE = 'auth-service';

// ── Stub Data ─────────────────────────────────────────────────────────────────
// Production: PostgreSQL for credentials, Redis for sessions.

const stubPlayers: Record<string, { id: string; email: string; name: string }> = {
  'stub-player-00000000-0000-0000-0000-000000000001': {
    id: 'stub-player-00000000-0000-0000-0000-000000000001',
    email: 'demo@example.com',
    name: 'Demo Player',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, status: number, body: object): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function issueStubJWT(playerId: string): string {
  // STUB: Returns a fake JWT. Real implementation uses jsonwebtoken + RS256.
  // In production: short-lived (15min), signed with private key.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: playerId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900, // 15 minutes
    iss: 'swarm-blackjack',
  })).toString('base64url');
  const signature = crypto.createHash('sha256').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ── Request Router ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  console.log(`[${SERVICE}] ${method} ${url.pathname}`);

  // ── Routes ─────────────────────────────────────────────────────────────────

  if (method === 'GET' && url.pathname === '/health') {
    jsonResponse(res, 200, {
      status: 'healthy',
      service: SERVICE,
      language: 'TypeScript',
      authMethods: ['passkeys (WebAuthn)', 'TOTP', 'magic-link (registration only)'],
      policyEngine: 'OPA (Open Policy Agent) — TODO',
      note: 'Stub: returns hardcoded JWT. Real: simplewebauthn + OPA.',
    });
    return;
  }

  // Registration — begin WebAuthn ceremony
  if (method === 'POST' && url.pathname === '/register') {
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');

    if (!data.email || !data.displayName) {
      jsonResponse(res, 400, { error: 'email and displayName required' });
      return;
    }

    // STUB: Real implementation calls simplewebauthn's generateRegistrationOptions()
    // and stores the challenge for verification on /register/verify
    jsonResponse(res, 200, {
      stub: true,
      message: 'WebAuthn registration ceremony would begin here',
      nextStep: 'POST /register/verify with credential from browser WebAuthn API',
      realImplementation: 'simplewebauthn generateRegistrationOptions()',
    });
    return;
  }

  // Login — begin WebAuthn authentication ceremony
  if (method === 'POST' && url.pathname === '/login') {
    // STUB: Real implementation calls generateAuthenticationOptions()
    // Returns stub JWT for demo player
    const token = issueStubJWT('stub-player-00000000-0000-0000-0000-000000000001');
    jsonResponse(res, 200, {
      accessToken: token,
      expiresIn: 900,
      playerId: 'stub-player-00000000-0000-0000-0000-000000000001',
      playerName: 'Demo Player',
      stub: true,
      note: 'Stub login — real implementation uses WebAuthn ceremony',
    });
    return;
  }

  // Token refresh
  if (method === 'POST' && url.pathname === '/refresh') {
    // STUB: Real implementation validates Redis refresh token
    const token = issueStubJWT('stub-player-00000000-0000-0000-0000-000000000001');
    jsonResponse(res, 200, { accessToken: token, expiresIn: 900 });
    return;
  }

  // Policy check — called by other services
  if (method === 'POST' && url.pathname === '/policy/check') {
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    // STUB: Real implementation queries OPA
    // OPA query: { input: { user: playerId, action: action, resource: resource } }
    jsonResponse(res, 200, {
      allowed: true,
      playerId: data.playerId,
      action: data.action,
      stub: true,
      note: 'OPA policy engine integration pending',
    });
    return;
  }

  jsonResponse(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`🔐 Auth Service (TypeScript) starting on :${PORT}`);
  console.log('   Passkeys primary. TOTP fallback. Magic links: registration only.');
  console.log('   OPA policy engine: TODO (all requests currently allowed — stub)');
});
