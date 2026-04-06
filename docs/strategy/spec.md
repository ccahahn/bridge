**Problem**

SMBs on Pleo have a cash flow timing problem: the money they're owed arrives after the money they owe goes out. Pleo Overdraft lets them spend into a negative balance but it's general-purpose and unsecured. The business gets a credit line with no connection to *why* they need it or *when* it resolves. That means Pleo carries the full risk of the business's creditworthiness. 

**Core Bet**

Purpose-bound credit tied to a specific invoice from a known payer has a fundamentally better risk profile than general-purpose overdraft. It changes the underwriting question from "is this business creditworthy?" to "will this specific invoice get paid?" and auto-resolves when it does. 

The pitch is: pay 2% activation and your money works harder automatically. No interest on the bridge itself. It resolves when the invoice is paid.

This product is Pleo's own values made literal. 
- **"More than you'd expect":** the system sees a cash flow gap forming before the finance team does and shows up with a solution. Nobody expects their spend management platform to say "hey, you have payroll in 2 days and your receivable won't land in time. Do you want us to bridge that?" 
- **"Empowering"**: the customer isn't borrowing out of desperation, they're freeing up their cash to use however they want while Pleo bridges the timing. Their capital stays productive — earning yield, funding growth, maintaining liquidity for opportunities — instead of being pulled back to cover a gap they know will resolve.

**The Human Bar**

The best version of this today is a sharp CFO at a 30-person company who keeps a rolling cash flow forecast in their head. They know: payroll hits on the 15th, the office lease is due on the 1st, and the £50K from their biggest client always lands around the 20th but sometimes it's the 28th. When they see a gap forming, they call their bank or move money between accounts before anyone on the team even notices a problem. They never panic. They never over-borrow. They solve the timing problem, not the solvency problem, because they know the difference.

What makes them great: they act before the gap becomes a crisis. They know which receivables are reliable and which aren't. They'd never borrow against an invoice from a client who hasn't paid them before. And they never leave borrowed money sitting around. The moment the cash comes in, the debt closes.

Design decisions this implies:
- The system acts before the user notices the gap, not after they're already stressed
- It only bridges against receivables with known, reliable payers. New payers are a no
- The bridge auto-closes when the receivable pays. The user doesn't get to keep the money. This isn't a second credit line; it's a timing fix that resolves itself
- The system knows the difference between a timing problem and a solvency problem — but it's careful about what it assumes. A business spending more than usual could be sinking or growing; the system shouldn't guess

**The Prototype**

Three scenarios, each testing a different product behavior:

1. **The bridge works.** Verdant Studio has £50K coming from Acme Corp (reliable payer, 11 of 12 invoices paid on time) at T+35, but payroll of £42K and rent of £4.5K hit before that. The system bridges £20.5K — just enough to cover both obligations and maintain the buffer they're used to. Not the full £50K invoice. The system bridges the timing, not the invoice. The customer's capital stays free. Pleo has their back.

2. **Bridge with caution.** Vero Analytics has a reliable payer on paper — TrustBank at 87% lifetime on-time — but the last 4 payments have been getting later (35, 38, 42, 45 days vs their usual 30). The system still bridges £44K — the lifetime stats support it — but surfaces the trend: "We've noticed TrustBank has been paying later recently. Their last 4 invoices took 35, 38, 42, and 45 days — up from their usual average of 30."

3. **The transition.** Fika & Co's two-cycle story with Nordic Events. Cycle 1: Nordic Events (7/10 on-time, trending late at 2→5→7 days) has a £20K receivable due at T+10 but payroll and supplier payments hit at T+8 and T+12. The system bridges £16.5K with an early warning about the trend. Nordic pays 8 days late at T+18. Bridge auto-resolves. Cycle 2: Nordic's next invoice (£25K) is due at T+35 — before payroll at T+38, so on paper there's no gap. But the system knows Nordic has been paying 2–8 days late. If that continues, the money won't land in time. The system bridges proactively against the predicted gap. Nordic pays late again at T+43. The system was right.

What doors this closes:
- The product never bridges against payers with no history. Out of scope for now; needs data before revisiting.
- The user never keeps the advance after the receivable pays. Auto-pull is non-negotiable. Offering flexibility here may attract the wrong customer — someone using purpose-bound credit as general-purpose credit with extra steps — which is exactly the risk profile this product exists to avoid.
- The product never replaces the overdraft. It layers on top. The overdraft limit (£50K) caps bridge amounts.
- Pleo expects repayment within 30 days. The bridge window (activation to actual payment) must fit within this. Pleo doesn't pull until the payer pays — not when the invoice is due.

