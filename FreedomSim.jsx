// ─── FreedomSim.jsx ───────────────────────────────────────────────────────────
// Financial Freedom Calculator — Reality Estimator
// Drop this file alongside App.jsx in the repo root.
//
// In App.jsx add this import at the top with the other imports:
//   import { FreedomSim } from "./FreedomSim";
//
// In SimulatePage tabs array add:
//   { id: "freedom", icon: "🏆", label: "Freedom" }
//
// In SimulatePage return, after the debt line add:
//   {active === "freedom" && <FreedomSim user={user} onSave={onSave} onShowPro={onShowPro} />}
//
// In Dashboard icons object add:   freedom: "🏆"
// In Dashboard colors object add:  freedom: "#0f766e"
//
// In Home sims array add:
//   { id: "freedom", icon: "🏆", title: "Financial Freedom Number",
//     desc: "What income you need · taxes · obligations · career paths", badge: "Vision" }
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ─── SHARED THEME BRIDGE ─────────────────────────────────────────────────────
// Reads the same dark mode flag App.jsx uses so colors stay in sync
const getC = () => {
  try {
    const dark = localStorage.getItem("re_dark_mode") === "true";
    if (dark) return {
      bg: "#0a0f1e", card: "#111827", cardAlt: "#1a2234", text: "#f1f5f9",
      muted: "#94a3b8", border: "#1e293b", primary: "#3b82f6",
      primaryLight: "rgba(59,130,246,0.12)",
      green: "#14b8a6", greenBg: "rgba(20,184,166,0.12)", greenBorder: "rgba(20,184,166,0.25)",
      amber: "#fbbf24", amberBg: "rgba(245,158,11,0.12)", amberBorder: "rgba(245,158,11,0.25)",
      red: "#f87171", redBg: "rgba(239,68,68,0.12)", redBorder: "rgba(239,68,68,0.25)",
      shadow: "0 10px 25px rgba(0,0,0,0.4)", radius: "18px",
    };
    return {
      bg: "#f6f8fb", card: "#ffffff", cardAlt: "#f8fafc", text: "#0f172a",
      muted: "#475569", border: "#e2e8f0", primary: "#2563eb",
      primaryLight: "rgba(37,99,235,0.08)",
      green: "#0f766e", greenBg: "rgba(20,184,166,0.10)", greenBorder: "rgba(20,184,166,0.25)",
      amber: "#92400e", amberBg: "rgba(245,158,11,0.10)", amberBorder: "rgba(245,158,11,0.25)",
      red: "#991b1b", redBg: "rgba(239,68,68,0.10)", redBorder: "rgba(239,68,68,0.25)",
      shadow: "0 10px 25px rgba(2,6,23,0.06)", radius: "18px",
    };
  } catch { return {}; }
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(v || 0);

const fmtK = (v) => {
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

// ─── TAX DATA ─────────────────────────────────────────────────────────────────
// State marginal rates — top bracket for middle-income earners (2025)
const STATE_TAX_RATES = {
  "Alabama": 5.0, "Alaska": 0, "Arizona": 2.5, "Arkansas": 4.4,
  "California": 9.3, "Colorado": 4.4, "Connecticut": 5.0, "Delaware": 5.55,
  "Florida": 0, "Georgia": 5.49, "Hawaii": 8.25, "Idaho": 5.8,
  "Illinois": 4.95, "Indiana": 3.05, "Iowa": 3.8, "Kansas": 5.7,
  "Kentucky": 4.5, "Louisiana": 3.0, "Maine": 7.15, "Maryland": 5.0,
  "Massachusetts": 5.0, "Michigan": 4.25, "Minnesota": 7.85, "Mississippi": 4.7,
  "Missouri": 4.8, "Montana": 6.75, "Nebraska": 5.84, "Nevada": 0,
  "New Hampshire": 0, "New Jersey": 6.37, "New Mexico": 4.9, "New York": 6.85,
  "North Carolina": 4.75, "North Dakota": 2.5, "Ohio": 3.75, "Oklahoma": 4.75,
  "Oregon": 8.75, "Pennsylvania": 3.07, "Rhode Island": 5.99, "South Carolina": 6.4,
  "South Dakota": 0, "Tennessee": 0, "Texas": 0, "Utah": 4.65,
  "Vermont": 6.6, "Virginia": 5.75, "Washington": 0, "West Virginia": 5.12,
  "Wisconsin": 7.65, "Wyoming": 0,
};

const US_STATES = Object.keys(STATE_TAX_RATES).sort();

// Federal income tax — 2025 single filer brackets
function calcFederalTax(gross) {
  const brackets = [
    [11925,   0.10],
    [48475,   0.12],
    [103350,  0.22],
    [197300,  0.24],
    [250525,  0.32],
    [626350,  0.35],
    [Infinity,0.37],
  ];
  let tax = 0, prev = 0;
  for (const [top, rate] of brackets) {
    if (gross <= prev) break;
    tax += (Math.min(gross, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

// Solve for gross income that yields a target net (binary search)
function solveGross(targetNet, stateKey) {
  let lo = targetNet, hi = targetNet * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fed  = calcFederalTax(mid);
    const fica = Math.min(mid * 0.0765, 10453);
    const st   = mid * ((STATE_TAX_RATES[stateKey] || 0) / 100);
    (mid - fed - fica - st < targetNet) ? (lo = mid) : (hi = mid);
  }
  return Math.round((lo + hi) / 2);
}

// ─── CAREER PATH DATA ─────────────────────────────────────────────────────────
// 4 income tiers · 3 paths each · real timelines & ceilings
const CAREER_TIERS = [
  {
    range: [0, 59999],
    label: "Under $60k",
    paths: [
      {
        title: "Skilled Trades",
        icon: "🔧",
        roles: "Electrician, Plumber, HVAC Tech, Welder",
        timeline: "2–4 yr apprenticeship",
        ceiling: "$80k–$120k+",
        color: "#d97706",
        steps: "Apprenticeship program → Journeyman license → Master license → own contracting business",
        demand: "Very High",
      },
      {
        title: "Healthcare Support",
        icon: "🏥",
        roles: "Medical Assistant, Phlebotomist, Pharmacy Tech, CNA",
        timeline: "6–18 months cert program",
        ceiling: "$45k–$65k",
        color: "#0f766e",
        steps: "Cert program (community college) → entry clinical role → specialize or bridge to RN",
        demand: "High",
      },
      {
        title: "CDL / Logistics",
        icon: "🚛",
        roles: "Truck Driver (OTR/Local), Logistics Coordinator",
        timeline: "4–8 weeks CDL training",
        ceiling: "$55k–$90k",
        color: "#0284c7",
        steps: "CDL-A license → OTR company driver → owner-operator or dispatcher role",
        demand: "High",
      },
    ],
  },
  {
    range: [60000, 99999],
    label: "$60k–$99k",
    paths: [
      {
        title: "Software Development",
        icon: "💻",
        roles: "Junior Dev, QA Engineer, DevOps, Front-End",
        timeline: "6–18 months bootcamp or self-taught",
        ceiling: "$90k–$160k+",
        color: "#2563eb",
        steps: "Build portfolio projects → junior role → mid-level in 2 yr → senior in 4–5 yr",
        demand: "High",
      },
      {
        title: "Registered Nurse",
        icon: "💊",
        roles: "RN, Charge Nurse, Travel Nurse, ICU Nurse",
        timeline: "2–4 yr degree + NCLEX exam",
        ceiling: "$75k–$120k (travel: $130k+)",
        color: "#0f766e",
        steps: "ADN (2yr) or BSN (4yr) → NCLEX → staff RN → travel or specialize (ICU, ER)",
        demand: "Very High",
      },
      {
        title: "Tech Sales (SaaS)",
        icon: "📈",
        roles: "SDR, Account Executive, Sales Manager",
        timeline: "3–12 months to first role",
        ceiling: "$80k–$180k+ OTE",
        color: "#7c3aed",
        steps: "SDR (cold calling, prospecting) → AE in 1–2 yr → Senior AE → Team Lead → Director",
        demand: "High",
      },
    ],
  },
  {
    range: [100000, 149999],
    label: "$100k–$149k",
    paths: [
      {
        title: "Senior Software Engineer",
        icon: "⚙️",
        roles: "Senior Dev, Full-Stack, Backend, Mobile",
        timeline: "3–5 yr of experience",
        ceiling: "$130k–$200k+",
        color: "#2563eb",
        steps: "Mid-level → senior → staff engineer or engineering manager track",
        demand: "High",
      },
      {
        title: "Data / ML Engineer",
        icon: "📊",
        roles: "Data Analyst → Engineer → ML Engineer",
        timeline: "2–4 yr (degree or intensive bootcamp)",
        ceiling: "$110k–$180k",
        color: "#0284c7",
        steps: "SQL + Python → BI developer → data engineer → ML engineer or data scientist",
        demand: "Very High",
      },
      {
        title: "Cybersecurity",
        icon: "🔒",
        roles: "Security Analyst, Penetration Tester, CISO track",
        timeline: "1–3 yr + certifications",
        ceiling: "$95k–$160k",
        color: "#dc2626",
        steps: "CompTIA Sec+ → SOC Analyst → CISSP certification → senior analyst or manager",
        demand: "Very High",
      },
    ],
  },
  {
    range: [150000, Infinity],
    label: "$150k+",
    paths: [
      {
        title: "Staff / Principal Engineer",
        icon: "🚀",
        roles: "Staff Eng, Principal Eng, VP Engineering",
        timeline: "7–12 yr experience",
        ceiling: "$180k–$400k+ (with equity)",
        color: "#2563eb",
        steps: "Senior → Staff → Principal → Distinguished / VP — top 10% of eng careers",
        demand: "Moderate",
      },
      {
        title: "CRNA (Nurse Anesthetist)",
        icon: "🏥",
        roles: "Certified Registered Nurse Anesthetist",
        timeline: "8–10 yr total (RN + grad school)",
        ceiling: "$160k–$240k",
        color: "#0f766e",
        steps: "BSN → RN → 1–2 yr ICU → CRNA graduate program (28–36 mo) → board exam",
        demand: "High",
      },
      {
        title: "Entrepreneurship / Consulting",
        icon: "🏢",
        roles: "Founder, Fractional Exec, Independent Consultant",
        timeline: "3–10+ yr to scale meaningfully",
        ceiling: "Uncapped",
        color: "#d97706",
        steps: "Build deep expertise → freelance/consult → productize a service → scale or exit",
        demand: "Self-created",
      },
    ],
  },
];

function getCareerTier(gross) {
  return CAREER_TIERS.find(t => gross >= t.range[0] && gross <= t.range[1]) || CAREER_TIERS[CAREER_TIERS.length - 1];
}

// ─── LOCAL AI HOOK (mirrors App.jsx useAI) ────────────────────────────────────
function useAI(prompt, deps) {
  const [text, setText]       = useState("");
  const [loading, setLoading] = useState(false);
  const timer                 = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!prompt) return;
      setLoading(true);
      setText("");
      try {
        const res = await fetch("/api/chat", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model:      "claude-sonnet-4-20250514",
            max_tokens: 200,
            system:     "You are a personal finance advisor. Give ONE concise, direct, actionable insight. 2-3 sentences max. No bullet points. Plain conversational language.",
            messages:   [{ role: "user", content: prompt }],
          }),
        });
        const d = await res.json();
        setText(d.content?.[0]?.text || "");
      } catch {
        setText("Adjust your numbers above to see personalized insights.");
      }
      setLoading(false);
    }, 1400);
    return () => clearTimeout(timer.current);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { text, loading };
}

