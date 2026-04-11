// ─── ShareModal.jsx ───────────────────────────────────────────────────────────
// Share My Estimate — Reality Estimator
// Drop alongside App.jsx in the repo root.
//
// SETUP IN App.jsx:
// 1. Import at top:
//      import { ShareModal, SharedViewPage, encodeScenario } from "./ShareModal";
//
// 2. Add share state near other modal states:
//      const [shareScenario, setShareScenario] = useState(null);
//
// 3. Render modal (before closing </div> of main return):
//      {shareScenario && (
//        <ShareModal scenario={shareScenario} onClose={() => setShareScenario(null)} />
//      )}
//
// 4. Add shared view page route (in the page render section):
//      {page === "shared" && <SharedViewPage onNavigate={navigate} />}
//
// 5. In the useEffect that handles URL params, add:
//      if (params.get("share")) setPage("shared");
//
// 6. Pass setShareScenario down to SimulatePage and Dashboard as onShare prop.
//
// ADDING SHARE BUTTON TO SIMULATORS:
// In each sim's results Card, after the Save button add:
//   <Btn onClick={() => onShare({ id, type, label, date, data })} variant="outline"
//     style={{ width: "100%", marginTop: 8 }}>
//     🔗 Share Estimate
//   </Btn>
//
// ADDING SHARE BUTTON TO DASHBOARD SCENARIOS:
// In the scenario card in Dashboard, next to the delete button add:
//   <Btn onClick={e => { e.stopPropagation(); onShare(s); }} variant="outline"
//     style={{ padding: "6px 10px", fontSize: 12 }}>
//     🔗
//   </Btn>
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";

// ─── THEME BRIDGE ─────────────────────────────────────────────────────────────
const getC = () => {
  try {
    const dark = localStorage.getItem("re_dark_mode") === "true";
    if (dark) return {
      bg: "#0a0f1e", card: "#111827", cardAlt: "#1a2234", text: "#f1f5f9",
      muted: "#94a3b8", border: "#1e293b", primary: "#3b82f6",
      primaryLight: "rgba(59,130,246,0.12)",
      green: "#14b8a6", greenBg: "rgba(20,184,166,0.12)", greenBorder: "rgba(20,184,166,0.25)",
      red: "#f87171", redBg: "rgba(239,68,68,0.12)", redBorder: "rgba(239,68,68,0.25)",
      amber: "#fbbf24", amberBg: "rgba(245,158,11,0.12)", amberBorder: "rgba(245,158,11,0.25)",
      shadow: "0 10px 25px rgba(0,0,0,0.4)", radius: "18px",
    };
    return {
      bg: "#f6f8fb", card: "#ffffff", cardAlt: "#f8fafc", text: "#0f172a",
      muted: "#475569", border: "#e2e8f0", primary: "#2563eb",
      primaryLight: "rgba(37,99,235,0.08)",
      green: "#0f766e", greenBg: "rgba(20,184,166,0.10)", greenBorder: "rgba(20,184,166,0.25)",
      red: "#991b1b", redBg: "rgba(239,68,68,0.10)", redBorder: "rgba(239,68,68,0.25)",
      amber: "#92400e", amberBg: "rgba(245,158,11,0.10)", amberBorder: "rgba(245,158,11,0.25)",
      shadow: "0 10px 25px rgba(2,6,23,0.06)", radius: "18px",
    };
  } catch { return {}; }
};

const fmt = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(v || 0);

// ─── ENCODE / DECODE ──────────────────────────────────────────────────────────
// Encodes scenario to a URL-safe base64 string
export function encodeScenario(scenario) {
  try {
    const json = JSON.stringify({
      id:    scenario.id,
      type:  scenario.type,
      label: scenario.label,
      date:  scenario.date,
      data:  scenario.data,
    });
    return btoa(encodeURIComponent(json));
  } catch { return null; }
}

// Decodes scenario from URL param
export function decodeScenario(encoded) {
  try {
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json);
  } catch { return null; }
}

// Builds the full shareable URL
function buildShareUrl(scenario) {
  const encoded = encodeScenario(scenario);
  if (!encoded) return null;
  const base = window.location.origin + window.location.pathname;
  return `${base}?share=${encoded}`;
}

// ─── SCENARIO METADATA ────────────────────────────────────────────────────────
const SCENARIO_META = {
  moving:   { icon: "🏠", label: "Moving Out",             color: "#2563eb" },
  car:      { icon: "🚗", label: "Car Ownership",          color: "#0284c7" },
  project:  { icon: "🔨", label: "Project Estimate",       color: "#d97706" },
  recession:{ icon: "📉", label: "Recession Prep",         color: "#dc2626" },
  debt:     { icon: "💳", label: "Debt Payoff",            color: "#7c3aed" },
  freedom:  { icon: "🏆", label: "Financial Freedom",      color: "#0f766e" },
};

