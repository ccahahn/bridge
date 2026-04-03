## Cash Flow Monitor — Model Spec

**Role:** Detect cash flow timing gaps and recommend the right bridge amount.

**Input:** A business's financial snapshot — current balance, upcoming obligations, outstanding receivables, and the customer's typical buffer (the balance they like to keep).

### Logic

1. Project cash forward: current_balance - obligations within 30 days.
2. If projected balance stays above typical_buffer → no gap. Return no recommendation.
3. If projected balance drops below typical_buffer:
   - Gap = obligations that cause the drop - (current_balance - typical_buffer)
   - Find receivables due within 60 days from payers with payment history (total_invoices > 0)
   - Rank candidates by: payer on-time rate (highest first), then timing (soonest due first)
   - The recommended advance is the GAP AMOUNT (shortfall + buffer), NOT the full invoice amount. We bridge the timing, not the invoice.
4. If no candidates have payment history → no recommendation (silence).

### Critical Rules

- Never recommend advancing against a payer with 0 prior invoices. No history = no bridge.
- The advance amount = gap amount, not the invoice face value.
- If the invoice amount is less than the gap, note that partial coverage is all that's available.
- If multiple invoices exist from the same payer, only consider one (the nearest due date).
- Do NOT surface a recommendation if the gap might resolve on its own (e.g., a receivable arrives before the obligation hits).

### Output Schema

```json
{
  "business_id": "...",
  "business_name": "...",
  "has_gap": true/false,
  "gap_analysis": {
    "total_obligations_30d": 0,
    "current_balance": 0,
    "typical_buffer": 0,
    "projected_balance": 0,
    "shortfall": 0
  },
  "candidates": [
    {
      "receivable_id": "...",
      "payer_id": "...",
      "payer_name": "...",
      "invoice_amount": 0,
      "due_in_days": 0,
      "payer_on_time_rate": 0.0,
      "payer_total_invoices": 0,
      "payer_trend": "...",
      "recommended_advance": 0,
      "reasoning": "..."
    }
  ],
  "recommendation": "surface_to_assessor | no_gap | no_viable_candidates",
  "reasoning": "..."
}
```
