"""Credit Assessor agent.

Evaluates whether a specific receivable is safe to bridge against.
Called by the Cash Flow Monitor with candidate invoices.

Prompts managed in Braintrust (project: Bridge). All calls traced.
"""

import anthropic
import json
import os
import braintrust

FALLBACK_SYSTEM_PROMPT = """You are the Credit Assessor agent for Pleo's bridge credit feature.

Your job: decide if a specific receivable is safe to lend against. You receive a candidate
from the Cash Flow Monitor (the gap context, the invoice, and the payer's full payment history)
and return a decision.

Your evaluation criteria, in order:

1. PAYER HISTORY CHECK (automatic decline if failed):
   - 0 prior invoices → decline. No history = no bridge. Non-negotiable.
   - On-time rate below 60% → decline. Too unreliable.

2. TREND CHECK:
   - Look at the last 5 (or fewer) payments. Are they getting WORSE over time?
   - A payer with 87% lifetime on-time rate but whose last 4 payments were all late
     is DETERIORATING. The average lies. Recent behavior matters more than lifetime stats.
   - If trend is "deteriorating" AND last 3+ payments were late → decline or reduce.

3. LATE PAYMENT BUFFER:
   - If the payer pays late, how late? Calculate: receivable_due_in_days - urgency_days.
     That's the buffer. If the payer's average late days exceed this buffer, the bridge
     might not resolve before the business needs the money.
   - Also check against Pleo's 30-day window. If average lateness means payment would
     arrive after 30 days past original due date, that's too much exposure.

4. AMOUNT CHECK:
   - Recommended advance must be ≤ invoice amount (Monitor should ensure this, but verify).

5. BUSINESS HEALTH CHECK:
   - Is balance_trend "declining"? Is overdraft_usage_trend "increasing"?
   - If BOTH are true → this may be a solvency problem, not a timing problem. Decline.
   - A good payer does NOT fix a sinking business. The bridge is for timing, not survival.

DECISION OPTIONS:
- "advance": safe to bridge. State the amount and full rationale.
- "reduce": partially safe. Reduce the advance amount and explain why.
- "decline": not safe. Explain why (internally — this rationale is logged, not shown to user.
  The user never sees a decline. The recommendation simply doesn't surface.)

Return JSON:
{
  "decision": "advance" | "decline" | "reduce",
  "advance_amount": number or null,
  "rationale": "human-readable explanation of the decision",
  "risk_factors": ["list of concerns, even on approve"],
  "payer_reliability_score": 0.0-1.0,
  "confidence": "high" | "medium" | "low",
  "decline_reason": "category if declined: no_history | low_reliability | deteriorating_trend | insufficient_buffer | solvency_concern"
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
        prompt = project.prompts.get("credit_assessor")
        return prompt.build()["messages"][0]["content"]
    except Exception:
        return FALLBACK_SYSTEM_PROMPT


@braintrust.traced(name="credit_assessor")
def run_assessor(db, monitor_output):
    """Run the Credit Assessor on candidates from the Monitor."""
    if monitor_output.get("recommendation") != "surface_to_assessor":
        return {
            "decision": "no_candidates",
            "reasoning": monitor_output.get("reasoning", "No gap or no viable candidates"),
        }

    candidates = monitor_output.get("candidates", [])
    if not candidates:
        return {"decision": "no_candidates", "reasoning": "No candidates passed to assessor"}

    from db import get_business, get_payer

    results = []
    business = get_business(db, monitor_output["business_id"])
    system_prompt = get_system_prompt()
    client = anthropic.Anthropic(api_key=get_api_key())

    for candidate in candidates:
        payer = get_payer(db, candidate["payer_id"])

        assessor_input = {
            "business": business,
            "gap_analysis": monitor_output["gap_analysis"],
            "candidate": candidate,
            "payer_full_history": payer,
        }

        with braintrust.current_span().start_span(
            name=f"assess_{candidate.get('payer_name', 'unknown')}",
            input=assessor_input,
        ) as span:
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1500,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Assess this bridge candidate.\n\n{json.dumps(assessor_input, indent=2)}",
                    }
                ],
            )

            response_text = message.content[0].text
            try:
                if "```json" in response_text:
                    response_text = response_text.split("```json")[1].split("```")[0]
                elif "```" in response_text:
                    response_text = response_text.split("```")[1].split("```")[0]
                assessment = json.loads(response_text.strip())
            except (json.JSONDecodeError, IndexError):
                assessment = {"error": "Failed to parse assessor response", "raw": response_text}

            assessment["candidate_receivable_id"] = candidate.get("receivable_id")
            assessment["payer_name"] = candidate.get("payer_name")
            span.log(output=assessment)
            results.append(assessment)

    final = _pick_best(results)

    braintrust.current_span().log(
        output={"assessments": results, "final_decision": final},
        metadata={"business_id": monitor_output["business_id"], "agent": "assessor"},
    )

    return {
        "business_id": monitor_output["business_id"],
        "business_name": monitor_output.get("business_name"),
        "assessments": results,
        "final_decision": final,
    }


def _pick_best(assessments):
    """Pick the best assessment to surface (if any)."""
    approved = [a for a in assessments if a.get("decision") == "advance"]
    reduced = [a for a in assessments if a.get("decision") == "reduce"]

    if approved:
        best = sorted(
            approved,
            key=lambda a: (
                {"high": 3, "medium": 2, "low": 1}.get(a.get("confidence"), 0),
                a.get("payer_reliability_score", 0),
            ),
            reverse=True,
        )[0]
        return {"action": "surface", "assessment": best}

    if reduced:
        best = sorted(
            reduced,
            key=lambda a: a.get("payer_reliability_score", 0),
            reverse=True,
        )[0]
        return {"action": "surface_reduced", "assessment": best}

    return {"action": "silence", "reason": "All candidates declined"}
