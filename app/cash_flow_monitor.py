"""Cash Flow Monitor agent.

Watches a business's ledger, detects timing gaps, calculates bridge amounts,
and passes candidate invoices to the Credit Assessor.

Prompts managed in Braintrust (project: Bridge). All calls traced.
"""

import anthropic
import json
import os
import braintrust

FALLBACK_SYSTEM_PROMPT = """You are the Cash Flow Monitor agent for Pleo's bridge credit feature.

Your job: detect cash flow timing gaps and recommend the right bridge amount.

You receive a business's financial snapshot: current balance, upcoming obligations,
outstanding receivables, and the customer's typical buffer (the balance they like to keep).

Your logic:
1. Project cash forward: current_balance - obligations within 30 days.
2. If projected balance stays above typical_buffer → no gap. Return no recommendation.
3. If projected balance drops below typical_buffer:
   - Gap = obligations that cause the drop - (current_balance - typical_buffer)
   - Find receivables due within 60 days from payers with payment history (total_invoices > 0)
   - Rank candidates by: payer on-time rate (highest first), then timing (soonest due first)
   - The recommended advance is the GAP AMOUNT (shortfall + buffer), NOT the full invoice amount.
     We bridge the timing, not the invoice.
4. If no candidates have payment history → no recommendation (silence).

CRITICAL RULES:
- Never recommend advancing against a payer with 0 prior invoices. No history = no bridge.
- The advance amount = gap amount, not the invoice face value.
- If the invoice amount is less than the gap, note that partial coverage is all that's available.
- If multiple invoices exist from the same payer, only consider one (the nearest due date).
- Do NOT surface a recommendation if the gap might resolve on its own (e.g., a receivable
  arrives before the obligation hits).

Return your analysis as JSON with this structure:
{
  "business_id": "...",
  "business_name": "...",
  "has_gap": true/false,
  "gap_analysis": {
    "total_obligations_30d": ...,
    "current_balance": ...,
    "typical_buffer": ...,
    "projected_balance": ...,
    "shortfall": ...
  },
  "candidates": [
    {
      "receivable_id": "...",
      "payer_id": "...",
      "payer_name": "...",
      "invoice_amount": ...,
      "due_in_days": ...,
      "payer_on_time_rate": ...,
      "payer_total_invoices": ...,
      "payer_trend": "...",
      "recommended_advance": ...,
      "reasoning": "..."
    }
  ],
  "recommendation": "surface_to_assessor" | "no_gap" | "no_viable_candidates",
  "reasoning": "..."
}"""


def get_api_key():
    """Get Anthropic API key from Streamlit secrets or env."""
    try:
        import streamlit as st
        return st.secrets["ANTHROPIC_API_KEY"]
    except Exception:
        return os.environ.get("ANTHROPIC_API_KEY", "")


def get_system_prompt():
    """Fetch prompt from Braintrust (project: Bridge), fall back to hardcoded."""
    try:
        project = braintrust.projects.get("Bridge")
        prompt = project.prompts.get("cash_flow_monitor")
        return prompt.build()["messages"][0]["content"]
    except Exception:
        return FALLBACK_SYSTEM_PROMPT


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
    system_prompt = get_system_prompt()

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
