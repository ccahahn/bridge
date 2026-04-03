## Credit Assessor — Rule Engine Spec

**Role:** Decide if a specific receivable is safe to bridge against.

**Runtime:** Client-side if/else logic. No AI. Deterministic.

### Evaluation Criteria (in order)

**1. Payer History Check (automatic decline if failed)**
- 0 prior invoices → decline. No history = no bridge. Non-negotiable.
- On-time rate below 60% → decline. Too unreliable.

**2. Trend Check**
- Look at last 5 (or fewer) payments. Are they getting worse?
- A payer with 87% lifetime on-time rate but last 4 payments all late is DETERIORATING. The average lies. Recent behavior matters more than lifetime stats.
- If trend is "deteriorating" AND last 3+ payments were late → decline.

**3. Late Payment Buffer**
- If payer pays late: `receivable_due_in_days - urgency_days` = buffer. If average late days exceed this buffer, the bridge might not resolve in time.
- Check against Pleo's 30-day window. If lateness pushes payment past 30 days from original due date → too much exposure.

**4. Amount Check**
- Recommended advance must be ≤ invoice amount.

**5. Business Health Check**
- Is `balance_trend` declining AND `overdraft_usage_trend` increasing?
- If both → solvency problem, not timing problem. Decline.
- A good payer does not fix a sinking business.

### Decision Outcomes

- **Advance**: safe to bridge. Specify amount and rationale.
- **Decline**: not safe. Recommendation does not surface. User sees nothing.

### Production Note

This logic is implemented as a rule engine in the prototype. In production, the assessor could be extended with an AI layer for: deteriorating trend prediction (not just detection), cross-portfolio payer risk scoring, and nuanced solvency assessment beyond two binary signals.