// Pulls the most meaningful stats from any scenario type
function getHighlights(scenario) {
  const d = scenario.data || {};
  switch (scenario.type) {
    case "moving":
      return [
        { label: "Monthly Total",   value: fmt(d.total),   accent: true  },
        { label: "% of Income",     value: `${d.ratio}%`,  accent: false },
        { label: "Monthly Surplus", value: fmt(d.surplus), accent: false },
        { label: "Score",           value: `${d.score}/100`, accent: false },
      ];
    case "car":
      return [
        { label: "Monthly Total",  value: fmt(d.total),      accent: true  },
        { label: "Annual Cost",    value: fmt(d.annualCost),  accent: false },
        { label: "% of Income",    value: `${d.ratio}%`,     accent: false },
        { label: "Score",          value: `${d.score}/100`,  accent: false },
      ];
    case "project":
      return [
        { label: "Reality Total",  value: fmt(d.total),      accent: true  },
        { label: "Buffer Added",   value: fmt(d.bufferAmt),  accent: false },
        { label: "Materials",      value: fmt(d.materials),  accent: false },
        { label: "Score",          value: `${d.score}/100`,  accent: false },
      ];
    case "recession":
      return [
        { label: "Runway",         value: d.runway >= 99 ? "Indefinite" : `${d.runway} months`, accent: true },
        { label: "Monthly Gap",    value: fmt(d.gap),        accent: false },
        { label: "Total Savings",  value: fmt(d.savings),    accent: false },
        { label: "Score",          value: `${d.score}/100`,  accent: false },
      ];
    case "debt":
      return [
        { label: "Payoff Time",    value: fmtMonths(d.payoffMonths), accent: true  },
        { label: "Total Interest", value: fmt(d.totalInterest),      accent: false },
        { label: "Interest Saved", value: fmt(d.interestSaved),      accent: false },
        { label: "Score",          value: `${d.score}/100`,          accent: false },
      ];
    case "freedom":
      return [
        { label: "Gross Needed",   value: fmt(d.requiredGross),  accent: true  },
        { label: "Income Gap",     value: fmt(d.gapFromCurrent), accent: false },
        { label: "Tax Rate",       value: `${d.effectiveTaxPct}%`, accent: false },
        { label: "Score",          value: `${d.score}/100`,      accent: false },
      ];
    default:
      return [];
  }
}

function fmtMonths(m) {
  if (!m || m >= 600) return "—";
  const yrs = Math.floor(m / 12);
  const mos = m % 12;
  if (yrs === 0) return `${mos}mo`;
  if (mos === 0) return `${yrs}yr`;
  return `${yrs}yr ${mos}mo`;
}

// ─── SCORE RING (SVG, works in share card) ────────────────────────────────────
function ScoreRingSmall({ score, color, size = 80 }) {
  const r    = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={7} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={circ}
          strokeDashoffset={circ - (Math.min(score, 100) / 100) * circ}
          strokeLinecap="round" />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ fontSize: size * 0.24, fontWeight: 700, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: size * 0.11, color: "rgba(255,255,255,0.5)", marginTop: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>score</div>
      </div>
    </div>
  );
}

