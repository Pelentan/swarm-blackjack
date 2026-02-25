/**
 * Auth Service
 * Language: TypeScript / Node.js
 *
 * Auth posture (demo-simplified):
 *   - Register: name + email → verify token in Redis → verification email sent
 *   - Verify:   /verify-token?token= → exchange code → redirect to UI
 *   - Exchange: /exchange {code} → JWT issued, session stored
 *   - Login:    email → JWT + Redis session (demo: no passkey ceremony)
 *
 * Token flow:
 *   verify_token (24h)  → /verify-token → exchange_code (60s) → /exchange → JWT
 *   No JWT ever appears in a URL. Exchange code is single-use.
 *
 * Production path:
 *   - Swap issueJWT to RS256 with key pair
 *   - Add simplewebauthn registration/authentication ceremonies
 *   - Wire OPA policy engine on /policy/check
 */

import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';

const PORT    = parseInt(process.env.PORT ?? '3006');
const SERVICE = 'auth-service';

const JWT_SECRET      = process.env.JWT_SECRET ?? 'swarm-blackjack-dev-secret-change-in-production';
const JWT_EXPIRES_IN  = 900; // 15 minutes
const REDIS_URL       = process.env.REDIS_URL       ?? 'redis://redis:6379';
const EMAIL_URL       = process.env.EMAIL_URL       ?? 'http://email-service:3008';
const BANK_URL        = process.env.BANK_URL        ?? 'http://bank-service:3005';
const GATEWAY_URL     = process.env.GATEWAY_URL     ?? 'http://localhost:8080';
const UI_URL          = process.env.UI_URL          ?? 'http://localhost:3000';

// ── Redis ─────────────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);
redis.on('connect', () => console.log(`[${SERVICE}] Redis connected`));
redis.on('error',   (e) => console.error(`[${SERVICE}] Redis error:`, e.message));

// session:{playerId}:{sessionId} → JSON, TTL = JWT_EXPIRES_IN * 4
// verify:{token}                 → playerId, TTL = 86400 (24h)
// exchange:{code}                → playerId, TTL = 60s

// ── Player Registry ───────────────────────────────────────────────────────────

interface Player {
  id:        string;
  email:     string;
  name:      string;
  verified:  boolean;
  createdAt: string;
}

const playersByEmail = new Map<string, Player>();
const playersById    = new Map<string, Player>();

// Seed demo player
const demoPlayer: Player = {
  id:       'player-00000000-0000-0000-0000-000000000001',
  email:    'demo@swarm.local',
  name:     'Demo Player',
  verified: true,
  createdAt: new Date().toISOString(),
};
playersByEmail.set(demoPlayer.email, demoPlayer);
playersById.set(demoPlayer.id, demoPlayer);

// ── JWT ───────────────────────────────────────────────────────────────────────

function issueJWT(player: Player, sessionId: string): string {
  return jwt.sign(
    { sub: player.id, email: player.email, name: player.name, sessionId, iss: 'swarm-blackjack' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyJWT(token: string): jwt.JwtPayload | null {
  try { return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload; }
  catch { return null; }
}

async function createSession(playerId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  await redis.setex(
    `session:${playerId}:${sessionId}`,
    JWT_EXPIRES_IN * 4,
    JSON.stringify({ playerId, createdAt: new Date().toISOString() })
  );
  return sessionId;
}

async function validateSession(playerId: string, sessionId: string): Promise<boolean> {
  return (await redis.get(`session:${playerId}:${sessionId}`)) !== null;
}

// ── Email calls ───────────────────────────────────────────────────────────────

async function sendVerificationEmail(player: Player): Promise<void> {
  // Generate single-use verify token, store in Redis for 24h
  const verifyToken = crypto.randomUUID();
  await redis.setex(`verify:${verifyToken}`, 86400, player.id);

  // Link goes through gateway — UI URL never exposed to auth service
  const verificationUrl = `${GATEWAY_URL}/verify?token=${verifyToken}`;

  const body = JSON.stringify({
    caller:       { service: 'auth-service', request_id: crypto.randomUUID() },
    tier:         'system',
    message_type: 'verify_email',
    recipient:    { type: 'email', value: player.email },
    payload:      { verification_url: verificationUrl, expires_in: '24h' },
    options:      {},
  });

  try {
    const res  = await fetch(`${EMAIL_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const data = await res.json() as { status: string; message_id: string };
    console.log(`[${SERVICE}] Verification email queued: messageId=${data.message_id} to=${player.email}`);
    console.log(`[${SERVICE}] Verify URL: ${verificationUrl}`);
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to send verification email:`, e.message);
  }
}

async function sendTransactionReceipt(player: Player, txData: {
  transactionId: string; amount: string; type: string; timestamp: string; balanceAfter: string;
}): Promise<void> {
  const body = JSON.stringify({
    caller:       { service: 'auth-service', request_id: crypto.randomUUID() },
    tier:         'restricted',
    message_type: 'transaction_receipt',
    recipient:    { type: 'user_id', value: player.id },
    payload: {
      transaction_id: txData.transactionId, amount: txData.amount,
      type: txData.type, timestamp: txData.timestamp, balance_after: txData.balanceAfter,
    },
    options: {},
  });
  try {
    const res  = await fetch(`${EMAIL_URL}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const data = await res.json() as { status: string; message_id: string };
    console.log(`[${SERVICE}] Transaction receipt queued: messageId=${data.message_id} player=${player.id}`);
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to send transaction receipt:`, e.message);
  }
}

// ── Bank calls ────────────────────────────────────────────────────────────────

async function ensureBankAccount(player: Player): Promise<void> {
  try {
    await fetch(`${BANK_URL}/account`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, startingBalance: '1000.00' }),
    });
    console.log(`[${SERVICE}] Bank account ensured for player=${player.id}`);
  } catch (e: any) {
    console.error(`[${SERVICE}] Failed to create bank account:`, e.message);
  }
}

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

