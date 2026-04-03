## System Overview

```
┌─────────────────────────────────────────────────────┐
│                  React Demo (Next.js)                │
│                                                      │
│  Synthetic Data ──► Rule Engine ──► Recommendation   │
│  (5 SMBs)          (arithmetic)     (pre-written)    │
│                                          │           │
│                                          ▼           │
│                                  ┌──────────────┐    │
│                                  │  Compliance   │    │
│                                  │  Agent (LLM)  │    │
│                                  └──────────────┘    │
│                                          │           │
│                                          ▼           │
│                                  Article 50 Review   │
└─────────────────────────────────────────────────────┘
         │
         ▼
   Braintrust (prompt management + tracing)
```

**What runs where:**
- Credit decisions (gap detection, payer assessment, advance/decline) are **rule-based arithmetic**. No AI. Deterministic, instant, no tokens.
- The compliance agent is the **one AI component**. It reviews the recommendation text against EU AI Act Article 50 requirements. This is genuinely an LLM problem — checking if natural language meets regulatory requirements.

---

## Rule Engine

The credit logic runs entirely client-side with predetermined outcomes.

**Cash Flow Monitor logic:**
1. Project cash forward: `current_balance - obligations within 30 days`
2. If projected balance stays above `typical_buffer` → no gap, no recommendation
3. If gap forms: `gap = obligations - (current_balance - typical_buffer)`
4. Find bridgeable receivables from payers with history
5. Recommended advance = gap amount, not invoice face value

**Credit Assessor logic:**
1. Payer has 0 history → decline
2. On-time rate below 60% → decline
3. Trend deteriorating (last 3+ payments late) → decline
4. Business balance declining AND overdraft usage increasing → decline (solvency, not liquidity)
5. Otherwise → advance

Both are if/else logic. No model needed.

---

## Compliance Agent (the AI)

**The only component that calls an LLM.**

Reviews the user-facing recommendation text and checks it against EU AI Act Article 50 transparency obligations. The agent receives the full recommendation (rationale, data points, risk factors, disclosure language) and returns a compliance assessment.

**Why this is an LLM problem:**
- Article 50 requires that users are informed they're interacting with AI, understand the basis of the recommendation, and know the decision is theirs
- Checking whether natural language *actually* communicates these things — not just that the right keywords appear — requires language understanding
- Edge cases: is "we think this is safe" a guarantee or a recommendation? Does the rationale actually explain the data, or just reference it? Is the AI disclosure visible or buried?

**Prompt:** Managed in Braintrust (project: Bridge, slug: `compliance-agent-prompt-4e0b`). See `model-spec-compliance-agent.md` for the full spec.

**Integration:**
- Next.js API route (`/api/compliance`) receives recommendation text, calls Claude via Anthropic SDK
- Response is displayed alongside the recommendation in the demo — the user sees both the recommendation and the compliance review
- Every call is traced to Braintrust with the recommendation text as input and the compliance assessment as output

---

## Data

All scenario data is baked into the React component. The `data/synthetic_db.json` file is a reference document, not used at runtime. All dates are relative (T+N days) so data never goes stale.

---

## Demo Mode

The React demo supports:
- **5 scenarios** selected from a sidebar dropdown, each testing different failure modes
- **Time scrubbing** via slider or auto-play — the cash flow projection animates day by day
- **Recommendation card** slides in when a gap forms (or silence for declines)
- **Compliance review panel** shows the AI's Article 50 assessment alongside the recommendation
- **Resolution toast** when the bridge auto-resolves on payer payment

---

## Braintrust Integration

The compliance agent's prompt is managed in Braintrust (project: Bridge). Every compliance review is traced:
- Input: the recommendation text being reviewed
- Output: the compliance assessment (pass/fail per requirement, suggestions)
- Metadata: scenario ID, business name

This enables: prompt iteration without code changes, regression detection (did a prompt change cause a previously-passing recommendation to fail compliance?), and human review of compliance assessments.

---

## Gotchas the Synthetic Data Tests

| Gotcha | What it tests | Expected behavior |
|--------|--------------|-------------------|
| Payer with 87% lifetime on-time but last 4 payments late | Trend detection | Rule engine catches deteriorating trend, declines |
| Two receivables from same payer | Deduplication | Only one considered |
| New payer with zero history | History threshold | Auto-decline, user sees nothing |
| Good payer but business has declining balance + increasing overdraft | Solvency vs. liquidity | Decline despite good payer |
| Risky payer where amount doesn't cover gap | Partial coverage | No safe bridge available |
