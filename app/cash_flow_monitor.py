"""Cash Flow Monitor agent.

Watches a business's ledger, detects timing gaps, calculates bridge amounts,
and passes candidate invoices to the Credit Assessor.

Prompt: Braintrust (project: Bridge) → local model-spec fallback.
All calls traced.
"""

import anthropic
import json
import os
import braintrust
from prompts import get_prompt


def get_api_key():
    """Get Anthropic API key from Streamlit secrets or env."""
    try:
        import streamlit as st
        return st.secrets["ANTHROPIC_API_KEY"]
    except Exception:
        return os.environ.get("ANTHROPIC_API_KEY", "")


def build_business_snapshot(db, business_id):
    """Build the full financial context for one business."""
    from db import get_business, get_obligations, get_receivables, get_payer

    biz = get_business(db, business_id)
    obligations = get_obligations(db, business_id)
    receivables = get_receivables(db, business_id)

    enriched_receivables = []
    for rec in receivables:
        payer = get_payer(db, rec["payer_id"])
        enriched_receivables.append({**rec, "payer": payer})

    return {
        "business": biz,
        "obligations": obligations,
        "receivables": enriched_receivables,
    }


@braintrust.traced(name="cash_flow_monitor")
def run_monitor(db, business_id):
    """Run the Cash Flow Monitor on a single business."""
    snapshot = build_business_snapshot(db, business_id)
    system_prompt = get_prompt("cash_flow_monitor")

    braintrust.current_span().log(
        input=snapshot,
        metadata={"business_id": business_id, "agent": "monitor"},
    )

    client = anthropic.Anthropic(api_key=get_api_key())

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": f"Analyze this business's cash flow and determine if a bridge recommendation is warranted.\n\n{json.dumps(snapshot, indent=2)}",
            }
        ],
    )

    response_text = message.content[0].text

    try:
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]
        result = json.loads(response_text.strip())
    except (json.JSONDecodeError, IndexError):
        result = {"error": "Failed to parse monitor response", "raw": response_text}

    braintrust.current_span().log(output=result)
    return result