function htmlResponse(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';

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

  // ── Health ──────────────────────────────────────────────────────────────────

  if (method === 'GET' && url.pathname === '/health') {
    jsonResponse(res, 200, {
      status: 'healthy', service: SERVICE, language: 'TypeScript',
      redis: redis.status === 'ready' ? 'connected' : 'disconnected',
      players: playersByEmail.size,
      gatewayUrl: GATEWAY_URL, uiUrl: UI_URL,
    });
    return;
  }

  // ── GET /users/{id}/email — called by email-service for address resolution ──

  if (method === 'GET' && url.pathname.startsWith('/users/') && url.pathname.endsWith('/email')) {
    const parts    = url.pathname.split('/');
    const playerId = parts[2];
    const player   = playersById.get(playerId);
    if (!player) { jsonResponse(res, 404, { error: 'player not found' }); return; }
    jsonResponse(res, 200, { playerId: player.id, email: player.email });
    return;
  }

  // ── POST /register ──────────────────────────────────────────────────────────

  if (method === 'POST' && url.pathname === '/register') {
    const body = await readBody(req);
    let data: any;
    try { data = JSON.parse(body || '{}'); }
    catch { jsonResponse(res, 400, { error: 'invalid JSON' }); return; }

    const email = (data.email ?? '').trim().toLowerCase();
    const name  = (data.name  ?? '').trim();

    if (!email || !name) { jsonResponse(res, 400, { error: 'email and name required' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { jsonResponse(res, 400, { error: 'invalid email address' }); return; }
    if (playersByEmail.has(email)) { jsonResponse(res, 409, { error: 'email already registered' }); return; }

    const player: Player = {
      id: crypto.randomUUID(), email, name, verified: false, createdAt: new Date().toISOString(),
    };
    playersByEmail.set(email, player);
    playersById.set(player.id, player);

    await ensureBankAccount(player);

    // Send verification email — do not issue JWT yet
    sendVerificationEmail(player);

    console.log(`[${SERVICE}] Registered (unverified): id=${player.id} email=${email} name=${name}`);

    jsonResponse(res, 201, {
      registered: true,
      message:    'Verification email sent. Check your inbox and click the link to activate your account.',
      email:      player.email,
    });
    return;
  }

  // ── POST /login ─────────────────────────────────────────────────────────────

  if (method === 'POST' && url.pathname === '/login') {
    const body = await readBody(req);
    let data: any;
    try { data = JSON.parse(body || '{}'); }
    catch { jsonResponse(res, 400, { error: 'invalid JSON' }); return; }

    const email = (data.email ?? '').trim().toLowerCase();
    if (!email) { jsonResponse(res, 400, { error: 'email required' }); return; }

    const player = playersByEmail.get(email);
    if (!player) { jsonResponse(res, 401, { error: 'invalid credentials' }); return; }

    const sessionId = await createSession(player.id);
    const token     = issueJWT(player, sessionId);

    console.log(`[${SERVICE}] Login: id=${player.id} email=${email}`);

    jsonResponse(res, 200, {
      accessToken: token, expiresIn: JWT_EXPIRES_IN,
      playerId: player.id, playerName: player.name, email: player.email,
    });
    return;
  }

  // ── GET /verify-token?token= ────────────────────────────────────────────────
  // Called by gateway when user clicks the email link.
  // Validates verify token → creates short-lived exchange code → redirects to UI.

  if (method === 'GET' && url.pathname === '/verify-token') {
    const token = url.searchParams.get('token');
    if (!token) {
      htmlResponse(res, 400, errorPage('Missing verification token.', UI_URL));
      return;
    }

    const playerId = await redis.getdel(`verify:${token}`);
    if (!playerId) {
      htmlResponse(res, 400, errorPage(
        'Verification link is invalid or has already been used. Please register again.',
        UI_URL
      ));
      return;
    }

    const player = playersById.get(playerId);
    if (!player) {
      htmlResponse(res, 400, errorPage('Account not found.', UI_URL));
      return;
    }

    // Mark as verified
    player.verified = true;

    // Create short-lived (60s) single-use exchange code
    const code = crypto.randomUUID();
    await redis.setex(`exchange:${code}`, 60, playerId);

    console.log(`[${SERVICE}] Email verified: player=${playerId} — redirecting with exchange code`);

    // Redirect to UI — exchange code in URL is not sensitive (single-use, 60s TTL, non-secret)
    res.writeHead(302, { Location: `${UI_URL}?exchange=${code}` });
    res.end();
    return;
  }

  // ── POST /exchange ──────────────────────────────────────────────────────────
  // UI calls this to swap exchange code for JWT.
  // Exchange code is single-use and expires in 60s.

  if (method === 'POST' && url.pathname === '/exchange') {
    const body = await readBody(req);
    let data: any;
    try { data = JSON.parse(body || '{}'); }
    catch { jsonResponse(res, 400, { error: 'invalid JSON' }); return; }

    const code = data.code ?? '';
    if (!code) { jsonResponse(res, 400, { error: 'code required' }); return; }

    const playerId = await redis.getdel(`exchange:${code}`);
    if (!playerId) {
      jsonResponse(res, 401, { error: 'invalid or expired exchange code' });
      return;
    }

    const player = playersById.get(playerId);
    if (!player) { jsonResponse(res, 404, { error: 'player not found' }); return; }

    const sessionId = await createSession(player.id);
    const token     = issueJWT(player, sessionId);

    console.log(`[${SERVICE}] Exchange: issued JWT for player=${playerId}`);

    jsonResponse(res, 200, {
      accessToken: token, expiresIn: JWT_EXPIRES_IN,
      playerId: player.id, playerName: player.name, email: player.email,
    });
    return;
  }

  // ── POST /validate ──────────────────────────────────────────────────────────

  if (method === 'POST' && url.pathname === '/validate') {
    const body = await readBody(req);
    let data: any;
    try { data = JSON.parse(body || '{}'); }
    catch { jsonResponse(res, 400, { error: 'invalid JSON' }); return; }

    const payload = verifyJWT(data.token ?? '');
    if (!payload) { jsonResponse(res, 401, { error: 'invalid or expired token' }); return; }

    const valid = await validateSession(payload.sub!, payload.sessionId);
    if (!valid) { jsonResponse(res, 401, { error: 'session expired or revoked' }); return; }

    jsonResponse(res, 200, {
      valid: true, playerId: payload.sub, email: payload.email, name: payload.name,
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
    });
    return;
  }

  // ── POST /notify/transaction ────────────────────────────────────────────────

  if (method === 'POST' && url.pathname === '/notify/transaction') {
    const body = await readBody(req);
    let data: any;
    try { data = JSON.parse(body || '{}'); }
    catch { jsonResponse(res, 400, { error: 'invalid JSON' }); return; }

    const player = playersById.get(data.playerId ?? '');
    if (!player) { jsonResponse(res, 404, { error: 'player not found' }); return; }

    sendTransactionReceipt(player, {
      transactionId: data.transactionId, amount: data.amount,
      type: data.type, timestamp: data.timestamp, balanceAfter: data.balanceAfter,
    });

    jsonResponse(res, 202, { queued: true });
    return;
  }

  // ── POST /policy/check ──────────────────────────────────────────────────────

  if (method === 'POST' && url.pathname === '/policy/check') {
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    jsonResponse(res, 200, { allowed: true, playerId: data.playerId, action: data.action, stub: true });
    return;
  }

  jsonResponse(res, 404, { error: 'not found' });
});

// ── Error page ────────────────────────────────────────────────────────────────

function errorPage(message: string, uiUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verification Error — Swarm Blackjack</title>
  <style>
    body { background:#0d1117; color:#e6edf3; font-family:system-ui,sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .box { background:#161b22; border:1px solid #e53e3e; border-radius:12px;
           padding:32px 40px; max-width:420px; text-align:center; }
    h2 { color:#fc8181; margin:0 0 16px; }
    p  { color:#8b949e; line-height:1.6; margin:0 0 24px; }
    a  { display:inline-block; padding:10px 24px; background:#1f6feb;
         color:#fff; text-decoration:none; border-radius:8px; font-weight:600; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Verification Failed</h2>
    <p>${message}</p>
    <a href="${uiUrl}">Back to Game</a>
  </div>
</body>
</html>`;
}

server.listen(PORT, () => {
  console.log(`[${SERVICE}] Auth Service (TypeScript) starting on :${PORT}`);
  console.log(`[${SERVICE}] Gateway URL: ${GATEWAY_URL}`);
  console.log(`[${SERVICE}] UI URL: ${UI_URL}`);
  console.log(`[${SERVICE}] Demo player seeded: ${demoPlayer.email}`);
});