// ─── SHARE CARD (the visual screenshot card) ──────────────────────────────────
function ShareCard({ scenario, cardRef }) {
  const meta       = SCENARIO_META[scenario.type] || SCENARIO_META.moving;
  const highlights = getHighlights(scenario);
  const score      = scenario.data?.score || 0;

  return (
    <div ref={cardRef} style={{
      background:   "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
      borderRadius: 20,
      padding:      "24px 24px 20px",
      width:        "100%",
      boxSizing:    "border-box",
      fontFamily:   "ui-sans-serif, system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 900, fontSize: 18,
          }}>R</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>Reality Estimator</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>realityestimator.com</div>
          </div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: meta.color,
          background: `${meta.color}20`,
          border: `1px solid ${meta.color}40`,
          padding: "4px 10px", borderRadius: 999,
        }}>
          {meta.icon} {meta.label}
        </div>
      </div>

      {/* Scenario name */}
      <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", marginBottom: 4, lineHeight: 1.3 }}>
        {scenario.label}
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 20 }}>
        Estimated {scenario.date}
      </div>

      {/* Score + highlights grid */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
        <ScoreRingSmall score={score} color={meta.color} size={80} />
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {highlights.map((h, i) => (
            <div key={i} style={{
              background: h.accent ? `${meta.color}18` : "rgba(255,255,255,0.04)",
              border:     `1px solid ${h.accent ? meta.color + "40" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 10, padding: "8px 10px",
            }}>
              <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
                {h.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: h.accent ? meta.color : "#e2e8f0" }}>
                {h.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer CTA */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        paddingTop: 14,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ fontSize: 11, color: "#334155" }}>
          Run your own reality check
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "#fff",
          background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
          padding: "5px 12px", borderRadius: 999,
        }}>
          realityestimator.com →
        </div>
      </div>
    </div>
  );
}

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
export function ShareModal({ scenario, onClose }) {
  const [, forceUpdate]  = useState(0);
  useEffect(() => { forceUpdate(n => n + 1); }, []);

  const C               = getC();
  const cardRef         = useRef(null);
  const [copied, setCopied]       = useState(false);
  const [copyError, setCopyError] = useState(false);
  const shareUrl                  = buildShareUrl(scenario);

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share || !shareUrl) return;
    try {
      await navigator.share({
        title: `My ${scenario.label} — Reality Estimator`,
        text:  `Check out my financial estimate: ${scenario.label}`,
        url:   shareUrl,
      });
    } catch { /* user cancelled */ }
  };

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;
  const meta           = SCENARIO_META[scenario.type] || SCENARIO_META.moving;

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 300,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   C.card,
          borderRadius: "24px 24px 0 0",
          width:        "100%",
          maxWidth:     520,
          boxShadow:    "0 -20px 60px rgba(0,0,0,0.4)",
          overflow:     "hidden",
          maxHeight:    "92vh",
          overflowY:    "auto",
        }}
      >
        {/* Header */}
        <div style={{
          padding:      "20px 20px 16px",
          borderBottom: `1px solid ${C.border}`,
          display:      "flex",
          justifyContent: "space-between",
          alignItems:   "center",
          position:     "sticky", top: 0,
          background:   C.card, zIndex: 1,
        }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: C.text }}>🔗 Share Estimate</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {meta.icon} {scenario.label}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, color: C.muted, cursor: "pointer", padding: 4 }}
          >✕</button>
        </div>

        <div style={{ padding: "20px 20px 32px" }}>

          {/* Visual share card */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              📸 Screenshot Card
            </div>
            <ShareCard scenario={scenario} cardRef={cardRef} />
            <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 8 }}>
              Screenshot this card to share on social media
            </div>
          </div>

          {/* Link section */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              🔗 Shareable Link
            </div>
            <div style={{
              display:      "flex",
              gap:          8,
              background:   C.cardAlt,
              border:       `1.5px solid ${C.border}`,
              borderRadius: 12,
              padding:      "10px 12px",
              alignItems:   "center",
            }}>
              <div style={{
                flex:         1,
                fontSize:     11,
                color:        C.muted,
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
                fontFamily:   "monospace",
              }}>
                {shareUrl || "Could not generate link"}
              </div>
              <button
                onClick={handleCopyLink}
                style={{
                  padding:      "6px 14px",
                  borderRadius: 8,
                  border:       "none",
                  background:   copied ? C.green : C.primary,
                  color:        "#fff",
                  fontWeight:   700,
                  fontSize:     12,
                  cursor:       "pointer",
                  fontFamily:   "inherit",
                  flexShrink:   0,
                  transition:   "background 0.2s",
                  whiteSpace:   "nowrap",
                }}
              >
                {copied ? "✓ Copied!" : "Copy"}
              </button>
            </div>
            {copyError && (
              <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>
                Could not copy automatically — tap the link and copy manually.
              </div>
            )}
          </div>

          {/* Native share button (mobile) */}
          {canNativeShare && (
            <button
              onClick={handleNativeShare}
              style={{
                width:        "100%",
                padding:      "14px",
                borderRadius: 14,
                border:       "none",
                background:   `linear-gradient(135deg, ${meta.color}, ${meta.color}cc)`,
                color:        "#fff",
                fontWeight:   800,
                fontSize:     15,
                cursor:       "pointer",
                fontFamily:   "inherit",
                marginBottom: 10,
              }}
            >
              ↑ Share via…
            </button>
          )}

          {/* Disclaimer */}
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", lineHeight: 1.6 }}>
            Shared links are read-only. Viewers cannot edit or save your scenario.
            Link includes your estimate data but not your name or account info.
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── SHARED VIEW PAGE ─────────────────────────────────────────────────────────
// Shown when someone opens a ?share= URL
export function SharedViewPage({ onNavigate }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => { forceUpdate(n => n + 1); }, []);

  const C        = getC();
  const [scenario, setScenario] = useState(null);
  const [error,    setError]    = useState(false);

  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const encoded = params.get("share");
    if (!encoded) { setError(true); return; }
    const decoded = decodeScenario(encoded);
    if (!decoded) { setError(true); return; }
    setScenario(decoded);
  }, []);

  if (error) return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
      <div style={{ fontWeight: 800, fontSize: 18, color: C.text, marginBottom: 8 }}>
        Link expired or invalid
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>
        This estimate link couldn't be loaded. It may have been modified or expired.
      </div>
      <button
        onClick={() => onNavigate("home")}
        style={{
          padding:      "12px 24px",
          borderRadius: 12,
          border:       "none",
          background:   C.primary,
          color:        "#fff",
          fontWeight:   700,
          fontSize:     14,
          cursor:       "pointer",
          fontFamily:   "inherit",
        }}
      >
        Go to Reality Estimator
      </button>
    </div>
  );

  if (!scenario) return (
    <div style={{ textAlign: "center", padding: "60px 24px", color: C.muted, fontSize: 13 }}>
      Loading estimate…
    </div>
  );

  const meta       = SCENARIO_META[scenario.type] || SCENARIO_META.moving;
  const highlights = getHighlights(scenario);
  const score      = scenario.data?.score || 0;

  const tierLabel = score >= 75 ? "Ready"
    : score >= 50 ? "Building"
    : score >= 25 ? "At Risk"
    : "Critical";

  const tierColor = score >= 75 ? C.green
    : score >= 50 ? "#0284c7"
    : score >= 25 ? "#d97706"
    : C.red;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Read-only banner */}
      <div style={{
        background:   C.amberBg,
        border:       `1px solid ${C.amberBorder}`,
        borderRadius: 12,
        padding:      "10px 16px",
        display:      "flex",
        alignItems:   "center",
        gap:          10,
        fontSize:     12,
        color:        C.amber,
        fontWeight:   600,
      }}>
        <span style={{ fontSize: 16 }}>👁️</span>
        You're viewing a shared estimate — read only. Numbers may have changed.
      </div>

      {/* Hero card */}
      <div style={{
        background:   "linear-gradient(135deg, #0f172a, #1e293b)",
        borderRadius: 20,
        padding:      "24px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 900, fontSize: 20,
          }}>R</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Reality Estimator</div>
            <div style={{ fontSize: 10, color: "#475569" }}>Shared Estimate</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: meta.color,
              background: `${meta.color}25`,
              border:     `1px solid ${meta.color}40`,
              padding:    "4px 10px", borderRadius: 999,
            }}>
              {meta.icon} {meta.label}
            </span>
          </div>
        </div>

        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginBottom: 4 }}>
          {scenario.label}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 20 }}>
          Estimated {scenario.date}
        </div>

        {/* Score */}
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          16,
          background:   "rgba(255,255,255,0.04)",
          borderRadius: 14,
          padding:      "14px 16px",
          marginBottom: 16,
        }}>
          <ScoreRingSmall score={score} color={tierColor} size={80} />
          <div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Reality Score</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: tierColor, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: tierColor, marginTop: 2 }}>{tierLabel}</div>
          </div>
        </div>

        {/* Highlights grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {highlights.map((h, i) => (
            <div key={i} style={{
              background:   h.accent ? `${meta.color}20` : "rgba(255,255,255,0.04)",
              border:       `1px solid ${h.accent ? meta.color + "50" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 12, padding: "12px 14px",
            }}>
              <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                {h.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: h.accent ? meta.color : "#e2e8f0" }}>
                {h.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{
        background:   C.card,
        border:       `1.5px solid ${C.border}`,
        borderRadius: 20,
        padding:      "24px",
        textAlign:    "center",
      }}>
        <div style={{ fontSize: 22, marginBottom: 10 }}>📊</div>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 8 }}>
          Run your own reality check
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
          See the true cost of your next big decision — moving out, buying a car,
          paying off debt, or building toward financial freedom.
        </div>
        <button
          onClick={() => {
            // Clear share param from URL
            window.history.replaceState({}, "", window.location.pathname);
            onNavigate("simulate");
          }}
          style={{
            width:        "100%",
            padding:      "14px",
            borderRadius: 14,
            border:       "none",
            background:   "linear-gradient(135deg, #2563eb, #1d4ed8)",
            color:        "#fff",
            fontWeight:   800,
            fontSize:     15,
            cursor:       "pointer",
            fontFamily:   "inherit",
            marginBottom: 10,
          }}
        >
          Try It Free →
        </button>
        <div style={{ fontSize: 11, color: C.muted }}>
          Free to use · No credit card · Save scenarios with a free account
        </div>
      </div>

    </div>
  );
}
