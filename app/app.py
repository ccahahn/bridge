"""Pleo Bridge Credit — Streamlit Demo

Interactive demo of the two-agent pipeline:
Cash Flow Monitor → Credit Assessor
"""

import streamlit as st
import json
import os
import braintrust
from db import load_db, get_business, get_obligations, get_receivables, get_payer
from cash_flow_monitor import run_monitor
from credit_assessor import run_assessor

# --- Config ---
st.set_page_config(page_title="Pleo Bridge Credit", page_icon="🏦", layout="wide")

# Set API keys from Streamlit secrets
if "ANTHROPIC_API_KEY" in st.secrets:
    os.environ["ANTHROPIC_API_KEY"] = st.secrets["ANTHROPIC_API_KEY"]
if "BRAINTRUST_API_KEY" in st.secrets:
    os.environ["BRAINTRUST_API_KEY"] = st.secrets["BRAINTRUST_API_KEY"]

# --- Load data ---
db = load_db()

BUSINESS_INFO = {
    "biz_001": {"label": "GreenLeaf Design Studio", "scenario": "Bridge works", "icon": "✅"},
    "biz_002": {"label": "Nordic Freight Solutions", "scenario": "Risky payer", "icon": "⚠️"},
    "biz_003": {"label": "Bright Path Tutoring", "scenario": "Correctly declines", "icon": "🚫"},
    "biz_004": {"label": "Coastal Analytics", "scenario": "Deteriorating trend hidden in good average", "icon": "📉"},
    "biz_005": {"label": "UrbanBrew Coffee Roasters", "scenario": "Solvency problem, not liquidity", "icon": "🔴"},
}

# --- Header ---
st.title("Pleo Bridge Credit")
st.caption("AI-generated recommendations — EU AI Act Article 50 compliant")
st.markdown("Two-agent pipeline: **Cash Flow Monitor** detects timing gaps → **Credit Assessor** evaluates if the bridge is safe.")
st.divider()

# --- Business selector ---
col1, col2 = st.columns([1, 2])

with col1:
    st.subheader("Select a business")
    selected_biz = None
    for biz_id, info in BUSINESS_INFO.items():
        biz = get_business(db, biz_id)
        if st.button(
            f"{info['icon']} {info['label']}",
            key=biz_id,
            use_container_width=True,
            help=info["scenario"],
        ):
            selected_biz = biz_id

