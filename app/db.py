"""Load and query the synthetic database."""

import json
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "synthetic_db.json"


def load_db():
    with open(DB_PATH) as f:
        return json.load(f)


def get_business(db, business_id):
    return next(b for b in db["businesses"] if b["business_id"] == business_id)


def get_obligations(db, business_id):
    return [o for o in db["obligations"] if o["business_id"] == business_id]


def get_receivables(db, business_id):
    return [r for r in db["receivables"] if r["business_id"] == business_id]


def get_payer(db, payer_id):
    return next(p for p in db["payers"] if p["payer_id"] == payer_id)


def get_all_business_ids(db):
    return [b["business_id"] for b in db["businesses"]]
