**Problem**

SMBs on Pleo have a cash flow timing problem: the money they're owed arrives after the money they owe goes out. Pleo Overdraft lets them spend into a negative balance but it's general-purpose and unsecured. The business gets a credit line with no connection to *why* they need it or *when* it resolves. That means Pleo carries the full risk of the business's creditworthiness. 

**Core Bet**

Purpose-bound credit tied to a specific invoice from a known payer has a fundamentally better risk profile than general-purpose overdraft. It changes the underwriting question from "is this business creditworthy?" to "will this specific invoice get paid?" and auto-resolves when it does. 

The pitch is: pay 2% and your money works harder automatically. 

This product is Pleo's own values made literal. 
- **"More than you'd expect":** the system sees a cash flow gap forming before the finance team does and shows up with a solution. Nobody expects their spend management platform to say "hey, you have payroll in 9 days and your receivable won't land in time. Do you want us to bridge that?" 
- **"Empowering"**: the customer isn't borrowing out of desperation, they're freeing up their cash to use however they want while Pleo bridges the timing. They feel in control, not in debt. 

**The Human Bar**

The best version of this today is a sharp CFO at a 30-person company who keeps a rolling cash flow forecast in their head. They know: payroll hits on the 15th, the office lease is due on the 1st, and the €50K from their biggest client always lands around the 20th but sometimes it's the 28th. When they see a gap forming, they call their bank or move money between accounts before anyone on the team even notices a problem. They never panic. They never over-borrow. They solve the timing problem, not the solvency problem, because they know the difference.

What makes them great: they act before the gap becomes a crisis. They know which receivables are reliable and which aren't. They'd never borrow against an invoice from a client who hasn't paid them before. And they never leave borrowed money sitting around. The moment the cash comes in, the debt closes.

Design decisions this implies:
- The system acts before the user notices the gap, not after they're already stressed
- It only bridges against receivables with known, reliable payers. New payers are a no
- The bridge auto-closes when the receivable pays. The user doesn't get to keep the money. This isn't a second credit line; it's a timing fix that resolves itself
- The system knows the difference between a timing problem and a solvency problem, and says no to the latter

**The Prototype**

Three synthetic SMBs, each with a cash flow timeline using relative dates (T+9 days, T+38 days), all existing overdraft customers paying the 2% annual rate. The prototype demonstrates the two-agent system making one decision per business:

1. **The bridge works.** A healthy business has €50K coming from Acme Corp (reliable payer, 11 of 12 invoices paid on time) in T+38 days, but payroll of €42K hits in T+9 days and their balance is €31K. The gap is €11K. The Monitor knows this customer typically keeps a €5K buffer in their account, so it recommends a €16K advance, just enough to cover the gap and maintain the cushion they're used to. Not the full €50K invoice. The system bridges the timing, not the invoice. The customer feels empowered. Their cash stays free. Pleo has their back.

2. **The bridge is risky.** A business has a similar gap, but the receivable is from a client with a pattern of late payments, average 18 days late on the last 5 invoices. The risk model has to be smarter than "invoice exists." The agents either decline or advance a reduced amount with a wider timing buffer. For example, if the client is on average late less than 30 days, then Pleo still gets their money back within their established 30-day period and so it is a yes. 

3. **The bridge correctly declines.** A business has a genuine cash flow problem, but the only receivable is from a brand new client with no payment history. The system says no. Knowing when not to extend credit is the product working, not the product failing. Start small.

What doors this closes:
- The product never bridges against payers with no history. Out of scope for now; needs data before revisiting.
- The user never keeps the advance after the receivable pays. Auto-pull is non-negotiable. Offering flexibility here may attract the wrong customer, someone using purpose-bound credit as general-purpose credit with extra steps, which is exactly the risk profile this product exists to avoid.
- The product never replaces the overdraft. It layers on top. The 2% annual rate is protected.

**High-Level Architecture**

Two layers:

**Rule engine** (no AI): The Cash Flow Monitor detects timing gaps and calculates bridge amounts. The Credit Assessor evaluates payer reliability, trend, and business health. Both are arithmetic and if/else logic — deterministic, instant, no tokens. Credit decisions should not depend on a model's mood. If the logic is expressible as rules, it should be rules.

**Compliance agent** (AI): The one component that calls an LLM. Before a recommendation surfaces to the user, the compliance agent reviews the output text against EU AI Act Article 50 transparency obligations. This is genuinely an LLM problem — checking whether natural language *actually* communicates AI disclosure, data basis, and human authority, not just that the right keywords appear. The prompt is managed in Braintrust; every review is traced.

The user sees the combined output: "Your payment from Acme Corp isn't due for 38 days, but you have payroll in 9 days. We can bridge €16K to cover the gap and keep your usual buffer." The output is packaged for two readers: the finance person who sees it first, and the decision-maker they may need to forward it to. The context, the math, and the risk are all in one view that anyone can understand in 30 seconds.

For the prototype: the rule engine runs against a synthetic database with relative-time ledgers (not real dates, so the data never goes stale). Real-time monitoring is simulated — the prototype shows the moment, not the surveillance loop.

**How We'll Know It Works**

Failure modes:

