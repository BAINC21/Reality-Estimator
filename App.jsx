import { useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://obsgsmaxydccohmyjxhh.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ic2dzbWF4eWRjY29obXlqeGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MjIwMzcsImV4cCI6MjA4Nzk5ODAzN30.S4seJqj703w_IgIkzv40Qi1230PTl_0RI4h5Lsrqh1s";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── UTILS ────────────────────────────────────────────────────────────────────
const fmt = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);
const fmtK = (v) => { if (Math.abs(v) >= 1000000) return `$${(v/1000000).toFixed(1)}M`; if (Math.abs(v) >= 1000) return `$${(v/1000).toFixed(0)}K`; return `$${Math.round(v)}`; };

// ─── STORAGE ──────────────────────────────────────────────────────────────────
// Local cache for session (Supabase is source of truth)
const DB = {
  // Session user cache
  getUser: () => { try { return JSON.parse(localStorage.getItem("re_user") || "null"); } catch { return null; } },
  setUser: (u) => { try { if (u) localStorage.setItem("re_user", JSON.stringify(u)); else localStorage.removeItem("re_user"); } catch {} },

  // Scenarios - local fallback cache
  _key: (k) => { try { const u = JSON.parse(localStorage.getItem("re_user") || "null"); return u?.id ? `re_${u.id}_${k}` : `re_${k}`; } catch { return `re_${k}`; } },
  getScenarios: () => { try { return JSON.parse(localStorage.getItem(DB._key("scenarios")) || "[]"); } catch { return []; } },
  saveScenario: (s) => {
    try {
      const all = DB.getScenarios();
      const idx = all.findIndex(x => x.id === s.id);
      if (idx >= 0) all[idx] = s; else all.unshift(s);
      localStorage.setItem(DB._key("scenarios"), JSON.stringify(all.slice(0, 50)));
    } catch {}
  },
  deleteScenario: (id) => {
    try {
      localStorage.setItem(DB._key("scenarios"), JSON.stringify(DB.getScenarios().filter(x => x.id !== id)));
    } catch {}
  },
  setScenarios: (list) => { try { localStorage.setItem(DB._key("scenarios"), JSON.stringify(list)); } catch {} },

  // Transactions - local fallback cache
  getTransactions: () => { try { return JSON.parse(localStorage.getItem(DB._key("transactions")) || "[]"); } catch { return []; } },
  saveTransactions: (t) => { try { localStorage.setItem(DB._key("transactions"), JSON.stringify(t)); } catch {} },
};

// ─── SUPABASE DATA LAYER ──────────────────────────────────────────────────────
const SB = {
  // Auth
  signUp: async (email, password, name, zip) => {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { name, zip } }
    });
    if (error) throw error;
    // If email confirmation is on, data.user exists but session is null
    if (!data.session && data.user) {
      throw { message: "CHECK_EMAIL", user: data.user };
    }
    // No confirmation needed — create profile immediately
    if (data.user) {
      try {
        await sb.from("profiles").upsert({
          id: data.user.id,
          name: name || email.split("@")[0],
          zip: zip || "",
          is_admin: false,
        });
      } catch {}
    }
    return data.user;
  },

  signIn: async (email, password) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  signOut: async () => { await sb.auth.signOut(); },

  getSession: async () => {
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  getProfile: async (userId) => {
    const { data } = await sb.from("profiles").select("*").eq("id", userId).single();
    return data;
  },

  updateProfile: async (userId, updates) => {
    const { error } = await sb.from("profiles").upsert({ id: userId, ...updates });
    if (error) throw error;
  },

  // Scenarios
  getScenarios: async (userId) => {
    const { data } = await sb.from("scenarios").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    return data || [];
  },

  saveScenario: async (userId, scenario) => {
    const { error } = await sb.from("scenarios").upsert({
      id: scenario.id, user_id: userId, label: scenario.label,
      type: scenario.type, date: scenario.date, data: scenario.data
    });
    if (error) throw error;
  },

  deleteScenario: async (id) => {
    await sb.from("scenarios").delete().eq("id", id);
  },

  // Dashboard
  getDashboard: async (userId) => {
    const { data } = await sb.from("dashboard").select("*").eq("user_id", userId).single();
    return data;
  },

  saveDashboard: async (userId, payload) => {
    const { error } = await sb.from("dashboard").upsert({ user_id: userId, ...payload, updated_at: new Date().toISOString() });
    if (error) throw error;
  },

  // Transactions
  getTransactions: async (userId) => {
    const { data } = await sb.from("transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    return (data || []).map(t => ({ id: t.id, desc: t.description || t.desc, amount: t.amount, category: t.category, necessity: t.necessity, date: t.date }));
  },

  saveTransactions: async (userId, transactions) => {
    // Delete all and re-insert (simple approach for now)
    await sb.from("transactions").delete().eq("user_id", userId);
    if (transactions.length > 0) {
      const rows = transactions.map(t => ({ id: t.id, user_id: userId, description: t.desc, amount: t.amount, category: t.category, necessity: t.necessity, date: t.date }));
      await sb.from("transactions").insert(rows);
    }
  },

  // News
  getNews: async () => {
    const { data } = await sb.from("news_articles").select("*").eq("is_active", true).order("published_at", { ascending: false });
    return data || [];
  },

  saveArticles: async (articles) => {
    const { error } = await sb.from("news_articles").insert(articles);
    if (error) throw error;
  },

  deleteArticle: async (id) => {
    await sb.from("news_articles").update({ is_active: false }).eq("id", id);
  },

  // Reviews
  submitReview: async (userId, name, rating, body) => {
    const { error } = await sb.from("reviews").insert({ user_id: userId || null, name, rating, body });
    if (error) throw error;
  },

  getApprovedReviews: async () => {
    const { data } = await sb.from("reviews").select("*").eq("is_approved", true).order("created_at", { ascending: false });
    return data || [];
  },

  approveReview: async (id, approved) => {
    await sb.from("reviews").update({ is_approved: approved }).eq("id", id);
  },
};

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const LIGHT = {
  bg: "#f6f8fb",
  card: "#ffffff",
  cardAlt: "#f8fafc",
  text: "#0f172a",
  muted: "#475569",
  border: "#e2e8f0",
  primary: "#2563eb",
  primaryLight: "rgba(37,99,235,0.08)",
  green: "#0f766e",
  greenBg: "rgba(20,184,166,0.10)",
  greenBorder: "rgba(20,184,166,0.25)",
  amber: "#92400e",
  amberBg: "rgba(245,158,11,0.10)",
  amberBorder: "rgba(245,158,11,0.25)",
  red: "#991b1b",
  redBg: "rgba(239,68,68,0.10)",
  redBorder: "rgba(239,68,68,0.25)",
  shadow: "0 10px 25px rgba(2,6,23,0.06)",
  navBg: "rgba(255,255,255,0.94)",
  headerBg: "rgba(246,248,251,0.88)",
  radius: "18px",
};

const DARK = {
  bg: "#0a0f1e",
  card: "#111827",
  cardAlt: "#1a2234",
  text: "#f1f5f9",
  muted: "#94a3b8",
  border: "#1e293b",
  primary: "#3b82f6",
  primaryLight: "rgba(59,130,246,0.12)",
  green: "#14b8a6",
  greenBg: "rgba(20,184,166,0.12)",
  greenBorder: "rgba(20,184,166,0.25)",
  amber: "#fbbf24",
  amberBg: "rgba(245,158,11,0.12)",
  amberBorder: "rgba(245,158,11,0.25)",
  red: "#f87171",
  redBg: "rgba(239,68,68,0.12)",
  redBorder: "rgba(239,68,68,0.25)",
  shadow: "0 10px 25px rgba(0,0,0,0.4)",
  navBg: "rgba(10,15,30,0.96)",
  headerBg: "rgba(10,15,30,0.92)",
  radius: "18px",
};

// Theme token accessor - always reads current theme from localStorage
const getTheme = () => {
  try {
    const dark = localStorage.getItem('re_dark_mode') === 'true';
    return dark ? DARK : LIGHT;
  } catch { return LIGHT; }
};
let C = getTheme();

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
const Badge = ({ children, variant = "default", style = {} }) => {
  const variants = {
    default: { background: C.card, border: `1px solid ${C.border}`, color: C.muted },
    ok: { background: C.greenBg, border: `1px solid ${C.greenBorder}`, color: C.green },
    warn: { background: C.amberBg, border: `1px solid ${C.amberBorder}`, color: C.amber },
    danger: { background: C.redBg, border: `1px solid ${C.redBorder}`, color: C.red },
    primary: { background: C.primaryLight, border: `1px solid rgba(37,99,235,0.25)`, color: C.primary },
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...variants[variant], ...style }}>
      {children}
    </span>
  );
};

const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: C.radius, boxShadow: C.shadow, padding: 16, ...style }}>
    {children}
  </div>
);

const Btn = ({ children, onClick, variant = "primary", style = {} }) => {
  const styles = {
    primary: { background: C.primary, color: "#fff", border: "none" },
    outline: { background: "transparent", color: C.primary, border: `1.5px solid ${C.border}` },
    ghost: { background: "transparent", color: C.muted, border: "none" },
    danger: { background: "#fee2e2", color: C.red, border: "none" },
  };
  return (
    <button onClick={onClick} style={{ padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s", ...styles[variant], ...style }}>
      {children}
    </button>
  );
};

const Input = ({ label, value, onChange, placeholder = "", type = "text", style = {} }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: "0.04em" }}>{label}</div>}
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
      style={{ width: "100%", padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt || "#f8fafc", boxSizing: "border-box", ...style }} />
  </div>
);

const NumInput = ({ label, value, prefix = "$", suffix = "", onChange, accentColor = C.primary }) => {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);
  const handleChange = (v) => {
    setRaw(v);
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    if (!isNaN(n)) onChange(n);
  };
  const handleBlur = () => {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (isNaN(n)) { setRaw(String(value)); return; }
    onChange(n);
    setRaw(String(n));
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {prefix === "$" && <span style={{ position: "absolute", left: 12, fontSize: 14, color: C.muted, pointerEvents: "none" }}>$</span>}
        <input
          value={raw}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          inputMode="decimal"
          style={{
            width: "100%", padding: prefix === "$" ? "11px 14px 11px 26px" : "11px 14px",
            border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 14,
            fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt,
            boxSizing: "border-box",
          }}
          onFocus={e => e.target.style.borderColor = accentColor}
          onBlur={e => e.target.style.borderColor = C.border}
        />
        {suffix && <span style={{ position: "absolute", right: 12, fontSize: 13, color: C.muted, pointerEvents: "none" }}>{suffix}</span>}
      </div>
    </div>
  );
};

const AffordabilityBar = ({ ratio, label }) => {
  const tier = ratio <= 30 ? { label: "Comfortable", color: C.green, bg: C.greenBg, border: C.greenBorder, variant: "ok" }
    : ratio <= 45 ? { label: "Manageable", color: C.amber, bg: C.amberBg, border: C.amberBorder, variant: "warn" }
    : { label: "Tight", color: C.red, bg: C.redBg, border: C.redBorder, variant: "danger" };
  return (
    <div style={{ background: tier.bg, border: `1px solid ${tier.border}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: tier.color }}>{tier.label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: tier.color }}>{ratio}% of income</span>
      </div>
      <div style={{ height: 6, background: "rgba(0,0,0,0.08)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(ratio, 100)}%`, background: tier.color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
      {label && <div style={{ fontSize: 11, color: tier.color, marginTop: 6, opacity: 0.8 }}>{label}</div>}
    </div>
  );
};

const AIInsight = ({ text, loading }) => (
  <div style={{ background: C.bg === "#0a0f1e" ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: `1px solid ${C.primary}26`, borderRadius: 14, padding: 14, marginTop: 14 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700 }}>✦</div>
      <div style={{ fontSize: 13, color: C.bg === "#0a0f1e" ? "#c8d8f0" : "#1e3a5f", lineHeight: 1.65 }}>
        {loading ? <span style={{ color: C.muted }}>Analyzing your numbers…</span> : text || <span style={{ color: C.muted }}>Enter your numbers to get AI insight</span>}
      </div>
    </div>
  </div>
);

const ScoreRing = ({ score, size = 110 }) => {
  const tier = score >= 75 ? { color: C.green, label: "Ready" } : score >= 50 ? { color: "#d97706", label: "Caution" } : score >= 25 ? { color: "#ea580c", label: "At Risk" } : { color: C.red, label: "Critical" };
  const r = (size / 2) - 10; const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tier.color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ}
          style={{ transition: "stroke-dashoffset 0.8s ease", strokeLinecap: "round" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: size * 0.22, fontWeight: 600, color: tier.color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: size * 0.1, color: C.muted, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{tier.label}</div>
      </div>
    </div>
  );
};

const StatRow = ({ label, value, sub, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
    <div>
      <div style={{ fontSize: 13, color: C.muted }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, opacity: 0.7 }}>{sub}</div>}
    </div>
    <div style={{ fontSize: 14, fontWeight: 700, color: color || C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);

// ─── AI HOOK ──────────────────────────────────────────────────────────────────
// ─── NEWS CONTEXT STORE ──────────────────────────────────────────────────────
// Global news context — fetched once, injected into all AI insight calls
const NewsStore = {
  _context: "",
  _prefs: null,
  get: () => NewsStore._context,
  set: (ctx) => { NewsStore._context = ctx; },
  getPrefs: () => { try { return JSON.parse(localStorage.getItem("re_news_prefs") || "null"); } catch { return null; } },
  setPrefs: (p) => { try { localStorage.setItem("re_news_prefs", JSON.stringify(p)); } catch {} },
  getCache: () => { try { const c = JSON.parse(localStorage.getItem("re_news_cache") || "null"); if (c && Date.now() - c.ts < 3600000) return c; return null; } catch { return null; } },
  setCache: (data) => { try { localStorage.setItem("re_news_cache", JSON.stringify({ ...data, ts: Date.now() })); } catch {} },
};

const NEWS_TOPICS = [
  { id: "housing",    label: "Housing Market",    icon: "🏠", desc: "Rent prices, home buying, mortgage rates" },
  { id: "interest",   label: "Interest Rates",    icon: "📈", desc: "Fed decisions, APR changes, savings rates" },
  { id: "jobs",       label: "Jobs & Income",     icon: "💼", desc: "Employment, wages, layoffs, gig economy" },
  { id: "inflation",  label: "Inflation & Prices",icon: "🛒", desc: "CPI, gas prices, grocery costs, cost of living" },
  { id: "debt",       label: "Debt & Credit",     icon: "💳", desc: "Credit card rates, student loans, auto loans" },
  { id: "recession",  label: "Economy & Recession",icon: "📉", desc: "GDP, recession signals, market conditions" },
];

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
  "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
  "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
  "Wisconsin","Wyoming"
];

function useAI(prompt, deps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!prompt) return;
      setLoading(true); setText("");
      const newsCtx = NewsStore.get();
      const systemPrompt = newsCtx
        ? `You are a personal finance advisor. You have access to current financial news context below. Use it to make your advice timely and specific — reference relevant news when it directly affects the user's situation. Give ONE concise, direct, actionable insight. 2-3 sentences max. No bullet points. Plain conversational language.\n\nCURRENT FINANCIAL NEWS CONTEXT:\n${newsCtx}`
        : "You are a personal finance advisor. Give ONE concise, direct, actionable insight. 2 sentences max. No bullet points. Plain conversational language.";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514", max_tokens: 200,
            system: systemPrompt,
            messages: [{ role: "user", content: prompt }]
          })
        });
        const d = await res.json();
        setText(d.content?.[0]?.text || "");
      } catch { setText("Adjust your numbers above to see personalized insights."); }
      setLoading(false);
    }, 1400);
    return () => clearTimeout(timerRef.current);
  }, deps);
  return { text, loading };
}

// ─── SIMULATORS ───────────────────────────────────────────────────────────────
function MovingOutSim({ user, onSave }) {
  const [income, setIncome] = useState(4000);
  const [rent, setRent] = useState(1100);
  const [utilities, setUtilities] = useState(140);
  const [groceries, setGroceries] = useState(280);
  const [insurance, setInsurance] = useState(100);
  const [subscriptions, setSubscriptions] = useState(60);
  const [furniture, setFurniture] = useState(50);
  const [parking, setParking] = useState(40);
  const [savings, setSavingsGoal] = useState(200);
  const [showHidden, setShowHidden] = useState(false);

  const base = rent + utilities + groceries + insurance;
  const hidden = subscriptions + furniture + parking;
  const total = base + hidden + savings;
  const ratio = Math.round((total / income) * 100);
  const surplus = income - total;
  const score = Math.max(0, Math.min(100, (surplus > 0 ? 35 : 0) + (ratio <= 30 ? 30 : ratio <= 40 ? 15 : 0) + (surplus >= 400 ? 20 : surplus >= 100 ? 10 : 0) + (hidden <= 100 ? 15 : 8)));

  const { text: aiText, loading: aiLoading } = useAI(
    `Moving out: income $${income}, rent $${rent}, total monthly cost $${total} (${ratio}% of income), surplus $${surplus}. Score ${score}/100.`,
    [income, rent, utilities, groceries, insurance, subscriptions, furniture, parking, savings]
  );

  const projData = Array.from({ length: 13 }, (_, i) => ({ mo: i === 0 ? "Now" : `M${i}`, savings: Math.max(0, surplus * i) }));

  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    onSave({ id: Date.now().toString(), type: "moving", label: `Moving Out — ${fmt(total)}/mo`, date: new Date().toLocaleDateString(), data: { income, rent, utilities, groceries, insurance, subscriptions, furniture, parking, savings, total, ratio, surplus, score } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Base Costs</div>
        <NumInput label="Monthly Take-Home Income" value={income} onChange={setIncome} accentColor={C.primary} />
        <NumInput label="Rent / Mortgage" value={rent} onChange={setRent} />
        <NumInput label="Utilities (electric, water, internet)" value={utilities} onChange={setUtilities} />
        <NumInput label="Groceries & Household" value={groceries} onChange={setGroceries} />
        <NumInput label="Renter's / Health Insurance" value={insurance} onChange={setInsurance} />
        <NumInput label="Savings Goal / Month" value={savings} onChange={setSavingsGoal} accentColor={C.green} />
        <button onClick={() => setShowHidden(h => !h)} style={{ background: "none", border: "none", color: C.primary, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "4px 0", fontFamily: "inherit" }}>
          {showHidden ? "▲ Hide" : "▼ Show"} hidden costs
        </button>
        {showHidden && <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Hidden Costs (people forget)</div>
          <NumInput label="Subscriptions (Netflix, Spotify…)" value={subscriptions} onChange={setSubscriptions} accentColor="#7c3aed" />
          <NumInput label="Furniture / Setup (amortized)" value={furniture} onChange={setFurniture} accentColor="#7c3aed" />
          <NumInput label="Parking / Transit" value={parking} onChange={setParking} accentColor="#7c3aed" />
        </div>}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <ScoreRing score={score} />
          <div style={{ flex: 1, paddingLeft: 16 }}>
            <StatRow label="Monthly Total" value={fmt(total)} color={C.text} />
            <StatRow label="Surplus / Deficit" value={fmt(surplus)} color={surplus >= 0 ? C.green : C.red} />
            <StatRow label="Hidden Costs" value={fmt(hidden)} color={C.muted} />
          </div>
        </div>
        <AffordabilityBar ratio={ratio} label={`Experts recommend keeping housing under 30% of income (yours: ${Math.round((rent/income)*100)}%)`} />
        <AIInsight text={aiText} loading={aiLoading} />
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Btn onClick={handleSave} style={{ flex: 1 }}>💾 Save Scenario</Btn>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>12-MONTH SAVINGS PROJECTION</div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={projData}>
            <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.primary} stopOpacity={0.2}/><stop offset="95%" stopColor={C.primary} stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="mo" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 10 }} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <Area type="monotone" dataKey="savings" name="Accumulated Savings" stroke={C.primary} fill="url(#mg)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── INSURANCE ENGINE ────────────────────────────────────────────────────────