# --- Run pipeline ---
with col2:
    if selected_biz:
        biz = get_business(db, selected_biz)
        info = BUSINESS_INFO[selected_biz]

        st.subheader(f"{info['icon']} {biz['name']}")
        st.caption(f"Scenario: {info['scenario']}")

        # Business snapshot
        with st.expander("Business snapshot", expanded=True):
            metrics_col1, metrics_col2, metrics_col3, metrics_col4 = st.columns(4)
            metrics_col1.metric("Balance", f"€{biz['current_balance']:,.0f}")
            metrics_col2.metric("Buffer", f"€{biz['typical_buffer']:,.0f}")
            metrics_col3.metric("Overdraft limit", f"€{biz['overdraft_limit']:,.0f}")
            metrics_col4.metric("Months on Pleo", biz['months_on_pleo'])

            st.markdown("**Upcoming obligations:**")
            obligations = get_obligations(db, selected_biz)
            for obl in sorted(obligations, key=lambda o: o["due_in_days"]):
                st.markdown(f"- €{obl['amount']:,.0f} — {obl['description']} (T+{obl['due_in_days']} days)")

            st.markdown("**Outstanding receivables:**")
            receivables = get_receivables(db, selected_biz)
            for rec in sorted(receivables, key=lambda r: r["due_in_days"]):
                payer = get_payer(db, rec["payer_id"])
                history = f"{payer['paid_on_time']}/{payer['total_invoices']} on time" if payer["total_invoices"] > 0 else "No history"
                trend_badge = {"stable": "🟢", "deteriorating": "🔴", "improving": "🟡", "unknown": "⚪"}.get(payer["trend"], "⚪")
                st.markdown(f"- €{rec['invoice_amount']:,.0f} from **{payer['payer_name']}** (T+{rec['due_in_days']} days) — {history} {trend_badge}")

        st.divider()

        # Run the pipeline
        with st.spinner("Cash Flow Monitor analyzing..."):
            monitor_result = run_monitor(db, selected_biz)

        if monitor_result.get("error"):
            st.error(f"Monitor error: {monitor_result['error']}")
        else:
            has_gap = monitor_result.get("has_gap", False)
            recommendation = monitor_result.get("recommendation", "unknown")

            # Monitor results
            with st.expander("Cash Flow Monitor analysis", expanded=True):
                gap = monitor_result.get("gap_analysis", {})
                if has_gap:
                    st.warning(f"Gap detected: €{gap.get('shortfall', 0):,.0f} shortfall")
                    st.markdown(f"- Obligations (30d): €{gap.get('total_obligations_30d', 0):,.0f}")
                    st.markdown(f"- Current balance: €{gap.get('current_balance', 0):,.0f}")
                    st.markdown(f"- Typical buffer: €{gap.get('typical_buffer', 0):,.0f}")
                    st.markdown(f"- Projected balance: €{gap.get('projected_balance', 0):,.0f}")
                else:
                    st.success("No gap detected. No action needed.")

                st.markdown(f"**Monitor reasoning:** {monitor_result.get('reasoning', 'N/A')}")

                candidates = monitor_result.get("candidates", [])
                if candidates:
                    st.markdown(f"**Candidates passed to Credit Assessor:** {len(candidates)}")
                    for c in candidates:
                        st.markdown(f"- {c.get('payer_name', '?')} — €{c.get('recommended_advance', 0):,.0f} advance, {c.get('payer_on_time_rate', 0):.0%} on-time rate, trend: {c.get('payer_trend', '?')}")

            # Credit Assessor
            if recommendation == "surface_to_assessor":
                with st.spinner("Credit Assessor evaluating..."):
                    assessor_result = run_assessor(db, monitor_result)

                final = assessor_result.get("final_decision", {})
                action = final.get("action", "silence")

                with st.expander("Credit Assessor evaluation", expanded=True):
                    for a in assessor_result.get("assessments", []):
                        decision = a.get("decision", "unknown")
                        badge = {"advance": "✅", "reduce": "⚠️", "decline": "🚫"}.get(decision, "❓")
                        st.markdown(f"**{badge} {a.get('payer_name', '?')}** — {decision}")
                        st.markdown(f"Rationale: {a.get('rationale', 'N/A')}")
                        if a.get("risk_factors"):
                            st.markdown("Risk factors:")
                            for rf in a["risk_factors"]:
                                st.markdown(f"- {rf}")
                        if a.get("decline_reason"):
                            st.markdown(f"Decline category: `{a['decline_reason']}`")
                        st.markdown(f"Reliability: {a.get('payer_reliability_score', 'N/A')} | Confidence: {a.get('confidence', 'N/A')}")
                        st.markdown("---")

                # Final output
                st.divider()
                if action in ("surface", "surface_reduced"):
                    assessment = final["assessment"]
                    amount = assessment.get("advance_amount", 0)

                    st.success("**Bridge recommendation ready**")
                    st.info("🤖 AI-generated recommendation")

                    if action == "surface_reduced":
                        st.warning("This is a reduced advance due to risk factors.")

                    st.markdown(f"""
**We can bridge €{amount:,.0f}** to cover your upcoming gap and keep your usual €{biz['typical_buffer']:,.0f} buffer.

**How we assessed this:**
{assessment.get('rationale', '')}

**Data used in this assessment:**
""")
                    for rf in assessment.get("risk_factors", []):
                        st.markdown(f"- {rf}")

                    st.markdown(f"""
**When the advance resolves:**
When {assessment.get('payer_name', 'the payer')} pays this invoice, we automatically apply €{amount:,.0f} back to your balance.

*This recommendation was generated automatically by Pleo's credit assessment system. The final decision is yours.*
""")
                    btn_col1, btn_col2, _ = st.columns([1, 1, 3])
                    btn_col1.button("Approve", type="primary", key="approve")
                    btn_col2.button("Not now", key="not_now")

                else:
                    st.markdown("### No recommendation")
                    st.markdown("The system found no safe bridge for this business. **The user sees nothing** — no notification, no decline message. Silence is the product working.")
                    if final.get("reason"):
                        st.caption(f"Internal: {final['reason']}")

            elif recommendation == "no_viable_candidates":
                st.divider()
                st.markdown("### No recommendation")
                st.markdown("Candidates exist but none have sufficient payment history. **The user sees nothing.**")

            elif recommendation == "no_gap":
                st.divider()
                st.markdown("### No action needed")
                st.markdown("This business has no timing gap. The system stays silent.")

    else:
        st.markdown("### Choose a business from the left to run the pipeline")
        st.markdown("""
Each business tests a different scenario:

- **GreenLeaf** — the happy path. Reliable payer, clear gap, bridge works.
- **Nordic Freight** — risky payer. Late payment history, the agents must catch this.
- **Bright Path** — brand new client, zero history. System should correctly decline.
- **Coastal Analytics** — the gotcha. Great lifetime average hides a deteriorating recent trend.
- **UrbanBrew** — solvency problem disguised as a timing gap. Good payer, sinking business.
""")
