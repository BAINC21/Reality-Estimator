diff --git a/App.jsx b/App.jsx
index b2e03277a270d42f3d8971465bffa1c6032dfb72..d82b6f379a5144b4dd929a5aed1012bd8e8c1ade 100644
--- a/App.jsx
+++ b/App.jsx
@@ -1529,50 +1529,150 @@ function CDTracker({ cd, onUpdate, onDelete }) {
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
 
+function FreedomIncomeSim({ user, onSave }) {
+  const [scenarioName, setScenarioName] = useState("");
+  const [freedomLifestyle, setFreedomLifestyle] = useState(250000);
+  const [taxRate, setTaxRate] = useState(38);
+  const [responsibilities, setResponsibilities] = useState(45000);
+  const [savingsGoals, setSavingsGoals] = useState(35000);
+  const [miscellaneous, setMiscellaneous] = useState(20000);
+
+  const totalTakeHomeNeeded = freedomLifestyle + responsibilities + savingsGoals + miscellaneous;
+  const safeTaxRate = Math.max(0, Math.min(95, taxRate));
+  const taxMultiplier = 1 - (safeTaxRate / 100);
+  const grossIncomeNeeded = taxMultiplier > 0 ? Math.round(totalTakeHomeNeeded / taxMultiplier) : 0;
+  const taxesEstimated = Math.round(grossIncomeNeeded * (safeTaxRate / 100));
+  const monthlyGrossIncome = Math.round(grossIncomeNeeded / 12);
+  const monthlyTakeHome = Math.round(totalTakeHomeNeeded / 12);
+
+  const score = Math.max(0, Math.min(100,
+    (safeTaxRate <= 30 ? 25 : safeTaxRate <= 40 ? 18 : 10) +
+    (savingsGoals >= freedomLifestyle * 0.15 ? 30 : savingsGoals >= freedomLifestyle * 0.1 ? 18 : 8) +
+    (responsibilities <= freedomLifestyle * 0.35 ? 25 : responsibilities <= freedomLifestyle * 0.5 ? 15 : 8) +
+    (miscellaneous <= freedomLifestyle * 0.2 ? 20 : 10)
+  ));
+
+  const { text: aiText, loading: aiLoading } = useAI(
+    `Financial freedom income calculator: freedom lifestyle ${fmt(freedomLifestyle)}/yr, tax rate ${safeTaxRate}%, responsibilities ${fmt(responsibilities)}/yr, savings goals ${fmt(savingsGoals)}/yr, misc ${fmt(miscellaneous)}/yr. Take-home needed ${fmt(totalTakeHomeNeeded)}/yr and gross income needed ${fmt(grossIncomeNeeded)}/yr. Score ${score}/100. Give practical, direct advice.`,
+    [freedomLifestyle, safeTaxRate, responsibilities, savingsGoals, miscellaneous]
+  );
+
+  const handleSave = () => {
+    if (!user) return alert("Create an account to save scenarios!");
+    const label = scenarioName.trim() ? scenarioName.trim() : `Freedom Income — ${fmt(grossIncomeNeeded)}/yr`;
+    onSave({
+      id: Date.now().toString(),
+      type: "freedom",
+      label,
+      date: new Date().toLocaleDateString(),
+      data: {
+        freedomLifestyle, taxRate: safeTaxRate, responsibilities, savingsGoals, miscellaneous,
+        totalTakeHomeNeeded, grossIncomeNeeded, taxesEstimated, monthlyGrossIncome, monthlyTakeHome, score
+      }
+    });
+    setScenarioName("");
+  };
+
+  const breakdown = [
+    { name: "Lifestyle", value: freedomLifestyle },
+    { name: "Responsibilities", value: responsibilities },
+    { name: "Savings Goals", value: savingsGoals },
+    { name: "Misc", value: miscellaneous },
+  ];
+
+  return (
+    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
+      <Card>
+        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Annual Financial Freedom Targets</div>
+        <NumInput label="Lifestyle Amount Needed / Year" value={freedomLifestyle} onChange={setFreedomLifestyle} accentColor={C.primary} />
+        <NumInput label="Tax Rate" value={taxRate} onChange={setTaxRate} prefix="" suffix="%" accentColor="#7c3aed" />
+        <NumInput label="Responsibilities / Year (housing, family, debt)" value={responsibilities} onChange={setResponsibilities} accentColor="#ea580c" />
+        <NumInput label="Savings Goals / Year" value={savingsGoals} onChange={setSavingsGoals} accentColor={C.green} />
+        <NumInput label="Miscellaneous / Year" value={miscellaneous} onChange={setMiscellaneous} accentColor="#0f766e" />
+      </Card>
+
+      <Card>
+        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
+          <ScoreRing score={score} />
+          <div style={{ flex: 1, paddingLeft: 16 }}>
+            <StatRow label="Take-Home Needed (Annual)" value={fmt(totalTakeHomeNeeded)} color={C.text} />
+            <StatRow label="Gross Income Needed (Annual)" value={fmt(grossIncomeNeeded)} color="#7c3aed" />
+            <StatRow label="Estimated Taxes (Annual)" value={fmt(taxesEstimated)} color={C.muted} />
+          </div>
+        </div>
+        <div style={{ background: C.primaryLight, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
+          <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 4 }}>Monthly target</div>
+          <div style={{ fontSize: 13, color: C.muted }}>Gross income needed: <span style={{ fontWeight: 700, color: C.text }}>{fmt(monthlyGrossIncome)}/mo</span> · Take-home target: <span style={{ fontWeight: 700, color: C.text }}>{fmt(monthlyTakeHome)}/mo</span></div>
+        </div>
+        <AIInsight text={aiText} loading={aiLoading} />
+        <div style={{ marginTop: 10 }}>
+          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>Scenario Name (optional)</div>
+          <input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="e.g. My Freedom Number"
+            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", outline: "none", marginBottom: 8 }} />
+        </div>
+        <Btn onClick={handleSave} style={{ width: "100%" }}>💾 Save Scenario</Btn>
+      </Card>
+
+      <Card>
+        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>ANNUAL TAKE-HOME BREAKDOWN</div>
+        <ResponsiveContainer width="100%" height={170}>
+          <BarChart data={breakdown}>
+            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
+            <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} />
+            <YAxis tickFormatter={fmtK} tick={{ fill: C.muted, fontSize: 10 }} />
+            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
+            <Bar dataKey="value" fill="#7c3aed" radius={[6, 6, 0, 0]} />
+          </BarChart>
+        </ResponsiveContainer>
+      </Card>
+    </div>
+  );
+}
+
 function Dashboard({ user, onLogout, onShowAuth, showEmail, onToggleEmail }) {
   const [scenarios, setScenarios] = useState(DB.getScenarios());
   useEffect(() => {
     if (user?.id) {
       SB.getScenarios(user.id).then(data => { if (data.length) { DB.setScenarios(data); setScenarios(data); } });
       // Load dashboard data from Supabase on login (cross-device sync)
       SB.getDashboard(user.id).then(data => {
         if (data) {
           if (data.income != null) { setMonthlyIncome(data.income); DB_DASH.set("income", data.income); }
           if (data.income_streams) { setIncomeStreams(data.income_streams); DB_DASH.set("incomeStreams", data.income_streams); }
           if (data.buckets) { setBuckets(data.buckets); DB_DASH.set("buckets", data.buckets); }
           if (data.cds) { setCDs(data.cds); DB_DASH.set("cds", data.cds); }
           if (data.bills) { setBills(data.bills); DB_DASH.set("bills", data.bills); }
         }
       }).catch(() => {});
     }
   }, [user?.id]);
   const [activeTab, setActiveTab] = useState("overview");
   const [expandedScenarioId, setExpandedScenarioId] = useState(null);
 
   // Income tracker
   const [monthlyIncome, setMonthlyIncome] = useState(() => DB_DASH.get("income") || 4000);
   const [incomeStreams, setIncomeStreams] = useState(() => DB_DASH.get("incomeStreams") || []);
   const [showAddIncome, setShowAddIncome] = useState(false);
   const [newIncomeLabel, setNewIncomeLabel] = useState("");
@@ -1605,52 +1705,52 @@ function Dashboard({ user, onLogout, onShowAuth, showEmail, onToggleEmail }) {
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
 
-  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳" };
-  const colors = { moving: C.primary, car: "#0284c7", project: "#d97706", recession: "#dc2626" };
+  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳", freedom: "💸" };
+  const colors = { moving: C.primary, car: "#0284c7", project: "#d97706", recession: "#dc2626", freedom: "#7c3aed" };
 
   const dashTabs = [
     { id: "overview", label: "Overview" },
     { id: "income", label: "Income" },
     { id: "savings", label: "Savings" },
     { id: "cds", label: "CDs" },
     { id: "bills", label: "Bills" },
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
 
@@ -2172,50 +2272,60 @@ function Dashboard({ user, onLogout, onShowAuth, showEmail, onToggleEmail }) {
               ["Time Cost", fmt(d.timeCost)],
               ["Hidden / Delivery", fmt(d.hidden)],
               ["Buffer Added", fmt(d.bufferAmt)],
               ["Reality Total", fmt(d.total), true],
             );
           } else if (s.type === "recession") {
             rows.push(
               ["Monthly Income", fmt(d.income)],
               ["Current Savings", fmt(d.savings)],
               ["Essential Expenses", fmt(d.essentials)],
               ["Income Drop", `${d.drop}%`],
               ["Emergency Reserve", fmt(d.reserve)],
               ["Reduced Income", fmt(d.reduced)],
               ["Monthly Gap", fmt(d.gap)],
               ["Runway", d.runway >= 99 ? "Indefinite ✓" : `${d.runway} months`, true],
             );
           } else if (s.type === "debt") {
             rows.push(
               ["Strategy", d.strategy === "avalanche" ? "Avalanche (highest APR first)" : "Snowball (smallest balance first)"],
               ["Total Balance", fmt(d.totalBalance)],
               ["Monthly Payment", fmt(d.totalMonthly)],
               ["Payoff Time", fmtMonths ? fmtMonths(d.payoffMonths) : `${d.payoffMonths} mo`],
               ["Total Interest", fmt(d.totalInterest)],
               ["Interest Saved", fmt(d.interestSaved), true],
             );
+          } else if (s.type === "freedom") {
+            rows.push(
+              ["Lifestyle Goal", fmt(d.freedomLifestyle)],
+              ["Tax Rate", `${d.taxRate}%`],
+              ["Responsibilities", fmt(d.responsibilities)],
+              ["Savings Goals", fmt(d.savingsGoals)],
+              ["Miscellaneous", fmt(d.miscellaneous)],
+              ["Take-Home Needed", fmt(d.totalTakeHomeNeeded), true],
+              ["Gross Income Needed", fmt(d.grossIncomeNeeded), true],
+            );
           }
 
           const accentColor = colors[s.type] || C.primary;
 
           return (
             <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
               <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                 {rows.map(([label, value, highlight]) => (
                   <div key={label} style={{ background: highlight ? `${accentColor}12` : C.bg, borderRadius: 8, padding: "8px 10px", border: highlight ? `1px solid ${accentColor}30` : `1px solid ${C.border}` }}>
                     <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
                     <div style={{ fontSize: 14, fontWeight: highlight ? 700 : 500, color: highlight ? accentColor : C.text }}>{value}</div>
                   </div>
                 ))}
               </div>
             </div>
           );
         };
 
         return (
           <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
             {scenarios.length === 0 ? (
               <Card style={{ textAlign: "center", padding: 32 }}>
                 <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                 <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>No saved scenarios yet</div>
                 <div style={{ fontSize: 13, color: C.muted }}>Run a simulator and tap "Save Scenario"</div>
@@ -2374,50 +2484,51 @@ function SettingsPanel({ user, onUpdate, onLogout, showEmail, onToggleEmail }) {
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
+    { id: "freedom", icon: "💸", title: "Freedom Income Calculator", desc: "Income needed for your financial freedom vision", badge: "Income" },
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
@@ -2455,101 +2566,103 @@ function Home({ onNavigate }) {
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
+    { id: "freedom", icon: "💸", label: "Freedom Income" },
   ];
   const [active, setActive] = useState(defaultTab || "moving");
 
   return (
     <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
       <div style={{ marginBottom: 4 }}>
         <div style={{ fontSize: 26, fontWeight: 900, color: C.text, letterSpacing: "-0.02em" }}>⚡ Simulators</div>
         <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>Run a simulation · see the real numbers · save your scenario</div>
       </div>
       <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 4 }}>
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
+      {active === "freedom" && <FreedomIncomeSim user={user} onSave={onSave} />}
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
 
-  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳" };
+  const icons = { moving: "🏠", car: "🚗", project: "🔨", recession: "📉", debt: "💳", freedom: "💸" };
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
