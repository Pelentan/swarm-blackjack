# Email Service — Request/Response Contracts

**Last Updated:** 2026-02-24  
**Status:** Design / Pre-implementation

---

## Core Concepts

### Tiers
Declared by the caller, enforced by Auth/OPA. The email service will reject
any request where the caller's declared tier doesn't match what Auth/OPA
authorizes.

| Tier | Value | Encryption | Recipient Type | Example Use |
|------|-------|------------|----------------|-------------|
| System | `system` | Never | Raw email or user ID | Welcome email, verification link |
| Social | `social` | Never | Raw email or user ID | Game invite, friend request |
| Personal | `personal` | Optional (owner only) | User ID only | Win/loss records, game history |
| Confidential | `confidential` | Always | User ID only | Account flags, moderation actions |
| Restricted | `restricted` | Always | Registered address on account only | Bank receipts, financial summaries |

### Recipient Types
- `email` — raw email address string. Only valid for System and Social tiers.
- `user_id` — registered user. Email address and public key looked up internally.
  Required for Personal and above.
- For Restricted tier, the recipient field is ignored entirely — the email
  service always resolves the address from the bank account record directly.

### Auth/OPA Check
Every request goes through Auth/OPA before any processing. Three questions:
1. Is the calling service authorized to send this tier?
2. Is the calling service authorized to send this message type?
3. Is the recipient authorized to receive this information?

If any check fails, the request is rejected with `auth_denied` before
the email service touches the payload.

---

## Endpoints

### POST /send
Send an email. All tiers use this single endpoint — the tier field
determines the processing path.

---

## Request Schema

```json
{
  "caller": {
    "service": "string",        // e.g. "game-state", "bank-service"
    "request_id": "string"      // UUID, for correlation/audit
  },
  "tier": "system|social|personal|confidential|restricted",
  "message_type": "string",     // e.g. "verify_email", "game_invite", "transaction_receipt"
  "recipient": {
    "type": "email|user_id",
    "value": "string"           // raw email address OR user UUID
  },
  "payload": {
    // key/value pairs passed to template renderer
    // contents vary by message_type
    // email service treats this as opaque — Auth/OPA validates contents
  },
  "options": {
    "encryption_waived": false  // Personal tier only. Requires owner re-verification token.
    "waiver_token": "string"    // Required if encryption_waived is true.
  }
}
```

### Request Examples

**System — email verification**
```json
{
  "caller": { "service": "auth-service", "request_id": "uuid" },
  "tier": "system",
  "message_type": "verify_email",
  "recipient": { "type": "email", "value": "newuser@example.com" },
  "payload": { "verification_url": "https://...", "expires_in": "24h" },
  "options": {}
}
```

**Social — game invite**
```json
{
  "caller": { "service": "game-state", "request_id": "uuid" },
  "tier": "social",
  "message_type": "game_invite",
  "recipient": { "type": "user_id", "value": "user-uuid-here" },
  "payload": {
    "inviter_name": "PlayerOne",
    "table_name": "High Stakes Table",
    "join_url": "https://..."
  },
  "options": {}
}
```

**Personal — win/loss summary (encrypted)**
```json
{
  "caller": { "service": "game-state", "request_id": "uuid" },
  "tier": "personal",
  "message_type": "session_summary",
  "recipient": { "type": "user_id", "value": "user-uuid-here" },
  "payload": {
    "hands_played": 12,
    "net_result": -150,
    "session_start": "2026-02-24T14:00:00Z",
    "session_end": "2026-02-24T16:00:00Z"
  },
  "options": {}
}
```

**Personal — win/loss summary (encryption waived by owner)**
```json
{
  "caller": { "service": "game-state", "request_id": "uuid" },
  "tier": "personal",
  "message_type": "session_summary",
  "recipient": { "type": "user_id", "value": "user-uuid-here" },
  "payload": { "hands_played": 12, "net_result": -150 },
  "options": {
    "encryption_waived": true,
    "waiver_token": "short-lived-token-from-re-verification"
  }
}
```

