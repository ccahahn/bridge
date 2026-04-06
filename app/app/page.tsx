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
  warning: string | null;
  secondCycle: { obligationDay: number; gapDetectionDay: number; recommendation: Recommendation | null; resolution: Resolution | null; declineReason: string | null } | null;
}

// ─── Constants ───
const NUM_DAYS = 55;

// ─── Icon map for obligation types ───
const OBLIGATION_ICONS: Record<string, string> = {
  payroll: "\u{1F465}", rent: "\u{1F3E2}", vendor: "\u{1F4E6}", tax: "\u{1F4C4}", other: "\u{1F4CB}",
};

// ─── Build scenarios from synthetic DB ───
function buildScenarios(): Record<string, Scenario> {
  const result: Record<string, Scenario> = {};

  for (const sc of db.scenarios) {
    const biz = db.businesses.find((b) => b.business_id === sc.business_id);
    if (!biz) continue;
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

    const payer = db.payers.find((p) => p.payer_id === sc.primary_payer_id);
    if (!payer) continue;

    const receivables = db.receivables
      .filter((r) => r.business_id === sc.business_id)
      .map((r) => {
        const rPayer = db.payers.find((p) => p.payer_id === r.payer_id);
        return {
          id: r.receivable_id,
          payer: rPayer?.payer_name ?? "Unknown",
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
      warning: sc.warning || null,
      secondCycle: sc.second_cycle ? {
        obligationDay: sc.second_cycle.obligation_day,
        gapDetectionDay: sc.second_cycle.gap_detection_day,
        recommendation: sc.second_cycle.recommendation ? {
          amount: sc.second_cycle.recommendation.amount,
          gapBreakdown: sc.second_cycle.recommendation.gap_breakdown as GapBreakdown,
          decision: sc.second_cycle.recommendation.decision,
          confidence: sc.second_cycle.recommendation.confidence,
          rationale: sc.second_cycle.recommendation.rationale,
          riskFactors: sc.second_cycle.recommendation.risk_factors,
        } : null,
        resolution: sc.second_cycle.resolution || null,
        declineReason: sc.second_cycle.decline_reason || null,
      } : null,
    };
  }

  return result;
}

const SCENARIOS = buildScenarios();

// ─── Helpers ───
const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function projectBalance(scenario: Scenario, numDays = NUM_DAYS) {
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

function projectWithBridge(scenario: Scenario, numDays = NUM_DAYS, approvedSecond = false) {
  if (!scenario.recommendation) return null;
  const points: { day: number; balance: number }[] = [];
  let bal = scenario.balance;
  const bridgeDay = Math.max(scenario.obligations[0].dueDay - 2, 1);
  const resolveDay = scenario.resolution?.day || scenario.receivables[0]?.dueDay || 40;
  const primaryRec = scenario.receivables.find((r) => r.payer === scenario.payer.name);
  const isLate = primaryRec && resolveDay > primaryRec.dueDay;

  const sc2 = scenario.secondCycle;
  const bridge2Day = sc2?.recommendation && approvedSecond ? sc2.gapDetectionDay + 1 : null;
  const resolve2Day = sc2?.resolution?.day || null;
  const secondRec = scenario.receivables.find((r) => r.payer === scenario.payer.name && r.id !== primaryRec?.id);
  const isLate2 = approvedSecond && secondRec && resolve2Day && resolve2Day > secondRec.dueDay;

  for (let d = 0; d <= numDays; d++) {
    let dayBal = bal;
    if (d === bridgeDay) dayBal += scenario.recommendation.amount;
    if (bridge2Day && d === bridge2Day && sc2?.recommendation) dayBal += sc2.recommendation.amount;
    scenario.obligations.forEach((ob) => { if (ob.dueDay === d) dayBal -= ob.amount; });
    scenario.receivables.forEach((rc) => {
      if (isLate && rc.id === primaryRec.id) {
        if (d === resolveDay) dayBal += rc.amount;
      } else if (isLate2 && secondRec && rc.id === secondRec.id) {
        if (d === resolve2Day) dayBal += rc.amount;
      } else {
        if (rc.dueDay === d) dayBal += rc.amount;
      }
    });
    if (d === resolveDay && scenario.recommendation) dayBal -= scenario.recommendation.amount;
    if (resolve2Day && d === resolve2Day && sc2?.recommendation && approvedSecond) dayBal -= sc2.recommendation.amount;
    bal = dayBal;
    points.push({ day: d, balance: bal });
  }
  return points;
}

// ─── Chart ───
function CashFlowChart({ scenario, currentDay, approved, approvedSecond = false }: { scenario: Scenario; currentDay: number; approved: boolean; approvedSecond?: boolean }) {
  const width = 680, height = 220;
  const pad = { t: 20, r: 20, b: 32, l: 56 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const baseline = projectBalance(scenario);
  const bridged = approved ? projectWithBridge(scenario, NUM_DAYS, approvedSecond) : null;
  const allVals = baseline.map((p) => p.balance);
  if (bridged) bridged.forEach((p) => allVals.push(p.balance));
  const minBal = Math.min(...allVals, 0);
  const maxBal = Math.max(...allVals);
  const range = maxBal - minBal || 1;

  const x = (d: number) => pad.l + (d / NUM_DAYS) * iw;
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
  const dayLabels = Array.from({ length: Math.floor(NUM_DAYS / 7) + 1 }, (_, i) => i * 7);
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
      <text x={width - pad.r - 4} y={bufferY - 6} textAnchor="end" fill="#c49a20" fontSize="9" fontFamily="'DM Sans', sans-serif">buffer</text>

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
  const [showSecondRec, setShowSecondRec] = useState(false);
  const [approvedSecond, setApprovedSecond] = useState(false);
  const [resolvedSecond, setResolvedSecond] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scenario = SCENARIOS[activeScenario];
  const baseline = projectBalance(scenario);
  const bridged = approved ? projectWithBridge(scenario, NUM_DAYS, approvedSecond) : null;
  const currentBalance = (approved && bridged ? bridged : baseline).find((p) => p.day === currentDay)?.balance ?? scenario.balance;

  const gapDay = scenario.obligations[0]?.dueDay - 2;
  const shouldShowRec = scenario.recommendation && currentDay >= (gapDay > 0 ? gapDay : 7);
  const shouldShowDecline = !scenario.recommendation && scenario.declineReason && currentDay >= (gapDay > 0 ? gapDay : 7);
  const shouldResolve = scenario.resolution && approved && currentDay >= scenario.resolution.day;
  const sc2 = scenario.secondCycle;
  const shouldShowSecondRec = sc2?.recommendation && resolved && !approvedSecond && currentDay >= sc2.gapDetectionDay;
  const shouldShowSecondDecline = sc2?.declineReason && !sc2.recommendation && resolved && currentDay >= (sc2.obligationDay - 2);
  const shouldResolveSecond = sc2?.resolution && approvedSecond && currentDay >= sc2.resolution.day;

  useEffect(() => { if (shouldShowRec && !approved) { setShowRecommendation(true); setPlaying(false); } }, [shouldShowRec, approved]);
  useEffect(() => { if (shouldShowDecline) setPlaying(false); }, [shouldShowDecline]);
  useEffect(() => { if (shouldResolve && !resolved) setResolved(true); }, [shouldResolve, resolved]);
  useEffect(() => { if (shouldShowSecondRec && !showSecondRec) { setShowSecondRec(true); setPlaying(false); } }, [shouldShowSecondRec, showSecondRec]);
  useEffect(() => { if (shouldShowSecondDecline) setPlaying(false); }, [shouldShowSecondDecline]);
  useEffect(() => { if (shouldResolveSecond && !resolvedSecond) setResolvedSecond(true); }, [shouldResolveSecond, resolvedSecond]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentDay((d) => { if (d >= NUM_DAYS) { setPlaying(false); return NUM_DAYS; } return d + 1; });
      }, 400);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing]);

  const reset = useCallback(() => {
    setCurrentDay(0); setShowRecommendation(false); setApproved(false); setResolved(false);
    setShowSecondRec(false); setApprovedSecond(false); setResolvedSecond(false); setPlaying(false);
  }, []);

  const switchScenario = (id: string) => { setActiveScenario(id); setShowScenarioMenu(false); reset(); };
  const handleApprove = () => { setApproved(true); setShowRecommendation(false); setPlaying(true); };
  const handleApproveSecond = () => { setApprovedSecond(true); setShowSecondRec(false); setPlaying(true); };

  const balanceColor = currentBalance < 0 ? "#d94f4f" : currentBalance < scenario.buffer ? "#e0a030" : "#1a1a2e";

  return (
    <div style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', 'Helvetica Neue', sans-serif", background: "#f6f6f8", minHeight: "100vh", display: "flex", color: "#1a1a2e" }}>

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
          <div style={{ fontSize: 11, color: "#8c8c9a", padding: "6px 8px 0", lineHeight: 1.4 }}>{scenario.tagline}</div>

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
            <button onClick={reset} style={{ padding: "9px 18px", background: "#f6f6f8", border: "1px solid #e0e0e6", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", color: "#1a1a2e" }}>Reset</button>
            <button onClick={() => { if (currentDay >= NUM_DAYS) { reset(); setPlaying(true); } else { setPlaying(!playing); } }} style={{
              padding: "10px 28px", background: playing ? "#1a1a2e" : "#4a40d4", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s",
              boxShadow: playing ? "none" : "0 2px 8px rgba(74, 64, 212, 0.3)",
            }}>{playing ? "\u23F8 Pause" : "\u25B6 Play scenario"}</button>
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
              {approved && !resolved && scenario.recommendation && <div style={{ fontSize: 11, color: "#0f8a5f", marginTop: 4, fontWeight: 500 }}>Bridge active {"\u00B7"} {eur(scenario.recommendation.amount)}</div>}
              {approvedSecond && !resolvedSecond && sc2?.recommendation && <div style={{ fontSize: 11, color: "#0f8a5f", marginTop: 4, fontWeight: 500 }}>Bridge 2 active {"\u00B7"} {eur(sc2.recommendation.amount)}</div>}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Outgoing</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#d94f4f" }}>{eur(scenario.obligations.reduce((s, o) => s + o.amount, 0))}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Incoming</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#0f8a5f" }}>{eur(scenario.receivables.reduce((s, r) => s + r.amount, 0))}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 11, color: "#8c8c9a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Overdraft Limit</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{eur(scenario.overdraftLimit - (approved && !resolved && scenario.recommendation ? scenario.recommendation.amount : 0) - (approvedSecond && !resolvedSecond && sc2?.recommendation ? sc2.recommendation.amount : 0))}</div>
              {(approved && !resolved && scenario.recommendation || approvedSecond && !resolvedSecond && sc2?.recommendation) && <div style={{ fontSize: 11, color: "#e0a030", marginTop: 4 }}>{eur((approved && !resolved && scenario.recommendation ? scenario.recommendation.amount : 0) + (approvedSecond && !resolvedSecond && sc2?.recommendation ? sc2.recommendation.amount : 0))} reserved for bridge</div>}
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
              <input type="range" min={0} max={NUM_DAYS} value={currentDay} onChange={(e) => { setCurrentDay(parseInt(e.target.value)); setPlaying(false); }} style={{ width: "100%", marginBottom: 8, accentColor: "#1a1a2e" }} />
              <CashFlowChart scenario={scenario} currentDay={currentDay} approved={approved} approvedSecond={approvedSecond} />
            </div>

            {/* Timeline */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e8e8ec" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Upcoming</div>
              {(() => {
                // Build a map of receivable ID → actual payment day for late payers
                const latePayments: Record<string, number> = {};
                const primaryRec = scenario.receivables.find((r) => r.payer === scenario.payer.name);
                if (primaryRec && scenario.resolution && scenario.resolution.day > primaryRec.dueDay) {
                  latePayments[primaryRec.id] = scenario.resolution.day;
                }
                const secondRec = scenario.receivables.find((r) => r.payer === scenario.payer.name && r.id !== primaryRec?.id);
                if (secondRec && sc2?.resolution && sc2.resolution.day > secondRec.dueDay) {
                  latePayments[secondRec.id] = sc2.resolution.day;
                }

                type TimelineItem = { id: string; kind: "out" | "in"; label: string; dueDay: number; amount: number; late?: "due" | "paid"; paidDay?: number };

                const items: TimelineItem[] = [
                  ...scenario.obligations.map((o) => ({ id: o.id, kind: "out" as const, label: o.label, dueDay: o.dueDay, amount: o.amount })),
                  ...scenario.receivables.map((r) => {
                    const latePaidDay = latePayments[r.id];
                    return {
                      id: r.id, kind: "in" as const, dueDay: r.dueDay, amount: r.amount,
                      label: latePaidDay ? `${r.payer} due` : `${r.payer} payment`,
                      late: latePaidDay ? "due" as const : undefined,
                      paidDay: latePaidDay,
                    };
                  }),
                  ...Object.entries(latePayments).map(([recId, paidDay]) => {
                    const rec = scenario.receivables.find((r) => r.id === recId)!;
                    const daysLate = paidDay - rec.dueDay;
                    return {
                      id: `${recId}-paid`, kind: "in" as const, dueDay: paidDay,
                      amount: rec.amount, label: `${rec.payer} paid \u2014 ${daysLate} days late`, late: "paid" as const,
                    };
                  }),
                ];

                return items.sort((a, b) => a.dueDay - b.dueDay).map((item, i) => {
                  const isPast = currentDay >= item.dueDay;
                  const itemPaidDay = item.paidDay;
                  const isOverdue = item.late === "due" && currentDay >= item.dueDay && (!itemPaidDay || currentDay < itemPaidDay);
                  const overdueResolved = item.late === "due" && itemPaidDay && currentDay >= itemPaidDay;

                  return (
                    <div key={i} style={{
                      padding: "12px 0", borderBottom: "1px solid #f0f0f4",
                      opacity: (isPast && !isOverdue) ? 0.4 : 1, transition: "opacity 0.3s",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{
                            fontSize: 13, fontWeight: 500,
                            textDecoration: (isPast && !isOverdue) || overdueResolved ? "line-through" : "none",
                            color: isOverdue ? "#c49a20" : undefined,
                          }}>{item.label}</div>
                          <div style={{ fontSize: 11, color: isOverdue ? "#c49a20" : "#8c8c9a", marginTop: 2 }}>
                            T+{item.dueDay} days {isOverdue ? "\u00B7 overdue" : isPast ? "\u00B7 done" : ""}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: item.kind === "out" ? "#d94f4f" : isOverdue ? "#c49a20" : "#0f8a5f" }}>
                          {item.kind === "out" ? "-" : "+"}{eur(item.amount)}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
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
              }}>{"\u26A1"} Invoice Bridge</div>

              <div style={{ padding: "24px 28px" }}>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 12 }}>
                  Your payment from <span style={{ color: "#0f8a5f" }}>{scenario.receivables[0].payer}</span> isn&apos;t due for {scenario.receivables[0].dueDay - currentDay} days, but you have {scenario.obligations[0].type} in <span style={{ color: "#d94f4f" }}>{scenario.obligations[0].dueDay - currentDay} days</span>.
                  {" "}We can bridge <strong>{eur(scenario.recommendation.amount)}</strong> to cover the gap and keep your usual buffer.
                </div>

                <div style={{ fontSize: 13, color: "#8c8c9a", marginBottom: 20 }}>
                  No interest. Auto-resolves when {scenario.receivables[0].payer} pays.
                </div>

                {scenario.warning && (
                  <div style={{ marginBottom: 20, padding: "14px 18px", background: "#fef8e8", border: "1px solid #f0e0a0", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8a6d1b", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{"\u26A0"}</span> Heads up about {scenario.payer.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b5a1a", lineHeight: 1.6 }}>{scenario.warning}</div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: "#b0b0ba", marginBottom: 20 }}>This recommendation was generated by Pleo&apos;s credit assessment system based on your payment history. The final decision is yours.</div>

                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button onClick={handleApprove} style={{
                    padding: "12px 32px", background: "#0f8a5f", color: "#fff", border: "none", borderRadius: 10,
                    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>Approve Bridge</button>
                  <button onClick={() => { setShowRecommendation(false); setPlaying(true); }} style={{
                    padding: "12px 24px", background: "#fff", color: "#8c8c9a", border: "1px solid #e0e0e6",
                    borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                  }}>Not now</button>
                </div>
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

          {/* Second cycle — bridge recommendation (predicted gap) */}
          {showSecondRec && !approvedSecond && sc2?.recommendation && (
            <div style={{
              background: "#fff", borderRadius: 14, border: "2px solid #0f8a5f",
              padding: 0, marginBottom: 24, overflow: "hidden", animation: "slideIn 0.5s ease-out",
            }}>
              <div style={{
                background: "#e6f5ee", padding: "10px 24px", fontSize: 12, fontWeight: 500, color: "#0f7a52",
                display: "flex", alignItems: "center", gap: 8,
              }}>{"\u26A1"} Invoice Bridge — Cycle 2</div>
              <div style={{ padding: "24px 28px" }}>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 12 }}>
                  {sc2.recommendation.rationale.split(". We can bridge")[0]}.
                  {" "}We can bridge <strong>{eur(sc2.recommendation.amount)}</strong> so payroll is covered regardless.
                </div>
                <div style={{ fontSize: 13, color: "#8c8c9a", marginBottom: 20 }}>
                  No interest. Auto-resolves when {scenario.payer.name} pays.
                </div>
                <div style={{ fontSize: 11, color: "#b0b0ba", marginBottom: 20 }}>This recommendation was generated by Pleo&apos;s credit assessment system based on your payment history. The final decision is yours.</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button onClick={handleApproveSecond} style={{
                    padding: "12px 32px", background: "#0f8a5f", color: "#fff", border: "none", borderRadius: 10,
                    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>Approve Bridge</button>
                  <button onClick={() => { setShowSecondRec(false); setPlaying(true); }} style={{
                    padding: "12px 24px", background: "#fff", color: "#8c8c9a", border: "1px solid #e0e0e6",
                    borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                  }}>Not now</button>
                </div>
              </div>
            </div>
          )}

          {/* Second cycle — graceful decline (if no recommendation) */}
          {shouldShowSecondDecline && sc2?.declineReason && (
            <div style={{
              background: "#fff", border: "1px solid #f0e0a0", borderRadius: 14, padding: 0,
              marginBottom: 24, overflow: "hidden", animation: "slideIn 0.5s ease-out",
            }}>
              <div style={{
                background: "#fef8e8", padding: "10px 24px", fontSize: 12, fontWeight: 500, color: "#8a6d1b",
                display: "flex", alignItems: "center", gap: 8,
              }}>About your next cycle</div>
              <div style={{ padding: "24px 28px" }}>
                {sc2.declineReason.split("\n\n").map((para: string, i: number) => (
                  <div key={i} style={{ fontSize: 13, color: "#4a4a48", lineHeight: 1.7, maxWidth: 560, marginTop: i > 0 ? 12 : 0 }}>
                    {para}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Second cycle resolution toast */}
          {resolvedSecond && sc2?.resolution && (
            <div style={{
              background: "#e6f5ee", border: "1px solid #b7e4cd", borderRadius: 12, padding: "16px 24px",
              marginBottom: 24, display: "flex", alignItems: "center", gap: 12, animation: "slideIn 0.4s ease-out",
            }}>
              <span style={{ fontSize: 20 }}>{"\u2713"}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0f7a52" }}>Bridge auto-resolved</div>
                <div style={{ fontSize: 13, color: "#0f7a52", opacity: 0.8, marginTop: 2 }}>{sc2.resolution.message}</div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
