"""
Email Service — Python STUB
===========================
Handles account verification magic links ONLY.
(Magic links are not a login mechanism — they're a one-time email verification
for new account creation. Login is passkeys/TOTP.)

STUB: Logs to console instead of sending real email.
Production swap: replace send_email() with SMTP/SendGrid/SES.
Zero upstream contract changes required.
"""

import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s [email-service] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)


def send_email(to: str, subject: str, body: str) -> bool:
    """
    STUB: Replace this function body with real SMTP/SendGrid/SES.
    Signature stays identical — zero upstream changes.
    """
    log.info("=" * 60)
    log.info(f"📧 STUB EMAIL (would be sent in production)")
    log.info(f"   To:      {to}")
    log.info(f"   Subject: {subject}")
    log.info(f"   Body:    {body}")
    log.info("=" * 60)
    return True


@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "service": "email-service",
        "language": "Python",
        "mode": "STUB — logs to console, no real email sent",
        "scope": "Account verification magic links ONLY. Not a login mechanism."
    })


@app.route('/send/verification', methods=['POST'])
def send_verification():
    """Send account verification magic link to new user."""
    data = request.get_json(silent=True) or {}

    email = data.get('email')
    token = data.get('token')
    display_name = data.get('displayName', 'Player')

    if not email or not token:
        return jsonify({"error": "email and token required"}), 400

    verify_url = f"http://localhost:8080/api/auth/verify?token={token}"

    subject = "Verify your Swarm Blackjack account"
    body = (
        f"Hi {display_name},\n\n"
        f"Click the link below to verify your account:\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"Note: This is a one-time link for account setup only.\n"
        f"Future logins use your passkey — no passwords, no magic links."
    )

    success = send_email(email, subject, body)

    return jsonify({
        "sent": success,
        "to": email,
        "stub": True,
        "note": "Check service logs for email content"
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3008))
    log.info(f"📧 Email Service (Python STUB) starting on :{port}")
    log.info("   Logging to console only. No real email sent.")
    log.info("   Swap send_email() for production SMTP/SendGrid/SES.")
    app.run(host='0.0.0.0', port=port)
