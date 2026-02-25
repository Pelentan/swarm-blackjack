"""
encryption.py — Encryption Layer
==================================
Handles public-key encryption of message bodies for Personal and above tiers.

STUB: Logs intent, returns plaintext.
Production swap: Replace _encrypt_with_public_key() body only.

Key management assumption:
- User public keys are stored in the Auth service at registration (WebAuthn flow)
- This service fetches the key by user_id
- Private key never leaves the user's device
- Unencrypted tiers never touch this module
"""

import os
import logging
import urllib.request
import json
from dataclasses import dataclass

log = logging.getLogger(__name__)

AUTH_SERVICE_URL = os.environ.get('AUTH_SERVICE_URL', 'http://auth-service:3006')


@dataclass
class EncryptionResult:
    ciphertext: str      # Encrypted body (or plaintext if stub/waived)
    encrypted:  bool     # Whether actual encryption was applied
    key_id:     str | None  # Which key was used (for audit trail)


def _fetch_public_key(user_id: str) -> str | None:
    """
    STUB — fetch user's public key from Auth service.
    Production: GET {AUTH_SERVICE_URL}/users/{user_id}/public-key
    Returns None if user has no key on record.
    """
    log.info(f"STUB KEYFETCH — would fetch public key for user {user_id} from Auth service")
    return f"stub-public-key-for-{user_id}"


def _encrypt_with_public_key(plaintext: str, public_key: str, user_id: str) -> str:
    """
    STUB — encrypt body with user's public key.
    Production: Use recipient's PGP/age public key.
    Returns ciphertext string (base64 encoded in production).
    """
    log.info(f"STUB ENCRYPT — would encrypt with key for user {user_id}")
    log.info(f"  Key   : {public_key[:40]}...")
    log.info(f"  Input : {plaintext[:80]}...")
    # Stub returns plaintext so output is readable in logs
    return plaintext


def encrypt(body: str, user_id: str) -> EncryptionResult:
    """Public interface. Fetches key and encrypts."""
    public_key = _fetch_public_key(user_id)
    if not public_key:
        return EncryptionResult(ciphertext=body, encrypted=False, key_id=None)

    ciphertext = _encrypt_with_public_key(body, public_key, user_id)
    return EncryptionResult(
        ciphertext=ciphertext,
        encrypted=True,
        key_id=f"key-{user_id}",  # Production: actual key fingerprint
    )


def resolve_recipient_address(user_id: str, tier: str) -> str | None:
    """
    Resolve a user_id to their registered email address.
    For Restricted tier, this is the only valid way to get a recipient address.
    Calls auth-service — it owns the user registry.
    """
    try:
        url = f"{AUTH_SERVICE_URL}/users/{user_id}/email"
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            email = data.get('email')
            if email:
                log.info(f"Resolved user {user_id} → {email} (tier={tier})")
                return email
    except Exception as e:
        log.warning(f"Could not resolve email for user {user_id}: {e}")
    return None
