"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import db from "./data/synthetic_db.json";

// ─── Types ───
interface Payment { days: number; onTime: boolean }
interface Obligation { id: string; type: string; label: string; amount: number; dueDay: number; icon: string }
interface Receivable { id: string; payer: string; amount: number; dueDay: number; description: string }
interface Payer { name: string; totalInvoices: number; paidOnTime: number; avgDaysToPay: number | null; trend: string; onTimeRate: number | null; last5: Payment[] }
interface GapBreakdown { obligation: number; balance: number; buffer: number; shortfall: number }
interface Recommendation { amount: number; gapBreakdown: GapBreakdown; decision: string; confidence: string; rationale: string; riskFactors: string[] }
interface Resolution { day: number; message: string }
interface Scenario {
  id: string; name: string; label: string; tagline: string; industry: string;
  balance: number; buffer: number; overdraftLimit: number; monthlyRevenue: number; monthsOnPleo: number;
  balanceTrend: string; overdraftUsageTrend: string;
  obligations: Obligation[]; receivables: Receivable[]; payer: Payer;
  recommendation: Recommendation | null; resolution: Resolution | null;
  declineReason: string | null;
}

// ─── Icon map for obligation types ───
const OBLIGATION_ICONS: Record<string, string> = {
  payroll: "\u{1F465}", rent: "\u{1F3E2}", vendor: "\u{1F4E6}", tax: "\u{1F4C4}", other: "\u{1F4CB}",
};

// ─── Build scenarios from synthetic DB ───
function buildScenarios(): Record<string, Scenario> {
  const result: Record<string, Scenario> = {};

  for (const sc of db.scenarios) {
    const biz = db.businesses.find((b) => b.business_id === sc.business_id)!;
    const obligations = db.obligations
      .filter((o) => o.business_id === sc.business_id)
      .map((o) => ({
        id: o.obligation_id,
        type: o.type,
        label: o.description,
        amount: o.amount,
        dueDay: o.due_in_days,
        icon: OBLIGATION_ICONS[o.type] || OBLIGATION_ICONS.other,
      }));

    const payer = db.payers.find((p) => p.payer_id === sc.primary_payer_id)!;

    const receivables = db.receivables
      .filter((r) => r.business_id === sc.business_id)
      .map((r) => {
        const rPayer = db.payers.find((p) => p.payer_id === r.payer_id)!;
        return {
          id: r.receivable_id,
          payer: rPayer.payer_name,
          amount: r.invoice_amount,
          dueDay: r.due_in_days,
          description: r.description,
        };
      });

    result[sc.id] = {
      id: sc.id,
      name: biz.name,
      label: sc.label,
      tagline: sc.tagline,
      industry: biz.industry,
      balance: biz.current_balance,
      buffer: biz.typical_buffer,
      overdraftLimit: biz.overdraft_limit,
      monthlyRevenue: biz.monthly_revenue_avg,
      monthsOnPleo: biz.months_on_pleo,
      balanceTrend: biz.balance_trend,
      overdraftUsageTrend: biz.overdraft_usage_trend,
      obligations,
      receivables,
      payer: {
        name: payer.payer_name,
        totalInvoices: payer.total_invoices,
        paidOnTime: payer.paid_on_time,
        avgDaysToPay: payer.avg_days_to_pay,
        trend: payer.trend,
        onTimeRate: payer.total_invoices > 0 ? payer.paid_on_time / payer.total_invoices : null,
        last5: payer.last_5_payments.map((p) => ({ days: p.days_to_pay, onTime: p.on_time })),
      },
      recommendation: sc.recommendation ? {
        amount: sc.recommendation.amount,
        gapBreakdown: sc.recommendation.gap_breakdown as GapBreakdown,
        decision: sc.recommendation.decision,
        confidence: sc.recommendation.confidence,
        rationale: sc.recommendation.rationale,
        riskFactors: sc.recommendation.risk_factors,
      } : null,
      resolution: sc.resolution,
      declineReason: sc.decline_reason,
    };
  }

  return result;
}

const SCENARIOS = buildScenarios();

// ─── Helpers ───
const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function projectBalance(scenario: Scenario, numDays = 45) {
  const points: { day: number; balance: number }[] = [];
  let bal = scenario.balance;
  for (let d = 0; d <= numDays; d++) {
    let dayBal = bal;
    scenario.obligations.forEach((ob) => { if (ob.dueDay === d) dayBal -= ob.amount; });
    scenario.receivables.forEach((rc) => { if (rc.dueDay === d) dayBal += rc.amount; });
    bal = dayBal;
    points.push({ day: d, balance: bal });
  }
  return points;
}