// ─── MINI SHARED UI (self-contained so this file has no imports from App.jsx) ─
function Card({ children, style = {}, onClick }) {
  const C = getC();
  return (
    <div onClick={onClick} style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: C.radius, boxShadow: C.shadow, padding: 16, ...style,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style = {} }) {
  const C = getC();
  const styles = {
    primary: { background: C.primary,       color: "#fff",    border: "none" },
    outline: { background: "transparent",   color: C.primary, border: `1.5px solid ${C.border}` },
    ghost:   { background: "transparent",   color: C.muted,   border: "none" },
  };
  return (
    <button onClick={onClick} style={{
      padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700,
      cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s",
      ...styles[variant], ...style,
    }}>
      {children}
    </button>
  );
}

function NumInput({ label, value, onChange, prefix = "$", suffix = "", accentColor }) {
  const C = getC();
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = (v) => {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    if (!isNaN(n)) onChange(n);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {prefix === "$" && <span style={{ position: "absolute", left: 12, fontSize: 14, color: C.muted, pointerEvents: "none" }}>$</span>}
        <input
          value={raw}
          onChange={e => { setRaw(e.target.value); commit(e.target.value); }}
          onBlur={e => {
            const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
            if (isNaN(n)) { setRaw(String(value)); return; }
            onChange(n); setRaw(String(n));
            e.target.style.borderColor = C.border;
          }}
          onFocus={e => e.target.style.borderColor = accentColor || C.primary}
          inputMode="decimal"
          style={{
            width: "100%",
            padding: prefix === "$" ? "11px 14px 11px 26px" : "11px 14px",
            border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 14,
            fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt,
            boxSizing: "border-box",
          }}
        />
        {suffix && <span style={{ position: "absolute", right: 12, fontSize: 13, color: C.muted, pointerEvents: "none" }}>{suffix}</span>}
      </div>
    </div>
  );
}

