"""
Email Service
=============
Language  : Python
Framework : Flask + Gunicorn

Architecture: Four isolated layers behind a single /send endpoint.
  transport.py   — SMTP stub (swap for production, zero upstream changes)
  auth.py        — Auth/OPA stub (all policy decisions, never local)
  encryption.py  — Public-key encryption stub
  templates.py   — Message type registry and renderers
  pipeline.py    — 9-step processing pipeline

See contracts.md for full API specification.
"""

import os
import logging
from flask import Flask, request, jsonify

import pipeline
import templates
import transport

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [email-service] %(levelname)s %(message)s'
)
log = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/health')
def health():
    smtp = transport.smtp_config_summary()
    return jsonify({
        "status": "healthy",
        "service": "email-service",
        "language": "Python",
        "tiers": ["system", "social", "personal", "confidential", "restricted"],
        "transport": smtp,
        "encryption": "stubbed — logs intent, sends plaintext",
        "auth": "stubbed — always authorized (policy enforced structurally)",
    })


@app.route('/send', methods=['POST'])
def send():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({
            "status": "rejected",
            "message_id": None,
            "enforced_tier": None,
            "encrypted": None,
            "error": {"code": "invalid_schema", "message": "Request body must be JSON"}
        }), 400

    caller = data.get('caller', {})
    recipient = data.get('recipient', {})
    options = data.get('options', {})

    req = pipeline.SendRequest(
        calling_service=caller.get('service', ''),
        request_id=caller.get('request_id', ''),
        tier=data.get('tier', ''),
        message_type=data.get('message_type', ''),
        recipient_type=recipient.get('type', ''),
        recipient_value=recipient.get('value', ''),
        payload=data.get('payload', {}),
        encryption_waived=options.get('encryption_waived', False),
        waiver_token=options.get('waiver_token'),
    )

    result = pipeline.process(req)

    response_body = {
        "status": result.status,
        "message_id": result.message_id,
        "enforced_tier": result.enforced_tier,
        "encrypted": result.encrypted,
        "error": {
            "code": result.error_code,
            "message": result.error_message,
        } if result.error_code else None,
    }

    status_code = 202 if result.status == "queued" else 400 if result.status == "rejected" else 500
    return jsonify(response_body), status_code


@app.route('/message-types', methods=['GET'])
def message_type_list():
    return jsonify({
        name: {
            "minimum_tier": spec.minimum_tier,
            "required_fields": spec.required_fields,
            "description": spec.description,
        }
        for name, spec in templates.MESSAGE_TYPES.items()
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3008))
    log.info(f"Email Service (Python) starting on :{port}")
    log.info("  All tiers: system / social / personal / confidential / restricted")
    smtp = transport.smtp_config_summary()
    log.info(f"  Transport: SMTP {smtp['host']}:{smtp['port']} (mode={smtp['mode']})")
    log.info("  Auth/OPA:  STUB (structurally enforced)")
    log.info("  Crypto:    STUB (plaintext, intent logged)")
    app.run(host='0.0.0.0', port=port)
