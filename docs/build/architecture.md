## Two-Agent Pipeline

```
Synthetic DB (JSON)
       │
       ▼
┌──────────────┐     candidate invoices     ┌──────────────────┐
│  Cash Flow   │ ──────────────────────────► │  Credit          │
│  Monitor     │                             │  Assessor        │
│              │ ◄────────────────────────── │                  │
│  "when and   │   advance / decline / reduce│  "is this safe?" │
│   how much?" │                             │                  │
└──────────────┘                             └──────────────────┘
       │
       ▼
  User-facing recommendation
  (or silence if declined)
```

---

## Data Model

### Business Profile

```json
{
  "business_id": "string",
  "name": "string",
  "industry": "string",
  "overdraft_limit": 50000,
  "overdraft_rate": 0.02,
  "current_balance": 31000,
  "typical_buffer": 5000,
  "monthly_revenue_avg": 120000,
  "months_on_pleo": 18
}
```

### Obligations (upcoming outflows)

```json
{
  "obligation_id": "string",
  "business_id": "string",
  "type": "payroll | rent | vendor | tax | other",
  "amount": 42000,
  "due_in_days": 9,
  "recurring": true,
  "description": "Monthly payroll"
}
```

### Receivables (outstanding invoices)

```json
{
  "receivable_id": "string",
  "business_id": "string",
  "payer_id": "string",
  "invoice_amount": 50000,
  "due_in_days": 38,
  "description": "Q1 consulting services"
}
```

### Payers (client payment history)

```json
{
  "payer_id": "string",
  "payer_name": "string",
  "total_invoices": 12,
  "paid_on_time": 11,
  "avg_days_to_pay": 28,
  "avg_days_late_when_late": 5,
  "last_5_payments": [
    { "days_to_pay": 27, "on_time": true },
    { "days_to_pay": 30, "on_time": true },
    { "days_to_pay": 35, "on_time": false },
    { "days_to_pay": 28, "on_time": true },
    { "days_to_pay": 26, "on_time": true }
  ],
  "trend": "stable | improving | deteriorating",
  "first_invoice_months_ago": 24
}
```

---

## Agent 1: Cash Flow Monitor

**Input:** Business profile, obligations, receivables, payer list

**Job:** Detect timing gaps and calculate bridge amounts

**Logic:**
1. Project cash position forward: `current_balance - sum(obligations within 30 days)`
2. If projected balance stays above `typical_buffer`: no gap, stop. Do not surface.
3. If projected balance drops below `typical_buffer`:
   - Gap = `sum(obligations that cause the drop) - (current_balance - typical_buffer)`
   - Identify receivables that are due after the gap but within 60 days
   - Filter to receivables from payers with payment history (>0 prior invoices)
   - Rank by: payer reliability (on-time rate), timing fit (due soonest), amount coverage
4. For each candidate receivable, pass to Credit Assessor with the gap amount and buffer context
5. If Credit Assessor returns advance: package recommendation for user
6. If Credit Assessor returns decline for all candidates: silence. No recommendation surfaces.

**Output to Credit Assessor:**
```json
{
  "business_id": "string",
  "gap_amount": 16000,
  "gap_breakdown": {
    "obligation_total": 42000,
    "current_balance": 31000,
    "typical_buffer": 5000,
    "shortfall": 11000,
    "recommended_advance": 16000
  },
  "candidate_receivable": {
    "receivable_id": "string",
    "payer_id": "string",
    "invoice_amount": 50000,
    "due_in_days": 38
  },
  "urgency_days": 9
}
```

---

## Agent 2: Credit Assessor

**Input:** Gap context from Monitor + payer history from DB

**Job:** Decide if this specific receivable is safe to bridge against

**Logic:**
1. **Payer history check:** If payer has 0 prior invoices → automatic decline. No history, no bridge.
2. **On-time rate:** Calculate `paid_on_time / total_invoices`. Below 60% → decline.
3. **Trend check:** If trend is "deteriorating" (last 3 payments worse than prior 3) → flag for extra scrutiny.
4. **Late payment buffer:** If payer pays late, are they late by less than `receivable_due_in_days - urgency_days`? If the late pattern still resolves before Pleo's 30-day window, it may still be viable.
5. **Amount check:** Is the recommended advance ≤ the invoice amount? (Should always be true given Monitor logic, but verify.)
6. **Business health:** Is the business showing signs of solvency problems (declining balance trend, increasing overdraft usage, obligations growing faster than receivables)? If so, this is a solvency problem, not a timing problem → decline.