function StatRow({ label, value, color, sub }) {
  const C = getC();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 13, color: C.muted }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: C.muted, opacity: 0.7 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function ScoreRing({ score, size = 110 }) {
  const C    = getC();
  const tier = score >= 75
    ? { color: C.green,   label: "Ready"    }
    : score >= 50
    ? { color: "#d97706", label: "Building" }
    : score >= 25
    ? { color: "#ea580c", label: "Early"    }
    : { color: C.red,     label: "Far Off"  };
  const r    = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tier.color} strokeWidth={8}
          strokeDasharray={circ}
          strokeDashoffset={circ - (score / 100) * circ}
          style={{ transition: "stroke-dashoffset 0.8s ease", strokeLinecap: "round" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: size * 0.22, fontWeight: 600, color: tier.color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: size * 0.1, color: C.muted, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{tier.label}</div>
      </div>
    </div>
  );
}

function AIInsightBox({ text, loading }) {
  const C = getC();
  const isDark = C.bg === "#0a0f1e";
  return (
    <div style={{
      background:   isDark ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)",
      border:       `1px solid ${C.primary}26`,
      borderRadius: 14, padding: 14, marginTop: 14,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700,
        }}>✦</div>
        <div style={{ fontSize: 13, color: isDark ? "#c8d8f0" : "#1e3a5f", lineHeight: 1.65 }}>
          {loading
            ? <span style={{ color: C.muted }}>Analyzing your numbers…</span>
            : text || <span style={{ color: C.muted }}>Enter your numbers to get AI insight</span>}
        </div>
      </div>
    </div>
  );
}