**Balance Traces**

Verdant Studio (with bridge):
- T+0: £31,000 → T+7: +£20,500 bridge → T+9: -£42K payroll = £9,500 → T+15: -£4.5K rent = £5,000 (buffer) → T+35: +£50K Acme, -£20.5K repaid = £34,500

Vero Analytics (with bridge):
- T+0: £18,000 → T+6: +£44K bridge → T+8: -£42K payroll = £20,000 → T+20: -£14K VAT = £6,000 (buffer) → T+32: +£55K TrustBank pays, -£44K repaid = £17,000

Fika & Co (with bridge, two cycles):
- T+0: £12,000 → T+6: +£16.5K bridge → T+8: -£20K payroll = £8,500 → T+12: -£5K supplier = £3,500 (buffer) → T+18: +£20K Nordic pays (8 days late), -£16.5K repaid = £7,000 → T+36: +£16.5K bridge 2 → T+38: -£20K payroll = £3,500 (buffer) → T+43: +£25K Nordic pays (8 days late), -£16.5K repaid = £12,000

**High-Level Architecture**

One layer: a **rule engine** with no AI. The Cash Flow Monitor detects timing gaps and calculates bridge amounts. The Credit Assessor evaluates payer reliability, trend, and business health. Both are arithmetic and if/else logic — deterministic, instant, no tokens.

The user sees a clean notification: "Your payment from Acme Corp isn't due for 28 days, but you have payroll in 2 days. We can bridge £20,500 to cover the gap and keep your usual buffer. No interest. Auto-resolves when Acme Corp pays."

For the prototype: the rule engine runs against a synthetic database with relative-time ledgers (not real dates, so the data never goes stale). Real-time monitoring is simulated — the prototype shows the moment, not the surveillance loop.

**How We'll Know It Works**

Failure modes:

*In the rule engine:*
- The Credit Assessor misses a deteriorating trend hidden in a good lifetime average. The Vero Analytics scenario tests this with an early warning surfacing the trend data.
- The Monitor surfaces a recommendation when the gap might resolve on its own. The relative-time data lets us test timing sensitivity.
- The system fails to predict a gap that only exists because a payer is late. The Fika Cycle 2 scenario tests this — the receivable is due before payroll, but the system knows the payer won't pay on time.
- The bridge amount exceeds the overdraft limit. All scenarios are verified against the £50K cap.
- The bridge window exceeds 30 days. All scenarios verified: healthy (28 days), deteriorating (26 days), Fika Cycle 1 (12 days), Fika Cycle 2 (7 days).

*In the product:*
- A reliable payer starts sliding and the user has no visibility. The early warning and late-payment tracking in the timeline sidebar address this — the user sees "Nordic Events due" go amber/overdue, then "Nordic Events paid — 8 days late."
- Default rates on bridged payments exceed projections. The guardrails have a kill threshold on annual default rate and a max capital deployed ceiling.
- The feature attracts customers who are insolvent, not illiquid. Purpose-binding and auto-pull are the design constraints that prevent this.

