## Synthetic SMB Scenarios

### biz_001: GreenLeaf Design Studio — Bridge Works
- **Gap:** €42K payroll in T+9, balance €31K, buffer €5K → shortfall €16K
- **Best candidate:** Acme Corp (rec_001) — €50K due T+38, 11/12 on-time, stable trend
- **Expected:** Monitor recommends €16K advance against Acme invoice. Assessor approves with high confidence.
- **Gotcha:** Bloom Bakery (rec_002) also exists but only 3 invoices of history and €8K wouldn't cover the gap anyway. Agent should pick Acme, not Bloom.

### biz_002: Nordic Freight Solutions — Bridge is Risky
- **Gap:** €58K payroll T+11 + €12K vendor T+7, balance €22K, buffer €8K → shortfall €56K
- **Candidates:**
  - SlowShip Retail (rec_003) — €65K due T+30, but 5/10 on-time, avg 18 days late, deteriorating trend. This is the trap.
  - QuickMart (rec_004) — €22K due T+25, 7/8 on-time, stable. Reliable but €22K doesn't cover €56K gap.
- **Expected:** SlowShip is too risky (50% on-time, deteriorating). QuickMart is reliable but insufficient. Agents should either: decline entirely (gap too large for safe candidates), or advance against QuickMart for partial coverage only if that logic is supported.
- **Gotcha:** The temptation is SlowShip because the amount covers the gap. The agent must not chase amount over reliability.

### biz_003: Bright Path Tutoring — Correctly Declines
- **Gap:** €18K payroll T+10 + €2.8K rent T+14, balance €6K, buffer €3K → shortfall €17.8K
- **Only candidate:** NewSchool Academy (rec_005) — €20K due T+35, but **zero payment history**. Brand new client.
- **Expected:** Assessor auto-declines. No history = no bridge. Recommendation never surfaces.
- **Gotcha:** The invoice amount covers the gap perfectly. The agent must resist the "it fits" temptation. Also: business has declining balance trend and increasing overdraft usage — solvency signal, not just a liquidity gap.

### biz_004: Coastal Analytics — Deteriorating Payer Hidden in Good Average
- **Gap:** €52K payroll T+8 + €14K VAT T+20, balance €18K, buffer €6K → shortfall €54K
- **Candidates:**
  - TrustBank (rec_006) — €55K due T+32, 13/15 on-time overall (87%). Looks great on paper.
  - TrustBank (rec_007) — €30K due T+50, same payer.
- **Expected:** Despite 87% lifetime on-time rate, the last 4 of 5 payments have been late and getting later (35→38→42→45 days). Trend is deteriorating. The agent should catch this — the average lies.
- **Gotcha:** Two invoices from same payer. Agent must not double-count or recommend advancing both. The deteriorating trend is the real test — overall stats look fine but recent behavior is bad.

### biz_005: UrbanBrew Coffee Roasters — Solvency Problem, Not Liquidity
- **Gap:** €28K payroll T+12 + €15K supplier T+5 + €8K equipment T+18, balance €15K, buffer €4K → shortfall €40K
- **Candidates:**
  - HotelGroup Nordic (rec_008) — €35K due T+28, 10/11 on-time, stable. This is actually a great payer.
  - StartupHub (rec_009) — €12K due T+40, 2/4 on-time, deteriorating. Weak.
- **Expected:** HotelGroup is reliable, but the business itself is the problem. Declining balance, increasing overdraft usage, obligations (€51K) vastly exceed receivables (€47K) and current balance. This isn't a timing gap — it's a business spending more than it earns. Agent should decline despite the good payer.
- **Gotcha:** The payer is solid. The temptation is to approve because HotelGroup Nordic is trustworthy. But the Credit Assessor must also check the business's health, not just the payer's. A good payer doesn't fix a sinking ship.
