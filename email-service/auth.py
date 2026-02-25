"""
auth.py — Auth/OPA Policy Check
=================================
All authorization decisions go through here.
This layer talks to the Auth/OPA service — never makes local decisions.

STUB: Always returns authorized.
Production swap: Replace _call_opa() body only.
"""

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Tiers in ascending privilege order
TIER_LEVELS = {
    "system":       1,
    "social":       2,
    "personal":     3,
    "confidential": 4,
    "restricted":   5,
}

# Which services are permitted to send which tiers
# In production this lives in OPA policy, not here.
# This is documentation-as-code for the stub.
CALLER_TIER_POLICY = {
    "auth-service":  {"system"},
    "game-state":    {"system", "social", "personal"},
    "chat-service":  {"social"},
    "bank-service":  {"restricted"},
    # internal test caller
    "test":          {"system", "social", "personal", "confidential", "restricted"},
}

# Which message types trigger security alerts regardless of auth outcome
HONEYPOT_MESSAGE_TYPES = {
    "password_reset",  # passkey-only system — no passwords to reset
}


@dataclass
class AuthRequest:
    calling_service: str
    request_id: str
    tier: str
    message_type: str
    recipient_user_id: str | None  # None for raw email recipients


@dataclass
class AuthResult:
    authorized: bool
    enforced_tier: str | None
    reason: str | None = None
    security_alert: bool = False
    alert_detail: str | None = None


def _call_opa(auth_req: AuthRequest) -> AuthResult:
    """
    STUB — replace this body for production.
    Production implementation calls Auth service /policy/check endpoint.
    Returns AuthResult based on OPA policy evaluation.
    """
    log.info(f"STUB AUTH — would call Auth/OPA in production")
    log.info(f"  caller       : {auth_req.calling_service}")
    log.info(f"  tier         : {auth_req.tier}")
    log.info(f"  message_type : {auth_req.message_type}")
    log.info(f"  recipient    : {auth_req.recipient_user_id or '(raw email)'}")

    # Stub applies documented policy so behavior is realistic
    allowed_tiers = CALLER_TIER_POLICY.get(auth_req.calling_service, set())
    if auth_req.tier not in allowed_tiers:
        return AuthResult(
            authorized=False,
            enforced_tier=None,
            reason=f"Service '{auth_req.calling_service}' not permitted to send '{auth_req.tier}' tier"
        )

    return AuthResult(authorized=True, enforced_tier=auth_req.tier)


def check(auth_req: AuthRequest) -> AuthResult:
    """
    Public interface. Pipeline calls this.
    Handles honeypot detection regardless of auth outcome.
    """
    result = _call_opa(auth_req)

    # Honeypot check — runs even if auth passes
    # Logs security alert but does not reveal detection to caller
    if auth_req.message_type in HONEYPOT_MESSAGE_TYPES:
        log.warning("=" * 60)
        log.warning("SECURITY ALERT — honeypot message type triggered")
        log.warning(f"  message_type    : {auth_req.message_type}")
        log.warning(f"  calling_service : {auth_req.calling_service}")
        log.warning(f"  request_id      : {auth_req.request_id}")
        log.warning(f"  tier            : {auth_req.tier}")
        log.warning("  Action: flag calling service for review")
        log.warning("=" * 60)
        # Caller sees normal rejection — no indication a wire was tripped
        return AuthResult(
            authorized=False,
            enforced_tier=None,
            reason="Message type not available",
            security_alert=True,
            alert_detail=f"Honeypot triggered by {auth_req.calling_service}"
        )

    return result