*In the rule engine:*
- The Credit Assessor misses a deteriorating trend hidden in a good lifetime average. The Vero Analytics scenario tests this.
- The Monitor surfaces a recommendation when the gap might resolve on its own. The relative-time data lets us test timing sensitivity.
- The system stays silent for a business that genuinely needed the bridge. The Luma Interiors scenario sits right on this line — the receivable exists but the payer is unknown.
- The system approves despite a solvency problem. The Kova Roasters scenario tests this — good payer, sinking business.

*In the compliance agent:*
- The agent passes a recommendation that doesn't actually meet Article 50 (false pass). Tested by subtly weakening the disclosure language and checking if the agent catches it.
- The agent fails a recommendation that is compliant (false fail). Tested by running the current recommendation text, which is designed to pass.

*In the business:*
- Default rates on bridged payments exceed projections. The guardrails have a kill threshold on annual default rate and a max capital deployed ceiling.
- The feature attracts customers who are insolvent, not illiquid. Purpose-binding and auto-pull are the design constraints that prevent this, but if the default rate climbs, that's the signal.

What I'm deliberately not measuring yet: whether the payer's own financial health is deteriorating (we're using historical payment patterns as a proxy, not assessing the payer directly). That's a deeper underwriting layer for later.

The compliance agent's prompt is managed in Braintrust (project: Bridge). Every compliance review is traced — recommendation text in, compliance assessment out, prompt version pinned. This is the infrastructure for the eval loop: iterate the prompt, re-run, see if assessments improve or regress.

**Risk Model**

Separate deliverable an 18-month financial projection, not part of the prototype demo. Built on the existing overdraft customer base as the starting pool.

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

Breach flags are monitored monthly. Any breach triggers a review — not an automatic shutdown, but a forced conversation about whether the assumptions still hold. here's what invoice financing looks like at 100 customers, 1,000 customers, 10,000 customers.

The model assumes bridge-only against payers with established payment history. If we later relax that constraint (new payers, reduced history requirements), the default rate assumptions change and the model needs to be re-run.

**Trust and Safety**

The auto-pull is the highest-stakes moment. When the receivable pays, Pleo automatically pulls the advance. The user needs to know this is coming and exactly when. If it surprises them, trust is destroyed in one transaction. The system must be transparent about the terms at the moment of the advance, not buried in fine print.

The decline is invisible. If the system can't find a safe bridge, the option simply never surfaces. This is the right design: a business in a cash flow crunch that gets told "no" is worse off than before they asked. 

The recommendation itself carries weight. If the agent says "advance this invoice" and the business does, they're trusting Pleo's judgment about the payer's reliability. If the payer then doesn't pay on time and the business gets auto-pulled anyway, who's accountable? The system should never frame a recommendation as a guarantee. The language is "we think this is a strong candidate based on [specific reasons]" — not "this is safe."

AI-generated financial recommendations in a regulated environment need clear boundaries. The agent recommends; it does not decide. The user (or the decision-maker they forward to) approves. The system cannot auto-advance without explicit human approval.

EU AI Act Article 50 compliance: the user-facing output must clearly disclose that this recommendation is AI-generated, explain the basis of the recommendation in understandable terms (which data points were used, what the model assessed), and ensure the user knows they are interacting with an automated system, not a human advisor. Every recommendation surfaces: (1) an AI disclosure label, (2) the specific data that informed it (payer history, payment patterns, gap calculation), and (3) that the final decision is theirs. This isn't just legal — it's good design. Transparency about how the system thinks builds the trust that makes the user act on it.

**What We're Not Prioritizing**

- **Multi-market regulatory compliance:** the prototype assumes a simple market to demonstrate the product value. Scaling the credit decisioning engine across European regulators is the architecture problem described in the role and will be tackled, but is out of scope for this build.
- **Disputed invoices:** what happens when the payer contests the invoice after Pleo has advanced funds. Real risk, needs legal and product design, not prototype scope.
- **Flexibility on auto-pull:** customers will want the option to keep the advance after the receivable pays. This needs data on whether offering flexibility changes who adopts the product and how it affects default rates before touching it.
- **Bridging against new payers:** the prototype requires established payment history. Relaxing this constraint is the obvious growth lever but changes the risk profile fundamentally. 
- **The approval workflow between finance person and decision-maker:** the prototype packages the recommendation for both readers but doesn't build the forwarding/approval flow.
- **Real-time monitoring infrastructure:** the prototype simulates the timing moment with synthetic data. Building the actual surveillance loop (watching ledgers, detecting gaps as they form) is an engineering investment beyond prototype scope.

**What Do We Want to Learn?**

- What does Pleo's actual payer payment data look like? How reliable is the historical on-time rate as a predictor? Is there enough signal in Pleo's data to underwrite the payer without external credit checks?
- How do existing overdraft customers actually use their credit line today? What percentage are using it for timing problems vs. structural shortfalls? This determines the addressable market for the bridge feature. Although, I don't think this is something users think is possible so they may enjoy it even if they don't have too many timing problems. 
- What's the real distribution of invoice payment terms and late-payment patterns in Pleo's data? The risk model assumes averages. The tails are where it breaks.
- How does the sub-account funding feature usage correlate with cash flow gaps? Businesses already splitting overdraft into purpose-allocated sub-accounts might be natural early adopters. They're already thinking in terms of purpose-bound credit.
- What are the markets we are interested in shipping? I would want to understand regulatory constraints in each market. For example: The EU AI Act hits financial services on August 2, 2026, which means AI systems must be fully compliant by that date. 
