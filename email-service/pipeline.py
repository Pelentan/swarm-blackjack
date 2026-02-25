"""
pipeline.py — Email Processing Pipeline
=========================================
Executes the 9-step processing pipeline for every send request.
Each step is a rejection point. Transport is the last step.

Steps:
1. Validate request schema
2. Auth/OPA check
3. Validate tier/recipient type compatibility
4. Resolve recipient
5. Validate payload against message type registry
6. Render template
7. Apply encryption if required
8. Hand off to transport layer
9. Return result
"""

import logging
import uuid
from dataclasses import dataclass

import auth
import encryption
import templates
import transport

log = logging.getLogger(__name__)

# Tiers that require user_id recipient (no raw email addresses)
REQUIRES_USER_ID = {"personal", "confidential", "restricted"}

# Tiers that require encryption
REQUIRES_ENCRYPTION = {"confidential", "restricted"}

# Tiers where encryption is always the default but can be waived by data owner
ENCRYPTION_DEFAULT = {"personal"}


@dataclass
class SendRequest:
    calling_service: str
    request_id: str
    tier: str
    message_type: str
    recipient_type: str    # "email" or "user_id"
    recipient_value: str
    payload: dict
    encryption_waived: bool = False
    waiver_token: str | None = None


@dataclass
class SendResult:
    status: str            # "queued" | "rejected" | "error"
    message_id: str | None
    enforced_tier: str | None
    encrypted: bool | None
    error_code: str | None = None
    error_message: str | None = None


def _reject(code: str, message: str, enforced_tier: str | None = None) -> SendResult:
    log.warning(f"Request rejected [{code}]: {message}")
    return SendResult(
        status="rejected",
        message_id=None,
        enforced_tier=enforced_tier,
        encrypted=None,
        error_code=code,
        error_message=message,
    )


def process(req: SendRequest) -> SendResult:
    message_id = str(uuid.uuid4())
    log.info(f"[{message_id}] Processing {req.tier}/{req.message_type} from {req.calling_service}")

    # ── Step 1: Validate request schema ──────────────────────────────────────
    if not req.calling_service or not req.request_id:
        return _reject("invalid_schema", "caller.service and caller.request_id are required")

    if req.tier not in auth.TIER_LEVELS:
        return _reject("invalid_schema", f"Unknown tier: {req.tier}")

    if req.recipient_type not in ("email", "user_id"):
        return _reject("invalid_schema", f"recipient.type must be 'email' or 'user_id'")

    if not req.recipient_value:
        return _reject("invalid_schema", "recipient.value is required")

    # ── Step 2: Auth/OPA check ────────────────────────────────────────────────
    auth_result = auth.check(auth.AuthRequest(
        calling_service=req.calling_service,
        request_id=req.request_id,
        tier=req.tier,
        message_type=req.message_type,
        recipient_user_id=req.recipient_value if req.recipient_type == "user_id" else None,
    ))

    if not auth_result.authorized:
        return _reject("auth_denied", auth_result.reason or "Authorization denied")

    enforced_tier = auth_result.enforced_tier

    # ── Step 3: Validate tier/recipient compatibility ─────────────────────────
    if enforced_tier in REQUIRES_USER_ID and req.recipient_type != "user_id":
        return _reject(
            "invalid_recipient",
            f"{enforced_tier} tier requires registered user_id recipient, not raw email",
            enforced_tier=enforced_tier,
        )

    # ── Step 4: Resolve recipient ─────────────────────────────────────────────
    if req.recipient_type == "user_id":
        resolved_address = encryption.resolve_recipient_address(req.recipient_value, enforced_tier)
        if not resolved_address:
            return _reject("recipient_not_found", f"No registered address for user {req.recipient_value}", enforced_tier)
        recipient_user_id = req.recipient_value
    else:
        resolved_address = req.recipient_value
        recipient_user_id = None

    # Restricted tier: ignore provided recipient entirely, use registered address only
    if enforced_tier == "restricted":
        registered_address = encryption.resolve_recipient_address(req.recipient_value, "restricted")
        if not registered_address:
            return _reject("recipient_not_found", f"No registered address on account for {req.recipient_value}", enforced_tier)
        if resolved_address != registered_address:
            return _reject("restricted_address_mismatch",
                "Restricted tier: resolved address does not match account registered address", enforced_tier)
        resolved_address = registered_address

    # ── Step 5: Validate payload ──────────────────────────────────────────────
    errors = templates.validate(req.message_type, enforced_tier, req.payload)
    if errors:
        return _reject(
            "payload_validation_failed" if "Unknown message type" not in errors[0] else "unknown_message_type",
            "; ".join(errors),
            enforced_tier=enforced_tier,
        )

    # ── Step 6: Determine encryption ─────────────────────────────────────────
    should_encrypt: bool
    if enforced_tier in REQUIRES_ENCRYPTION:
        should_encrypt = True
    elif enforced_tier in ENCRYPTION_DEFAULT:
        if req.encryption_waived:
            # Validate waiver token
            if not req.waiver_token:
                return _reject("waiver_token_invalid",
                    "encryption_waived=true requires a waiver_token", enforced_tier)
            # STUB: accept any non-empty token
            log.info(f"STUB WAIVER — would validate re-verification token: {req.waiver_token}")
            should_encrypt = False
        else:
            should_encrypt = True
    else:
        should_encrypt = False

    # ── Step 7: Render template ───────────────────────────────────────────────
    subject, body, body_html = templates.render(req.message_type, req.payload, should_encrypt)

    # ── Step 8: Apply encryption ──────────────────────────────────────────────
    final_body = body
    actually_encrypted = False

    if should_encrypt:
        if not recipient_user_id:
            return _reject("encryption_key_missing",
                "Cannot encrypt: no user_id to look up public key", enforced_tier)
        enc_result = encryption.encrypt(body, recipient_user_id)
        if not enc_result.encrypted:
            return _reject("encryption_key_missing",
                f"No public key on record for user {recipient_user_id}", enforced_tier)
        final_body = enc_result.ciphertext
        actually_encrypted = enc_result.encrypted

    # ── Step 9: Hand off to transport ─────────────────────────────────────────
    transport_result = transport.deliver(transport.TransportMessage(
        to_address=resolved_address,
        subject=subject,
        body_text=final_body,
        body_html=body_html if not actually_encrypted else None,
        message_id=message_id,
        encrypted=actually_encrypted,
        tier=enforced_tier,
    ))

    if not transport_result.success:
        log.error(f"[{message_id}] Transport failed: {transport_result.error}")
        return SendResult(
            status="error",
            message_id=message_id,
            enforced_tier=enforced_tier,
            encrypted=actually_encrypted,
            error_code="smtp_unavailable",
            error_message=transport_result.error,
        )

    log.info(f"[{message_id}] Queued successfully — tier={enforced_tier} encrypted={actually_encrypted}")
    return SendResult(
        status="queued",
        message_id=message_id,
        enforced_tier=enforced_tier,
        encrypted=actually_encrypted,
    )