const INSURANCE_TIERS = [
  { id: "liability",     label: "Liability Only",          icon: "🟡", coverageMultiplier: 0.55, baseRange: "$40–$90/mo",   pros: "Lowest cost",              cons: "No coverage for your car",       desc: "State minimum. Covers damage you cause others only." },
  { id: "collision",     label: "Liability + Collision",   icon: "🟠", coverageMultiplier: 1.00, baseRange: "$90–$170/mo",  pros: "Covers your car in crashes", cons: "No theft/weather coverage",      desc: "Adds repair coverage for your car after crashes." },
  { id: "comprehensive", label: "Full Coverage",           icon: "🟢", coverageMultiplier: 1.45, baseRange: "$130–$260/mo", pros: "Theft, weather, vandalism",  cons: "Higher monthly cost",            desc: "Liability + collision + theft, weather, vandalism." },
  { id: "premium",       label: "Premium + Gap",           icon: "🔵", coverageMultiplier: 1.78, baseRange: "$165–$320/mo", pros: "Best for financed cars",     cons: "Most expensive tier",            desc: "Full coverage + gap insurance if car is totaled." },
];

// Age multipliers based on industry data (teens pay ~$250/mo avg, 25-39 pay ~$160/mo avg)
const AGE_FACTORS = [
  { id: "16-19", label: "16–19",  multiplier: 2.20, note: "Highest risk tier — ~2.2× average rate" },
  { id: "20-24", label: "20–24",  multiplier: 1.55, note: "Young adult — still elevated risk" },
  { id: "25-29", label: "25–29",  multiplier: 1.10, note: "Rates drop significantly at 25" },
  { id: "30-39", label: "30–39",  multiplier: 1.00, note: "Baseline adult rate" },
  { id: "40-54", label: "40–54",  multiplier: 0.92, note: "Experienced driver discount" },
  { id: "55-69", label: "55–69",  multiplier: 0.88, note: "Lowest risk age group" },
  { id: "70+",   label: "70+",    multiplier: 1.05, note: "Slight increase for seniors" },
];

// Region multipliers (urban = more accidents, theft, congestion)
const REGION_FACTORS = [
  { id: "rural",    label: "Rural",         multiplier: 0.78, note: "Low traffic, low theft risk" },
  { id: "suburban", label: "Suburban",      multiplier: 1.00, note: "Baseline rate" },
  { id: "urban",    label: "Urban / City",  multiplier: 1.32, note: "Higher congestion, theft, accidents" },
  { id: "highcrime",label: "High-Crime City",multiplier: 1.65, note: "Significantly elevated theft/vandalism risk" },
];

// Driving record — rate increases based on real industry averages
const RECORD_FACTORS = [
  { id: "clean",    label: "Clean Record",         multiplier: 1.00, badge: "✅", badgeColor: "#0f766e", note: "Eligible for safe driver discounts (~25% off)" },
  { id: "minor",    label: "1 Minor Ticket",        multiplier: 1.25, badge: "⚠️", badgeColor: "#d97706", note: "+25% avg increase. Stays on record ~3 years." },
  { id: "multi",    label: "2–3 Tickets",           multiplier: 1.55, badge: "🔶", badgeColor: "#ea580c", note: "+55% increase. May be flagged as high-risk." },
  { id: "accident", label: "At-Fault Accident",     multiplier: 1.55, badge: "🔴", badgeColor: "#dc2626", note: "+55% avg increase. Stays on record 3–5 years." },
  { id: "dui",      label: "DUI / DWI",             multiplier: 1.90, badge: "🚨", badgeColor: "#991b1b", note: "+90% avg increase. May require SR-22. 5–10 yr impact." },
  { id: "serious",  label: "Reckless / Hit & Run",  multiplier: 2.10, badge: "⛔", badgeColor: "#7f1d1d", note: "+100–200% increase. High-risk policy required." },
];

// Credit score impact (banned in CA, HI, MA, MI)
const CREDIT_FACTORS = [
  { id: "excellent", label: "Excellent (750+)",  multiplier: 0.88, note: "Best rates available" },
  { id: "good",      label: "Good (670–749)",    multiplier: 1.00, note: "Baseline rate" },
  { id: "fair",      label: "Fair (580–669)",    multiplier: 1.18, note: "+18% avg increase" },
  { id: "poor",      label: "Poor (300–579)",    multiplier: 1.77, note: "+77% avg increase in states that allow it" },
];

// Additional discount factors
const DISCOUNTS = [
  { id: "married",   label: "Married",              multiplier: 0.92, note: "5–15% lower rates for married drivers" },
  { id: "homeowner", label: "Homeowner (bundle)",   multiplier: 0.88, note: "Bundle home + auto for ~12% off" },
  { id: "goodstudent",label: "Good Student (under 25)", multiplier: 0.90, note: "~10% off for students with B+ GPA" },
  { id: "lowmileage",label: "Low Mileage (<7k/yr)", multiplier: 0.93, note: "~7% off for infrequent drivers" },
  { id: "telematics",label: "Telematics / Usage App",multiplier: 0.87, note: "~13% off for monitored safe driving" },
];

function calcInsurancePremium({ baseRate, coverageTier, age, region, record, credit, selectedDiscounts }) {
  const tier = INSURANCE_TIERS.find(t => t.id === coverageTier) || INSURANCE_TIERS[1];
  const ageFactor = AGE_FACTORS.find(a => a.id === age)?.multiplier || 1.0;
  const regionFactor = REGION_FACTORS.find(r => r.id === region)?.multiplier || 1.0;
  const recordFactor = RECORD_FACTORS.find(r => r.id === record)?.multiplier || 1.0;
  const creditFactor = CREDIT_FACTORS.find(c => c.id === credit)?.multiplier || 1.0;
  const discountMultiplier = selectedDiscounts.reduce((acc, id) => {
    const d = DISCOUNTS.find(x => x.id === id);
    return d ? acc * d.multiplier : acc;
  }, 1.0);
  return Math.round(baseRate * tier.coverageMultiplier * ageFactor * regionFactor * recordFactor * creditFactor * discountMultiplier);
}