**Decision output:**
```json
{
  "decision": "advance | decline | reduce",
  "advance_amount": 16000,
  "rationale": "string — human-readable explanation",
  "risk_factors": ["list of concerns, even on approve"],
  "payer_reliability_score": 0.92,
  "confidence": "high | medium | low"
}
```

**Decline reasons (internal — never shown to user, recommendation simply doesn't surface):**
- No payer history
- Payer reliability below threshold
- Deteriorating payer trend with insufficient buffer
- Business solvency concern

---

## User-Facing Output

Only generated when Credit Assessor returns `advance` or `reduce`.
Must comply with EU AI Act Article 50: disclose AI generation, explain the data basis, make clear the decision is the user's.

```
🤖 AI-generated recommendation

Your payment from [Payer] isn't due for [X] days, but you have 
[obligation type] in [Y] days. We can bridge €[amount] to cover 
the gap and keep your usual buffer.

How we assessed this:
- We analyzed [Payer]'s payment history: [N] of [M] invoices 
  paid on time, averaging [Z] days to pay
- We calculated your gap based on your current balance (€[bal]), 
  upcoming [obligation type] (€[obl]), and your typical €[buffer] cushion
- This recommendation was generated automatically by Pleo's 
  credit assessment system

When the advance resolves:
- When [Payer] pays this invoice, we automatically apply €[amount] 
  back to your balance

This is a recommendation, not a guarantee. The final decision is yours.

[Approve] [Not now]
```

Packaged so the finance person can forward the full context to a decision-maker without rebuilding it.

---

## Demo Mode

The pipeline supports two modes:

- **Test mode** (`python pipeline.py`): runs all SMBs, logs everything, produces summary. This is the test suite.
- **Demo mode** (`python pipeline.py --demo`): interactive. Presents a menu of businesses with one-line descriptions. The presenter picks one, the pipeline runs, the recommendation (or silence) is shown. Then back to the menu. This lets the presenter tell a story — "let me show you a healthy business... now a risky one... now watch the system correctly stay silent."

---

## Prompt Management and Tracing (Braintrust)

All agent prompts are managed in Braintrust, not hardcoded in source. The code pulls the current prompt version at runtime.

**Why this matters:**
- Prompts can be iterated in Braintrust's UI without code changes or deploys
- Every pipeline run is logged as a trace: the business snapshot input, the Monitor's analysis, the Assessor's decision, and the final output (or silence)
- Traces are tagged by business_id and scenario so we can filter by outcome type
- Prompt versions are pinned to traces, so we can see which prompt version produced which decision

**Architecture:**
- `cash_flow_monitor.py` and `credit_assessor.py` fetch their system prompts from Braintrust at runtime
- Each agent call is wrapped in a Braintrust span (monitor span → assessor span nested inside)
- The pipeline run is the top-level trace, with business metadata attached
- Scores (correct decision, gotcha caught, etc.) can be attached to traces after the fact for eval

**In production**, this is the same infrastructure that would power: prompt A/B testing, regression detection (did a prompt change cause a previously-correct decline to flip to approve?), and the eval loop described in the spec.

---

## Synthetic DB Design Principles

- All dates are relative (T+N days from "today") so data never goes stale
- Each SMB has enough history to show patterns, not just snapshots
- Payer histories include gotchas: deteriorating trends hidden in good averages, new payers mixed with established ones, late-but-within-window patterns
- Business profiles include buffer patterns derived from 6+ months of balance history
- At least 5 SMBs to cover the three spec scenarios plus additional edge cases the agents must handle correctly

---

## Gotchas the Synthetic Data Must Test

| Gotcha | What it tests | Expected behavior |
|--------|--------------|-------------------|
| Payer with 90% on-time rate but last 3 payments all late | Trend detection | Assessor flags deteriorating trend, declines or reduces |
| Invoice amount smaller than the gap | Monitor logic | Monitor doesn't recommend advancing — it won't cover the shortfall |
| Two receivables from same payer | Deduplication | Monitor picks one, doesn't double-count |
| Gap resolves if a closer obligation gets paid first | False positive gap | Monitor should not surface if the gap might close on its own |
| Payer with great history but invoice is overdue (past due date) | Overdue detection | Already late = higher risk signal, Assessor factors this in |
| Business with no gap but low balance trending toward one | Too-early surfacing | Monitor stays silent — no gap yet, don't interrupt |
| New payer with a single large invoice | History threshold | Assessor auto-declines — zero history means no bridge |
| Reliable payer, but business has growing overdraft usage | Solvency vs. liquidity | Assessor catches solvency signal, declines despite good payer |