function projectWithBridge(scenario: Scenario, numDays = 45) {
  if (!scenario.recommendation) return null;
  const points: { day: number; balance: number }[] = [];
  let bal = scenario.balance;
  const bridgeDay = Math.max(scenario.obligations[0].dueDay - 2, 1);
  const resolveDay = scenario.resolution?.day || scenario.receivables[0]?.dueDay || 40;
  for (let d = 0; d <= numDays; d++) {
    let dayBal = bal;
    if (d === bridgeDay) dayBal += scenario.recommendation.amount;
    scenario.obligations.forEach((ob) => { if (ob.dueDay === d) dayBal -= ob.amount; });
    scenario.receivables.forEach((rc) => { if (rc.dueDay === d) dayBal += rc.amount; });
    if (d === resolveDay && scenario.recommendation) dayBal -= scenario.recommendation.amount;
    bal = dayBal;
    points.push({ day: d, balance: bal });
  }
  return points;
}

// ─── Chart ───
function CashFlowChart({ scenario, currentDay, approved }: { scenario: Scenario; currentDay: number; approved: boolean }) {
  const width = 680, height = 220;
  const pad = { t: 20, r: 20, b: 32, l: 56 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const baseline = projectBalance(scenario, 44);
  const bridged = approved ? projectWithBridge(scenario, 44) : null;
  const allVals = baseline.map((p) => p.balance);
  if (bridged) bridged.forEach((p) => allVals.push(p.balance));
  const minBal = Math.min(...allVals, 0);
  const maxBal = Math.max(...allVals);
  const range = maxBal - minBal || 1;

  const x = (d: number) => pad.l + (d / 44) * iw;
  const y = (v: number) => pad.t + ih - ((v - minBal) / range) * ih;

  const toPath = (pts: { day: number; balance: number }[], upTo: number) => {
    const visible = pts.filter((p) => p.day <= upTo);
    if (visible.length < 2) return "";
    return visible.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  };

  const toArea = (pts: { day: number; balance: number }[], upTo: number) => {
    const visible = pts.filter((p) => p.day <= upTo);
    if (visible.length < 2) return "";
    const line = visible.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
    return `${line} L${x(visible[visible.length - 1].day).toFixed(1)},${y(0).toFixed(1)} L${x(visible[0].day).toFixed(1)},${y(0).toFixed(1)} Z`;
  };

  const bufferY = y(scenario.buffer);
  const dayLabels = [0, 7, 14, 21, 28, 35, 42];
  const isDanger = baseline.some((p) => p.day <= currentDay && p.balance < scenario.buffer);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a1a2e" stopOpacity="0.08" /><stop offset="100%" stopColor="#1a1a2e" stopOpacity="0.01" /></linearGradient>
        <linearGradient id="bridgeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f8a5f" stopOpacity="0.1" /><stop offset="100%" stopColor="#0f8a5f" stopOpacity="0.01" /></linearGradient>
        <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d94f4f" stopOpacity="0.08" /><stop offset="100%" stopColor="#d94f4f" stopOpacity="0.01" /></linearGradient>
      </defs>

      {[0, 1, 2, 3, 4].map((i) => {
        const val = minBal + (range * i) / 4;
        return (<g key={i}><line x1={pad.l} y1={y(val)} x2={width - pad.r} y2={y(val)} stroke="#e8e8ec" strokeWidth="1" /><text x={pad.l - 8} y={y(val) + 4} textAnchor="end" fill="#8c8c9a" fontSize="10" fontFamily="'DM Sans', sans-serif">{val >= 1000 ? `\u20AC${(val / 1000).toFixed(0)}k` : `\u20AC${val.toFixed(0)}`}</text></g>);
      })}

      {dayLabels.map((d) => (<text key={d} x={x(d)} y={height - 6} textAnchor="middle" fill="#8c8c9a" fontSize="10" fontFamily="'DM Sans', sans-serif">T+{d}</text>))}

      <line x1={pad.l} y1={bufferY} x2={width - pad.r} y2={bufferY} stroke="#e0b040" strokeWidth="1" strokeDasharray="6,4" opacity="0.6" />
      <text x={width - pad.r + 2} y={bufferY - 4} fill="#c49a20" fontSize="9" fontFamily="'DM Sans', sans-serif">buffer</text>

      {minBal < 0 && <line x1={pad.l} y1={y(0)} x2={width - pad.r} y2={y(0)} stroke="#d94f4f" strokeWidth="1" strokeDasharray="4,4" opacity="0.4" />}

      {scenario.obligations.map((ob) => (
        <g key={ob.id} opacity={ob.dueDay <= currentDay ? 1 : 0.3}>
          <line x1={x(ob.dueDay)} y1={pad.t} x2={x(ob.dueDay)} y2={height - pad.b} stroke="#d94f4f" strokeWidth="1" strokeDasharray="3,3" opacity={ob.dueDay <= currentDay ? 0.3 : 1} />
          {ob.dueDay <= currentDay && <circle cx={x(ob.dueDay)} cy={pad.t + 4} r="3" fill="#d94f4f" opacity="0.5" />}
        </g>
      ))}

      {scenario.receivables.map((rc) => (
        <g key={rc.id} opacity={rc.dueDay <= currentDay ? 0.6 : 0.2}>
          <line x1={x(rc.dueDay)} y1={pad.t} x2={x(rc.dueDay)} y2={height - pad.b} stroke="#0f8a5f" strokeWidth="1" strokeDasharray="3,3" />
          <circle cx={x(rc.dueDay)} cy={pad.t + 4} r="3" fill="#0f8a5f" opacity="0.5" />
        </g>
      ))}

      {!approved && (
        <>
          <path d={toArea(baseline, currentDay)} fill={isDanger ? "url(#dangerGrad)" : "url(#areaGrad)"} />
          <path d={toPath(baseline, currentDay)} fill="none" stroke={isDanger ? "#d94f4f" : "#1a1a2e"} strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {approved && bridged && (
        <>
          <path d={toArea(bridged, currentDay)} fill="url(#bridgeGrad)" />
          <path d={toPath(bridged, currentDay)} fill="none" stroke="#0f8a5f" strokeWidth="2.5" strokeLinecap="round" />
          <path d={toPath(baseline, currentDay)} fill="none" stroke="#d94f4f" strokeWidth="1" strokeDasharray="4,4" opacity="0.35" />
        </>
      )}

      <line x1={x(currentDay)} y1={pad.t} x2={x(currentDay)} y2={height - pad.b} stroke="#1a1a2e" strokeWidth="1.5" opacity="0.15" />
      <circle cx={x(currentDay)} cy={y((approved && bridged ? bridged : baseline).find((p) => p.day === currentDay)?.balance || 0)} r="4" fill={approved ? "#0f8a5f" : "#1a1a2e"} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

// ─── Main ───
export default function PleoBridgeDemo() {
  const [activeScenario, setActiveScenario] = useState("healthy");
  const [currentDay, setCurrentDay] = useState(0);
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [approved, setApproved] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const [complianceResult, setComplianceResult] = useState<Record<string, unknown> | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scenario = SCENARIOS[activeScenario];
  const baseline = projectBalance(scenario, 44);
  const bridged = approved ? projectWithBridge(scenario, 44) : null;
  const currentBalance = (approved && bridged ? bridged : baseline).find((p) => p.day === currentDay)?.balance ?? scenario.balance;

  const gapDay = scenario.obligations[0]?.dueDay - 2;
  const shouldShowRec = scenario.recommendation && currentDay >= (gapDay > 0 ? gapDay : 7);
  const shouldShowDecline = !scenario.recommendation && scenario.declineReason && currentDay >= (gapDay > 0 ? gapDay : 7);
  const shouldResolve = scenario.resolution && approved && currentDay >= scenario.resolution.day;

  useEffect(() => { if (shouldShowRec && !approved) setShowRecommendation(true); }, [shouldShowRec, approved]);
  useEffect(() => { if (shouldResolve && !resolved) setResolved(true); }, [shouldResolve, resolved]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentDay((d) => { if (d >= 44) { setPlaying(false); return 44; } return d + 1; });
      }, 400);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing]);

  const reset = useCallback(() => {
    setCurrentDay(0); setShowRecommendation(false); setApproved(false); setResolved(false); setPlaying(false);
    setComplianceResult(null); setComplianceLoading(false);
  }, []);

  const runComplianceReview = useCallback(async () => {
    if (!scenario.recommendation) return;
    setComplianceLoading(true);
    setComplianceResult(null);
    const recText = [
      `AI-generated recommendation - Invoice Bridge`,
      `Your payment from ${scenario.receivables[0].payer} isn't due for ${scenario.receivables[0].dueDay} days, but you have ${scenario.obligations[0].label.toLowerCase()} in ${scenario.obligations[0].dueDay} days. We can bridge ${eur(scenario.recommendation.amount)} to cover the gap and keep your usual buffer.`,
      `How we assessed this:`,
      `- Payer reliability: ${scenario.payer.paidOnTime}/${scenario.payer.totalInvoices} on time (${((scenario.payer.onTimeRate || 0) * 100).toFixed(0)}%)`,
      `- Average days to pay: ${scenario.payer.avgDaysToPay} days, trend: ${scenario.payer.trend}`,
      `- Gap calculation: ${eur(scenario.recommendation.gapBreakdown.obligation)} obligation - ${eur(scenario.recommendation.gapBreakdown.balance)} balance - ${eur(scenario.recommendation.gapBreakdown.buffer)} buffer`,
      `- Confidence: ${scenario.recommendation.confidence}`,
      scenario.recommendation.riskFactors.length > 0 ? `Risk factors: ${scenario.recommendation.riskFactors.join("; ")}` : "",
      `When the advance resolves: When ${scenario.receivables[0].payer} pays this invoice, we automatically apply ${eur(scenario.recommendation.amount)} back to your balance. No action needed.`,
      `This recommendation was generated automatically by Pleo's credit assessment system. The final decision is yours.`,
      `[Approve Bridge] [Not now]`,
    ].filter(Boolean).join("\n");

    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationText: recText }),
      });
      const data = await res.json();
      setComplianceResult(data);
    } catch {
      setComplianceResult({ error: "Failed to reach compliance API" });
    } finally {
      setComplianceLoading(false);
    }
  }, [scenario]);

  const switchScenario = (id: string) => { setActiveScenario(id); setShowScenarioMenu(false); reset(); };
  const handleApprove = () => { setApproved(true); setShowRecommendation(false); };

  const balanceColor = currentBalance < 0 ? "#d94f4f" : currentBalance < scenario.buffer ? "#e0a030" : "#1a1a2e";

  return (
    <div style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", background: "#f6f6f8", minHeight: "100vh", display: "flex", color: "#1a1a2e" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Sidebar */}
      <div style={{ width: 200, background: "#fff", borderRight: "1px solid #e8e8ec", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 24px 20px", fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px" }}>PLEO</div>

        {/* Scenario selector */}
        <div style={{ padding: "0 16px", position: "relative" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8c8c9a", padding: "0 8px", marginBottom: 6 }}>Demo scenario</div>
          <button onClick={() => setShowScenarioMenu(!showScenarioMenu)} style={{
            width: "100%", padding: "10px 12px", background: "#f6f6f8", border: "1px solid #e0e0e6",
            borderRadius: 8, fontSize: 13, fontWeight: 500, color: "#1a1a2e", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}>
            {scenario.name}<span style={{ float: "right", color: "#8c8c9a" }}>{"\u25BE"}</span>
          </button>

          {showScenarioMenu && (
            <div style={{
              position: "absolute", top: "100%", left: 16, right: 16, background: "#fff",
              border: "1px solid #e0e0e6", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              overflow: "hidden", marginTop: 4, zIndex: 100,
            }}>
              {Object.values(SCENARIOS).map((s) => (
                <button key={s.id} onClick={() => switchScenario(s.id)} style={{
                  display: "block", width: "100%", padding: "12px 14px",
                  background: s.id === activeScenario ? "#f0f0f4" : "#fff",
                  border: "none", borderBottom: "1px solid #f0f0f4", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "#8c8c9a", marginTop: 2 }}>{s.tagline}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Top bar */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e8e8ec", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Cash Management</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8c8c9a" }}>{scenario.name} {"\u00B7"} {scenario.industry}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#8c8c9a", fontWeight: 500, background: "#f0f0f4", padding: "6px 14px", borderRadius: 20 }}>Day T+{currentDay}</div>
            <button onClick={reset} style={{ padding: "7px 14px", background: "#f6f6f8", border: "1px solid #e0e0e6", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", color: "#1a1a2e" }}>Reset</button>
            <button onClick={() => setPlaying(!playing)} style={{
              padding: "7px 18px", background: playing ? "#1a1a2e" : "#fff", color: playing ? "#fff" : "#1a1a2e",
              border: "1px solid #1a1a2e", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
            }}>{playing ? "\u23F8 Pause" : "\u25B6 Play"}</button>
          </div>
        </div>

        <div style={{ padding: 32 }}>
          {/* Scenario pill */}
          <div style={{ marginBottom: 20 }}>
            <span style={{
              display: "inline-block", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: scenario.recommendation ? "#e6f5ee" : "#fde8e8",
              color: scenario.recommendation ? "#0f7a52" : "#c53030",
            }}>Scenario: {scenario.label}</span>
          </div>

          {/* Metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Current Balance</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: balanceColor, transition: "color 0.3s" }}>{eur(currentBalance)}</div>
              {approved && scenario.recommendation && <div style={{ fontSize: 11, color: "#0f8a5f", marginTop: 4, fontWeight: 500 }}>Bridge active {"\u00B7"} {eur(scenario.recommendation.amount)}</div>}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Outgoing (30d)</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#d94f4f" }}>{eur(scenario.obligations.reduce((s, o) => s + o.amount, 0))}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Incoming</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#0f8a5f" }}>{eur(scenario.receivables.reduce((s, r) => s + r.amount, 0))}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Overdraft</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{eur(scenario.overdraftLimit)}</div>
              <div style={{ fontSize: 11, color: "#8c8c9a", marginTop: 4 }}>2.0% annual</div>
            </div>
          </div>

          {/* Chart + timeline */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e8e8ec" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Cash Flow Projection</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#8c8c9a" }}>
                  {approved && (<><span><span style={{ display: "inline-block", width: 10, height: 2, background: "#0f8a5f", marginRight: 4, verticalAlign: "middle" }}></span>With bridge</span><span><span style={{ display: "inline-block", width: 10, height: 2, background: "#d94f4f", marginRight: 4, verticalAlign: "middle" }}></span>Without</span></>)}
                  <span><span style={{ display: "inline-block", width: 10, height: 2, background: "#e0b040", marginRight: 4, verticalAlign: "middle" }}></span>Buffer</span>
                </div>
              </div>
              <input type="range" min={0} max={44} value={currentDay} onChange={(e) => { setCurrentDay(parseInt(e.target.value)); setPlaying(false); }} style={{ width: "100%", marginBottom: 8, accentColor: "#1a1a2e" }} />
              <CashFlowChart scenario={scenario} currentDay={currentDay} approved={approved} />
            </div>

            {/* Timeline */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Upcoming</div>
              {[
                ...scenario.obligations.map((o) => ({ ...o, kind: "out" as const, label: o.label })),
                ...scenario.receivables.map((r) => ({ ...r, kind: "in" as const, label: `${r.payer} payment`, dueDay: r.dueDay, amount: r.amount, id: r.id })),
              ].sort((a, b) => a.dueDay - b.dueDay).map((item, i) => {
                const isPast = currentDay >= item.dueDay;
                return (
                  <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f4", opacity: isPast ? 0.4 : 1, transition: "opacity 0.3s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, textDecoration: isPast ? "line-through" : "none" }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: "#8c8c9a", marginTop: 2 }}>T+{item.dueDay} days {isPast ? "\u00B7 done" : ""}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: item.kind === "out" ? "#d94f4f" : "#0f8a5f" }}>
                        {item.kind === "out" ? "-" : "+"}{eur(item.amount)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {approved && scenario.recommendation && (
                <div style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f4" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: 13, fontWeight: 500, color: "#0f8a5f" }}>{"\u26A1"} Bridge advance</div><div style={{ fontSize: 11, color: "#8c8c9a", marginTop: 2 }}>Active {"\u00B7"} auto-resolves on payment</div></div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0f8a5f" }}>+{eur(scenario.recommendation.amount)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recommendation card */}
          {showRecommendation && !approved && scenario.recommendation && (
            <div style={{
              background: "#fff", borderRadius: 14, border: "2px solid #0f8a5f",
              padding: 0, marginBottom: 24, overflow: "hidden", animation: "slideIn 0.5s ease-out",
            }}>
              <style>{`@keyframes slideIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>

              <div style={{
                background: "#e6f5ee", padding: "10px 24px", fontSize: 12, fontWeight: 500, color: "#0f7a52",
                display: "flex", alignItems: "center", gap: 8,
              }}>{"\u{1F916}"} AI-generated recommendation {"\u00B7"} Invoice Bridge</div>

              <div style={{ padding: "24px 28px" }}>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 16 }}>
                  Your payment from <span style={{ color: "#0f8a5f" }}>{scenario.receivables[0].payer}</span> isn&apos;t due for {scenario.receivables[0].dueDay} days, but you have {scenario.obligations[0].label.toLowerCase()} in <span style={{ color: "#d94f4f" }}>{scenario.obligations[0].dueDay} days</span>.
                  {" "}We can bridge <strong>{eur(scenario.recommendation.amount)}</strong> to cover the gap and keep your usual buffer.
                </div>

                <div style={{ background: "#f8f8fa", borderRadius: 10, padding: "16px 20px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>How we assessed this</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#8c8c9a", marginBottom: 4 }}>Payer reliability</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {scenario.payer.paidOnTime}/{scenario.payer.totalInvoices} on time
                        <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#e6f5ee", color: "#0f7a52" }}>
                          {((scenario.payer.onTimeRate || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#8c8c9a", marginBottom: 4 }}>Avg days to pay</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{scenario.payer.avgDaysToPay} days
                        <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#e6f5ee", color: "#0f7a52" }}>{scenario.payer.trend}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#8c8c9a", marginBottom: 4 }}>Gap calculation</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{eur(scenario.recommendation.gapBreakdown.obligation)} obligation {"\u2212"} {eur(scenario.recommendation.gapBreakdown.balance)} balance {"\u2212"} {eur(scenario.recommendation.gapBreakdown.buffer)} buffer</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#8c8c9a", marginBottom: 4 }}>Confidence</div>
                      <div style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>{scenario.recommendation.confidence}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, color: "#8c8c9a", marginBottom: 6 }}>Last 5 payments</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {scenario.payer.last5.map((p, i) => (
                        <div key={i} style={{ flex: 1, padding: "6px 0", textAlign: "center", fontSize: 11, fontWeight: 500, borderRadius: 6, background: p.onTime ? "#e6f5ee" : "#fde8e8", color: p.onTime ? "#0f7a52" : "#c53030" }}>
                          {p.days}d {p.onTime ? "\u2713" : "\u2717"}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {scenario.recommendation.riskFactors.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {scenario.recommendation.riskFactors.map((rf, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#a08020", padding: "4px 0", display: "flex", gap: 6 }}><span>{"\u26A0"}</span> {rf}</div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 12, color: "#8c8c9a", marginBottom: 20, padding: "10px 14px", background: "#f8f8fa", borderRadius: 8 }}>
                  <strong>When the advance resolves:</strong> When {scenario.receivables[0].payer} pays this invoice, we automatically apply {eur(scenario.recommendation.amount)} back to your balance. No action needed.
                </div>

                <div style={{ fontSize: 11, color: "#b0b0ba", marginBottom: 20 }}>This recommendation was generated automatically by Pleo&apos;s credit assessment system. The final decision is yours.</div>

                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button onClick={handleApprove} style={{
                    padding: "12px 32px", background: "#0f8a5f", color: "#fff", border: "none", borderRadius: 10,
                    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>Approve Bridge</button>
                  <button onClick={() => setShowRecommendation(false)} style={{
                    padding: "12px 24px", background: "#fff", color: "#8c8c9a", border: "1px solid #e0e0e6",
                    borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                  }}>Not now</button>
                  <div style={{ flex: 1 }} />
                  <button onClick={runComplianceReview} disabled={complianceLoading} style={{
                    padding: "8px 16px", background: "#f0f0f4", color: "#1a1a2e", border: "1px solid #e0e0e6",
                    borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: complianceLoading ? "wait" : "pointer", fontFamily: "inherit",
                    opacity: complianceLoading ? 0.6 : 1,
                  }}>{complianceLoading ? "Reviewing..." : "\u{1F6E1}\uFE0F Run Article 50 Review"}</button>
                </div>

                {/* Compliance review panel */}
                {complianceResult && !("error" in complianceResult) && (
                  <div style={{ marginTop: 20, background: "#f8f8fa", borderRadius: 10, padding: "16px 20px", border: "1px solid #e0e0e6", animation: "slideIn 0.4s ease-out" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.05em" }}>EU AI Act Article 50 Review</div>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 10,
                        background: (complianceResult as Record<string, string>).overall === "pass" ? "#e6f5ee" : (complianceResult as Record<string, string>).overall === "warn" ? "#fef8e8" : "#fde8e8",
                        color: (complianceResult as Record<string, string>).overall === "pass" ? "#0f7a52" : (complianceResult as Record<string, string>).overall === "warn" ? "#8a6d1b" : "#c53030",
                      }}>{((complianceResult as Record<string, string>).overall || "").toUpperCase()}</span>
                    </div>

                    {((complianceResult as Record<string, unknown>).requirements as Array<Record<string, string>>)?.map((req) => (
                      <div key={req.id} style={{ padding: "10px 0", borderBottom: "1px solid #e8e8ec" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{req.label}</div>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                            background: req.status === "pass" ? "#e6f5ee" : req.status === "warn" ? "#fef8e8" : "#fde8e8",
                            color: req.status === "pass" ? "#0f7a52" : req.status === "warn" ? "#8a6d1b" : "#c53030",
                          }}>{req.status.toUpperCase()}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>{req.finding}</div>
                        {req.suggestion && <div style={{ fontSize: 11, color: "#a08020", marginTop: 4 }}>{"\u{1F4A1}"} {req.suggestion}</div>}
                      </div>
                    ))}

                    {(complianceResult as Record<string, string>).summary && (
                      <div style={{ marginTop: 12, fontSize: 12, color: "#8c8c9a", fontStyle: "italic" }}>{(complianceResult as Record<string, string>).summary}</div>
                    )}
                  </div>
                )}

                {complianceResult && "error" in complianceResult && (
                  <div style={{ marginTop: 16, fontSize: 12, color: "#c53030" }}>Compliance review failed: {(complianceResult as Record<string, string>).error}</div>
                )}
              </div>
            </div>
          )}

          {/* Resolution toast */}
          {resolved && scenario.resolution && (
            <div style={{
              background: "#e6f5ee", border: "1px solid #b7e4cd", borderRadius: 12, padding: "16px 24px",
              marginBottom: 24, display: "flex", alignItems: "center", gap: 12, animation: "slideIn 0.4s ease-out",
            }}>
              <span style={{ fontSize: 20 }}>{"\u2713"}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0f7a52" }}>Bridge auto-resolved</div>
                <div style={{ fontSize: 13, color: "#0f7a52", opacity: 0.8, marginTop: 2 }}>{scenario.resolution.message}</div>
              </div>
            </div>
          )}

          {/* Decline / silence card */}
          {shouldShowDecline && (
            <div style={{
              background: "#fff", border: "1px dashed #e0e0e6", borderRadius: 12, padding: "32px 24px",
              marginBottom: 24, textAlign: "center", animation: "slideIn 0.4s ease-out",
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{"\u{1F92B}"}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#8c8c9a", marginBottom: 8 }}>No recommendation surfaced</div>
              <div style={{ fontSize: 13, color: "#b0b0ba", maxWidth: 520, margin: "0 auto", lineHeight: 1.5 }}>
                {scenario.declineReason}
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: "#8c8c9a", fontStyle: "italic" }}>
                This is the product working, not the product failing.
              </div>
            </div>
          )}

          {/* Payer detail */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e8e8ec" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Payer Profile {"\u00B7"} {scenario.payer.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
              <div><div style={{ fontSize: 11, color: "#8c8c9a" }}>Total invoices</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{scenario.payer.totalInvoices}</div></div>
              <div><div style={{ fontSize: 11, color: "#8c8c9a" }}>On-time rate</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: scenario.payer.onTimeRate === null ? "#8c8c9a" : (scenario.payer.onTimeRate > 0.8 ? "#0f8a5f" : scenario.payer.onTimeRate > 0.6 ? "#e0a030" : "#d94f4f") }}>{scenario.payer.onTimeRate !== null ? `${(scenario.payer.onTimeRate * 100).toFixed(0)}%` : "\u2014"}</div></div>
              <div><div style={{ fontSize: 11, color: "#8c8c9a" }}>Avg days to pay</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{scenario.payer.avgDaysToPay ?? "\u2014"}</div></div>
              <div><div style={{ fontSize: 11, color: "#8c8c9a" }}>Trend</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, textTransform: "capitalize" as const }}>{scenario.payer.trend}</div></div>
              <div><div style={{ fontSize: 11, color: "#8c8c9a" }}>History</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{scenario.payer.totalInvoices === 0 ? "None" : `${scenario.payer.totalInvoices} invoices`}</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