What I'm deliberately not measuring yet: whether the payer's own financial health is deteriorating (we're using historical payment patterns as a proxy, not assessing the payer directly). That's a deeper underwriting layer for later.

**Risk Model**

Separate deliverable — an 18-month financial projection, not part of the prototype demo. Built on the existing overdraft customer base as the starting pool.

The model tracks:
- **Growth**: baseline signups, uplift from bridge feature, churn with and without bridge, cumulative customer base
- **The Good**: incremental activation revenue from uplift customers, retained revenue from reduced churn
- **The Bad**: capital deployed in bridges (opportunity cost vs. treasury yield), default losses net of recovery, late payment drag (extra days capital is tied up), operational cost
- **Net impact**: monthly and cumulative, with a target month for net-positive cumulative

**Guardrails — kill thresholds:**
- Max acceptable default rate (annual)
- Max capital deployed
- Min upside/downside ratio to continue
- Max months to net-positive cumulative

Breach flags are monitored monthly. Any breach triggers a review — not an automatic shutdown, but a forced conversation about whether the assumptions still hold. Here's what invoice financing looks like at 100 customers, 1,000 customers, 10,000 customers.

The model assumes bridge-only against payers with established payment history. If we later relax that constraint (new payers, reduced history requirements), the default rate assumptions change and the model needs to be re-run.

**Trust and Safety**

The auto-pull is the highest-stakes moment. When the payer actually pays the invoice, Pleo automatically pulls the advance — not when the invoice is due, but when the money lands. The user needs to know this is coming and exactly when. If it surprises them, trust is destroyed in one transaction. The system must be transparent about the terms at the moment of the advance, not buried in fine print.

The early warning is how the system builds trust over time. When a payer's trend is concerning, the system doesn't hide it — it surfaces the data ("Their last 3 invoices were 2, 5, and 7 days late") and lets the user see what the system sees. When the payer then pays late and the system had already flagged it, trust compounds. The system was right, and it told you.

The recommendation itself carries weight. If the system says "we can bridge this" and the business does, they're trusting Pleo's judgment about the payer's reliability. If the payer then doesn't pay on time and the 30-day window closes, who's accountable? The system should never frame a recommendation as a guarantee. The language is "we can bridge" — not "this is safe."

**What happens when the payer is late?** Start with a 30-day grace period after the initial 30-day window — 60 days total before any interest kicks in. No interest during the grace period. The reasoning: we recommended this bridge based on the payer's history. If the payer is a few days late, that's within the variance we accepted when we made the recommendation. Penalizing the customer immediately feels like we're punishing them for trusting our judgment. "I might as well just add funds from my bank" is the exact reaction that kills adoption. Track this from day one: how often do bridges exceed 30 days, by how much, and does the payer eventually pay? We need to understand both client and payer behavior past the 30-day mark before deciding on the right interest structure. The grace period is the starting position — data tells us if it needs to tighten or can afford to be more generous.

**What We're Not Prioritizing**

- **AI in the credit decision:** The bridge recommendation is rule-based. If AI is introduced later (e.g., personalized rationale generation), EU AI Act Article 50 compliance becomes relevant — the design thinking exists in `thinking/model-spec-compliance-agent.md` but nothing is built.
- **Multi-market regulatory compliance:** the prototype assumes a simple market to demonstrate the product value. Scaling the credit decisioning engine across European regulators is the architecture problem described in the role and will be tackled, but is out of scope for this build.
- **Disputed invoices:** what happens when the payer contests the invoice after Pleo has advanced funds. Real risk, needs legal and product design, not prototype scope.
- **Flexibility on auto-pull:** customers will want the option to keep the advance after the receivable pays. This needs data on whether offering flexibility changes who adopts the product and how it affects default rates before touching it.
- **Bridging against new payers:** the prototype requires established payment history. Relaxing this constraint is the obvious growth lever but changes the risk profile fundamentally.
- **The approval workflow between finance person and decision-maker:** the prototype packages the recommendation for both readers but doesn't build the forwarding/approval flow.
- **Real-time monitoring infrastructure:** the prototype simulates the timing moment with synthetic data. Building the actual surveillance loop (watching ledgers, detecting gaps as they form) is an engineering investment beyond prototype scope.

**What Do We Want to Learn?**

- What does Pleo's actual payer payment data look like? How reliable is the historical on-time rate as a predictor? Is there enough signal in Pleo's data to underwrite the payer without external credit checks?
- How many companies have activated overdraft but never drawn on it? These are customers who paid the 2% activation because they wanted the safety net, but haven't needed it. The bridge might be the feature that makes that activation feel worth it — proactive, automatic, no effort required. They're already paying; now the product actually does something for them.
- How do existing overdraft customers actually use their credit line today? What percentage are using it for timing problems vs. structural shortfalls? This determines the addressable market for the bridge feature. Although, I don't think this is something users think is possible so they may enjoy it even if they don't have too many timing problems. 
- What's the real distribution of invoice payment terms and late-payment patterns in Pleo's data? The risk model assumes averages. The tails are where it breaks.
- How does the sub-account funding feature usage correlate with cash flow gaps? Businesses already splitting overdraft into purpose-allocated sub-accounts might be natural early adopters. They're already thinking in terms of purpose-bound credit.
- Could we offer a partial bridge backed by both the invoice and the overdraft limit when the invoice alone doesn't cover the gap? Would need clean cohorts to track whether hybrid bridges behave differently from pure invoice bridges — default rates, repayment timing, user behavior over time. The cohort separation is non-negotiable: mixing hybrid and pure bridge data would poison both signals.
- What are the markets we are interested in shipping? I would want to understand regulatory constraints in each market. For example: The EU AI Act hits financial services on August 2, 2026, which means AI systems must be fully compliant by that date.
