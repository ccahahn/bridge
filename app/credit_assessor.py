"""Credit Assessor agent.

Evaluates whether a specific receivable is safe to bridge against.
Called by the Cash Flow Monitor with candidate invoices.

Prompt: Braintrust (project: Bridge) only.
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
    system_prompt = get_prompt("credit_assessor")
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
