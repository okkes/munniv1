// Goals — long-term savings buckets
// Linked to actual saving balance. User allocates available saving budget
// across goals. If saving balance drops below allocated total → warning.

const GOALS_DATA = [
  { name: 'House down payment', icon: 'house',  saved: 4200,  target: 30000, perPeriod: 400, deadline: 'Jun 2030', auto: true },
  { name: 'New car',            icon: 'car',    saved: 1800,  target: 8000,  perPeriod: 150, deadline: 'Dec 2027', auto: true },
  { name: 'Holiday · Japan',    icon: 'globe',  saved: 950,   target: 2500,  perPeriod: 100, deadline: 'May 2026', auto: false },
  { name: 'Emergency fund',     icon: 'lock',   saved: 1200,  target: 3000,  perPeriod: 50,  deadline: '—',        auto: true },
];

const ARCHIVED_GOALS = [
  { name: 'New laptop',    icon: 'box',  target: 1200 },
  { name: 'Wedding gift',  icon: 'star', target: 400 },
];

// ── Goals overview ────────────────────────────────────────────
function ScreenGoals() {
  const totalAllocated = GOALS_DATA.reduce((s, g) => s + g.saved, 0);
  const savingsAvailable = 7400; // < totalAllocated would trigger warning
  const overAllocated = totalAllocated - savingsAvailable;
  const isOver = overAllocated > 0;

  return (
    <ScreenShell>
      <WFAppBar
        title="Goals"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Saving available */}
        <div className="wf-card" style={{
          padding: 16, marginBottom: 14,
          background: isOver ? WF.redSoft : WF.fillSoft, border: 'none',
        }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div className="wf-cap" style={{ fontWeight: 600, color: WF.ink2 }}>Saving balance</div>
            <span className="wf-pill" style={{ background: '#fff', color: WF.ink3 }}>linked to bank</span>
          </div>
          <div className="wf-num" style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>€{savingsAvailable.toLocaleString()}</div>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <div className="wf-cap">Allocated to goals</div>
            <div className="wf-num wf-cap" style={{ fontWeight: 600, color: WF.ink }}>€{totalAllocated.toLocaleString()}</div>
          </div>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <div className="wf-cap" style={{ color: isOver ? WF.red : WF.green, fontWeight: 600 }}>
              {isOver ? 'Over-allocated' : 'Free to allocate'}
            </div>
            <div className="wf-num wf-cap" style={{ fontWeight: 600, color: isOver ? WF.red : WF.green }}>
              {isOver ? `−€${overAllocated.toLocaleString()}` : `€${(savingsAvailable - totalAllocated).toLocaleString()}`}
            </div>
          </div>
          {isOver && (
            <div className="wf-cap" style={{ marginTop: 8, color: WF.red }}>
              ⚠ You withdrew from savings. Reduce a goal allocation to balance.
            </div>
          )}
        </div>

        {/* Auto-allocate CTA */}
        <button className="wf-btn" style={{ width: '100%', height: 44, marginBottom: 14 }}>
          <Ico name="rocket" size={16} color="#fff"/> Auto-allocate this period (€700)
        </button>

        {/* Active goals */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Active · {GOALS_DATA.length}</div>
        <div className="wf-col" style={{ gap: 10 }}>
          {GOALS_DATA.map(g => <GoalCard key={g.name} g={g}/>)}
        </div>

        {/* Archived (secondary) */}
        <div className="wf-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 6 }}>
          <div className="wf-section-title">Achieved & closed</div>
          <Ico name="arrowR" size={14} color={WF.ink4}/>
        </div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {ARCHIVED_GOALS.map((g, i, a) => (
            <React.Fragment key={g.name}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: WF.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name="check" size={14} color={WF.green} stroke={2.4}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</div>
                  <div className="wf-cap">€{g.target} · achieved</div>
                </div>
                <Ico name="arrowR" size={12} color={WF.ink4}/>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

function GoalCard({ g }) {
  const pct = Math.min(100, (g.saved / g.target) * 100);
  return (
    <div className="wf-card" style={{ padding: 14 }}>
      <div className="wf-row" style={{ gap: 10, marginBottom: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico name={g.icon} size={18} color={WF.ink2}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</div>
            {g.auto && <span className="wf-pill" style={{ background: WF.blueSoft, color: WF.blue, fontSize: 9 }}>auto</span>}
          </div>
          <div className="wf-cap" style={{ marginTop: 1 }}>
            <span className="wf-num">€{g.saved.toLocaleString()}</span> / <span className="wf-num">€{g.target.toLocaleString()}</span>
            {' · '}{Math.round(pct)}%
          </div>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: WF.ink }}/>
      </div>
      <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <div className="wf-cap"><span className="wf-num">€{g.perPeriod}</span> / period</div>
        <div className="wf-cap">by {g.deadline}</div>
      </div>
    </div>
  );
}

// ── Goal create / edit ─────────────────────────────────────────
function ScreenGoalCreate() {
  return (
    <ScreenShell>
      <WFAppBar
        title="New goal"
        leading={<Ico name="x" size={22}/>}
        trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Create</div>}
      />
      <WFBody>
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Name</div>
        <div className="wf-input" style={{ marginBottom: 14 }}>House down payment</div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Target amount</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, textAlign: 'center' }}>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>€ 30 000</div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Achieve by</div>
        <div className="wf-row" style={{ gap: 8, marginBottom: 14 }}>
          <div className="wf-input" style={{ flex: 1 }}>Jun 2030</div>
          <div className="wf-input" style={{ width: 110, justifyContent: 'center' }}>52 mo</div>
        </div>

        {/* Required vs target — calc */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, background: WF.fillSoft, border: 'none' }}>
          <div className="wf-cap">To reach this goal you'd save</div>
          <div className="wf-num" style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>€575 / period</div>
          <div className="wf-cap" style={{ marginTop: 2 }}>at 52 monthly periods</div>
        </div>

        {/* Per-period override */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>I want to put aside</div>
        <div className="wf-row" style={{ gap: 8, marginBottom: 14 }}>
          <div className="wf-input" style={{ flex: 1, fontFamily: WF.fontMono }}>€ 400</div>
          <div className="wf-cap" style={{ alignSelf: 'center' }}>per period</div>
        </div>
        <div className="wf-cap" style={{ marginBottom: 14, color: WF.amber }}>
          ⚠ At €400/period you'll reach this goal in 75 months — past deadline.
        </div>

        {/* Auto-allocate toggle */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Auto-allocate each period</div>
              <div className="wf-cap" style={{ marginTop: 2 }}>
                When you save money, automatically reserve €400 here.
              </div>
            </div>
            <div style={{ width: 38, height: 22, borderRadius: 999, background: WF.ink, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: '#fff' }}/>
            </div>
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenGoals, ScreenGoalCreate, GoalCard, GOALS_DATA,
});