**Restricted — transaction receipt**
```json
{
  "caller": { "service": "bank-service", "request_id": "uuid" },
  "tier": "restricted",
  "message_type": "transaction_receipt",
  "recipient": { "type": "user_id", "value": "user-uuid-here" },
  "payload": {
    "transaction_id": "txn-uuid",
    "amount": "50.00",
    "type": "withdrawal",
    "timestamp": "2026-02-24T15:30:00Z",
    "balance_after": "950.00"
  },
  "options": {}
}
```

---

## Response Schema

```json
{
  "status": "queued|rejected|error",
  "message_id": "string",       // UUID assigned by email service. Present on queued.
  "enforced_tier": "string",    // Tier Auth/OPA actually approved. May differ from requested.
  "encrypted": true,            // Whether message was/will be encrypted.
  "error": {
    "code": "string",           // Machine-readable. See error codes below.
    "message": "string"         // Human-readable detail.
  }
}
```

Note: Status is `queued` not `sent` — email is async. The service accepts
responsibility for delivery but does not confirm SMTP handoff synchronously.
A future webhook or status endpoint can report actual delivery.

### Response Examples

**Success**
```json
{
  "status": "queued",
  "message_id": "msg-uuid",
  "enforced_tier": "personal",
  "encrypted": true,
  "error": null
}
```

**Auth denied**
```json
{
  "status": "rejected",
  "message_id": null,
  "enforced_tier": null,
  "encrypted": null,
  "error": {
    "code": "auth_denied",
    "message": "Calling service not authorized to send personal tier messages"
  }
}
```

**Invalid recipient for tier**
```json
{
  "status": "rejected",
  "message_id": null,
  "enforced_tier": "confidential",
  "encrypted": null,
  "error": {
    "code": "invalid_recipient",
    "message": "Confidential tier requires registered user_id recipient"
  }
}
```

**Unknown message type**
```json
{
  "status": "rejected",
  "message_id": null,
  "enforced_tier": null,
  "encrypted": null,
  "error": {
    "code": "unknown_message_type",
    "message": "No template registered for message type: foo_bar"
  }
}
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| `auth_denied` | Auth/OPA rejected the request |
| `invalid_recipient` | Recipient type not valid for requested tier |
| `recipient_not_found` | user_id not found in system |
| `unknown_message_type` | No template registered for this message_type |
| `encryption_key_missing` | User has no public key on record (encrypted tier) |
| `waiver_token_invalid` | encryption_waived=true but token missing or expired |
| `restricted_address_mismatch` | Restricted tier: resolved address doesn't match account |
| `smtp_unavailable` | Transport layer down (queuing for retry) |
| `payload_validation_failed` | Payload missing required fields for this message_type |

---

## Message Types Registry

| message_type | Minimum Tier | Required Payload Fields |
|-------------|-------------|------------------------|
| `verify_email` | system | `verification_url`, `expires_in` |
| `magic_link` | system | `magic_url`, `expires_in` |
| `password_reset` | system | `reset_url`, `expires_in` |
| `game_invite` | social | `inviter_name`, `table_name`, `join_url` |
| `game_result_notify` | social | `result`, `net_change` |
| `session_summary` | personal | `hands_played`, `net_result`, `session_start`, `session_end` |
| `account_flag_notice` | confidential | `reason`, `action_taken` |
| `transaction_receipt` | restricted | `transaction_id`, `amount`, `type`, `timestamp`, `balance_after` |

---

## Processing Pipeline (per request)

```
1. Validate request schema
2. Auth/OPA check (caller permissions, recipient permissions, tier authorization)
3. Validate tier/recipient type compatibility
4. Resolve recipient (user_id → email address, public key if needed)
5. Validate payload against message_type registry
6. Render template
7. Apply encryption if required
8. Hand off to transport layer (SMTP client)
9. Return queued response with message_id
```

Steps 1-5 are all rejection points. Step 8 is the only part that touches
SMTP — everything above it is transport-agnostic.

---

## What's Stubbed (PoC)

- Auth/OPA check: always returns authorized
- Encryption: logs "would encrypt with key for {user_id}" but sends plaintext
- SMTP transport: logs to console, no actual sending
- Recipient resolution: returns mock email address for any user_id
- Waiver token validation: accepts any non-empty string

Each stub is isolated to a single function with a clear TODO.
The pipeline runs end-to-end with real validation everywhere else.
