## System Overview

```
┌─────────────────────────────────────────────────┐
│                React Demo (Next.js)              │
│                                                  │
│  Synthetic Data ──► Rule Engine ──► Notification │
│  (4 SMBs)          (arithmetic)     (pre-built)  │
│                                                  │
│  Time Scrubber ──► Cash Flow Chart               │
│  (slider/autoplay)  (SVG, animated)              │
└─────────────────────────────────────────────────┘
```

**No AI.** Credit decisions (gap detection, payer assessment, advance/decline) are rule-based arithmetic. Deterministic, instant, no tokens. Credit decisions should not depend on a model's mood. If the logic is expressible as rules, it should be rules.

---

## Rule Engine

The credit logic runs entirely client-side with predetermined outcomes baked into synthetic data.

**Cash Flow Monitor logic:**
1. Project cash forward: `current_balance - obligations`
2. If projected balance stays above `typical_buffer` → no gap, no notification
3. If gap forms: `gap = total_obligations - (current_balance - typical_buffer)`
4. Find bridgeable receivables from payers with history
5. Recommended advance = gap amount (covers all obligations + buffer), not invoice face value

**Credit Assessor logic:**
1. Payer has 0 history → decline
2. On-time rate below 60% → decline
3. Trend deteriorating (last 3+ payments late) → decline
4. Otherwise → advance, with early warning if trend is concerning

Both are if/else logic. No model needed.

**Constraints:**
- Bridge amount cannot exceed the €50,000 overdraft limit
- Pleo expects repayment within 30 days — bridge window (activation to actual payment) must be ≤ 30 days. Pleo doesn't pull until the payer pays, not when the invoice is due
- No interest on the bridge — the 2% activation fee for the overdraft facility is already paid

---

## Data

The React component imports `data/synthetic_db.json` at build time — single source of truth. All dates are relative (T+N days) so data never goes stale.

**4 scenarios, 4 businesses, 6 payers.** Each scenario tests a different product behavior:

| Scenario | Business | What it tests |
|----------|----------|---------------|
| healthy | Verdant Studio | Bridge works — reliable payer, clean resolve |
| risky | Norde Health | System correctly declines — unreliable payer |
| deteriorating | Vero Analytics | Bridge with early warning — good stats, concerning trend |
| transition | Fika & Co | Two cycles — bridge + warning, then graceful decline |

---

## Demo Mode

The React demo supports:
- **4 scenarios** selected from a sidebar dropdown with tagline visible at a glance
- **Auto-play** via a prominent "Play scenario" button — cash flow projection animates day by day
- **Auto-pause** when notifications appear (bridge offer, decline, graceful decline) so the user can digest and act
- **Bridge notification** slides in when a gap forms — clean, minimal: situation statement, no-interest terms, approve/decline buttons
- **Early warning** (amber card) appears within the bridge notification when payer trend is concerning
- **Graceful decline** (second cycle) appears after a bridge resolves if the payer trend has worsened
- **Cold decline** for scenarios where the system correctly says nothing (unreliable payer)
- **Resolution toast** when the bridge auto-resolves on payer payment
- **Overdraft limit** updates live when bridge is active, restores when resolved
- **Auto-resume** after user approves or declines the bridge offer
- **Reset and replay** when clicking "Play scenario" at the end of a timeline

---

## What's Not Here

- **No AI anywhere.** The bridge recommendation is rule-based. The notification text is pre-built. No LLM calls, no prompt management, no tokens.
- **No compliance reviewer.** Article 50 applies to AI-generated content. This system doesn't generate content with AI, so it doesn't need one. The model-spec for a compliance agent exists as design thinking for when AI is introduced (e.g., if the system ever generates personalized rationale text), but it's not built or needed for this demo.
- **No real-time monitoring.** The prototype simulates the timing moment with synthetic data. Building the surveillance loop (watching ledgers, detecting gaps as they form) is beyond prototype scope.
- **No approval workflow.** The prototype packages the recommendation for the finance person but doesn't build the forwarding/approval flow to a decision-maker.
