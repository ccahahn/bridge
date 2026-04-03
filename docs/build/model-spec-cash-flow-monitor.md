## Cash Flow Monitor — Rule Engine Spec

**Role:** Detect cash flow timing gaps and calculate the right bridge amount.

**Runtime:** Client-side arithmetic. No AI. Deterministic.

### Logic

1. Project cash forward: `current_balance - sum(obligations within 30 days)`
2. If projected balance stays above `typical_buffer` → no gap. No recommendation.
3. If projected balance drops below `typical_buffer`:
   - Gap = `obligations that cause the drop - (current_balance - typical_buffer)`
   - Find receivables due within 60 days from payers with payment history (`total_invoices > 0`)
   - Rank candidates by: payer on-time rate (highest first), then timing (soonest due first)
   - Recommended advance = gap amount (shortfall + buffer), NOT the full invoice amount. We bridge the timing, not the invoice.
4. If no candidates have payment history → no recommendation (silence).

### Rules

- Never advance against a payer with 0 prior invoices. No history = no bridge.
- Advance amount = gap amount, not invoice face value.
- If invoice amount < gap, note partial coverage only.
- If multiple invoices from same payer, consider only one (nearest due date).
- Do not surface if the gap might resolve on its own (receivable arrives before obligation hits).

### Production Note

This logic is implemented as a rule engine in the prototype. In production, the same logic could be extended with an AI layer for: natural language invoice parsing, seasonal pattern detection, and cross-client payer reliability modeling.
