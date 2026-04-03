"""Bridge credit pipeline.

Runs Cash Flow Monitor → Credit Assessor for each business,
then formats user-facing output (or silence).

Modes:
  python pipeline.py           — test mode: run all SMBs, log everything
  python pipeline.py --demo    — demo mode: interactive, pick one business at a time
  python pipeline.py biz_001   — run one specific business
"""

import json
import sys
import braintrust
from db import load_db, get_business, get_all_business_ids
from cash_flow_monitor import run_monitor
from credit_assessor import run_assessor

BUSINESS_DESCRIPTIONS = {
    "biz_001": "GreenLeaf Design Studio — healthy business, clear gap, reliable payer",
    "biz_002": "Nordic Freight Solutions — risky payer with late payment history",
    "biz_003": "Bright Path Tutoring — new payer, no history (should decline)",
    "biz_004": "Coastal Analytics — good average hides deteriorating payer trend",
    "biz_005": "UrbanBrew Coffee Roasters — solvency problem, not a timing gap",
}


def format_recommendation(business, assessor_result):
    """Format the user-facing recommendation, or return None for silence."""
    final = assessor_result.get("final_decision", {})

    if final.get("action") == "silence":
        return None

    assessment = final.get("assessment", {})
    biz = business
    amount = assessment.get("advance_amount")
    payer = assessment.get("payer_name", "Unknown")
    rationale = assessment.get("rationale", "")
    risk_factors = assessment.get("risk_factors", [])
    confidence = assessment.get("confidence", "unknown")

    if final.get("action") == "surface_reduced":
        note = "\n  Note: This is a reduced advance due to risk factors identified below."
    else:
        note = ""

    output = f"""
{'='*60}
  BRIDGE RECOMMENDATION — {biz['name']}
  AI-generated recommendation
{'='*60}
{note}
  We can bridge €{amount:,.0f} to cover your upcoming gap
  and keep your usual €{biz['typical_buffer']:,.0f} buffer.

  How we assessed this:
  {rationale}

  Confidence: {confidence}

  Data used in this assessment:
  {chr(10).join(f'  - {r}' for r in risk_factors) if risk_factors else '  - None identified'}

  When the advance resolves:
  When {payer} pays this invoice, we automatically apply
  €{amount:,.0f} back to your balance.

  This recommendation was generated automatically by Pleo's
  credit assessment system. The final decision is yours.

  [Approve]  [Not now]
{'='*60}
"""
    return output


def format_silence(business, monitor_result, assessor_result):
    """Format the internal log for why no recommendation surfaced."""
    monitor_reason = monitor_result.get("reasoning", "Unknown")
    assessor_reason = ""

    if assessor_result:
        final = assessor_result.get("final_decision", {})
        if final.get("action") == "silence":
            assessor_reason = final.get("reason", "")
        assessments = assessor_result.get("assessments", [])
        decline_details = []
        for a in assessments:
            if a.get("decision") == "decline":
                decline_details.append(
                    f"  - {a.get('payer_name', '?')}: {a.get('decline_reason', 'unknown')} — {a.get('rationale', '')}"
                )
        if decline_details:
            assessor_reason += "\n" + "\n".join(decline_details)

    return f"""
{'- '*30}
  NO RECOMMENDATION — {business['name']}
  (User sees nothing. This is internal logging only.)

  Monitor: {monitor_reason}
  Assessor: {assessor_reason or 'Not reached'}
{'- '*30}
"""


@braintrust.traced(name="bridge_pipeline")
def run_pipeline(db, business_id):
    """Run the full pipeline for one business."""
    business = get_business(db, business_id)

    braintrust.current_span().log(
        metadata={
            "business_id": business_id,
            "business_name": business["name"],
            "scenario": business.get("scenario", "unknown"),
        }
    )

    print(f"\n  Running pipeline for {business['name']} ({business_id})...")
    print(f"  Balance: €{business['current_balance']:,} | Buffer: €{business['typical_buffer']:,} | Scenario: {business.get('scenario', 'unknown')}")

    # Step 1: Cash Flow Monitor
    print("  > Cash Flow Monitor analyzing...")
    monitor_result = run_monitor(db, business_id)

    if monitor_result.get("error"):
        print(f"  x Monitor error: {monitor_result['error']}")
        return monitor_result

    has_gap = monitor_result.get("has_gap", False)
    recommendation = monitor_result.get("recommendation", "unknown")
    print(f"  > Gap detected: {has_gap} | Recommendation: {recommendation}")

    # Step 2: Credit Assessor (only if monitor found candidates)
    assessor_result = None
    if recommendation == "surface_to_assessor":
        print("  > Credit Assessor evaluating candidates...")
        assessor_result = run_assessor(db, monitor_result)
        final = assessor_result.get("final_decision", {})
        print(f"  > Final decision: {final.get('action', 'unknown')}")

    # Step 3: Format output
    surfaced = False
    if assessor_result and assessor_result.get("final_decision", {}).get("action") in ("surface", "surface_reduced"):
        output = format_recommendation(business, assessor_result)
        if output:
            print(output)
            surfaced = True

    if not surfaced:
        output = format_silence(business, monitor_result, assessor_result)
        print(output)

    result = {
        "business_id": business_id,
        "business_name": business["name"],
        "scenario": business.get("scenario"),
        "monitor": monitor_result,
        "assessor": assessor_result,
        "surfaced": surfaced,
    }

    braintrust.current_span().log(output=result)
    return result


def run_all(db):
    """Run pipeline for every business in the DB."""
    results = []
    for biz_id in get_all_business_ids(db):
        result = run_pipeline(db, biz_id)
        results.append(result)

    print(f"\n{'='*60}")
    print("  PIPELINE SUMMARY")
    print(f"{'='*60}")
    for r in results:
        status = "SURFACED" if r.get("surfaced") else "SILENCE"
        print(f"  {r['business_name']:.<40} {status}")
    print(f"{'='*60}\n")

    return results


def run_demo(db):
    """Interactive demo mode. Presenter picks businesses one at a time."""
    biz_ids = get_all_business_ids(db)

    while True:
        print(f"\n{'='*60}")
        print("  PLEO BRIDGE CREDIT — DEMO")
        print(f"{'='*60}")
        for i, biz_id in enumerate(biz_ids, 1):
            desc = BUSINESS_DESCRIPTIONS.get(biz_id, biz_id)
            print(f"  {i}. {desc}")
        print(f"  q. Quit")
        print(f"{'='*60}")

        choice = input("\n  Select a business (1-5, or q): ").strip()

        if choice.lower() == "q":
            print("\n  Done.\n")
            break

        try:
            idx = int(choice) - 1
            if 0 <= idx < len(biz_ids):
                run_pipeline(db, biz_ids[idx])
            else:
                print("  Invalid selection.")
        except ValueError:
            print("  Invalid selection.")

        input("\n  Press Enter to continue...")


if __name__ == "__main__":
    db = load_db()

    if "--demo" in sys.argv:
        run_demo(db)
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        run_pipeline(db, sys.argv[1])
    else:
        run_all(db)