function CarOwnershipSim({ user, onSave }) {
  const [scenarioName, setScenarioName] = useState("");
  const [income, setIncome] = useState(4000);
  // APR loan calculator fields
  const [carPrice, setCarPrice] = useState(28000);
  const [downPayment, setDownPayment] = useState(3000);
  const [apr, setApr] = useState(7.5);
  const [loanTermYears, setLoanTermYears] = useState(5);
  const [useCalculated, setUseCalculated] = useState(true);
  const [manualPayment, setManualPayment] = useState(320);
  // Insurance driver profile
  const [insuranceTier, setInsuranceTier] = useState("collision");
  const [baseInsurance, setBaseInsurance] = useState(110);
  const [driverAge, setDriverAge] = useState("30-39");
  const [driverRegion, setDriverRegion] = useState("suburban");
  const [driverRecord, setDriverRecord] = useState("clean");
  const [driverCredit, setDriverCredit] = useState("good");
  const [driverDiscounts, setDriverDiscounts] = useState([]);
  const [showDriverProfile, setShowDriverProfile] = useState(false);
  const toggleDiscount = (id) => setDriverDiscounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  // Other costs
  const [gas, setGas] = useState(140);
  const [maintenance, setMaintenance] = useState(70);
  const [registration, setRegistration] = useState(18);
  const [tolls, setTolls] = useState(20);
  const [parking2, setParking2] = useState(30);
  const [showHidden, setShowHidden] = useState(false);
  const [showAprBreakdown, setShowAprBreakdown] = useState(false);

  // APR payment calculation
  const loanAmount = Math.max(0, carPrice - downPayment);
  const monthlyRate = apr / 100 / 12;
  const numPayments = loanTermYears * 12;
  const calcPayment = monthlyRate > 0
    ? Math.round(loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1))
    : Math.round(loanAmount / numPayments);
  const totalInterest = Math.max(0, calcPayment * numPayments - loanAmount);
  const totalPaid = calcPayment * numPayments + downPayment;

  // Year-by-year remaining balance
  const yearlyData = Array.from({ length: loanTermYears + 1 }, (_, yr) => {
    let balance = loanAmount;
    for (let m = 0; m < yr * 12; m++) {
      const interest = balance * monthlyRate;
      const principal = calcPayment - interest;
      balance = Math.max(0, balance - principal);
    }
    const annualInterest = yr < loanTermYears
      ? Array.from({ length: 12 }, (_, m2) => {
          let b = loanAmount;
          for (let mm = 0; mm < yr * 12 + m2; mm++) {
            b = Math.max(0, b - (calcPayment - b * monthlyRate));
          }
          return b * monthlyRate;
        }).reduce((a, b) => a + b, 0)
      : 0;
    return {
      label: yr === 0 ? "Start" : `Yr ${yr}`,
      balance: Math.round(balance),
      payment: yr < loanTermYears ? calcPayment * 12 : 0,
      interest: Math.round(annualInterest),
    };
  });

  // Insurance cost based on full driver profile
  const selectedTier = INSURANCE_TIERS.find(t => t.id === insuranceTier);
  const insurance = calcInsurancePremium({ baseRate: baseInsurance, coverageTier: insuranceTier, age: driverAge, region: driverRegion, record: driverRecord, credit: driverCredit, selectedDiscounts: driverDiscounts });
  const selectedRecord = RECORD_FACTORS.find(r => r.id === driverRecord);
  const selectedAge = AGE_FACTORS.find(a => a.id === driverAge);
  const selectedRegion = REGION_FACTORS.find(r => r.id === driverRegion);
  const selectedCredit = CREDIT_FACTORS.find(c => c.id === driverCredit);

  const payment = useCalculated ? calcPayment : manualPayment;
  const base = payment + insurance + gas + maintenance;
  const hidden = registration + tolls + parking2;
  const total = base + hidden;
  const ratio = Math.round((total / income) * 100);
  const annualCost = total * 12;
  const score = Math.max(0, Math.min(100,
    (ratio <= 15 ? 40 : ratio <= 20 ? 25 : ratio <= 30 ? 10 : 0) +
    (income - total > 1500 ? 30 : income - total > 500 ? 18 : income - total > 0 ? 8 : 0) +
    (maintenance >= 50 ? 20 : 10) + 10
  ));

  const { text: aiText, loading: aiLoading } = useAI(
    `Car ownership: income $${income}, payment $${payment} (APR ${apr}%, ${loanTermYears}yr loan on $${carPrice}), insurance $${insurance}/mo (${selectedTier?.label}, age ${driverAge}, ${driverRegion}, record: ${driverRecord}, credit: ${driverCredit}), gas $${gas}, maintenance $${maintenance}. Total $${total}/mo (${ratio}% of income). Total interest: $${Math.round(totalInterest)}. Score ${score}/100. Give honest, specific advice about their car cost situation.`,
    [income, payment, insurance, gas, maintenance, apr, carPrice, downPayment, loanTermYears, insuranceTier, baseInsurance, driverAge, driverRegion, driverRecord, driverCredit, driverDiscounts.length]
  );

  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    const label = scenarioName.trim() ? scenarioName.trim() : `Car Ownership — ${fmt(total)}/mo`;
    onSave({ id: Date.now().toString(), type: "car", label, date: new Date().toLocaleDateString(), data: { income, payment, insurance, gas, maintenance, total, ratio, annualCost, score } });
    setScenarioName("");
  };

  const barData = [
    { name: "Payment", value: payment },
    { name: "Insurance", value: insurance },
    { name: "Gas", value: gas },
    { name: "Maint.", value: maintenance },
    { name: "Hidden", value: hidden },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* APR Loan Calculator */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>💳 Loan / APR Calculator</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setUseCalculated(true)} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: useCalculated ? "#0284c7" : C.card, color: useCalculated ? "#fff" : C.muted, border: `1.5px solid ${useCalculated ? "#0284c7" : C.border}` }}>Auto-calc</button>
            <button onClick={() => setUseCalculated(false)} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: !useCalculated ? "#0284c7" : C.card, color: !useCalculated ? "#fff" : C.muted, border: `1.5px solid ${!useCalculated ? "#0284c7" : C.border}` }}>Manual</button>
          </div>
        </div>

        {useCalculated ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <NumInput label="Car Price" value={carPrice} onChange={setCarPrice} accentColor="#0284c7" />
              <NumInput label="Down Payment" value={downPayment} onChange={setDownPayment} accentColor="#0284c7" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <NumInput label="APR (%)" value={apr} onChange={setApr} prefix="" suffix="%" accentColor="#0284c7" />
              <NumInput label="Loan Term (years)" value={loanTermYears} onChange={(v) => setLoanTermYears(Math.min(10, Math.max(1, Math.round(v))))} prefix="" suffix=" yrs" accentColor="#0284c7" />
            </div>

            {/* Calculated payment highlight */}
            <div style={{ background: "rgba(2,132,199,0.08)", border: "1.5px solid rgba(2,132,199,0.25)", borderRadius: 12, padding: "12px 16px", marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#0284c7", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Monthly Payment</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#0284c7" }}>{fmt(calcPayment)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Total Interest</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#ea580c" }}>{fmt(totalInterest)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Total Paid</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{fmt(totalPaid)}</div>
                </div>
              </div>
            </div>

            {/* Year-by-year toggle */}
            <button onClick={() => setShowAprBreakdown(v => !v)} style={{ background: "none", border: "none", color: "#0284c7", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}>
              {showAprBreakdown ? "▲ Hide" : "▼ Show"} year-by-year breakdown
            </button>
            {showAprBreakdown && (
              <div style={{ marginTop: 12 }}>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={yearlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
                    <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 10 }} />
                    <Tooltip formatter={(v, name) => [fmt(v), name]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                    <Bar dataKey="balance" name="Remaining Balance" fill="#0284c7" radius={[4,4,0,0]} />
                    <Bar dataKey="interest" name="Interest That Year" fill="#f87171" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "center" }}>
                  <span style={{ fontSize: 11, color: C.muted }}>🔵 Remaining balance &nbsp; 🔴 Annual interest paid</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <NumInput label="Monthly Car Payment" value={manualPayment} onChange={setManualPayment} accentColor="#0284c7" />
        )}
      </Card>

      {/* Insurance Card */}
      <Card>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>🛡️ Insurance Estimator</div>

        {/* Estimated premium display */}
        <div style={{ background: "rgba(124,58,237,0.07)", border: "1.5px solid rgba(124,58,237,0.2)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>Est. Monthly Premium</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: "#7c3aed" }}>{fmt(insurance)}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{selectedTier?.label} · {selectedAge?.label} · {selectedRegion?.label}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Annual est.</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#ea580c" }}>{fmt(insurance * 12)}</div>
            <div style={{ fontSize: 10, color: selectedRecord?.badgeColor || C.muted, marginTop: 4 }}>{selectedRecord?.badge} {selectedRecord?.label}</div>
          </div>
        </div>

        {/* Coverage tier pills */}
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Coverage Level</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
          {INSURANCE_TIERS.map(tier => {
            const tierCost = calcInsurancePremium({ baseRate: baseInsurance, coverageTier: tier.id, age: driverAge, region: driverRegion, record: driverRecord, credit: driverCredit, selectedDiscounts: driverDiscounts });
            const isSelected = insuranceTier === tier.id;
            return (
              <button key={tier.id} onClick={() => setInsuranceTier(tier.id)} style={{
                textAlign: "left", padding: "10px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                background: isSelected ? "rgba(124,58,237,0.08)" : C.cardAlt,
                border: `1.5px solid ${isSelected ? "#7c3aed" : C.border}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#7c3aed" : C.text }}>{tier.icon} {tier.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{tier.desc}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: "#0f766e", background: "rgba(20,184,166,0.1)", padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>✓ {tier.pros}</span>
                      <span style={{ fontSize: 10, color: "#dc2626", background: "rgba(239,68,68,0.08)", padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>✗ {tier.cons}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 10, flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: isSelected ? "#7c3aed" : C.text }}>{fmt(tierCost)}/mo</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{tier.baseRange}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Driver Profile toggle */}
        <button onClick={() => setShowDriverProfile(v => !v)} style={{ background: "none", border: "none", color: "#7c3aed", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "4px 0", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
          {showDriverProfile ? "▲ Hide" : "▼ Edit"} Driver Profile
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>(age, region, record, credit, discounts)</span>
        </button>

        {showDriverProfile && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Base rate */}
            <NumInput label="Base Liability Rate Estimate (your starting point)" value={baseInsurance} onChange={setBaseInsurance} accentColor="#7c3aed" />

            {/* Age */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Driver Age</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {AGE_FACTORS.map(a => (
                  <button key={a.id} onClick={() => setDriverAge(a.id)} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: driverAge === a.id ? "#7c3aed" : C.card, color: driverAge === a.id ? "#fff" : C.muted, border: `1.5px solid ${driverAge === a.id ? "#7c3aed" : C.border}` }}>
                    {a.label}
                  </button>
                ))}
              </div>
              {selectedAge && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{selectedAge.note}</div>}
            </div>

            {/* Region */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Location Type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {REGION_FACTORS.map(r => (
                  <button key={r.id} onClick={() => setDriverRegion(r.id)} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: driverRegion === r.id ? "#0284c7" : C.card, color: driverRegion === r.id ? "#fff" : C.muted, border: `1.5px solid ${driverRegion === r.id ? "#0284c7" : C.border}` }}>
                    {r.label}
                  </button>
                ))}
              </div>
              {selectedRegion && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{selectedRegion.note}</div>}
            </div>

            {/* Driving Record */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Driving Record</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {RECORD_FACTORS.map(r => {
                  const isSelected = driverRecord === r.id;
                  return (
                    <button key={r.id} onClick={() => setDriverRecord(r.id)} style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", background: isSelected ? `${r.badgeColor}14` : C.cardAlt, border: `1.5px solid ${isSelected ? r.badgeColor : C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? r.badgeColor : C.text }}>{r.badge} {r.label}</span>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{r.note}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? r.badgeColor : C.muted, marginLeft: 10, flexShrink: 0 }}>
                          {r.multiplier > 1 ? `+${Math.round((r.multiplier - 1) * 100)}%` : "Baseline"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Credit Score */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Credit Score <span style={{ fontWeight: 400, fontSize: 11 }}>(not used in CA, HI, MA, MI)</span></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {CREDIT_FACTORS.map(c => (
                  <button key={c.id} onClick={() => setDriverCredit(c.id)} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: driverCredit === c.id ? "#0f766e" : C.card, color: driverCredit === c.id ? "#fff" : C.muted, border: `1.5px solid ${driverCredit === c.id ? "#0f766e" : C.border}` }}>
                    {c.label}
                  </button>
                ))}
              </div>
              {selectedCredit && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{selectedCredit.note}</div>}
            </div>

            {/* Discounts */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Applicable Discounts</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {DISCOUNTS.map(d => {
                  const isOn = driverDiscounts.includes(d.id);
                  return (
                    <button key={d.id} onClick={() => toggleDiscount(d.id)} style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", background: isOn ? "rgba(15,118,110,0.08)" : C.cardAlt, border: `1.5px solid ${isOn ? "#0f766e" : C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isOn ? "#0f766e" : C.text }}>{isOn ? "✓" : "○"} {d.label}</span>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{d.note}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: isOn ? "#0f766e" : C.muted, marginLeft: 10, flexShrink: 0 }}>
                          -{Math.round((1 - d.multiplier) * 100)}%
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </Card>

      {/* Other Costs */}
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Other Monthly Costs</div>
        <NumInput label="Monthly Take-Home Income" value={income} onChange={setIncome} accentColor={C.primary} />
        <NumInput label="Gas / Fuel" value={gas} onChange={setGas} accentColor="#0284c7" />
        <NumInput label="Maintenance & Repairs" value={maintenance} onChange={setMaintenance} accentColor="#0284c7" />
        <button onClick={() => setShowHidden(h => !h)} style={{ background: "none", border: "none", color: C.primary, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "4px 0", fontFamily: "inherit" }}>
          {showHidden ? "▲ Hide" : "▼ Show"} hidden costs
        </button>
        {showHidden && <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <NumInput label="Registration / Taxes (monthly)" value={registration} onChange={setRegistration} accentColor="#7c3aed" />
          <NumInput label="Tolls" value={tolls} onChange={setTolls} accentColor="#7c3aed" />
          <NumInput label="Parking" value={parking2} onChange={setParking2} accentColor="#7c3aed" />
        </div>}
      </Card>

      {/* Summary */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <ScoreRing score={score} />
          <div style={{ flex: 1, paddingLeft: 16 }}>
            <StatRow label="Monthly Payment" value={fmt(payment)} color="#0284c7" />
            <StatRow label="Insurance" value={fmt(insurance)} color="#7c3aed" sub={selectedTier.label} />
            <StatRow label="Monthly Total" value={fmt(total)} />
            <StatRow label="Annual Cost" value={fmt(annualCost)} color="#ea580c" />
            <StatRow label="% of Income" value={`${ratio}%`} color={ratio <= 15 ? C.green : ratio <= 25 ? "#d97706" : C.red} />
          </div>
        </div>
        <AffordabilityBar ratio={ratio} label="Experts recommend keeping total car costs under 15–20% of take-home income" />
        <AIInsight text={aiText} loading={aiLoading} />
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Scenario Name (optional)</div>
          <input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="e.g. My Honda Civic, Work Commuter Car" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
        </div>
      </Card>

      {/* Cost Breakdown Chart */}
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>COST BREAKDOWN</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={barData} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} width={60} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <Bar dataKey="value" fill="#0284c7" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function ProjectSim({ user, onSave }) {
  const [scenarioName, setScenarioName] = useState("");
  const [materials, setMaterials] = useState(700);
  const [labor, setLabor] = useState(400);
  const [hours, setHours] = useState(15);
  const [rate, setRate] = useState(25);
  const [buffer, setBuffer] = useState(20);
  const [delivery, setDelivery] = useState(50);
  const [tools, setTools] = useState(80);
  const [showHidden, setShowHidden] = useState(false);

  const timeCost = hours * rate;
  const hidden = delivery + tools;
  const subtotal = materials + labor + timeCost + hidden;
  const bufferAmt = Math.round(subtotal * (buffer / 100));
  const total = subtotal + bufferAmt;
  const score = Math.min(100, (buffer >= 20 ? 40 : buffer >= 10 ? 22 : 5) + (timeCost > 0 ? 25 : 0) + (hidden > 0 ? 20 : 0) + 15);

  const { text: aiText, loading: aiLoading } = useAI(
    `Project estimate: materials $${materials}, labor $${labor}, time $${timeCost}, buffer ${buffer}% ($${bufferAmt}), total $${total}. Score ${score}/100.`,
    [materials, labor, hours, rate, buffer, delivery, tools]
  );

  const scenData = [
    { name: "Best Case", value: Math.round(subtotal * 0.82) },
    { name: "Realistic", value: total },
    { name: "Worst Case", value: Math.round(total * 1.45) },
  ];

  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    const label = scenarioName.trim() ? scenarioName.trim() : `Project — ${fmt(total)} total`;
    onSave({ id: Date.now().toString(), type: "project", label, date: new Date().toLocaleDateString(), data: { materials, labor, timeCost, hidden, bufferAmt, total, score } });
    setScenarioName("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Project Inputs</div>
        <NumInput label="Materials & Supplies" value={materials} onChange={setMaterials} accentColor="#d97706" />
        <NumInput label="Hired Labor" value={labor} onChange={setLabor} accentColor="#d97706" />
        <NumInput label="Your Time (hours)" value={hours} onChange={setHours} accentColor="#7c3aed" prefix="" suffix=" hrs" />
        <NumInput label="Your Hourly Rate / Value" value={rate} onChange={setRate} accentColor="#7c3aed" />
        <NumInput label="Unexpected Buffer" value={buffer} onChange={setBuffer} accentColor="#dc2626" prefix="" suffix="%" />
        <button onClick={() => setShowHidden(h => !h)} style={{ background: "none", border: "none", color: C.primary, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "4px 0", fontFamily: "inherit" }}>
          {showHidden ? "▲ Hide" : "▼ Show"} hidden costs
        </button>
        {showHidden && <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <NumInput label="Delivery / Shipping" value={delivery} onChange={setDelivery} accentColor="#7c3aed" />
          <NumInput label="Tools / Equipment" value={tools} onChange={setTools} accentColor="#7c3aed" />
        </div>}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <ScoreRing score={score} />
          <div style={{ flex: 1, paddingLeft: 16 }}>
            <StatRow label="Base Estimate" value={fmt(subtotal)} />
            <StatRow label={`Buffer (${buffer}%)`} value={fmt(bufferAmt)} color="#ea580c" />
            <StatRow label="Reality Total" value={fmt(total)} color={C.text} />
          </div>
        </div>
        <AIInsight text={aiText} loading={aiLoading} />
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Scenario Name (optional)</div>
          <input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="e.g. Kitchen Remodel, Deck Build" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>SCENARIO COMPARISON</div>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={scenData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#d97706" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function RecessionSim({ user, onSave }) {
  const [scenarioName, setScenarioName] = useState("");
  const [income, setIncome] = useState(4000);
  const [savings, setSavings] = useState(7000);
  const [essentials, setEssentials] = useState(2000);
  const [drop, setDrop] = useState(70);
  const [reserve, setReserve] = useState(1500);

  const reduced = Math.round(income * (1 - drop / 100));
  const gap = Math.max(0, essentials - reduced);
  const total = savings + reserve;
  const runway = gap > 0 ? Math.floor(total / gap) : 99;
  const score = Math.max(0, Math.min(100,
    (runway >= 6 ? 40 : runway >= 3 ? 25 : runway >= 1 ? 10 : 0) +
    (savings >= essentials * 6 ? 30 : savings >= essentials * 3 ? 18 : savings >= essentials ? 8 : 0) +
    (reduced >= essentials * 0.5 ? 20 : reduced > 0 ? 10 : 0) + 10
  ));

  const { text: aiText, loading: aiLoading } = useAI(
    `Recession prep: income $${income}, savings $${savings}, essentials $${essentials}, income drops ${drop}% to $${reduced}, monthly gap $${gap}, runway ${runway >= 99 ? "indefinite" : runway + " months"}. Score ${score}/100.`,
    [income, savings, essentials, drop, reserve]
  );

  const runData = Array.from({ length: Math.min(runway + 3, 25) }, (_, i) => ({
    mo: `M${i}`, balance: Math.max(0, total - gap * i), line: essentials
  }));

  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    const label = scenarioName.trim() ? scenarioName.trim() : `Recession Prep — ${runway >= 99 ? "∞" : runway + "mo"} runway`;
    onSave({ id: Date.now().toString(), type: "recession", label, date: new Date().toLocaleDateString(), data: { income, savings, essentials, drop, reserve, reduced, gap, runway, score } });
    setScenarioName("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Crisis Scenario</div>
        <NumInput label="Current Monthly Income" value={income} onChange={setIncome} accentColor={C.primary} />
        <NumInput label="Total Savings" value={savings} onChange={setSavings} accentColor="#0f766e" />
        <NumInput label="Monthly Essential Expenses" value={essentials} onChange={setEssentials} accentColor="#dc2626" />
        <NumInput label="Income Drop in Crisis" value={drop} onChange={setDrop} accentColor="#dc2626" prefix="" suffix="%" />
        <NumInput label="One-Time Emergency Reserve" value={reserve} onChange={setReserve} accentColor="#7c3aed" />
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <ScoreRing score={score} />
          <div style={{ flex: 1, paddingLeft: 16 }}>
            <StatRow label="Reduced Income" value={fmt(reduced)} color={C.red} />
            <StatRow label="Monthly Gap" value={fmt(gap)} color={gap === 0 ? C.green : C.red} />
            <StatRow label="Runway" value={runway >= 99 ? "Indefinite ✓" : `${runway} months`} color={runway >= 6 ? C.green : runway >= 3 ? "#d97706" : C.red} />
          </div>
        </div>
        <AffordabilityBar ratio={Math.round((essentials / income) * 100)} label="Essential expense ratio — how much of income goes to necessities" />
        <AIInsight text={aiText} loading={aiLoading} />
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Scenario Name (optional)</div>
          <input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="e.g. Job Loss Plan, 2025 Prep" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>FINANCIAL RUNWAY (CRISIS MODE)</div>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={runData}>
            <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#dc2626" stopOpacity={0.2}/><stop offset="95%" stopColor="#dc2626" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="mo" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 10 }} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <Area type="monotone" dataKey="balance" name="Savings Balance" stroke="#dc2626" fill="url(#rg)" strokeWidth={2} />
            <Area type="monotone" dataKey="line" name="Monthly Essentials" stroke="#d97706" fill="none" strokeWidth={1.5} strokeDasharray="5 4" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onAuth }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!email || !password) { setError("Email and password are required."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      if (mode === "signup") {
        try {
          const sbUser = await SB.signUp(email, password, name || email.split("@")[0], zip);
          const user = { id: sbUser.id, name: name || email.split("@")[0], email: sbUser.email, zip, is_admin: false, joined: new Date().toLocaleDateString() };
          DB.setUser(user);
          onAuth(user);
          onClose();
        } catch (e) {
          if (e.message === "CHECK_EMAIL") {
            // Email confirmation required
            setAwaitingConfirmation(true);
          } else if (e.message?.includes("already registered") || e.message?.includes("User already registered")) {
            setError("An account with this email already exists. Try logging in instead.");
          } else {
            throw e;
          }
        }
      } else {
        const sbUser = await SB.signIn(email, password);
        const profile = await SB.getProfile(sbUser.id);
        const user = { id: sbUser.id, name: profile?.name || sbUser.email.split("@")[0], email: sbUser.email, zip: profile?.zip || "", is_admin: profile?.is_admin || false, joined: new Date(sbUser.created_at).toLocaleDateString() };
        DB.setUser(user);
        onAuth(user);
        onClose();
      }
    } catch (e) {
      if (e.message?.includes("Invalid login credentials") || e.message?.includes("invalid_credentials")) {
        setError("Incorrect email or password. Please try again.");
      } else if (e.message?.includes("Email not confirmed")) {
        setError("Please confirm your email first — check your inbox.");
      } else if (e.message?.includes("rate limit") || e.message?.includes("too many")) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        setError(e.message || "Something went wrong. Please try again.");
      }
    }
    setLoading(false);
  };

  // Email confirmation waiting screen
  if (awaitingConfirmation) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: 32, width: "100%", maxWidth: 480, boxShadow: "0 -20px 60px rgba(0,0,0,0.3)", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: C.text, marginBottom: 8 }}>Check your email</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
            We sent a confirmation link to <strong style={{ color: C.text }}>{email}</strong>.<br />
            Click it to activate your account, then come back and log in.
          </div>
          <Btn onClick={() => { setMode("login"); setAwaitingConfirmation(false); }} style={{ width: "100%", padding: 13, marginBottom: 10 }}>
            I confirmed — Log me in
          </Btn>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            I'll do this later
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: 28, width: "100%", maxWidth: 480, boxShadow: "0 -20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: C.text }}>{mode === "signup" ? "Create Account" : "Welcome Back"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.muted }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 24, background: C.bg, borderRadius: 12, padding: 4 }}>
          <button onClick={() => { setMode("signup"); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13, background: mode === "signup" ? C.primary : "transparent", color: mode === "signup" ? "#fff" : C.muted, transition: "all 0.15s" }}>Sign Up</button>
          <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 13, background: mode === "login" ? C.primary : "transparent", color: mode === "login" ? "#fff" : C.muted, transition: "all 0.15s" }}>Log In</button>
        </div>
        {mode === "signup" && <Input label="Your Name" value={name} onChange={setName} placeholder="Optional" />}
        <Input label="Email" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
        <Input label="Password" value={password} onChange={setPassword} placeholder="Min 6 characters" type="password" />
        {mode === "signup" && <Input label="ZIP Code (for local cost defaults)" value={zip} onChange={setZip} placeholder="Optional" />}
        {error && <div style={{ fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>{error}</div>}
        <Btn onClick={handleSubmit} style={{ width: "100%", padding: "14px 18px", fontSize: 15, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Please wait…" : mode === "signup" ? "Create Account & Save Progress" : "Log In"}
        </Btn>
        {mode === "login" && (
          <button onClick={() => { setMode("signup"); setError(""); }}
            style={{ width: "100%", background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit", marginTop: 10, padding: "6px" }}>
            Don't have an account? Sign up free
          </button>
        )}
        <p style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 10 }}>Your data is saved securely · Access from any device</p>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const DB_DASH = {
  get: (k) => { try { const u = JSON.parse(localStorage.getItem("re_user") || "null"); const prefix = u?.id ? `re_${u.id}_dash_` : "re_dash_"; return JSON.parse(localStorage.getItem(prefix + k) || "null"); } catch { return null; } },
  set: (k, v) => { try { const u = JSON.parse(localStorage.getItem("re_user") || "null"); const prefix = u?.id ? `re_${u.id}_dash_` : "re_dash_"; localStorage.setItem(prefix + k, JSON.stringify(v)); } catch {} },
};

function SavingsBucket({ bucket, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const pct = Math.min(100, bucket.target > 0 ? Math.round((bucket.saved / bucket.target) * 100) : 0);
  const remaining = Math.max(0, bucket.target - bucket.saved);
  const monthsLeft = bucket.monthly > 0 ? Math.ceil(remaining / bucket.monthly) : null;
  const colorMap = { emergency: "#0f766e", vacation: "#0284c7", car: "#d97706", home: "#7c3aed", other: "#6b7280" };
  const color = colorMap[bucket.type] || "#6b7280";

  return (
    <div style={{ background: C.cardAlt, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
      {editing ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Goal Name</div>
              <input value={bucket.label} onChange={e => onUpdate({ ...bucket, label: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Type</div>
              <select value={bucket.type} onChange={e => onUpdate({ ...bucket, type: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                <option value="emergency">🛡️ Emergency Fund</option>
                <option value="vacation">✈️ Vacation</option>
                <option value="car">🚗 Car / Transport</option>
                <option value="home">🏠 Home / Housing</option>
                <option value="other">📦 Other</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[["Target ($)", "target"], ["Saved So Far ($)", "saved"], ["Monthly Contribution ($)", "monthly"]].map(([lbl, key]) => (
              <div key={key}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>{lbl}</div>
                <input type="number" value={bucket[key]} onChange={e => onUpdate({ ...bucket, [key]: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => setEditing(false)} style={{ flex: 1, padding: "8px" }}>✓ Done</Btn>
            <Btn onClick={onDelete} variant="danger" style={{ padding: "8px 14px" }}>Delete</Btn>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{bucket.label}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {fmt(bucket.saved)} of {fmt(bucket.target)}
                {monthsLeft && <span> · ~{monthsLeft} mo to go</span>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color }}>
                {pct}%
              </div>
              <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: 4 }}>✏️</button>
            </div>
          </div>
          <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(to right, ${color}, ${color}cc)`, borderRadius: 4, transition: "width 0.5s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
            <span style={{ color, fontWeight: 600 }}>{fmt(bucket.monthly)}/mo contribution</span>
            <span>{fmt(remaining)} remaining</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CDTracker({ cd, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const startDate = new Date(cd.startDate);
  const maturityDate = new Date(startDate);
  maturityDate.setMonth(maturityDate.getMonth() + cd.termMonths);
  const today = new Date();
  const totalDays = (maturityDate - startDate) / (1000 * 60 * 60 * 24);
  const daysElapsed = Math.max(0, Math.min(totalDays, (today - startDate) / (1000 * 60 * 60 * 24)));
  const pct = Math.min(100, Math.round((daysElapsed / totalDays) * 100));
  const daysLeft = Math.max(0, Math.ceil((maturityDate - today) / (1000 * 60 * 60 * 24)));
  const projectedValue = cd.principal * Math.pow(1 + (cd.apy / 100) / 12, cd.termMonths);
  const interestEarned = projectedValue - cd.principal;
  const isMatured = today >= maturityDate;

  return (
    <div style={{ background: C.cardAlt, border: `1.5px solid ${isMatured ? "#0f766e" : C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
      {editing ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>CD / Account Label</div>
              <input value={cd.label} onChange={e => onUpdate({ ...cd, label: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Institution</div>
              <input value={cd.institution} onChange={e => onUpdate({ ...cd, institution: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            {[["Principal ($)", "principal"], ["APY (%)", "apy"], ["Term (months)", "termMonths"]].map(([lbl, key]) => (
              <div key={key}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>{lbl}</div>
                <input type="number" value={cd[key]} onChange={e => onUpdate({ ...cd, [key]: parseFloat(e.target.value) || 0 })}
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Start Date</div>
            <input type="date" value={cd.startDate} onChange={e => onUpdate({ ...cd, startDate: e.target.value })}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 10 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => setEditing(false)} style={{ flex: 1, padding: "8px" }}>✓ Done</Btn>
            <Btn onClick={onDelete} variant="danger" style={{ padding: "8px 14px" }}>Delete</Btn>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{cd.label}</span>
                {isMatured && <span style={{ fontSize: 10, background: "rgba(15,118,110,0.1)", color: "#0f766e", padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>✓ MATURED</span>}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{cd.institution} · {cd.apy}% APY · {cd.termMonths}mo term</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Matures: {maturityDate.toLocaleDateString()} {!isMatured && `· ${daysLeft} days left`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#0f766e" }}>{fmt(projectedValue)}</div>
                <div style={{ fontSize: 10, color: "#0f766e" }}>+{fmt(interestEarned)} interest</div>
              </div>
              <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: 4 }}>✏️</button>
            </div>
          </div>
          <div style={{ height: 7, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: isMatured ? "#0f766e" : `linear-gradient(to right, #0284c7, #0f766e)`, borderRadius: 4, transition: "width 0.5s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
            <span style={{ fontWeight: 600, color: "#0284c7" }}>{fmt(cd.principal)} deposited</span>
            <span>{pct}% of term elapsed</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({ user, onLogout, onShowAuth }) {
  const [scenarios, setScenarios] = useState(DB.getScenarios());
  useEffect(() => {
    if (user?.id) SB.getScenarios(user.id).then(data => { if (data.length) { DB.setScenarios(data); setScenarios(data); } });
  }, [user?.id]);
  const [activeTab, setActiveTab] = useState("overview");
  const [showEmail, setShowEmail] = useState(true);

  // Income tracker
  const [monthlyIncome, setMonthlyIncome] = useState(() => DB_DASH.get("income") || 4000);
  const [incomeStreams, setIncomeStreams] = useState(() => DB_DASH.get("incomeStreams") || []);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [newIncomeLabel, setNewIncomeLabel] = useState("");
  const [newIncomeAmt, setNewIncomeAmt] = useState("");
  const [newIncomeType, setNewIncomeType] = useState("monthly");

  // Savings buckets
  const [buckets, setBuckets] = useState(() => DB_DASH.get("buckets") || []);
  const [showAddBucket, setShowAddBucket] = useState(false);

  // CD tracker
  const [cds, setCDs] = useState(() => DB_DASH.get("cds") || []);
  const [showAddCD, setShowAddCD] = useState(false);

  const refresh = () => setScenarios(DB.getScenarios());
  const handleDeleteScenario = (id) => { DB.deleteScenario(id); SB.deleteScenario(id).catch(()=>{}); refresh(); };

  // Persist helpers
  const saveIncome = (v) => { setMonthlyIncome(v); DB_DASH.set("income", v); };
  const saveStreams = (v) => { setIncomeStreams(v); DB_DASH.set("incomeStreams", v); };
  const saveBuckets = (v) => { setBuckets(v); DB_DASH.set("buckets", v); };
  const saveCDs = (v) => { setCDs(v); DB_DASH.set("cds", v); };

  const addIncomeStream = () => {
    if (!newIncomeLabel || !newIncomeAmt) return;
    const stream = { id: Date.now().toString(), label: newIncomeLabel, amount: parseFloat(newIncomeAmt), type: newIncomeType };
    saveStreams([...incomeStreams, stream]);
    setNewIncomeLabel(""); setNewIncomeAmt(""); setShowAddIncome(false);
  };

  const addBucket = () => {
    const b = { id: Date.now().toString(), label: "New Goal", type: "other", target: 1000, saved: 0, monthly: 100 };
    saveBuckets([...buckets, b]);
  };

  const addCD = () => {
    const cd = { id: Date.now().toString(), label: "New CD", institution: "My Bank", principal: 5000, apy: 4.5, termMonths: 12, startDate: new Date().toISOString().split("T")[0] };
    saveCDs([...cds, cd]);
  };

  const totalMonthlyIncome = monthlyIncome + incomeStreams.filter(s => s.type === "monthly").reduce((a, s) => a + s.amount, 0)
    + incomeStreams.filter(s => s.type === "annual").reduce((a, s) => a + s.amount / 12, 0);
  const totalSavingsTarget = buckets.reduce((a, b) => a + b.target, 0);
  const totalSavingsSaved = buckets.reduce((a, b) => a + b.saved, 0);
  const totalMonthlySavings = buckets.reduce((a, b) => a + b.monthly, 0);
  const totalCDValue = cds.reduce((a, cd) => { const v = cd.principal * Math.pow(1 + (cd.apy / 100) / 12, cd.termMonths); return a + v; }, 0);
  const totalCDPrincipal = cds.reduce((a, cd) => a + cd.principal, 0);

  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳" };
  const colors = { moving: C.primary, car: "#0284c7", project: "#d97706", recession: "#dc2626" };

  const dashTabs = [
    { id: "overview", label: "Overview" },
    { id: "income", label: "Income" },
    { id: "savings", label: "Savings" },
    { id: "cds", label: "CDs" },
    { id: "scenarios", label: "Scenarios" },
    { id: "settings", label: "⚙️ Settings" },
  ];

  if (!user) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8, color: C.text }}>Sign in to see your dashboard</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Track income, savings goals, CD accounts, and saved scenarios.</div>
        <Btn onClick={onShowAuth} style={{ width: "100%", padding: "14px 18px", fontSize: 15 }}>Create Account / Log In</Btn>
      </Card>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Profile header */}
      <Card style={{ background: C.bg === "#0a0f1e" ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)", padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 24, fontWeight: 900, flexShrink: 0 }}>
            {(user.name?.[0] || user.email?.[0] || "U").toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: C.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>{user.name || "User"}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
              {showEmail ? (user.email || "") : "••••••••••@•••••.•••"}
              {user.zip ? ` · 📍 ${user.zip}` : ""}
              <button onClick={() => setShowEmail(v => !v)} title={showEmail ? "Hide email" : "Show email"}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", color: C.muted, lineHeight: 1 }}>
                {showEmail ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <Btn onClick={onLogout} variant="ghost" style={{ fontSize: 12 }}>Log out</Btn>
        </div>

        {/* Quick stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div style={{ background: "rgba(37,99,235,0.08)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.primary, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Monthly Income</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.primary }}>{fmt(totalMonthlyIncome)}</div>
          </div>
          <div style={{ background: "rgba(15,118,110,0.08)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.green, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Saving/mo</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.green }}>{fmt(totalMonthlySavings)}</div>
          </div>
          <div style={{ background: "rgba(124,58,237,0.08)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>CD Value</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#7c3aed" }}>{fmt(totalCDValue)}</div>
          </div>
        </div>
      </Card>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {dashTabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "8px 14px", borderRadius: 999, border: `1.5px solid ${activeTab === t.id ? C.primary : C.border}`,
            background: activeTab === t.id ? C.primary : C.card, color: activeTab === t.id ? "#fff" : C.muted,
            fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Financial Snapshot</div>
            <StatRow label="Total Monthly Income" value={fmt(totalMonthlyIncome)} color={C.primary} />
            <StatRow label="Monthly Savings Committed" value={fmt(totalMonthlySavings)} color={C.green} sub={`${totalMonthlySavings > 0 ? Math.round((totalMonthlySavings / totalMonthlyIncome) * 100) : 0}% of income`} />
            <StatRow label="Total Savings Progress" value={`${fmt(totalSavingsSaved)} / ${fmt(totalSavingsTarget)}`} color={C.text} />
            <StatRow label="CD Accounts" value={`${cds.length} account${cds.length !== 1 ? "s" : ""}`} sub={`${fmt(totalCDPrincipal)} deposited → ${fmt(totalCDValue)} projected`} />
            <StatRow label="Saved Scenarios" value={`${scenarios.length}`} color={C.muted} />
          </Card>

          {buckets.length > 0 && (
            <Card>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Savings Goals Progress</div>
              {buckets.map(b => {
                const pct = Math.min(100, b.target > 0 ? Math.round((b.saved / b.target) * 100) : 0);
                const colorMap = { emergency: "#0f766e", vacation: "#0284c7", car: "#d97706", home: "#7c3aed", other: "#6b7280" };
                const col = colorMap[b.type] || "#6b7280";
                return (
                  <div key={b.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{b.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{pct}% · {fmt(b.saved)}</span>
                    </div>
                    <div style={{ height: 7, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 4, transition: "width 0.4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {/* INCOME TAB */}
      {activeTab === "income" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Primary Income</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Monthly Take-Home Pay</div>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14 }}>$</span>
              <input type="number" value={monthlyIncome} onChange={e => saveIncome(parseFloat(e.target.value) || 0)}
                style={{ width: "100%", padding: "12px 14px 12px 26px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 15, fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt, boxSizing: "border-box", fontWeight: 700 }} />
            </div>
            <div style={{ background: "rgba(37,99,235,0.06)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: C.muted }}>Annual equivalent</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.primary }}>{fmt(monthlyIncome * 12)}/yr</div>
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Additional Income Streams</div>
              <Btn onClick={() => setShowAddIncome(v => !v)} variant="outline" style={{ fontSize: 11, padding: "5px 12px" }}>+ Add</Btn>
            </div>

            {showAddIncome && (
              <div style={{ background: C.cardAlt, borderRadius: 12, padding: 14, marginBottom: 14, border: `1.5px solid ${C.primary}` }}>
                <Input label="Label (e.g. Freelance, Side gig)" value={newIncomeLabel} onChange={setNewIncomeLabel} placeholder="Income source name" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Amount ($)</div>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted }}>$</span>
                      <input type="number" value={newIncomeAmt} onChange={e => setNewIncomeAmt(e.target.value)} placeholder="0"
                        style={{ width: "100%", padding: "10px 12px 10px 22px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Frequency</div>
                    <select value={newIncomeType} onChange={e => setNewIncomeType(e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                </div>
                <Btn onClick={addIncomeStream} style={{ width: "100%", marginTop: 10, padding: "10px" }}>Add Income Stream</Btn>
              </div>
            )}

            {incomeStreams.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 13 }}>No additional streams yet</div>
            ) : incomeStreams.map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{s.type === "annual" ? `${fmt(s.amount)}/yr · ${fmt(s.amount / 12)}/mo` : `${fmt(s.amount)}/mo`}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, color: C.green, fontSize: 14 }}>+{fmt(s.type === "annual" ? s.amount / 12 : s.amount)}/mo</span>
                  <button onClick={() => saveStreams(incomeStreams.filter(x => x.id !== s.id))} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
                </div>
              </div>
            ))}

            {incomeStreams.length > 0 && (
              <div style={{ marginTop: 12, background: "rgba(15,118,110,0.07)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Total Monthly Income</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.green }}>{fmt(totalMonthlyIncome)}</span>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* SAVINGS TAB */}
      {activeTab === "savings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px", textAlign: "center", boxShadow: C.shadow }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Total Saved</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: C.green }}>{fmt(totalSavingsSaved)}</div>
              <div style={{ fontSize: 11, color: C.muted }}>of {fmt(totalSavingsTarget)}</div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px", textAlign: "center", boxShadow: C.shadow }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Saving/mo</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: C.primary }}>{fmt(totalMonthlySavings)}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{buckets.length} goal{buckets.length !== 1 ? "s" : ""}</div>
            </div>
          </div>

          {buckets.map(b => (
            <SavingsBucket key={b.id} bucket={b}
              onUpdate={(updated) => saveBuckets(buckets.map(x => x.id === updated.id ? updated : x))}
              onDelete={() => saveBuckets(buckets.filter(x => x.id !== b.id))} />
          ))}

          <Btn onClick={addBucket} variant="outline" style={{ width: "100%", padding: "13px" }}>+ Add Savings Goal</Btn>
        </div>
      )}

      {/* CD TRACKER TAB */}
      {activeTab === "cds" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cds.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px", textAlign: "center", boxShadow: C.shadow }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Total Deposited</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>{fmt(totalCDPrincipal)}</div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px", textAlign: "center", boxShadow: C.shadow }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Projected Value</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.green }}>{fmt(totalCDValue)}</div>
                <div style={{ fontSize: 11, color: C.green }}>+{fmt(totalCDValue - totalCDPrincipal)} interest</div>
              </div>
            </div>
          )}

          {cds.map(cd => (
            <CDTracker key={cd.id} cd={cd}
              onUpdate={(updated) => saveCDs(cds.map(x => x.id === updated.id ? updated : x))}
              onDelete={() => saveCDs(cds.filter(x => x.id !== cd.id))} />
          ))}

          {cds.length === 0 && (
            <Card style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: C.text }}>No CDs tracked yet</div>
              <div style={{ fontSize: 13, color: C.muted }}>Track your certificates of deposit — see maturity dates, projected interest, and total value.</div>
            </Card>
          )}

          <Btn onClick={addCD} variant="outline" style={{ width: "100%", padding: "13px" }}>+ Add CD / Account</Btn>
        </div>
      )}

      {/* SCENARIOS TAB */}
      {activeTab === "scenarios" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {scenarios.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>No saved scenarios yet</div>
              <div style={{ fontSize: 13, color: C.muted }}>Run a simulator and tap "Save Scenario"</div>
            </Card>
          ) : scenarios.map(s => (
            <Card key={s.id} style={{ borderLeft: `4px solid ${colors[s.type] || C.primary}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{icons[s.type] || "📋"}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Saved {s.date}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <ScoreRing score={s.data?.score || 0} size={52} />
                  <Btn onClick={() => handleDeleteScenario(s.id)} variant="danger" style={{ padding: "6px 10px", fontSize: 12 }}>✕</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "settings" && (
        <SettingsPanel user={user} onUpdate={(updatedUser) => {
          DB.setUser(updatedUser);
          // Update accounts store too
          try {
            const accounts = JSON.parse(localStorage.getItem("re_accounts") || "{}");
            if (accounts[updatedUser.email]) {
              accounts[updatedUser.email] = { ...accounts[updatedUser.email], ...updatedUser };
              localStorage.setItem("re_accounts", JSON.stringify(accounts));
            }
          } catch {}
          window.location.reload();
        }} onLogout={onLogout} showEmail={showEmail} onToggleEmail={() => setShowEmail(v => !v)} />
      )}

    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({ user, onUpdate, onLogout, showEmail, onToggleEmail }) {
  const [displayName, setDisplayName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [zip, setZip] = useState(user.zip || "");
  const [msg, setMsg] = useState({ text: "", type: "" });

  const show = (text, type = "ok") => { setMsg({ text, type }); setTimeout(() => setMsg({ text: "", type: "" }), 3500); };

  const saveProfile = async () => {
    if (!displayName.trim()) { show("Display name can't be empty.", "err"); return; }
    try {
      await SB.updateProfile(user.id, { name: displayName.trim(), zip });
      onUpdate({ ...user, name: displayName.trim(), zip });
      show("Profile updated! ✓");
    } catch (e) { show(e.message || "Failed to save.", "err"); }
  };

  const saveEmail = async () => {
    if (!email.includes("@")) { show("Enter a valid email address.", "err"); return; }
    try {
      const { error } = await sb.auth.updateUser({ email: email.toLowerCase() });
      if (error) { show(error.message, "err"); return; }
      onUpdate({ ...user, email: email.toLowerCase() });
      show("Email updated! Check your inbox to confirm the change. ✓");
    } catch (e) { show(e.message || "Failed to update email.", "err"); }
  };

  const savePassword = async () => {
    if (newPassword.length < 6) { show("Password must be at least 6 characters.", "err"); return; }
    if (newPassword !== confirmPassword) { show("Passwords don't match. Please try again.", "err"); return; }
    try {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) { show(error.message, "err"); return; }
      setNewPassword(""); setConfirmPassword("");
      show("Password updated successfully! ✓");
    } catch (e) { show(e.message || "Failed to update password.", "err"); }
  };

  const Section = ({ title, children }) => (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>{title}</div>
      {children}
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {msg.text && (
        <div style={{ padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13,
          background: msg.type === "err" ? C.redBg : C.greenBg,
          border: `1px solid ${msg.type === "err" ? C.redBorder : C.greenBorder}`,
          color: msg.type === "err" ? C.red : C.green }}>
          {msg.text}
        </div>
      )}

      <Section title="👤 Display Name">
        <Input label="Name shown across the app" value={displayName} onChange={setDisplayName} placeholder="Your name" />
        <Input label="ZIP Code" value={zip} onChange={setZip} placeholder="Optional — used for local cost defaults" />
        <Btn onClick={saveProfile} style={{ width: "100%" }}>Save Profile</Btn>
      </Section>

      <Section title="📧 Email Address">
        <Input label="Email" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
        <Btn onClick={saveEmail} style={{ width: "100%" }}>Update Email</Btn>
      </Section>

      <Section title="🔒 Change Password">
        <Input label="New Password" value={newPassword} onChange={setNewPassword} placeholder="Min 6 characters" type="password" />
        <Input label="Re-enter New Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Must match above" type="password" />
        <Btn onClick={savePassword} style={{ width: "100%" }}>Update Password</Btn>
      </Section>

      <Section title="🔍 Privacy">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>Show email on dashboard</div>
            <div style={{ fontSize: 12, color: C.muted }}>Hides your email from the profile card and sidebar</div>
          </div>
          <button onClick={onToggleEmail}
            style={{ width: 48, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: showEmail ? C.primary : C.border, transition: "background 0.2s", position: "relative", flexShrink: 0 }}>
            <div style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", position: "absolute", top: 3, transition: "left 0.2s", left: showEmail ? 24 : 4 }} />
          </button>
        </div>
      </Section>

      <Section title="⚠️ Account">
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Logging out will clear your session. Your saved data stays on this device.</div>
        <Btn onClick={onLogout} variant="danger" style={{ width: "100%" }}>Log Out</Btn>
      </Section>

    </div>
  );
}
function Home({ onNavigate }) {
  const sims = [
    { id: "moving", icon: "🏠", title: "Moving Out Reality", desc: "Rent + utilities + groceries + hidden costs", badge: "Monthly" },
    { id: "car", icon: "🚗", title: "Car Ownership Reality", desc: "Payment + insurance + gas + maintenance", badge: "Monthly" },
    { id: "project", icon: "🔨", title: "Project / Task Reality", desc: "Materials + labor + time cost + buffer", badge: "Total" },
    { id: "recession", icon: "📉", title: "Recession Preparation", desc: "Emergency runway + crisis readiness", badge: "Readiness" },
    { id: "debt", icon: "💳", title: "Debt Payoff Reality", desc: "Avalanche vs snowball · interest saved · payoff date", badge: "Freedom" },
  ];
  const features = [
    { title: "Hidden cost library", desc: "Toggle line items people forget", badge: "Built-in", color: C.green },
    { title: "Reality buffer", desc: "A cushion for the unknown", badge: "Slider", color: "#d97706" },
    { title: "AI-powered insight", desc: "Personalized per your numbers", badge: "Live", color: C.primary },
    { title: "Zip or City/State defaults", desc: "Accuracy-first or privacy-first", badge: "Optional", color: C.muted },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card style={{ background: C.bg === "#0a0f1e" ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)", border: "none" }}>
        <Badge variant="ok">✅ Decision confidence</Badge>
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.03em", margin: "10px 0 10px", color: C.text, lineHeight: 1.2 }}>
          Know the real monthly cost<br/>before you commit.
        </h1>
        <p style={{ margin: "0 0 18px", color: C.muted, lineHeight: 1.6, fontSize: 14 }}>
          Reality Estimator simulates the true cost of life changes — with hidden costs, buffers, and AI-powered insights.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn onClick={() => onNavigate("simulate")}>Run a simulation →</Btn>
          <Btn onClick={() => onNavigate("dashboard")} variant="outline">My dashboard</Btn>
        </div>
      </Card>

      <div>
        <div className="re-section-title" style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 12 }}>Pick a simulator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sims.map(s => (
            <Card key={s.id} onClick={() => onNavigate("simulate", s.id)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 22 }}>{s.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{s.desc}</div>
                </div>
              </div>
              <Badge>{s.badge}</Badge>
            </Card>
          ))}
        </div>
      </div>

      <Card onClick={() => onNavigate("spending")} style={{ cursor: "pointer", background: C.bg === "#0a0f1e" ? `linear-gradient(135deg, ${C.card}, #1a2a3a)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: `1.5px solid ${C.primary}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 26 }}>🧾</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>Spending Tracker</div>
              <div style={{ fontSize: 12, color: C.muted }}>Log transactions · catch wasteful habits · AI analysis</div>
            </div>
          </div>
          <Badge variant="primary">New</Badge>
        </div>
      </Card>

      <div>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 12 }}>What makes it different</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {features.map((f, i) => (
            <Card key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{f.title}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{f.desc}</div>
              </div>
              <Badge variant={f.color === C.green ? "ok" : f.color === C.primary ? "primary" : "default"}>{f.badge}</Badge>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SIMULATE PAGE ────────────────────────────────────────────────────────────
function SimulatePage({ defaultTab, user, onSave }) {
  const tabs = [
    { id: "moving", icon: "🏠", label: "Moving Out" },
    { id: "car", icon: "🚗", label: "Car" },
    { id: "project", icon: "🔨", label: "Project" },
    { id: "recession", icon: "📉", label: "Recession" },
    { id: "debt", icon: "💳", label: "Debt" },
  ];
  const [active, setActive] = useState(defaultTab || "moving");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto", paddingBottom: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} style={{
            padding: "8px 14px", borderRadius: 999, border: `1.5px solid ${active === t.id ? C.primary : C.border}`,
            background: active === t.id ? C.primary : C.card, color: active === t.id ? "#fff" : C.muted,
            fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s"
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {active === "moving" && <MovingOutSim user={user} onSave={onSave} />}
      {active === "car" && <CarOwnershipSim user={user} onSave={onSave} />}
      {active === "project" && <ProjectSim user={user} onSave={onSave} />}
      {active === "recession" && <RecessionSim user={user} onSave={onSave} />}
      {active === "debt" && <DebtPayoffSim user={user} onSave={onSave} />}
    </div>
  );
}

// ─── COMPARE PAGE ─────────────────────────────────────────────────────────────
function ComparePage({ user }) {
  const scenarios = DB.getScenarios();
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);

  if (!user) return (
    <Card style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Account required</div>
      <div style={{ fontSize: 13, color: C.muted }}>Create an account and save scenarios to compare them side by side.</div>
    </Card>
  );
  if (scenarios.length < 2) return (
    <Card style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Save at least 2 scenarios</div>
      <div style={{ fontSize: 13, color: C.muted }}>Run simulations and save them to compare side by side.</div>
    </Card>
  );

  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳" };
  const sa = scenarios.find(s => s.id === a);
  const sb = scenarios.find(s => s.id === b);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>SCENARIO A</div>
          <select value={a || ""} onChange={e => setA(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.text, background: C.card }}>
            <option value="">Pick one…</option>
            {scenarios.map(s => <option key={s.id} value={s.id}>{icons[s.type]} {s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>SCENARIO B</div>
          <select value={b || ""} onChange={e => setB(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.text, background: C.card }}>
            <option value="">Pick one…</option>
            {scenarios.map(s => <option key={s.id} value={s.id}>{icons[s.type]} {s.label}</option>)}
          </select>
        </div>
      </div>

      {sa && sb && (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[sa, sb].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: C.text }}>{icons[s.type]} {s.label}</div>
                <ScoreRing score={s.data?.score || 0} size={80} />
                <div style={{ marginTop: 12 }}>
                  {s.data?.total && <StatRow label="Total Cost" value={fmt(s.data.total)} />}
                  {s.data?.ratio && <StatRow label="% of Income" value={`${s.data.ratio}%`} color={s.data.ratio <= 30 ? C.green : s.data.ratio <= 45 ? "#d97706" : C.red} />}
                  {s.data?.surplus !== undefined && <StatRow label="Surplus" value={fmt(s.data.surplus)} color={s.data.surplus >= 0 ? C.green : C.red} />}
                  {s.data?.runway !== undefined && <StatRow label="Runway" value={s.data.runway >= 99 ? "∞" : `${s.data.runway}mo`} />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}


// ─── SPENDING TRACKER ─────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "food", label: "Food & Dining", icon: "🍔" },
  { id: "transport", label: "Transport", icon: "🚗" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "entertainment", label: "Entertainment", icon: "🎬" },
  { id: "subscriptions", label: "Subscriptions", icon: "📱" },
  { id: "health", label: "Health", icon: "💊" },
  { id: "utilities", label: "Utilities", icon: "💡" },
  { id: "other", label: "Other", icon: "📦" },
];

const NECESSITY = [
  { id: "need", label: "Need", color: "#0f766e", bg: "rgba(20,184,166,0.10)", border: "rgba(20,184,166,0.25)" },
  { id: "want", label: "Want", color: "#d97706", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.25)" },
  { id: "impulse", label: "Impulse 🚨", color: "#dc2626", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.25)" },
];

function SpendingTracker() {
  const [transactions, setTransactions] = useState(DB.getTransactions());
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [necessity, setNecessity] = useState("need");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [filter, setFilter] = useState("all");

  const persist = (list) => { setTransactions(list); DB.saveTransactions(list); };

  const addTransaction = () => {
    if (!desc.trim() || !amount || isNaN(parseFloat(amount))) return;
    const tx = { id: Date.now().toString(), desc: desc.trim(), amount: parseFloat(amount), category, necessity, date };
    persist([tx, ...transactions]);
    setDesc(""); setAmount(""); setCategory("food"); setNecessity("need");
    setDate(new Date().toISOString().split("T")[0]);
    setShowForm(false);
    setAnalyzed(false);
  };

  const deleteTransaction = (id) => { persist(transactions.filter(t => t.id !== id)); setAnalyzed(false); };

  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const byNecessity = NECESSITY.map(n => ({
    ...n,
    amount: transactions.filter(t => t.necessity === n.id).reduce((s, t) => s + t.amount, 0),
    count: transactions.filter(t => t.necessity === n.id).length,
  }));
  const byCategory = CATEGORIES.map(c => ({
    ...c,
    amount: transactions.filter(t => t.category === c.id).reduce((s, t) => s + t.amount, 0),
  })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);

  const filtered = filter === "all" ? transactions : transactions.filter(t => t.necessity === filter);

  const runAI = async () => {
    if (transactions.length === 0) return;
    setAiLoading(true); setAiAnalysis("");
    const summary = transactions.slice(0, 30).map(t => `${t.date} | ${t.desc} | $${t.amount} | ${t.category} | ${t.necessity}`).join("\n");
    const wantTotal = byNecessity.find(n => n.id === "want")?.amount || 0;
    const impulseTotal = byNecessity.find(n => n.id === "impulse")?.amount || 0;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 400,
          system: "You are a sharp, honest personal finance coach reviewing spending. Be direct and specific — name actual transactions, call out real patterns, give 2-3 concrete actionable suggestions. Plain conversational language, no bullet points, 3-4 sentences max.",
          messages: [{ role: "user", content: `My recent transactions:\n${summary}\n\nTotal: $${total.toFixed(2)}. Wants: $${wantTotal.toFixed(2)}, Impulse: $${impulseTotal.toFixed(2)}. Analyze my spending honestly.` }]
        })
      });
      const d = await res.json();
      setAiAnalysis(d.content?.[0]?.text || "");
      setAnalyzed(true);
    } catch { setAiAnalysis("Could not connect. Try again."); }
    setAiLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Page Header */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: "-0.02em" }}>🧾 Spending Tracker</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Log transactions · catch wasteful habits · AI analysis</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {byNecessity.map(n => (
          <div key={n.id} style={{ background: n.bg, border: `1px solid ${n.border}`, borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: n.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{n.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: n.color }}>{fmt(n.amount)}</div>
            <div style={{ fontSize: 10, color: n.color, opacity: 0.7 }}>{n.count} item{n.count !== 1 ? "s" : ""}</div>
          </div>
        ))}
      </div>

      <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total Logged</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: C.text }}>{fmt(total)}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{transactions.length} transaction{transactions.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn onClick={runAI} style={{ fontSize: 12 }} variant={analyzed ? "outline" : "primary"}>
            {aiLoading ? "Analyzing…" : analyzed ? "✦ Re-analyze" : "✦ AI Analysis"}
          </Btn>
          <Btn onClick={() => setShowForm(f => !f)} variant="outline" style={{ fontSize: 12 }}>
            {showForm ? "✕ Cancel" : "+ Add Transaction"}
          </Btn>
        </div>
      </Card>

      {(aiAnalysis || aiLoading) && (
        <div style={{ background: C.bg === "#0a0f1e" ? `linear-gradient(135deg, ${C.card}, #1e3a5f)` : "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: `1px solid ${C.primary}26`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, color: "#fff", fontWeight: 700 }}>✦</div>
            <div style={{ fontSize: 13, color: "#1e3a5f", lineHeight: 1.7 }}>
              {aiLoading ? <span style={{ color: C.muted }}>Reading your spending patterns…</span> : aiAnalysis}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <Card style={{ border: `1.5px solid ${C.primary}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 14 }}>New Transaction</div>
          <Input label="Description" value={desc} onChange={setDesc} placeholder="e.g. Starbucks, Amazon order…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Amount</div>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14 }}>$</span>
                <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00"
                  style={{ width: "100%", padding: "11px 14px 11px 26px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt, boxSizing: "border-box" }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Date</div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: "100%", padding: "11px 12px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, fontFamily: "inherit", outline: "none", color: C.text, background: C.cardAlt, boxSizing: "border-box" }} />
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, marginTop: 4 }}>Category</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)} style={{
                padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                background: category === c.id ? C.primary : C.card,
                color: category === c.id ? "#fff" : C.muted,
                border: `1.5px solid ${category === c.id ? C.primary : C.border}`,
              }}>{c.icon} {c.label}</button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Was this a…</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {NECESSITY.map(n => (
              <button key={n.id} onClick={() => setNecessity(n.id)} style={{
                flex: 1, padding: "10px 6px", borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                background: necessity === n.id ? n.bg : C.card,
                color: necessity === n.id ? n.color : C.muted,
                border: `1.5px solid ${necessity === n.id ? n.border : C.border}`,
              }}>{n.label}</button>
            ))}
          </div>
          <Btn onClick={addTransaction} style={{ width: "100%", padding: "13px 18px", fontSize: 14 }}>Add Transaction</Btn>
        </Card>
      )}

      {byCategory.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>By Category</div>
          {byCategory.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 18, width: 24 }}>{c.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{c.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{fmt(c.amount)}</span>
                </div>
                <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${total > 0 ? Math.min((c.amount / total) * 100, 100) : 0}%`, background: C.primary, borderRadius: 3 }} />
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {transactions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[{ id: "all", label: "All" }, ...NECESSITY].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: "7px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === f.id ? C.primary : C.card,
              color: filter === f.id ? "#fff" : C.muted,
              border: `1.5px solid ${filter === f.id ? C.primary : C.border}`,
            }}>{f.label}</button>
          ))}
        </div>
      )}

      {transactions.length === 0 && (
        <Card style={{ textAlign: "center", padding: 36 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🧾</div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>No transactions yet</div>
          <div style={{ fontSize: 13, color: C.muted }}>Add your recent purchases and let AI flag what's costing you.</div>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(tx => {
          const nec = NECESSITY.find(n => n.id === tx.necessity);
          const cat = CATEGORIES.find(c => c.id === tx.category);
          return (
            <div key={tx.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: C.shadow }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{cat?.icon || "📦"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.desc}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{tx.date} · {cat?.label}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{fmt(tx.amount)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: nec?.color, background: nec?.bg, border: `1px solid ${nec?.border}`, padding: "2px 8px", borderRadius: 999 }}>{nec?.label}</span>
              </div>
              <button onClick={() => deleteTransaction(tx.id)} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 16, padding: 4, flexShrink: 0 }}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DEBT PAYOFF SIMULATOR ────────────────────────────────────────────────────
// Real data sources: Experian Q1 2025, Federal Reserve G.19, Bankrate 2026
const DEBT_TYPES = [
  {
    id: "credit_card", label: "Credit Card", icon: "💳",
    color: "#dc2626",
    defaultAPR: 23.4,    // Federal Reserve avg APR for accounts assessed interest, 2024
    defaultBalance: 6618, // Experian avg credit card balance Q1 2025
    minPaymentPct: 0.02, // Industry standard: max(2% of balance, $25)
    minFloor: 25,
    note: "Avg APR 23.4% (Fed Reserve 2025). Highest-cost consumer debt.",
  },
  {
    id: "personal_loan", label: "Personal Loan", icon: "🏦",
    color: "#7c3aed",
    defaultAPR: 12.26,   // Bankrate avg personal loan rate Feb 2026
    defaultBalance: 11724, // Avg personal loan balance 2025
    minPaymentPct: null,  // Fixed payment loans — user enters payment
    minFloor: null,
    note: "Avg APR 12.26% (Bankrate Feb 2026). Fixed term, fixed payment.",
  },
  {
    id: "auto_loan", label: "Auto Loan", icon: "🚗",
    color: "#d97706",
    defaultAPR: 8.98,    // Blended avg (6.56% new, 11.40% used) Experian Q3 2025
    defaultBalance: 24602, // Experian avg auto balance Q3 2025
    minPaymentPct: null,
    minFloor: null,
    note: "Avg APR 6.56% new / 11.40% used (Experian Q3 2025). Secured debt.",
  },
  {
    id: "student_loan", label: "Student Loan", icon: "🎓",
    color: "#0284c7",
    defaultAPR: 6.39,    // Federal undergraduate rate 2025-26
    defaultBalance: 38375, // Avg federal student loan balance 2025
    minPaymentPct: null,
    minFloor: null,
    note: "Federal undergrad: 6.39% (2025-26). Grad/PLUS: up to 8.94%.",
  },
  {
    id: "medical", label: "Medical Debt", icon: "🏥",
    color: "#0f766e",
    defaultAPR: 0,       // Often 0% if on payment plan; can be sent to collections
    defaultBalance: 2500,
    minPaymentPct: null,
    minFloor: null,
    note: "Often 0% on payment plans. ~$220B total US medical debt (CFPB 2024).",
  },
  {
    id: "other", label: "Other / BNPL", icon: "📋",
    color: "#475569",
    defaultAPR: 15.0,
    defaultBalance: 3000,
    minPaymentPct: null,
    minFloor: null,
    note: "Custom: store cards, BNPL, family loans, etc.",
  },
];

// Calculate minimum payment for credit cards: max(balance * pct, floor) 
function calcMinPayment(debt) {
  if (debt.type === "credit_card") {
    const pctAmt = debt.balance * 0.02;
    return Math.max(pctAmt, 25, debt.balance > 0 ? Math.min(debt.balance, 25) : 0);
  }
  return debt.payment || 0;
}

// Core amortization engine — runs a single debt to payoff with optional extra payment
// Returns array of month objects and totals
function amortizeDebt(balance, aprPct, monthlyPayment) {
  if (balance <= 0 || monthlyPayment <= 0) return { months: [], totalInterest: 0, payoffMonths: 0 };
  const monthlyRate = aprPct / 100 / 12;
  const months = [];
  let bal = balance;
  let totalInterest = 0;
  let mo = 0;
  while (bal > 0.005 && mo < 600) {
    const interest = bal * monthlyRate;
    const principal = Math.min(monthlyPayment - interest, bal);
    if (principal <= 0 && monthlyPayment < interest) { 
      // Payment doesn't cover interest — debt grows
      months.push({ mo: mo + 1, balance: bal, interest, principal: 0, payment: monthlyPayment });
      bal += (interest - monthlyPayment);
      mo++;
      if (mo >= 600) break;
      continue;
    }
    totalInterest += interest;
    bal = Math.max(0, bal - principal);
    months.push({ mo: mo + 1, balance: bal, interest: Math.round(interest * 100) / 100, principal: Math.round(principal * 100) / 100, payment: monthlyPayment });
    mo++;
  }
  return { months, totalInterest, payoffMonths: mo };
}

// Avalanche: sort debts by APR descending, apply extra to highest APR first
// Snowball: sort debts by balance ascending, apply extra to smallest first
function runStrategy(debts, extraPayment, strategyType) {
  if (!debts.length) return { schedule: [], totalInterest: 0, payoffMonths: 0, monthlyData: [] };
  
  // Clone debts with mutable balances
  let pool = debts.map(d => ({ ...d, bal: d.balance, done: false }));
  
  // Sort order for focus debt
  const sorted = [...pool].sort((a, b) =>
    strategyType === "avalanche" ? b.apr - a.apr : a.bal - b.bal
  );
  
  let totalInterest = 0;
  let month = 0;
  const monthlyData = [];
  const maxMonths = 600;
  
  // Total minimum payments committed
  const getTotalMins = (pool) => pool.filter(d => !d.done).reduce((s, d) => {
    if (d.type === "credit_card") return s + Math.max(d.bal * 0.02, 25);
    return s + (d.payment || 0);
  }, 0);
  
  while (pool.some(d => !d.done) && month < maxMonths) {
    month++;
    let monthInterest = 0;
    let monthPrincipal = 0;
    let totalBal = 0;
    
    // Determine focus debt (not done, first in sorted order)
    const focusId = sorted.find(d => !pool.find(p => p.id === d.id)?.done)?.id;
    
    // Extra payment released from paid-off debts (snowball/avalanche rollover)
    let availableExtra = extraPayment;
    
    for (let d of pool) {
      if (d.done) continue;
      const rate = d.apr / 100 / 12;
      const interest = d.bal * rate;
      monthInterest += interest;
      totalInterest += interest;
      
      // Minimum payment for this debt
      let minPay = d.type === "credit_card"
        ? Math.max(d.bal * 0.02, 25)
        : (d.payment || 0);
      minPay = Math.min(minPay, d.bal + interest);
      
      let pay = minPay;
      // Apply extra to focus debt
      if (d.id === focusId) {
        pay = Math.min(d.bal + interest, minPay + availableExtra);
      }
      
      const principal = Math.min(pay - interest, d.bal);
      if (principal >= 0) {
        d.bal = Math.max(0, d.bal - principal);
        monthPrincipal += principal;
      }
      
      if (d.bal < 0.01) {
        // Debt paid off — roll minimum into extra for next month
        availableExtra += (d.type === "credit_card" ? Math.max(d.bal * 0.02, 25) : (d.payment || 0));
        d.done = true;
        d.bal = 0;
      }
      totalBal += d.bal;
    }
    
    monthlyData.push({
      mo: month,
      label: month % 12 === 0 ? `Yr ${month/12}` : (month % 6 === 0 ? `M${month}` : ""),
      balance: Math.round(totalBal),
      interest: Math.round(monthInterest),
      principal: Math.round(monthPrincipal),
    });
    
    if (totalBal < 0.01) break;
  }
  
  return { totalInterest: Math.round(totalInterest), payoffMonths: month, monthlyData };
}

function DebtPayoffSim({ user, onSave }) {
  const [debts, setDebts] = useState([
    { id: "1", name: "Visa Credit Card", type: "credit_card", balance: 6618, apr: 23.4, payment: 181 },
    { id: "2", name: "Auto Loan", type: "auto_loan", balance: 24602, apr: 8.98, payment: 468 },
  ]);
  const [extraPayment, setExtraPayment] = useState(200);
  const [strategy, setStrategy] = useState("avalanche");
  const [income, setIncome] = useState(4500);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newDebt, setNewDebt] = useState({ name: "", type: "credit_card", balance: "", apr: "", payment: "" });
  const [showChart, setShowChart] = useState("balance");

  // Validate debts have required fields
  const validDebts = debts.filter(d => d.balance > 0 && d.apr >= 0 && d.payment > 0);

  // Run both strategies for comparison
  const avalancheResult = runStrategy(validDebts, extraPayment, "avalanche");
  const snowballResult  = runStrategy(validDebts, extraPayment, "snowball");
  const currentResult   = strategy === "avalanche" ? avalancheResult : snowballResult;

  // Minimum-only result (no extra payment)
  const minOnlyResult = runStrategy(validDebts, 0, "avalanche");

  const totalBalance    = validDebts.reduce((s, d) => s + d.balance, 0);
  const totalMinMonthly = validDebts.reduce((s, d) => {
    if (d.type === "credit_card") return s + Math.max(d.balance * 0.02, 25);
    return s + (d.payment || 0);
  }, 0);
  const totalMonthly    = totalMinMonthly + extraPayment;

  const interestSaved   = minOnlyResult.totalInterest - currentResult.totalInterest;
  const monthsSaved     = minOnlyResult.payoffMonths - currentResult.payoffMonths;

  const score = Math.max(0, Math.min(100,
    (currentResult.payoffMonths <= 24 ? 50 : currentResult.payoffMonths <= 48 ? 35 : currentResult.payoffMonths <= 72 ? 20 : 8) +
    (extraPayment >= 300 ? 25 : extraPayment >= 100 ? 15 : 5) +
    (totalBalance < 10000 ? 25 : totalBalance < 30000 ? 15 : totalBalance < 60000 ? 8 : 2)
  ));

  const fmtMonths = (m) => {
    if (m >= 600) return "Never (payment < interest)";
    if (m <= 0) return "Already paid off";
    const yrs = Math.floor(m / 12);
    const mos = m % 12;
    if (yrs === 0) return `${mos}mo`;
    if (mos === 0) return `${yrs}yr`;
    return `${yrs}yr ${mos}mo`;
  };

  const addDebt = () => {
    if (!newDebt.name || !newDebt.balance || !newDebt.apr) return;
    const typeInfo = DEBT_TYPES.find(t => t.id === newDebt.type);
    const bal = parseFloat(newDebt.balance) || 0;
    const payment = newDebt.payment ? parseFloat(newDebt.payment) :
      (newDebt.type === "credit_card" ? Math.max(bal * 0.02, 25) : Math.round(bal / 36));
    setDebts([...debts, {
      id: Date.now().toString(),
      name: newDebt.name,
      type: newDebt.type,
      balance: bal,
      apr: parseFloat(newDebt.apr) || 0,
      payment,
    }]);
    setNewDebt({ name: "", type: "credit_card", balance: "", apr: "", payment: "" });
    setShowAddDebt(false);
  };

  const updateDebt = (id, field, val) => {
    setDebts(debts.map(d => d.id === id ? { ...d, [field]: field === "name" || field === "type" ? val : parseFloat(val) || 0 } : d));
  };

  const removeDebt = (id) => setDebts(debts.filter(d => d.id !== id));

  const { text: aiText, loading: aiLoading } = useAI(
    validDebts.length > 0
      ? `Debt payoff plan: ${validDebts.length} debts totaling ${fmt(totalBalance)}. Strategy: ${strategy}. Monthly payment: ${fmt(totalMonthly)} (${fmt(extraPayment)} extra above minimums). Payoff in ${fmtMonths(currentResult.payoffMonths)}. Total interest: ${fmt(currentResult.totalInterest)}. Interest saved vs minimums: ${fmt(interestSaved)}. Monthly income: ${fmt(income)} — debt payments are ${Math.round((totalMonthly/income)*100)}% of income. Top debt by APR: ${[...validDebts].sort((a,b)=>b.apr-a.apr)[0]?.name} at ${[...validDebts].sort((a,b)=>b.apr-a.apr)[0]?.apr}%. Give honest, direct advice about this debt situation. Be specific — name their debts, call out the credit card interest cost, tell them exactly what the extra payment is saving them.`
      : null,
    [validDebts.length, totalBalance, extraPayment, strategy, income]
  );

  const handleSave = () => {
    if (!user) return alert("Create an account to save scenarios!");
    onSave({
      id: Date.now().toString(), type: "debt", icon: "💳",
      label: `Debt Payoff — ${fmtMonths(currentResult.payoffMonths)} to freedom`,
      date: new Date().toLocaleDateString(),
      data: { totalBalance, totalMonthly, payoffMonths: currentResult.payoffMonths, totalInterest: currentResult.totalInterest, interestSaved, strategy, score }
    });
  };

  const debtColors = { credit_card: "#dc2626", personal_loan: "#7c3aed", auto_loan: "#d97706", student_loan: "#0284c7", medical: "#0f766e", other: "#475569" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* DEBT LIST */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>💳 Your Debts</div>
          <Btn onClick={() => setShowAddDebt(v => !v)} variant="outline" style={{ fontSize: 11, padding: "5px 12px" }}>
            {showAddDebt ? "✕ Cancel" : "+ Add Debt"}
          </Btn>
        </div>

        {/* Add debt form */}
        {showAddDebt && (
          <div style={{ background: "#faf5ff", border: "1.5px solid #7c3aed", borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 10 }}>New Debt</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Debt Name</div>
              <input value={newDebt.name} onChange={e => setNewDebt(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Chase Sapphire, Car Loan..."
                style={{ width: "100%", padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Debt Type</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {DEBT_TYPES.map(t => (
                <button key={t.id} onClick={() => {
                  const typeInfo = DEBT_TYPES.find(x => x.id === t.id);
                  setNewDebt(p => ({ ...p, type: t.id, apr: typeInfo.defaultAPR.toString(), balance: typeInfo.defaultBalance.toString() }));
                }} style={{ padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  background: newDebt.type === t.id ? t.color : C.card, color: newDebt.type === t.id ? "#fff" : C.muted,
                  border: `1.5px solid ${newDebt.type === t.id ? t.color : C.border}` }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, fontStyle: "italic" }}>
              {DEBT_TYPES.find(t => t.id === newDebt.type)?.note}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
              {[["Balance ($)", "balance"], ["APR (%)", "apr"], ["Monthly Payment ($)", "payment"]].map(([lbl, key]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>{lbl}</div>
                  <input type="number" value={newDebt[key]} onChange={e => setNewDebt(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={key === "payment" ? "Auto" : "0"}
                    style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
            <Btn onClick={addDebt} style={{ width: "100%", padding: "10px" }}>Add to List</Btn>
          </div>
        )}

        {/* Debt rows */}
        {debts.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 13 }}>No debts added yet. Tap + Add Debt.</div>
        )}
        {debts.map(d => {
          const typeInfo = DEBT_TYPES.find(t => t.id === d.type);
          const col = debtColors[d.type] || C.muted;
          const isEditing = editingId === d.id;
          return (
            <div key={d.id} style={{ borderRadius: 12, border: `1.5px solid ${C.border}`, marginBottom: 8, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: isEditing ? `${col}08` : C.cardAlt }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{typeInfo?.icon || "📋"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <input value={d.name} onChange={e => updateDebt(d.id, "name", e.target.value)}
                      style={{ width: "100%", padding: "5px 8px", border: `1.5px solid ${col}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", fontWeight: 700 }} />
                  ) : (
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{typeInfo?.label} · {d.apr}% APR</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: col }}>{fmt(d.balance)}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{fmt(d.payment)}/mo</div>
                </div>
                <button onClick={() => setEditingId(isEditing ? null : d.id)}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, padding: 4, flexShrink: 0 }}>
                  {isEditing ? "✓" : "✏️"}
                </button>
                <button onClick={() => removeDebt(d.id)}
                  style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 15, padding: 4, flexShrink: 0 }}>✕</button>
              </div>
              {isEditing && (
                <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: `${col}06` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[["Balance ($)", "balance"], ["APR (%)", "apr"], ["Monthly ($)", "payment"]].map(([lbl, key]) => (
                      <div key={key}>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 3 }}>{lbl}</div>
                        <input type="number" value={d[key]} onChange={e => updateDebt(d.id, key, e.target.value)}
                          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${col}`, borderRadius: 8, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 8, fontStyle: "italic" }}>
                    {DEBT_TYPES.find(t => t.id === d.type)?.note}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Total bar */}
        {debts.length > 0 && (
          <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, textTransform: "uppercase" }}>Total Debt</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#dc2626" }}>{fmt(totalBalance)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Min. monthly</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{fmt(totalMinMonthly)}</div>
            </div>
          </div>
        )}
      </Card>

      {/* STRATEGY + EXTRA PAYMENT */}
      <Card>
        <div style={{ fontSize: 11, color: C.primary, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>⚡ Payoff Strategy</div>

        {/* Strategy toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[
            { id: "avalanche", icon: "🏔️", title: "Avalanche", sub: "Highest APR first", detail: "Saves the most money in interest. Best if you're analytical and can stay the course." },
            { id: "snowball",  icon: "❄️", title: "Snowball",  sub: "Smallest balance first", detail: "Fastest psychological wins. Best if you need motivation to keep going." },
          ].map(s => (
            <button key={s.id} onClick={() => setStrategy(s.id)} style={{
              padding: "12px 14px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              background: strategy === s.id ? C.primaryLight : C.cardAlt,
              border: `1.5px solid ${strategy === s.id ? C.primary : C.border}`,
            }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: strategy === s.id ? C.primary : C.text }}>{s.title}</div>
              <div style={{ fontSize: 10, color: strategy === s.id ? C.primary : C.muted, fontWeight: 600 }}>{s.sub}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{s.detail}</div>
            </button>
          ))}
        </div>

        {/* Extra payment input */}
        <div style={{ marginBottom: 14 }}>
          <NumInput label="Extra Monthly Payment (above minimums)" value={extraPayment} onChange={setExtraPayment} accentColor={C.primary} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: -6 }}>
            Total committed: {fmt(totalMonthly)}/mo · {income > 0 ? Math.round((totalMonthly/income)*100) : 0}% of income
          </div>
        </div>
        <NumInput label="Monthly Take-Home Income" value={income} onChange={setIncome} accentColor={C.green} />

        {/* Strategy comparison */}
        {validDebts.length > 0 && (
          <div style={{ background: C.cardAlt, borderRadius: 12, padding: "12px 14px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 10 }}>Strategy Comparison</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              {[
                { label: "Avalanche", months: avalancheResult.payoffMonths, interest: avalancheResult.totalInterest, color: "#0284c7" },
                { label: "Snowball",  months: snowballResult.payoffMonths,  interest: snowballResult.totalInterest,  color: "#7c3aed" },
                { label: "Min. Only", months: minOnlyResult.payoffMonths,   interest: minOnlyResult.totalInterest,   color: "#dc2626" },
              ].map(r => (
                <div key={r.label} style={{ background: strategy.toLowerCase() === r.label.toLowerCase() ? `${r.color}10` : "transparent", borderRadius: 10, padding: "8px 6px", border: `1px solid ${strategy.toLowerCase() === r.label.toLowerCase() ? r.color : "transparent"}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: r.color, marginBottom: 4 }}>{r.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: r.color }}>{fmtMonths(r.months)}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{fmt(r.interest)} interest</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* RESULTS SUMMARY */}
      {validDebts.length > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <ScoreRing score={score} />
            <div style={{ flex: 1, paddingLeft: 16 }}>
              <StatRow label="Payoff Date" value={fmtMonths(currentResult.payoffMonths)} color={currentResult.payoffMonths <= 36 ? C.green : currentResult.payoffMonths <= 72 ? "#d97706" : "#dc2626"} />
              <StatRow label="Total Interest" value={fmt(currentResult.totalInterest)} color="#dc2626" />
              <StatRow label="Interest Saved vs Min-Only" value={fmt(interestSaved)} color={C.green} />
              <StatRow label="Time Saved vs Min-Only" value={monthsSaved > 0 ? fmtMonths(monthsSaved) : "—"} color={C.green} />
              <StatRow label="Debt-to-Income (payments)" value={`${Math.round((totalMonthly/income)*100)}%`} color={totalMonthly/income <= 0.15 ? C.green : totalMonthly/income <= 0.25 ? "#d97706" : "#dc2626"} sub="Experts suggest under 20%" />
            </div>
          </div>

          {/* Debt priority order */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>
              {strategy === "avalanche" ? "🏔️ Avalanche Order (highest APR → lowest)" : "❄️ Snowball Order (smallest balance → largest)"}
            </div>
            {[...validDebts]
              .sort((a, b) => strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance)
              .map((d, i) => {
                const col = debtColors[d.type] || C.muted;
                const individual = amortizeDebt(d.balance, d.apr, d.payment);
                return (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 22, height: 22, borderRadius: 999, background: col, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{d.name}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{d.apr}% APR · {fmt(d.balance)} balance</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 11, color: C.muted }}>
                      <div style={{ fontWeight: 700, color: col }}>{fmtMonths(individual.payoffMonths)}</div>
                      <div>{fmt(individual.totalInterest)} interest</div>
                    </div>
                  </div>
                );
              })}
          </div>

          <AIInsight text={aiText} loading={aiLoading} />
          <div style={{ marginTop: 14 }}>
            <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
          </div>
        </Card>
      )}

      {/* PAYOFF CHART */}
      {validDebts.length > 0 && currentResult.monthlyData.length > 0 && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Payoff Timeline</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["balance", "interest"].map(t => (
                <button key={t} onClick={() => setShowChart(t)} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  background: showChart === t ? C.primary : C.card, color: showChart === t ? "#fff" : C.muted, border: `1.5px solid ${showChart === t ? C.primary : C.border}` }}>
                  {t === "balance" ? "Balance" : "Interest/mo"}
                </button>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={currentResult.monthlyData.filter((_, i) => i % Math.max(1, Math.floor(currentResult.monthlyData.length / 36)) === 0)}>
              <defs>
                <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="intGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d97706" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#d97706" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
              <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 10 }} />
              <Tooltip formatter={(v, n) => [fmt(v), n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
              {showChart === "balance"
                ? <Area type="monotone" dataKey="balance" name="Total Balance" stroke="#dc2626" fill="url(#debtGrad)" strokeWidth={2} />
                : <Area type="monotone" dataKey="interest" name="Monthly Interest" stroke="#d97706" fill="url(#intGrad)" strokeWidth={2} />
              }
            </AreaChart>
          </ResponsiveContainer>

          {/* Key milestone callouts */}
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#fef2f2", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>If minimum only</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#dc2626" }}>{fmtMonths(minOnlyResult.payoffMonths)}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{fmt(minOnlyResult.totalInterest)} total interest</div>
            </div>
            <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase" }}>With your plan</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.green }}>{fmtMonths(currentResult.payoffMonths)}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{fmt(currentResult.totalInterest)} total interest</div>
            </div>
          </div>
        </Card>
      )}

      {/* RATE BENCHMARKS */}
      <Card>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>📊 Current Rate Benchmarks</div>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>Source: Federal Reserve, Experian, Bankrate (2025–2026)</div>
        {DEBT_TYPES.map(t => (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>{t.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{t.label}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{t.note}</div>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.color }}>{t.defaultAPR}%</div>
              <div style={{ fontSize: 10, color: C.muted }}>avg APR</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}


// ─── NEWS PAGE ────────────────────────────────────────────────────────────────
function NewsPage({ user }) {
  const savedPrefs = NewsStore.getPrefs();
  const [topics, setTopics] = useState(savedPrefs?.topics || ["housing", "interest", "inflation"]);
  const [lifeStage, setLifeStage] = useState(savedPrefs?.lifeStage || "young_adult");
  const [allArticles, setAllArticles] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showPrefs, setShowPrefs] = useState(!savedPrefs);
  const [recommendation, setRecommendation] = useState("");
  const [recLoading, setRecLoading] = useState(false);
  const [expandedArticle, setExpandedArticle] = useState(null);

  const LIFE_STAGES = [
    { id: "student",      label: "Student",          icon: "🎓", desc: "College, student loans, first income" },
    { id: "young_adult",  label: "Young Adult",       icon: "🚀", desc: "First job, moving out, building credit" },
    { id: "family",       label: "Starting a Family", icon: "👨‍👩‍👧", desc: "Marriage, kids, home buying" },
    { id: "established",  label: "Established",       icon: "🏡", desc: "Homeowner, investing, career growth" },
    { id: "pre_retire",   label: "Pre-Retirement",    icon: "⏳", desc: "Paying off debt, maximizing savings" },
  ];

  const toggleTopic = (id) => setTopics(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const savePrefs = () => {
    const prefs = { topics, lifeStage };
    NewsStore.setPrefs(prefs);
    setShowPrefs(false);
    filterArticles(allArticles, prefs);
  };

  // Load articles from Supabase
  const loadArticles = async () => {
    setLoading(true);
    setRecommendation("");
    try {
      const { data } = await sb.from("news_articles")
        .select("*")
        .eq("is_active", true)
        .order("published_at", { ascending: false });
      const all = data || [];
      setAllArticles(all);
      const prefs = NewsStore.getPrefs();
      filterArticles(all, prefs);
      // Build news context for AI insights
      if (all.length > 0) {
        const ctx = all.slice(0, 10).map(a => `${a.title}: ${a.summary}`).join(" | ");
        NewsStore.set(ctx);
      }
    } catch { }
    setLoading(false);
  };

  // Filter articles by user prefs
  const filterArticles = (all, prefs) => {
    if (!prefs || !all.length) { setArticles(all); return; }
    const filtered = all.filter(a => {
      const topicMatch = !prefs.topics?.length || (a.topics || []).some(t => prefs.topics.includes(t));
      const stageMatch = !a.life_stages?.length || (a.life_stages || []).includes(prefs.lifeStage);
      return topicMatch || stageMatch;
    });
    setArticles(filtered.length > 0 ? filtered : all);
  };

  // Generate AI recommendation based on articles + user scenario
  const generateRecommendation = async () => {
    if (!articles.length) return;
    setRecLoading(true);
    setRecommendation("");
    const prefs = NewsStore.getPrefs();
    const stage = LIFE_STAGES.find(s => s.id === prefs?.lifeStage);
    const articleContext = articles.slice(0, 8).map((a, i) =>
      `Article ${i+1}: "${a.title}"\nSummary: ${a.summary}\nImpact: ${a.impact || ""}\nTopics: ${(a.topics||[]).join(", ")}`
    ).join("\n\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system: `You are a financial news analyst giving personalized recommendations — NOT advice. You weigh multiple articles against a user's situation and present options with evidence. Always cite specific articles by name. Never tell the user what to do — instead present what the evidence suggests and let them decide. Use plain conversational language. Format with clear paragraphs. Max 4 paragraphs.`,
          messages: [{
            role: "user",
            content: `User profile: ${stage?.label || "Young Adult"} — ${stage?.desc || "building financial foundation"}.
Their selected topics of interest: ${(prefs?.topics || []).join(", ")}.

Here are the current articles in their feed:

${articleContext}

Based on these articles, give this user a personalized recommendation. Weigh what the articles say against their life stage. Reference specific article titles as evidence. Present options and tradeoffs — don't tell them what to do. End with what questions they should be asking themselves given this information.`
          }]
        })
      });
      const d = await res.json();
      setRecommendation(d.content?.[0]?.text || "");
    } catch { setRecommendation("Could not generate recommendation. Try again."); }
    setRecLoading(false);
  };

  // Auto-load on mount
  useEffect(() => { loadArticles(); }, []);

  // Re-filter when prefs change
  useEffect(() => {
    const prefs = NewsStore.getPrefs();
    if (allArticles.length) filterArticles(allArticles, prefs);
  }, [allArticles]);

  const urgencyBg = { high: "rgba(220,38,38,0.07)", medium: "rgba(245,158,11,0.07)", low: C.cardAlt };
  const urgencyBorder = { high: "rgba(220,38,38,0.2)", medium: "rgba(245,158,11,0.25)", low: C.border };
  const sentimentColor = { positive: C.green, negative: C.red, neutral: C.primary };

  const displayed = activeFilter === "all" ? articles : articles.filter(a => (a.topics||[]).includes(activeFilter));
  const prefs = NewsStore.getPrefs();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header */}
      <Card style={{ background: C.bg === "#0a0f1e" ? "linear-gradient(135deg, #0f172a, #1e3a5f)" : "linear-gradient(135deg, #0f172a, #1e3a5f)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>📰 Financial News Feed</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", marginBottom: 4 }}>
              {allArticles.length > 0 ? `${articles.length} Articles For You` : "Your News Feed"}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {prefs ? LIFE_STAGES.find(s => s.id === prefs.lifeStage)?.label : "Set preferences to personalize"}
              {allArticles.length > 0 && ` · ${allArticles.length} total articles`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadArticles} disabled={loading} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {loading ? "⟳" : "↻ Refresh"}
            </button>
            <button onClick={() => setShowPrefs(v => !v)} style={{ background: showPrefs ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              ⚙ Prefs
            </button>
          </div>
        </div>
        <div style={{ background: "rgba(37,99,235,0.25)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 999, background: NewsStore.get() ? "#4ade80" : "#94a3b8", flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: "#bfdbfe" }}>
            {NewsStore.get() ? "✦ AI insights are using your news feed as context" : "Loading news context for AI insights…"}
          </div>
        </div>
      </Card>

      {/* Preferences panel */}
      {showPrefs && (
        <Card style={{ border: `1.5px solid ${C.primary}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 14 }}>⚙ Your News Preferences</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Your Life Stage</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {LIFE_STAGES.map(s => (
                <button key={s.id} onClick={() => setLifeStage(s.id)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", background: lifeStage === s.id ? C.primaryLight : C.cardAlt, border: `1.5px solid ${lifeStage === s.id ? C.primary : C.border}` }}>
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 13, color: lifeStage === s.id ? C.primary : C.text }}>{s.label}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: C.muted }}>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Topics to Follow</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {NEWS_TOPICS.map(t => {
                const on = topics.includes(t.id);
                return (
                  <button key={t.id} onClick={() => toggleTopic(t.id)} style={{ textAlign: "left", padding: "10px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", background: on ? "rgba(15,118,110,0.07)" : C.cardAlt, border: `1.5px solid ${on ? C.green : C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: 15 }}>{t.icon}</span>
                      <span style={{ marginLeft: 8, fontWeight: 700, fontSize: 13, color: on ? C.green : C.text }}>{t.label}</span>
                      <div style={{ fontSize: 11, color: C.muted, marginLeft: 23, marginTop: 2 }}>{t.desc}</div>
                    </div>
                    <span style={{ fontSize: 16, color: on ? C.green : "#cbd5e1" }}>{on ? "✓" : "○"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Btn onClick={savePrefs} style={{ width: "100%", padding: "13px" }}>Save & Apply Preferences</Btn>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📰</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 8 }}>Loading your feed…</div>
          <div style={{ fontSize: 12, color: C.muted }}>Pulling articles from the database</div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 6 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: 999, background: C.primary, opacity: 0.4, animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
          </div>
          <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}`}</style>
        </Card>
      )}

      {/* AI Recommendation Engine */}
      {!loading && articles.length > 0 && (
        <div style={{ background: C.bg === "#0a0f1e" ? "linear-gradient(135deg, #0f172a, #1a1f35)" : "linear-gradient(135deg, #eff6ff, #f0fdf4)", border: `1.5px solid ${C.primary}40`, borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: recommendation || recLoading ? 14 : 0 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.primary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>✦ AI Recommendation Engine</div>
              <div style={{ fontSize: 12, color: C.muted }}>Weighs your articles against your life stage — not advice, just options</div>
            </div>
            <Btn onClick={generateRecommendation} style={{ opacity: recLoading ? 0.7 : 1, fontSize: 12, padding: "8px 14px", flexShrink: 0 }}>
              {recLoading ? "Analyzing…" : recommendation ? "↺ Refresh" : "✦ Analyze My Feed"}
            </Btn>
          </div>
          {recLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: 999, background: C.primary, opacity: 0.4, animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>Reading your articles and building your recommendation…</div>
            </div>
          )}
          {recommendation && !recLoading && (
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.8, borderTop: `1px solid ${C.border}`, paddingTop: 14, whiteSpace: "pre-wrap" }}>
              {recommendation}
            </div>
          )}
        </div>
      )}

      {/* Topic filter pills */}
      {!loading && articles.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          <button onClick={() => setActiveFilter("all")} style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", background: activeFilter === "all" ? C.primary : C.card, color: activeFilter === "all" ? "#fff" : C.muted, border: `1.5px solid ${activeFilter === "all" ? C.primary : C.border}` }}>
            All ({articles.length})
          </button>
          {NEWS_TOPICS.filter(t => articles.some(a => (a.topics||[]).includes(t.id))).map(t => (
            <button key={t.id} onClick={() => setActiveFilter(t.id)} style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", background: activeFilter === t.id ? C.primary : C.card, color: activeFilter === t.id ? "#fff" : C.muted, border: `1.5px solid ${activeFilter === t.id ? C.primary : C.border}` }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Article cards */}
      {!loading && displayed.map((article, i) => {
        const topicInfo = NEWS_TOPICS.find(t => (article.topics||[]).includes(t.id));
        const isExpanded = expandedArticle === (article.id || i);
        const uBg = urgencyBg[article.urgency] || C.cardAlt;
        const uBorder = urgencyBorder[article.urgency] || C.border;
        const sColor = sentimentColor[article.sentiment] || C.muted;
        return (
          <div key={article.id || i} style={{ background: uBg, border: `1.5px solid ${uBorder}`, borderRadius: 16, padding: 16, position: "relative", overflow: "hidden", cursor: "pointer" }}
            onClick={() => setExpandedArticle(isExpanded ? null : (article.id || i))}>
            {article.urgency === "high" && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: C.red, borderRadius: "16px 0 0 16px" }} />}
            <div style={{ paddingLeft: article.urgency === "high" ? 8 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(article.topics||[]).slice(0,2).map(tid => {
                    const ti = NEWS_TOPICS.find(x => x.id === tid);
                    return ti ? <span key={tid} style={{ fontSize: 10, fontWeight: 700, color: C.muted, background: C.card, border: `1px solid ${C.border}`, padding: "2px 8px", borderRadius: 999 }}>{ti.icon} {ti.label}</span> : null;
                  })}
                  {article.urgency === "high" && <span style={{ fontSize: 10, fontWeight: 700, color: C.red, background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", padding: "2px 8px", borderRadius: 999 }}>⚡ High Impact</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 999, background: sColor }} title={article.sentiment} />
                  <span style={{ fontSize: 10, color: C.muted }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.4, marginBottom: 6 }}>{article.title}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: isExpanded ? 10 : 0 }}>{article.summary}</div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {article.impact && (
                    <div style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.12)", borderRadius: 9, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.primary, marginBottom: 4, textTransform: "uppercase" }}>💡 How This Affects You</div>
                      <div style={{ fontSize: 12, color: C.primary, lineHeight: 1.6 }}>{article.impact}</div>
                    </div>
                  )}
                  {article.source_url && (
                    <a href={article.source_url} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 12, color: C.primary, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      📎 Read full source article ↗
                    </a>
                  )}
                  <div style={{ fontSize: 10, color: C.muted }}>
                    Published {new Date(article.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {!loading && !articles.length && !showPrefs && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📰</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 8 }}>No articles available yet</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>The admin hasn't published any articles yet. Check back soon.</div>
        </Card>
      )}

    </div>
  );
}

// ─── REVIEWS PAGE ────────────────────────────────────────────────────────────
function ReviewsPage({ user, showToast, onNavigate }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [name, setName] = useState(user?.name || "");
  const [body, setBody] = useState("");
  const [scenario, setScenario] = useState("");

  const SCENARIOS = [
    "Moving Out", "Car Ownership", "Debt Payoff", "Recession Prep",
    "Project Planning", "Home Buying", "General Financial Planning", "Other"
  ];

  useEffect(() => { loadReviews(); }, []);

  const loadReviews = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("reviews")
        .select("*")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      setReviews(data || []);
    } catch {}
    setLoading(false);
  };

  const submitReview = async () => {
    if (!body.trim() || !name.trim()) return;
    setSubmitting(true);
    try {
      await sb.from("reviews").insert({
        user_id: user?.id || null,
        name: name.trim(),
        body: body.trim(),
        rating,
        scenario: scenario || null,
        status: "pending"
      });
      setSubmitted(true);
      setShowForm(false);
    } catch { showToast("Could not submit review. Please try again.", "err"); }
    setSubmitting(false);
  };

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 5), 0) / reviews.length).toFixed(1) : null;
  const ratingCounts = [5,4,3,2,1].map(n => ({ n, count: reviews.filter(r => r.rating === n).length }));

  const StarRow = ({ value, interactive = false, size = 18 }) => (
    <div style={{ display: "flex", gap: 3 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i}
          onClick={interactive ? () => setRating(i) : undefined}
          onMouseEnter={interactive ? () => setHoverRating(i) : undefined}
          onMouseLeave={interactive ? () => setHoverRating(0) : undefined}
          style={{ fontSize: size, cursor: interactive ? "pointer" : "default", color: i <= (interactive ? (hoverRating || rating) : value) ? "#f59e0b" : "#d1d5db", transition: "color 0.1s" }}>★</span>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a, #1e3a5f)", borderRadius: 20, padding: 22 }}>
        <div style={{ fontSize: 11, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>⭐ Real Reviews</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginBottom: 4 }}>What People Are Saying</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>Honest feedback from people who ran the numbers before making big decisions.</div>

        {/* Rating summary */}
        {reviews.length > 0 && (
          <div style={{ display: "flex", gap: 16, alignItems: "center", background: "rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 42, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{avgRating}</div>
              <StarRow value={Math.round(avgRating)} size={14} />
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{reviews.length} review{reviews.length !== 1 ? "s" : ""}</div>
            </div>
            <div style={{ flex: 1 }}>
              {ratingCounts.map(({ n, count }) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8", width: 8 }}>{n}</span>
                  <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "#f59e0b", borderRadius: 999, width: reviews.length ? `${(count / reviews.length) * 100}%` : "0%" }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#94a3b8", width: 14, textAlign: "right" }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {submitted ? (
          <div style={{ background: "rgba(15,118,110,0.2)", border: "1px solid rgba(20,184,166,0.3)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>🎉</div>
            <div style={{ fontWeight: 700, color: "#5eead4", fontSize: 13 }}>Review submitted — thank you!</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>It'll appear here once approved.</div>
          </div>
        ) : (
          <Btn onClick={() => user ? setShowForm(v => !v) : onNavigate("auth")}
            style={{ width: "100%", padding: 13, fontSize: 14 }}>
            {showForm ? "✕ Cancel" : "✍️ Write a Review"}
          </Btn>
        )}
      </div>

      {/* Review form */}
      {showForm && !submitted && (
        <Card style={{ border: `1.5px solid ${C.primary}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 14 }}>Your Review</div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Your Rating</div>
            <StarRow value={rating} interactive size={32} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Name (displayed publicly)</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name or first name"
              style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Which simulator did you use? (optional)</div>
            <select value={scenario} onChange={e => setScenario(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", outline: "none" }}>
              <option value="">Select one…</option>
              {SCENARIOS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Your experience</div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
              placeholder="What did you figure out? Did it change your decision? Be honest — good or bad."
              style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none" }} />
          </div>

          <Btn onClick={submitReview} style={{ width: "100%", padding: 13, opacity: submitting || !body.trim() || !name.trim() ? 0.6 : 1 }}>
            {submitting ? "Submitting…" : "Submit Review"}
          </Btn>
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", marginTop: 8 }}>Reviews are reviewed before publishing. No spam or promotional content.</div>
        </Card>
      )}

      {/* Reviews list */}
      {loading && (
        <Card style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 11, color: C.muted }}>Loading reviews…</div>
        </Card>
      )}

      {!loading && reviews.length === 0 && !showForm && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>💬</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>No reviews yet</div>
          <div style={{ fontSize: 13, color: C.muted }}>Be the first to share your experience.</div>
        </Card>
      )}

      {!loading && reviews.map((r, i) => (
        <div key={r.id || i} style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 15, flexShrink: 0 }}>
                {r.name?.[0]?.toUpperCase() || "?"}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{r.name}</div>
                {r.scenario && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Used: {r.scenario}</div>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <StarRow value={r.rating || 5} size={13} />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.7 }}>{r.body}</div>
        </div>
      ))}

      {/* Footer links */}
      <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: "8px 0" }}>
        <button onClick={() => onNavigate("terms")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: C.muted, fontFamily: "inherit", textDecoration: "underline" }}>Terms of Use</button>
        <button onClick={() => onNavigate("privacy")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: C.muted, fontFamily: "inherit", textDecoration: "underline" }}>Privacy Policy</button>
      </div>

    </div>
  );
}

// ─── TERMS OF USE PAGE ───────────────────────────────────────────────────────
function TermsPage({ onBack }) {
  const sections = [
    { title: "1. Acceptance of Terms", body: `By accessing or using Reality Estimator ("the App"), you agree to be bound by these Terms of Use. If you do not agree, please do not use the App. These terms apply to all visitors, users, and others who access the App.` },
    { title: "2. Description of Service", body: `Reality Estimator is a financial simulation and educational tool operated by NullSpace Studio LLC. The App provides estimates, projections, and educational content to help users understand potential financial scenarios. All outputs are for informational and educational purposes only.` },
    { title: "3. Not Financial Advice", body: `IMPORTANT: Reality Estimator is NOT a licensed financial advisor, investment advisor, or financial planner. Nothing in this App constitutes financial advice, investment advice, tax advice, or legal advice. All simulations, estimates, and AI-generated content are educational tools only.\n\nAlways consult a qualified financial professional before making any financial decisions. NullSpace Studio LLC is not responsible for any financial decisions you make based on information from this App.` },
    { title: "4. User Accounts", body: `You may create an account to save scenarios and access personalized features. You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must be at least 18 years old to create an account. We reserve the right to terminate accounts that violate these terms.` },
    { title: "5. User Content", body: `By submitting reviews or other content to the App, you grant NullSpace Studio LLC a non-exclusive, royalty-free license to display that content within the App. You represent that your submissions are truthful and do not violate any third-party rights. We reserve the right to moderate, edit, or remove user content at our discretion.` },
    { title: "6. Prohibited Uses", body: `You agree not to: (a) use the App for any unlawful purpose; (b) attempt to gain unauthorized access to any part of the App; (c) scrape, crawl, or data-mine the App without permission; (d) submit false, misleading, or spam reviews; (e) use the App in any way that could damage, disable, or impair its functionality.` },
    { title: "7. Intellectual Property", body: `All content, features, and functionality of Reality Estimator — including but not limited to text, graphics, logos, and software — are owned by NullSpace Studio LLC and are protected by applicable intellectual property laws. You may not copy, modify, distribute, or create derivative works without our written permission.` },
    { title: "8. Disclaimer of Warranties", body: `The App is provided "as is" and "as available" without warranties of any kind, either express or implied. NullSpace Studio LLC does not warrant that the App will be uninterrupted, error-free, or that financial estimates will be accurate. Use of the App is at your sole risk.` },
    { title: "9. Limitation of Liability", body: `To the fullest extent permitted by law, NullSpace Studio LLC shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the App — including any financial losses resulting from decisions made based on App content.` },
    { title: "10. Changes to Terms", body: `We reserve the right to modify these Terms at any time. Changes will be effective upon posting to the App. Continued use of the App after changes constitutes acceptance of the revised Terms. We encourage you to review these Terms periodically.` },
    { title: "11. Governing Law", body: `These Terms are governed by the laws of the United States and the state in which NullSpace Studio LLC is registered, without regard to conflict of law principles.` },
    { title: "12. Contact", body: `For questions about these Terms, contact NullSpace Studio LLC through the App or at the email address provided on our official communications.` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.text, fontWeight: 700 }}>← Back</button>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: C.text }}>Terms of Use</div>
          <div style={{ fontSize: 11, color: C.muted }}>NullSpace Studio LLC · Last updated March 2026</div>
        </div>
      </div>

      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "#92400e", fontWeight: 600, lineHeight: 1.6 }}>
          ⚠️ Reality Estimator provides financial simulations for educational purposes only. It is not a licensed financial advisor. Always consult a qualified professional before making financial decisions.
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={i} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 8 }}>{s.title}</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, whiteSpace: "pre-line" }}>{s.body}</div>
        </div>
      ))}
    </div>
  );
}

// ─── PRIVACY POLICY PAGE ─────────────────────────────────────────────────────
function PrivacyPage({ onBack }) {
  const sections = [
    { title: "1. Who We Are", body: `Reality Estimator is operated by NullSpace Studio LLC ("we," "us," or "our"). This Privacy Policy explains how we collect, use, and protect information when you use our App at realityestimator.com.` },
    { title: "2. Information We Collect", body: `Account information: When you register, we collect your name, email address, and ZIP code.\n\nUsage data: We collect information about how you interact with the App, including which simulators you use and scenarios you save.\n\nReviews & content: Any reviews or content you voluntarily submit.\n\nDevice data: Basic technical information like browser type and device type for App functionality.\n\nWe do NOT collect: Social Security numbers, bank account numbers, credit card numbers, or sensitive financial credentials.` },
    { title: "3. How We Use Your Information", body: `We use your information to: (a) provide and improve the App's features; (b) personalize your experience and news feed; (c) save and retrieve your financial scenarios; (d) send important service notifications; (e) moderate reviews and user content; (f) analyze aggregate usage patterns to improve the App.\n\nWe do not sell your personal information to third parties.` },
    { title: "4. Data Storage & Security", body: `Your data is stored securely using Supabase, a trusted database provider with industry-standard encryption. We implement reasonable technical and organizational measures to protect your information. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.` },
    { title: "5. AI & Third-Party Services", body: `The App uses the Anthropic Claude API to generate financial simulations and recommendations. When you use AI features, your inputs are sent to Anthropic's servers for processing. Anthropic's privacy policy governs their handling of this data. We do not send personally identifiable information to the AI — only the financial figures and parameters you enter into simulations.\n\nWe also use Supabase for database services and Vercel for hosting.` },
    { title: "6. Cookies & Local Storage", body: `We use browser local storage to save your preferences, dark mode setting, and cached data between sessions. We do not use advertising cookies or cross-site tracking. We may use essential cookies for authentication sessions.` },
    { title: "7. Your Rights", body: `You have the right to: (a) access the personal information we hold about you; (b) request correction of inaccurate information; (c) request deletion of your account and associated data; (d) opt out of non-essential communications.\n\nTo exercise these rights, contact us through the App. We will respond within 30 days.` },
    { title: "8. Data Retention", body: `We retain your account information for as long as your account is active. Saved scenarios are retained until you delete them or close your account. Reviews are retained indefinitely unless you request removal. You may delete your account at any time through Settings.` },
    { title: "9. Children's Privacy", body: `Reality Estimator is not intended for users under 18 years of age. We do not knowingly collect information from minors. If you believe a minor has provided us with personal information, please contact us and we will delete it promptly.` },
    { title: "10. Changes to This Policy", body: `We may update this Privacy Policy periodically. We will notify you of material changes by posting the updated policy in the App. Continued use of the App after changes constitutes acceptance of the revised policy.` },
    { title: "11. Contact Us", body: `For privacy questions or to exercise your rights, contact NullSpace Studio LLC through the App. We are committed to resolving privacy concerns promptly and transparently.` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.text, fontWeight: 700 }}>← Back</button>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: C.text }}>Privacy Policy</div>
          <div style={{ fontSize: 11, color: C.muted }}>NullSpace Studio LLC · Last updated March 2026</div>
        </div>
      </div>

      <div style={{ background: "rgba(37,99,235,0.06)", border: `1px solid ${C.primary}26`, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: C.primary, fontWeight: 600, lineHeight: 1.6 }}>
          🔒 We do not sell your data. We do not use advertising trackers. Your financial inputs are used only to power your simulations.
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={i} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 8 }}>{s.title}</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, whiteSpace: "pre-line" }}>{s.body}</div>
        </div>
      ))}
    </div>
  );
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
function AdminPanel({ onClose, user, showToast }) {
  const [tab, setTab] = useState("news");
  const [articles, setArticles] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rawInput, setRawInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processLog, setProcessLog] = useState("");

  useEffect(() => {
    if (tab === "news") loadArticles();
    if (tab === "reviews") loadReviews();
    if (tab === "users") loadUsers();
  }, [tab]);

  const loadArticles = async () => {
    setLoading(true);
    const { data } = await sb.from("news_articles").select("*").order("published_at", { ascending: false });
    setArticles(data || []);
    setLoading(false);
  };

  const loadReviews = async () => {
    setLoading(true);
    const { data } = await sb.from("reviews").select("*").order("created_at", { ascending: false });
    setReviews(data || []);
    setLoading(false);
  };

  const loadUsers = async () => {
    setLoading(true);
    const { data } = await sb.from("profiles").select("id, name, zip, is_admin, created_at").order("created_at", { ascending: false });
    setUsers(data || []);
    setLoading(false);
  };

  const daysOld = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);
  const daysLeft = (d) => Math.max(0, 50 - daysOld(d));
  const ageColor = (d) => daysLeft(d) <= 5 ? C.red : daysLeft(d) <= 14 ? C.amber : C.green;

  const processArticles = async () => {
    const chunks = rawInput.trim().split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, 50);
    if (!chunks.length) { showToast("Paste at least one article.", "err"); return; }
    setProcessing(true);
    setProcessLog(`Processing ${chunks.length} article(s) with AI…`);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4000,
          system: `You process financial news for a personal finance app. For each article return a JSON array. Each object: title (max 80 chars), summary (2-3 sentences), impact ("How this affects you:" 1 sentence for young adults), topics (array from: housing,interest,jobs,inflation,debt,recession), life_stages (array from: student,young_adult,starting_family,established,pre_retirement), urgency (high/medium/low), sentiment (positive/negative/neutral), source_url (extract if present else ""). Return ONLY valid JSON array, no markdown.`,
          messages: [{ role: "user", content: `Process ${chunks.length} articles:\n\n${chunks.map((c, i) => `--- ARTICLE ${i+1} ---\n${c}`).join("\n\n")}` }]
        })
      });
      const d = await res.json();
      const parsed = JSON.parse(d.content?.[0]?.text?.replace(/```json|```/g, "").trim() || "[]");
      setProcessLog(`✓ ${parsed.length} articles processed. Saving…`);
      const rows = parsed.map(a => ({ title: a.title, summary: a.summary, impact: a.impact, topics: a.topics || [], life_stages: a.life_stages || [], urgency: a.urgency || "medium", sentiment: a.sentiment || "neutral", source_url: a.source_url || "", is_active: true, published_at: new Date().toISOString() }));
      const { error } = await sb.from("news_articles").insert(rows);
      if (error) throw error;
      setProcessLog(`✅ ${parsed.length} articles published!`);
      setRawInput("");
      setTimeout(() => { setProcessLog(""); loadArticles(); }, 2000);
      showToast(`✓ ${parsed.length} articles published to all users!`);
    } catch (e) {
      setProcessLog(`❌ Error: ${e.message}`);
      showToast("Failed to process articles.", "err");
    }
    setProcessing(false);
  };

  const toggleArticle = async (id, cur) => { await sb.from("news_articles").update({ is_active: !cur }).eq("id", id); loadArticles(); };
  const deleteArticle = async (id) => { await sb.from("news_articles").delete().eq("id", id); loadArticles(); showToast("Article deleted."); };
  const toggleReview = async (id, cur) => { await sb.from("reviews").update({ is_approved: !cur }).eq("id", id); loadReviews(); };
  const deleteReview = async (id) => { await sb.from("reviews").delete().eq("id", id); loadReviews(); };

  const tabs = [{ id: "news", label: "📰 News" }, { id: "reviews", label: "⭐ Reviews" }, { id: "users", label: "👥 Users" }];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "100%", maxWidth: 760, background: C.bg, display: "flex", flexDirection: "column", boxShadow: "-20px 0 60px rgba(0,0,0,0.4)", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, position: "sticky", top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, color: C.text }}>🛡️ Admin Panel</div>
            <div style={{ fontSize: 12, color: C.muted }}>{user.email}</div>
          </div>
          <button onClick={onClose} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", fontSize: 18, color: C.muted }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, padding: "12px 24px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 16px", borderRadius: 999, border: `1.5px solid ${tab === t.id ? C.primary : C.border}`, background: tab === t.id ? C.primary : "transparent", color: tab === t.id ? "#fff" : C.muted, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 24, flex: 1 }}>

          {/* NEWS TAB */}
          {tab === "news" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 4 }}>📤 Upload Articles</div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Paste up to 50 articles separated by a blank line. Claude will summarize, tag, and publish them automatically.</div>
                <textarea value={rawInput} onChange={e => setRawInput(e.target.value)}
                  placeholder={"Paste article 1 here...\n\nPaste article 2 here (blank line between each)..."}
                  style={{ width: "100%", minHeight: 160, padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, fontFamily: "inherit", background: C.cardAlt, color: C.text, resize: "vertical", boxSizing: "border-box", lineHeight: 1.6 }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: C.muted }}>{rawInput.trim() ? `~${rawInput.trim().split(/\n{2,}/).filter(Boolean).length} article(s) detected` : "No articles pasted yet"}</div>
                  <Btn onClick={processArticles} style={{ opacity: processing ? 0.7 : 1 }}>{processing ? "⏳ Processing…" : "🚀 Process & Publish"}</Btn>
                </div>
                {processLog && (
                  <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, background: processLog.startsWith("❌") ? C.redBg : C.greenBg, border: `1px solid ${processLog.startsWith("❌") ? C.redBorder : C.greenBorder}`, fontSize: 13, color: processLog.startsWith("❌") ? C.red : C.green, fontWeight: 600 }}>
                    {processLog}
                  </div>
                )}
              </div>

              {/* Article List */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>Published Articles ({articles.length})</div>
                  <button onClick={loadArticles} style={{ background: "none", border: "none", color: C.primary, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>↺ Refresh</button>
                </div>
                {loading && <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 24 }}>Loading…</div>}
                {!loading && articles.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted, fontSize: 13 }}>No articles yet. Paste some above to get started.</div>}
                {articles.map(a => {
                  const old = daysOld(a.published_at);
                  const left = daysLeft(a.published_at);
                  const col = ageColor(a.published_at);
                  return (
                    <div key={a.id} style={{ background: C.card, border: `1px solid ${left <= 5 ? C.redBorder : C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 4 }}>{a.title}</div>
                          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 6 }}>{a.summary}</div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {(a.topics || []).map(t => <span key={t} style={{ fontSize: 10, background: C.primaryLight, color: C.primary, padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>{t}</span>)}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: col }}>{left === 0 ? "⚠️ Expired" : `${left}d left`}</div>
                            <div style={{ fontSize: 10, color: C.muted }}>{old}d old</div>
                          </div>
                          <div style={{ width: 72, height: 4, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, (old / 50) * 100)}%`, background: col, borderRadius: 4 }} />
                          </div>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button onClick={() => toggleArticle(a.id, a.is_active)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: a.is_active ? C.greenBg : C.cardAlt, color: a.is_active ? C.green : C.muted, cursor: "pointer", fontWeight: 700 }}>
                              {a.is_active ? "Live" : "Hidden"}
                            </button>
                            <button onClick={() => deleteArticle(a.id)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.redBorder}`, background: C.redBg, color: C.red, cursor: "pointer", fontWeight: 700 }}>Delete</button>
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
                        Uploaded {new Date(a.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {a.source_url && <> · <a href={a.source_url} target="_blank" rel="noreferrer" style={{ color: C.primary }}>Source ↗</a></>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* REVIEWS TAB */}
          {tab === "reviews" && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 16 }}>⭐ Reviews ({reviews.length} total · {reviews.filter(r => r.is_approved).length} approved)</div>
              {loading && <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 24 }}>Loading…</div>}
              {!loading && reviews.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted, fontSize: 13 }}>No reviews yet.</div>}
              {reviews.map(r => (
                <div key={r.id} style={{ background: C.card, border: `1px solid ${r.is_approved ? C.greenBorder : C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{r.name || "Anonymous"}</span>
                        <span style={{ fontSize: 13 }}>{"⭐".repeat(r.rating || 0)}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 700, background: r.is_approved ? C.greenBg : C.amberBg, color: r.is_approved ? C.green : C.amber }}>{r.is_approved ? "Approved" : "Pending"}</span>
                      </div>
                      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{r.body}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
                      <button onClick={() => toggleReview(r.id, r.is_approved)} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: r.is_approved ? C.amberBg : C.greenBg, color: r.is_approved ? C.amber : C.green, cursor: "pointer", fontWeight: 700 }}>{r.is_approved ? "Unpublish" : "Approve"}</button>
                      <button onClick={() => deleteReview(r.id)} style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.redBorder}`, background: C.redBg, color: C.red, cursor: "pointer", fontWeight: 700 }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* USERS TAB */}
          {tab === "users" && (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {[{ label: "Total Users", value: users.length, color: C.primary }, { label: "Admins", value: users.filter(u => u.is_admin).length, color: C.amber }, { label: "This Month", value: users.filter(u => new Date(u.created_at) > new Date(Date.now() - 30*86400000)).length, color: C.green }].map(s => (
                  <div key={s.label} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {loading && <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 24 }}>Loading…</div>}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 70px", padding: "10px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>
                  <span>Name</span><span>ZIP</span><span>Joined</span><span>Role</span>
                </div>
                {users.map((u, i) => (
                  <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 70px", padding: "12px 16px", borderBottom: i < users.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{u.name || "—"}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{u.zip || "—"}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 700, background: u.is_admin ? C.amberBg : C.primaryLight, color: u.is_admin ? C.amber : C.primary }}>{u.is_admin ? "Admin" : "User"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function RealityEstimator() {
  const [page, setPage] = useState("home");
  const [simTab, setSimTab] = useState("moving");
  const [user, setUser] = useState(DB.getUser());
  const [showAuth, setShowAuth] = useState(false);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("re_dark_mode");
    if (saved !== null) return saved === "true";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  });
  const [sidebarShowEmail, setSidebarShowEmail] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      const dismissed = localStorage.getItem("re_install_dismissed");
      if (!dismissed) setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstallBanner(false);
    setInstallPrompt(null);
  };

  const dismissInstall = () => {
    setShowInstallBanner(false);
    localStorage.setItem("re_install_dismissed", "true");
  };
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 30000);
  };

  // Restore Supabase session on load
  useEffect(() => {
    SB.getSession().then(async (session) => {
      if (session?.user && !DB.getUser()) {
        try {
          const profile = await SB.getProfile(session.user.id);
          const u = { id: session.user.id, name: profile?.name || session.user.email.split("@")[0], email: session.user.email, zip: profile?.zip || "", is_admin: profile?.is_admin || false };
          DB.setUser(u); setUser(u);
        } catch {}
      }
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") { DB.setUser(null); setUser(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Update global C before this render so all child components get correct colors
  C = dark ? DARK : LIGHT;

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("re_dark_mode", String(next));
  };

  const navigate = (p, tab) => { setPage(p); if (tab) setSimTab(tab); };

  const handleSave = (scenario) => {
    DB.saveScenario(scenario);
    if (user?.id) SB.saveScenario(user.id, scenario).catch(() => {});
    showToast("✓ Scenario saved! Find it in Dashboard → Scenarios.");
  };

  const handleLogout = async () => { await SB.signOut(); DB.setUser(null); setUser(null); };

  const navItems = [
    { id: "home", icon: "⊞", label: "Home" },
    { id: "simulate", icon: "⟳", label: "Simulate" },
    { id: "news", icon: "📰", label: "News" },
    { id: "spending", icon: "🧾", label: "Spending" },
    { id: "dashboard", icon: "◎", label: "Dashboard" },
    { id: "reviews", icon: "⭐", label: "Reviews" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif", color: C.text, paddingBottom: 80, transition: "background 0.2s, color 0.2s" }}>
      <style>{`
        * { box-sizing: border-box; }
        select { appearance: none; }
        body { background: ${C.bg}; margin: 0; color: ${C.text}; }
        input, textarea, select { color: ${C.text} !important; background: ${C.cardAlt} !important; }
        input::placeholder { color: ${C.muted} !important; }
        @media (min-width: 768px) {
          .re-layout { display: flex !important; width: 100%; min-height: 100vh; }
          .re-sidebar { display: flex !important; flex-direction: column; padding: 20px 12px; border-right: 1px solid ${C.border}; position: sticky; top: 56px; height: fit-content; min-width: 200px; max-width: 200px; align-self: flex-start; }
          .re-content { flex: 1 !important; max-width: 100% !important; padding: 28px 40px !important; }
          .re-bottom-nav { display: none !important; }
          .re-header-inner { max-width: 100% !important; padding: 12px 32px !important; }
          h1 { font-size: 36px !important; }
          .re-section-title { font-size: 20px !important; }
          .re-card-title { font-size: 16px !important; }
        }
        @media (max-width: 767px) {
          .re-sidebar { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: C.headerBg, borderBottom: `1px solid ${C.border}`, backdropFilter: "saturate(140%) blur(10px)" }}>
        <div className="re-header-inner" style={{ maxWidth: 520, margin: "0 auto", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 16, boxShadow: "0 8px 18px rgba(37,99,235,0.25)" }}>R</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.2, color: C.text }}>Reality Estimator</div>
            <div style={{ fontSize: 10, color: C.muted }}>Confidence safety check</div>
          </div>
          <div style={{ flex: 1 }} />
          <Badge variant="default" style={{ fontSize: 11 }}>📍 {user?.zip || "Not set"}</Badge>

          {/* Dark mode toggle */}
          <button onClick={toggleDark} title={dark ? "Switch to light mode" : "Switch to dark mode"}
            style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.card, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 16, transition: "all 0.2s" }}>
            {dark ? "☀️" : "🌙"}
          </button>

          {user ? (
            <div style={{ position: "relative" }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, cursor: "pointer" }}
                onClick={() => setShowUserMenu(v => !v)}>
                {user.name?.[0]?.toUpperCase() || "U"}
              </div>
              {showUserMenu && (
                <div onClick={() => setShowUserMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
              )}
              {showUserMenu && (
                <div style={{ position: "absolute", right: 0, top: 42, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, minWidth: 180, zIndex: 99, overflow: "hidden" }}>
                  <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{user.email}</div>
                  </div>
                  <button onClick={() => { setShowUserMenu(false); navigate("dashboard"); }}
                    style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                    ◎ Dashboard
                  </button>
                  {user?.is_admin && (
                    <button onClick={() => { setShowUserMenu(false); setShowAdmin(true); }}
                      style={{ width: "100%", padding: "10px 14px", background: "rgba(37,99,235,0.08)", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.primary, display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                      🛡️ Admin Panel
                    </button>
                  )}
                  <button onClick={() => { setShowUserMenu(false); setShowSettings(true); }}
                    style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                    ⚙️ Settings
                  </button>
                  <button onClick={() => { setShowUserMenu(false); handleLogout(); }}
                    style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.red, display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.border}` }}>
                    🚪 Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Btn onClick={() => setShowAuth(true)} variant="outline" style={{ fontSize: 12, padding: "6px 12px" }}>Login</Btn>
              <Btn onClick={() => setShowAuth(true)} style={{ fontSize: 12, padding: "6px 14px" }}>Get started</Btn>
            </>
          )}
        </div>
      </div>

      {/* Desktop layout wrapper */}
      <div className="re-layout" style={{ display: "block" }}>

        {/* Desktop Sidebar Nav */}
        <div className="re-sidebar" style={{ display: "none", background: C.card, borderRight: `1px solid ${C.border}` }}>
          <div style={{ marginBottom: 24 }}>
            {user ? (
              <div style={{ padding: "12px 10px", background: C.primaryLight, borderRadius: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.primary}, #1d4ed8)`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 15, flexShrink: 0 }}>
                    {user.name?.[0]?.toUpperCase() || "U"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: C.primary, fontWeight: 800, letterSpacing: "-0.01em" }}>👋 Hello,</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name || "User"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.muted }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {sidebarShowEmail ? user.email : "••••••••@•••.•••"}
                  </span>
                  <button onClick={() => setSidebarShowEmail(v => !v)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: "0 2px", color: C.muted, flexShrink: 0 }}>
                    {sidebarShowEmail ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "12px 10px", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Save your scenarios</div>
                <Btn onClick={() => setShowAuth(true)} style={{ width: "100%", fontSize: 12, padding: "8px" }}>Sign in / Sign up</Btn>
              </div>
            )}
          </div>

          {navItems.map(n => (
            <button key={n.id} onClick={() => navigate(n.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", marginBottom: 4, background: page === n.id ? C.primaryLight : "transparent", color: page === n.id ? C.primary : C.muted, fontWeight: page === n.id ? 700 : 500, fontSize: 14, transition: "all 0.15s", textAlign: "left" }}>
              <span style={{ fontSize: 18, width: 24 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}

          {user && (
            <button onClick={handleLogout}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", background: "transparent", color: C.muted, fontWeight: 500, fontSize: 14, marginTop: 12 }}>
              <span style={{ fontSize: 18, width: 24 }}>🚪</span> Log out
            </button>
          )}
        </div>

        {/* Content */}
        <div className="re-content" style={{ maxWidth: 520, margin: "0 auto", padding: "18px 16px" }}>
          {page === "home" && <Home onNavigate={navigate} />}
          {page === "simulate" && <SimulatePage defaultTab={simTab} user={user} onSave={handleSave} />}
          {page === "dashboard" && <Dashboard user={user} onLogout={handleLogout} onShowAuth={() => setShowAuth(true)} />}
          {page === "compare" && <ComparePage user={user} />}
          {page === "spending" && <SpendingTracker />}
          {page === "news" && <NewsPage user={user} />}
          {page === "reviews" && <ReviewsPage user={user} showToast={showToast} onNavigate={navigate} />}
          {page === "terms" && <TermsPage onBack={() => navigate("reviews")} />}
          {page === "privacy" && <PrivacyPage onBack={() => navigate("reviews")} />}
        </div>
      </div>

      {/* Bottom Nav (mobile only) */}
      <div className="re-bottom-nav" style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: C.navBg, borderTop: `1px solid ${C.border}`, backdropFilter: "blur(10px)", display: "flex", justifyContent: "space-around", padding: "10px 0 14px", zIndex: 50 }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => navigate(n.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontFamily: "inherit" }}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: page === n.id ? C.primary : C.muted }}>{n.label}</span>
          </button>
        ))}
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuth={setUser} />}

      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div style={{
          position: "fixed", bottom: 80, left: 12, right: 12, zIndex: 200,
          background: "linear-gradient(135deg, #1e3a5f, #1e40af)",
          border: "1px solid rgba(99,179,237,0.3)",
          borderRadius: 16, padding: "14px 16px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 12
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>R</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#fff", marginBottom: 2 }}>Add to Home Screen</div>
            <div style={{ fontSize: 11, color: "#93c5fd" }}>Install Reality Estimator for quick access</div>
          </div>
          <button onClick={handleInstall} style={{ background: "#2563eb", border: "none", borderRadius: 10, padding: "8px 14px", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            Install
          </button>
          <button onClick={dismissInstall} style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", fontSize: 18, padding: "0 4px", flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* Toast notification bar */}
      {toast && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
          background: toast.type === "err" ? C.red : "#0f766e",
          color: "#fff", padding: "14px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          animation: "slideDown 0.3s ease",
        }}>
          <style>{`@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 14 }}>
            <span style={{ fontSize: 18 }}>{toast.type === "err" ? "⚠️" : "✅"}</span>
            {toast.msg}
          </div>
          <button onClick={() => setToast(null)}
            style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontWeight: 700, fontSize: 13 }}>
            Dismiss
          </button>
        </div>
      )}
      {showAdmin && user?.is_admin && (
        <AdminPanel onClose={() => setShowAdmin(false)} user={user} showToast={showToast} />
      )}
      {showSettings && user && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowSettings(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 20, padding: 24, width: "100%", maxWidth: 500, maxHeight: "85vh", overflowY: "auto", boxShadow: C.shadow }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 20, color: C.text }}>⚙️ Settings</div>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.muted }}>✕</button>
            </div>
            <SettingsPanel user={user} onUpdate={(updatedUser) => {
              DB.setUser(updatedUser);
              try {
                const accounts = JSON.parse(localStorage.getItem("re_accounts") || "{}");
                if (accounts[updatedUser.email]) {
                  accounts[updatedUser.email] = { ...accounts[updatedUser.email], ...updatedUser };
                  localStorage.setItem("re_accounts", JSON.stringify(accounts));
                }
              } catch {}
              setUser(updatedUser);
              setShowSettings(false);
            }} onLogout={() => { setShowSettings(false); handleLogout(); }}
            showEmail={sidebarShowEmail} onToggleEmail={() => setSidebarShowEmail(v => !v)} />
          </div>
        </div>
      )}
    </div>
  );
}
