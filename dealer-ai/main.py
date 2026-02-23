"""
Dealer AI Service
Language: Python

Why Python? Rule-based strategy today, but the architecture leaves a clean
ML upgrade path. When we want to train a model on hand history, Python's
ecosystem (scikit-learn, PyTorch) is unmatched. Zero service contract changes
required — the /decide endpoint stays identical.
"""

import os
import logging
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(asctime)s [dealer-ai] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)


RANK_VALUES = {
    'A': 11, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10
}


def evaluate_hand(cards: list[dict]) -> tuple[int, bool]:
    """Pure function: returns (total, is_soft)."""
    total = 0
    aces = 0
    for card in cards:
        rank = card.get('rank', '0')
        if rank == 'hidden':
            continue
        if rank == 'A':
            aces += 1
            total += 11
        else:
            total += RANK_VALUES.get(rank, 0)

    soft = False
    aces_used = 0
    while total > 21 and aces_used < aces:
        total -= 10
        aces_used += 1

    soft = aces_used < aces and total <= 21
    return total, soft


def dealer_decision(hand: list[dict]) -> dict:
    """
    Standard casino dealer rules:
    - Stand on hard 17+
    - Hit on soft 17 (house rule — configurable in production)
    - Hit on 16 and below
    """
    total, is_soft = evaluate_hand(hand)

    if total > 21:
        return {
            "action": "bust",
            "handValue": total,
            "isSoft": is_soft,
            "reasoning": f"Dealer busts with {total}"
        }

    if total < 17:
        return {
            "action": "hit",
            "handValue": total,
            "isSoft": is_soft,
            "reasoning": f"Dealer hits on {total} (below 17)"
        }

    if total == 17 and is_soft:
        # Soft 17 — house rules typically say hit
        return {
            "action": "hit",
            "handValue": total,
            "isSoft": True,
            "reasoning": "Dealer hits soft 17 (house rule)"
        }

    return {
        "action": "stand",
        "handValue": total,
        "isSoft": is_soft,
        "reasoning": f"Dealer stands on {total}"
    }


@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "service": "dealer-ai",
        "language": "Python",
        "note": "Rule-based now. ML upgrade path: replace dealer_decision(), keep endpoint."
    })


@app.route('/decide', methods=['POST', 'OPTIONS'])
def decide():
    if request.method == 'OPTIONS':
        resp = app.make_default_options_response()
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp

    data = request.get_json(silent=True)
    if not data or 'hand' not in data:
        return jsonify({"error": "missing 'hand' in request body"}), 400

    hand = data['hand']
    decision = dealer_decision(hand)

    log.info(f"Decision for hand of {len(hand)} cards: {decision['action']} ({decision['reasoning']})")

    resp = jsonify(decision)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3004))
    log.info(f"🤖 Dealer AI (Python) starting on :{port}")
    app.run(host='0.0.0.0', port=port)
