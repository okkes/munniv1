// Home screen + variations

// Shared header used in home (avatar, balance, sync, menu)
function HomeHeader({ name = 'Demo', balance = '€8 725,68', synced = 'Last sync 15:38' }) {
  return (
    <div style={{ padding: '8px 20px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 999, background: WF.fillSoft, border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink3, fontWeight: 600, fontSize: 14 }}>D</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wf-cap">{name} · <span style={{ color: WF.ink4 }}>{synced}</span></div>
        <div className="wf-h2 wf-num" style={{ marginTop: 2 }}>{balance}</div>
      </div>
      <button className="wf-btn outline sm" style={{ height: 36 }}>
        <Ico name="sync" size={16}/> Sync
      </button>
      <Ico name="menu" size={22} color={WF.ink2}/>
    </div>
  );
}

// Period summary - 5 stats now (added Investment). Two visual treatments.
// Note: "Left to spend" was replaced by "Allocate" (YNAB-style proactive).
function PeriodSummary({ variant = 'grid' }) {
  const stats = [
    { id: 'income', label: 'Income', value: '€2 480', icon: 'arrow-dn-right', color: WF.green, soft: WF.greenSoft, sub: '+ 4% vs last' },
    { id: 'expense', label: 'Expense', value: '€1 220', icon: 'arrow-up-right', color: WF.red, soft: WF.redSoft, sub: '− 8% vs last' },
    { id: 'savings', label: 'Savings', value: '€640', icon: 'piggy', color: WF.amber, soft: WF.amberSoft, sub: '26% rate' },
    { id: 'invest', label: 'Investment', value: '€300', icon: 'rocket', color: WF.blue, soft: WF.blueSoft, sub: '+€42 m/m' },
    { id: 'allocate', label: 'Allocate', value: '€620', icon: 'goal', color: WF.ink, soft: WF.fillSoft, sub: 'unallocated' },
  ];

  if (variant === 'hero') {
    // hero variant: no big blue block — emphasise income vs expense rhythm
    return (
      <div className="wf-card" style={{ padding: 16 }}>
        <PeriodHeader/>
        <div className="wf-row" style={{ marginTop: 12, gap: 10 }}>
          <div style={{ flex: 1, padding: 14, borderRadius: 10, background: WF.greenSoft }}>
            <div className="wf-cap" style={{ color: WF.green, fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>Income</div>
            <div className="wf-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>€2 480</div>
          </div>
          <div style={{ flex: 1, padding: 14, borderRadius: 10, background: WF.redSoft }}>
            <div className="wf-cap" style={{ color: WF.red, fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>Expense</div>
            <div className="wf-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>€1 220</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          {[stats[2], stats[3]].map(s => (
            <div key={s.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${WF.line2}` }}>
              <Ico name={s.icon} size={14} color={s.color}/>
              <div className="wf-cap" style={{ marginTop: 4 }}>{s.label}</div>
              <div className="wf-num" style={{ fontSize: 16, fontWeight: 600, marginTop: 1 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // grid — 2-col with last (Allocate) spanning full width
  return (
    <div className="wf-card" style={{ padding: 16 }}>
      <PeriodHeader/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        {stats.map((s, i) => (
          <div key={s.id} style={{ padding: 10, borderRadius: 10, background: s.soft, position: 'relative', gridColumn: (i === stats.length - 1 && stats.length % 2 === 1) ? '1 / -1' : 'auto' }}>
            <div className="wf-row" style={{ gap: 6, marginBottom: 4 }}>
              <Ico name={s.icon} size={12} color={s.color}/>
              <div className="wf-cap" style={{ color: s.color, fontWeight: 600, textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.06em' }}>{s.label}</div>
            </div>
            <div className="wf-num" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{s.value}</div>
            <div className="wf-cap" style={{ marginTop: 1, fontSize: 10 }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodHeader() {
  return (
    <div className="wf-row" style={{ justifyContent: 'space-between' }}>
      <div className="wf-section-title">This period</div>
      <div className="wf-row" style={{ gap: 8, color: WF.ink3 }}>
        <Ico name="arrowL" size={14} color={WF.ink3}/>
        <div className="wf-cap" style={{ fontWeight: 600 }}>20 Jan – 19 Feb</div>
        <Ico name="arrowR" size={14} color={WF.ink3}/>
      </div>
    </div>
  );
}

// Category review banner — ALWAYS visible (shows 0 when none)
function CategoryReviewBanner({ count = 12 }) {
  const has = count > 0;
  return (
    <div className="wf-card" style={{ padding: 16 }}>
      <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="wf-section-title">Category review</div>
        <span className="wf-pill" style={{ background: has ? WF.amberSoft : WF.fillSoft, color: has ? WF.amber : WF.ink3 }}>
          {has ? `${count} to review` : 'all caught up'}
        </span>
      </div>
      <div className="wf-body" style={{ marginBottom: 12 }}>
        {has ? 'New transactions need a quick review.' : 'No new transactions waiting.'}
      </div>
      <div className="wf-row" style={{ gap: 8 }}>
        <button className="wf-btn sm" style={{ opacity: has ? 1 : 0.4 }}>Review now</button>
      </div>
    </div>
  );
}

// Budgets card — uses the compact widget defined in wf-screens-budgets.jsx
function BudgetsCard() {
  return <BudgetsHomeWidget/>;
}

// Goals card (placeholder — not designed)
function GoalsCard() {
  return null;
}

// Home screen — variants:
// 'A' : Period grid hero, then review, budgets, goals
// 'B' : Period hero+stats, review at top (alt rhythm)
function ScreenHome({ variant = 'A' }) {
  return (
    <ScreenShell tabBar activeTab="home">
      <HomeHeader/>
      <WFBody style={{ paddingTop: 4 }}>
        {variant === 'A' ? (
          <div className="wf-col" style={{ gap: 14 }}>
            <PeriodSummary variant="grid"/>
            <CategoryReviewBanner/>
            <BudgetsCard/>
            <GoalsCard/>
          </div>
        ) : (
          <div className="wf-col" style={{ gap: 14 }}>
            <CategoryReviewBanner/>
            <PeriodSummary variant="hero"/>
            <BudgetsCard/>
            <GoalsCard/>
          </div>
        )}
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenHome, HomeHeader, PeriodSummary, CategoryReviewBanner, BudgetsCard, GoalsCard,
});