function LockedAIInsightBox({ onUpgrade }) {
  const C = getC();
  const isDark = C.bg === "#0a0f1e";
  return (
    <div style={{
      background:   isDark ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)",
      border:       `1px solid ${C.primary}26`,
      borderRadius: 14, padding: 14, marginTop: 14,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: "linear-gradient(135deg, #f59e0b, #d97706)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700,
        }}>⚡</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 8, filter: "blur(3px)", userSelect: "none" }}>
            Upgrade to Pro to unlock AI insights that analyze your freedom number and give personalized feedback on your path there…
          </div>
          <button onClick={onUpgrade} style={{
            fontSize: 12, fontWeight: 700, color: "#f59e0b",
            background: "#f59e0b18", border: "1px solid #f59e0b44",
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
          }}>
            ⚡ Unlock AI Insights — Go Pro
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function FreedomSim({ user, onSave, onShowPro }) {
  const C = getC();

  // ── inputs ──
  const [scenarioName,     setScenarioName]     = useState("");
  const [visionIncome,     setVisionIncome]      = useState(120000);
  const [currentIncome,    setCurrentIncome]     = useState(50000);
  const [state,            setState]             = useState("California");
  // annual obligations
  const [rent,             setRent]              = useState(18000);
  const [carPayment,       setCarPayment]        = useState(5400);
  const [insurance,        setInsurance]         = useState(2400);
  const [utilities,        setUtilities]         = useState(1800);
  const [subscriptions,    setSubscriptions]     = useState(1200);
  const [otherObligations, setOtherObligations]  = useState(3000);
  const [savingsRate,      setSavingsRate]        = useState(20);
  const [discretionary,    setDiscretionary]     = useState(8000);
  // ui state
  const [showObligations,  setShowObligations]   = useState(true);
  const [showAiCareers,    setShowAiCareers]      = useState(false);
  const [aiCareers,        setAiCareers]          = useState("");
  const [aiCareersLoading, setAiCareersLoading]   = useState(false);

  // ── tax math ──
  const federalTax      = calcFederalTax(visionIncome);
  const stateTaxRate    = STATE_TAX_RATES[state] || 0;
  const ficaTax         = Math.min(visionIncome * 0.0765, 10453);
  const stateTax        = visionIncome * (stateTaxRate / 100);
  const totalTax        = federalTax + stateTax + ficaTax;
  const effectiveTaxPct = Math.round((totalTax / visionIncome) * 100);
  const takeHome        = Math.round(visionIncome - totalTax);
  const monthlyTakeHome = Math.round(takeHome / 12);

  // ── budget math ──
  const annualObligations = rent + carPayment + insurance + utilities + subscriptions + otherObligations;
  const savingsGoal       = Math.round(takeHome * (savingsRate / 100));
  const totalNeeded       = annualObligations + savingsGoal + discretionary;
  const surplusDeficit    = takeHome - totalNeeded;
  const needsMoreGross    = surplusDeficit < 0;

  // If take-home isn't enough, solve for the gross that covers it
  const requiredGross  = needsMoreGross ? solveGross(totalNeeded, state) : visionIncome;
  const gapFromCurrent = Math.max(0, requiredGross - currentIncome);
  const gapPct         = currentIncome > 0 ? Math.round((gapFromCurrent / currentIncome) * 100) : 100;

  // ── readiness score ──
  const score = Math.max(0, Math.min(100,
    (gapFromCurrent === 0       ? 50
      : gapPct <= 25            ? 35
      : gapPct <= 50            ? 22
      : gapPct <= 100           ? 10 : 3) +
    (savingsRate >= 20 ? 30 : savingsRate >= 10 ? 18 : 8) +
    (effectiveTaxPct <= 25 ? 20 : effectiveTaxPct <= 35 ? 12 : 6)
  ));

  // ── career tier ──
  const careerTier = getCareerTier(requiredGross);

  // ── AI insight (Pro) ──
  const aiPrompt = [
    `Financial freedom goal: ${fmt(visionIncome)}/yr gross in ${state}.`,
    `Effective tax rate: ${effectiveTaxPct}%. Monthly take-home: ${fmt(monthlyTakeHome)}.`,
    `Annual obligations: ${fmt(annualObligations)}.`,
    `Savings goal (${savingsRate}%): ${fmt(savingsGoal)}.`,
    `Discretionary: ${fmt(discretionary)}.`,
    `Gross income needed to fund this: ${fmt(requiredGross)}.`,
    `Current income: ${fmt(currentIncome)}. Gap: ${fmt(gapFromCurrent)} (${gapPct}% increase needed).`,
    `Score: ${score}/100.`,
    `Give ONE sharp, honest, direct insight about their path to this freedom number.`,
  ].join(" ");

  const { text: aiText, loading: aiLoading } = useAI(
    aiPrompt,
    [visionIncome, state, currentIncome, rent, carPayment, insurance,
     utilities, subscriptions, otherObligations, savingsRate, discretionary],
  );

  // ── AI career recommendations ──
  const runCareerAI = async () => {
    setAiCareersLoading(true);
    setAiCareers("");
    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 700,
          system: [
            "You are a career coach helping someone reach a specific income target.",
            "Give exactly 3 realistic career paths or income moves to reach their goal.",
            "For each: name the role, realistic timeline from where they are now,",
            "key first 3 steps, realistic salary ceiling, and one honest caveat.",
            "Be specific and direct. Number each path 1, 2, 3.",
            "Separate each with a blank line. No bullet points within each path.",
            "Plain conversational language. No corporate-speak.",
          ].join(" "),
          messages: [{
            role: "user",
            content: [
              `I need to reach ${fmt(requiredGross)}/yr gross to fund my financial freedom lifestyle in ${state}.`,
              `My current income is ${fmt(currentIncome)}/yr.`,
              `Income gap: ${fmt(gapFromCurrent)} (${gapPct}% increase needed).`,
              `What are 3 realistic career paths or income moves I should seriously consider?`,
              `Be specific about timelines, what I need to learn or get certified in, and honest salary ceilings.`,
            ].join(" "),
          }],
        }),
      });
      const d = await res.json();
      setAiCareers(d.content?.[0]?.text || "");
      setShowAiCareers(true);
    } catch {
      setAiCareers("Could not connect. Please try again.");
    }
    setAiCareersLoading(false);
  };

  // ── save ──
  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    const label = scenarioName.trim()
      ? scenarioName.trim()
      : `Freedom Number — ${fmt(requiredGross)}/yr`;
    onSave({
      id:    Date.now().toString(),
      type:  "freedom",
      label,
      date:  new Date().toLocaleDateString(),
      data: {
        visionIncome, requiredGross, currentIncome, gapFromCurrent, gapPct,
        effectiveTaxPct, takeHome, totalNeeded, savingsRate, score,
      },
    });
    setScenarioName("");
  };

  // ── chart data ──
  const breakdownData = [
    { name: "Obligations", value: annualObligations },
    { name: "Savings",     value: savingsGoal        },
    { name: "Lifestyle",   value: discretionary      },
    { name: "Taxes",       value: Math.round(totalTax) },
  ];

  const barColors = ["#dc2626", "#0f766e", "#0284c7", "#7c3aed"];

  // ── render ──
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Hero ── */}
      <Card style={{
        background: C.bg === "#0a0f1e"
          ? "linear-gradient(135deg, #0f2217, #0f172a)"
          : "linear-gradient(135deg, #f0fdf4, #ecfdf5)",
        border: `1.5px solid ${C.greenBorder}`,
      }}>
        <div style={{ fontSize: 11, color: C.green, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          🏆 Financial Freedom Calculator
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 16 }}>
          Define what financial freedom looks like for you. We calculate the exact gross income you need — after real taxes, your obligations, your savings rate, and your lifestyle — then show you career paths to close the gap.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 14, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.green, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Your Vision</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.green, lineHeight: 1 }}>
              {fmt(visionIncome)}
            </div>
            <div style={{ fontSize: 10, color: C.green, opacity: 0.7, marginTop: 3 }}>gross / year</div>
          </div>
          <div style={{
            background: needsMoreGross ? C.redBg : C.greenBg,
            border: `1px solid ${needsMoreGross ? C.redBorder : C.greenBorder}`,
            borderRadius: 14, padding: "14px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 10, color: needsMoreGross ? C.red : C.green, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
              {needsMoreGross ? "Gross Needed" : "On Track"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: needsMoreGross ? C.red : C.green, lineHeight: 1 }}>
              {fmt(requiredGross)}
            </div>
            <div style={{ fontSize: 10, color: needsMoreGross ? C.red : C.green, opacity: 0.7, marginTop: 3 }}>gross / year</div>
          </div>
        </div>
      </Card>

      {/* ── Step 1 — Vision ── */}
      <Card>
        <div style={{ fontSize: 11, color: C.green, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
          Step 1 — Define Your Vision
        </div>
        <NumInput label="Freedom Vision Income (annual gross target)" value={visionIncome} onChange={setVisionIncome} accentColor={C.green} />
        <NumInput label="Your Current Annual Gross Income"            value={currentIncome} onChange={setCurrentIncome} accentColor={C.primary} />

        {/* State picker */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>State (for tax calculation)</div>
          <div style={{ position: "relative" }}>
            <select
              value={state}
              onChange={e => setState(e.target.value)}
              style={{
                width: "100%", padding: "11px 14px",
                border: `1.5px solid ${C.border}`, borderRadius: 12,
                fontSize: 13, fontFamily: "inherit", outline: "none",
                appearance: "none", WebkitAppearance: "none",
              }}
            >
              {US_STATES.map(s => (
                <option key={s} value={s}>
                  {s}{STATE_TAX_RATES[s] === 0 ? " · No state income tax" : ` · ${STATE_TAX_RATES[s]}% state tax`}
                </option>
              ))}
            </select>
            <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.muted, fontSize: 12 }}>▼</span>
          </div>
        </div>

        {/* Tax breakdown */}
        <div style={{
          background: "rgba(124,58,237,0.07)",
          border: "1.5px solid rgba(124,58,237,0.2)",
          borderRadius: 14, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Tax Reality on {fmt(visionIncome)}/yr in {state}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center", marginBottom: 10 }}>
            {[
              { label: "Federal",   value: fmt(Math.round(federalTax)) },
              { label: "State",     value: fmt(Math.round(stateTax))   },
              { label: "FICA",      value: fmt(Math.round(ficaTax))    },
              { label: "Take-Home", value: fmt(takeHome), highlight: true },
            ].map(item => (
              <div key={item.label} style={{
                background: item.highlight ? C.greenBg : "rgba(124,58,237,0.06)",
                border: `1px solid ${item.highlight ? C.greenBorder : "rgba(124,58,237,0.15)"}`,
                borderRadius: 10, padding: "8px 4px",
              }}>
                <div style={{ fontSize: 9, color: item.highlight ? C.green : "#7c3aed", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: item.highlight ? C.green : "#7c3aed" }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
            <span>Effective rate: <strong style={{ color: "#7c3aed" }}>{effectiveTaxPct}%</strong></span>
            <span>Monthly take-home: <strong style={{ color: C.green }}>{fmt(monthlyTakeHome)}</strong></span>
          </div>
        </div>
      </Card>

      {/* ── Step 2 — Obligations ── */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.red, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Step 2 — Annual Obligations
          </div>
          <button
            onClick={() => setShowObligations(v => !v)}
            style={{ background: "none", border: "none", color: C.primary, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showObligations ? "▲ Hide" : "▼ Show"}
          </button>
        </div>

        {showObligations && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <NumInput label="Rent / Mortgage (annual)"       value={rent}             onChange={setRent}             accentColor="#dc2626" />
              <NumInput label="Car Payment (annual)"           value={carPayment}       onChange={setCarPayment}       accentColor="#dc2626" />
              <NumInput label="All Insurance (annual)"         value={insurance}        onChange={setInsurance}        accentColor="#dc2626" />
              <NumInput label="Utilities (annual)"             value={utilities}        onChange={setUtilities}        accentColor="#dc2626" />
              <NumInput label="Subscriptions (annual)"         value={subscriptions}    onChange={setSubscriptions}    accentColor="#dc2626" />
              <NumInput label="Other Fixed Costs (annual)"     value={otherObligations} onChange={setOtherObligations} accentColor="#dc2626" />
            </div>
          </div>
        )}

        <div style={{
          background: C.redBg, border: `1px solid ${C.redBorder}`,
          borderRadius: 12, padding: "12px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: showObligations ? 4 : 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>Total Annual Obligations</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.red }}>{fmt(annualObligations)}</div>
            <div style={{ fontSize: 11, color: C.red, opacity: 0.7 }}>{fmt(Math.round(annualObligations / 12))}/mo</div>
          </div>
        </div>
      </Card>

      {/* ── Step 3 — Savings & Lifestyle ── */}
      <Card>
        <div style={{ fontSize: 11, color: C.primary, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
          Step 3 — Savings & Lifestyle
        </div>

        {/* Savings rate slider */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Savings Rate</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
              {savingsRate}% = {fmt(savingsGoal)}/yr
            </div>
          </div>
          <input
            type="range" min="5" max="50" step="1" value={savingsRate}
            onChange={e => setSavingsRate(+e.target.value)}
            style={{ width: "100%", accentColor: C.green }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 4 }}>
            <span>5% bare min</span>
            <span>20% recommended</span>
            <span>50% FIRE</span>
          </div>
          {savingsRate < 10 && (
            <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "6px 10px", marginTop: 8 }}>
              ⚠️ Below 10% savings rate makes building real wealth difficult. Most advisors suggest 15–20%.
            </div>
          )}
        </div>

        <NumInput label="Annual Lifestyle / Discretionary Spend" value={discretionary} onChange={setDiscretionary} accentColor="#0284c7" />
        <div style={{ fontSize: 11, color: C.muted, marginTop: -10, marginBottom: 4 }}>
          Travel, dining, entertainment, hobbies, personal spending
        </div>
      </Card>

      {/* ── Results ── */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <ScoreRing score={score} />
          <div style={{ flex: 1, paddingLeft: 16 }}>
            <StatRow label="Take-Home at Vision Income"   value={fmt(takeHome)}        color={C.green} />
            <StatRow label="Total You Need (after tax)"   value={fmt(totalNeeded)}     />
            <StatRow label="Gross Income Required"        value={fmt(requiredGross)}   color={needsMoreGross ? C.red : C.green} />
            <StatRow
              label="Gap from Current Income"
              value={gapFromCurrent > 0 ? `${fmt(gapFromCurrent)}/yr` : "✓ Already there"}
              color={gapFromCurrent > 0 ? C.red : C.green}
            />
            <StatRow
              label="Increase Needed"
              value={gapFromCurrent > 0 ? `+${gapPct}%` : "—"}
              color={gapFromCurrent > 0 ? "#d97706" : C.green}
            />
            <StatRow
              label="Monthly Take-Home at Goal"
              value={fmt(monthlyTakeHome)}
              color={C.primary}
            />
          </div>
        </div>

        {/* Spend breakdown */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Where Your Freedom Income Goes
          </div>
          {breakdownData.map((item, i) => {
            const pct = Math.round((item.value / (visionIncome || 1)) * 100);
            return (
              <div key={item.name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.muted }}>{item.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: barColors[i] }}>
                    {fmt(item.value)} · {pct}%
                  </span>
                </div>
                <div style={{ height: 7, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${Math.min(pct, 100)}%`,
                    background: barColors[i], borderRadius: 4,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            );
          })}
          {totalNeeded > takeHome && (
            <div style={{
              fontSize: 11, color: C.red, background: C.redBg,
              border: `1px solid ${C.redBorder}`, borderRadius: 8,
              padding: "8px 12px", marginTop: 8,
            }}>
              ⚠️ Your vision lifestyle costs {fmt(totalNeeded - takeHome)}/yr more than {fmt(visionIncome)} gross provides. Required gross adjusted to {fmt(requiredGross)}.
            </div>
          )}
        </div>

        {/* AI insight */}
        {user?.is_pro !== false
          ? <AIInsightBox text={aiText} loading={aiLoading} />
          : <LockedAIInsightBox onUpgrade={onShowPro} />
        }

        {/* Save */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Scenario Name (optional)</div>
          <input
            value={scenarioName}
            onChange={e => setScenarioName(e.target.value)}
            placeholder="e.g. Freedom by 35, FIRE Goal, Coast FIRE"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 10,
              border: `1px solid ${C.border}`, background: C.cardAlt, color: C.text,
              fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
              outline: "none", marginBottom: 10,
            }}
          />
          <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
        </div>
      </Card>

      {/* ── Career Paths ── */}
      <Card>
        <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
          🎯 Career Paths to {fmt(requiredGross)}/yr
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
          Curated paths for the <strong style={{ color: "#0284c7" }}>{careerTier.label}</strong> income range.
          Not career advice — do your own research and talk to people in these fields.
        </div>

        {/* Curated paths */}
        {careerTier.paths.map((path, i) => (
          <div key={i} style={{
            background: C.cardAlt,
            border: `1.5px solid ${C.border}`,
            borderLeft: `4px solid ${path.color}`,
            borderRadius: 14, padding: "14px 16px", marginBottom: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>{path.icon}</span>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{path.title}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: C.green,
                  background: C.greenBg, border: `1px solid ${C.greenBorder}`,
                  padding: "2px 9px", borderRadius: 999,
                }}>
                  {path.ceiling}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#0284c7",
                  background: "rgba(2,132,199,0.08)", border: "1px solid rgba(2,132,199,0.2)",
                  padding: "2px 9px", borderRadius: 999,
                }}>
                  {path.demand} demand
                </span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 5 }}>
              <span style={{ fontWeight: 600, color: C.text }}>Roles: </span>{path.roles}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: path.color }}>Timeline: </span>{path.timeline}
            </div>
            <div style={{
              fontSize: 12, color: C.muted, lineHeight: 1.6,
              background: `${path.color}0d`,
              borderLeft: `3px solid ${path.color}`,
              borderRadius: "0 8px 8px 0",
              padding: "8px 12px",
            }}>
              {path.steps}
            </div>
          </div>
        ))}

       {/* AI career recommendations — opt-in only */}
{!showAiCareers && !aiCareers && (
  <div style={{
    marginTop: 10, padding: "12px 16px",
    background: C.cardAlt, border: `1px solid ${C.border}`,
    borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
  }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>✦ AI Career Recommendations</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
        Optional · uses AI to suggest paths for your specific gap
      </div>
    </div>
    <button
      onClick={() => setShowAiCareers(true)}
      style={{
        padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${C.border}`,
        background: "transparent", color: C.primary, fontWeight: 700,
        fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
      }}
    >
      Show
    </button>
  </div>
)}

{showAiCareers && !aiCareers && (
  <button
    onClick={runCareerAI}
    disabled={aiCareersLoading}
    style={{
      width: "100%", padding: "14px", borderRadius: 14, marginTop: 4,
      background: aiCareersLoading
        ? C.cardAlt
        : "linear-gradient(135deg, #0369a1, #0284c7)",
      border: `1.5px solid ${aiCareersLoading ? C.border : "#0284c7"}`,
      color: aiCareersLoading ? C.muted : "#fff",
      fontWeight: 800, fontSize: 14,
      cursor: aiCareersLoading ? "not-allowed" : "pointer",
      fontFamily: "inherit",
    }}
  >
    {aiCareersLoading ? "✦ Generating…" : "✦ Generate My Career Recommendations"}
  </button>
)}

{aiCareers && showAiCareers && (
  <div style={{
    background: C.bg === "#0a0f1e"
      ? "linear-gradient(135deg, #0c1f38, #0f172a)"
      : "linear-gradient(135deg, #eff6ff, #e0f2fe)",
    border: `1.5px solid ${C.primary}44`,
    borderRadius: 14, padding: 18, marginTop: 12,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "linear-gradient(135deg, #0284c7, #0369a1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, color: "#fff", fontWeight: 700,
        }}>✦</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#0284c7" }}>AI Recommendations</span>
      </div>
      <button
        onClick={() => { setAiCareers(""); setShowAiCareers(false); }}
        style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: 4 }}
      >✕</button>
    </div>
    <div style={{
      fontSize: 13,
      color: C.bg === "#0a0f1e" ? "#bae6fd" : "#0c4a6e",
      lineHeight: 1.85, whiteSpace: "pre-wrap",
    }}>
      {aiCareers}
    </div>
    <div style={{
      fontSize: 10, color: C.muted, marginTop: 14,
      paddingTop: 10, borderTop: `1px solid ${C.border}`,
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>⚠️ For exploration only. Not career or financial advice.</span>
      <button
        onClick={runCareerAI}
        style={{ background: "none", border: "none", color: C.primary, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}
      >
        ↺ Regenerate
      </button>
    </div>
  </div>
)}
        
      </Card>
      
    </div>
  );
}
