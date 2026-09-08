// Budgets — small home widget + full overview screen + create/edit flow
// Sorted by status: over → close → healthy. Each budget has its own renewal cadence.

const BUDGET_DATA = [
  { name: 'Restaurants', icon: 'fork',   spent: 145, total: 120, period: 'Weekly',   renew: 'every week',    subs: ['Restaurants', 'Coffee'], stack: false },
  { name: 'Groceries',   icon: 'shop',   spent: 270, total: 300, period: 'Monthly',  renew: 'every month',   subs: ['Groceries'], stack: true, stackMax: 600, stackCur: 30 },
  { name: 'Transport',   icon: 'car',    spent: 60,  total: 80,  period: 'Monthly',  renew: 'every month',   subs: ['DB Bahn', 'Uber', 'Fuel'], stack: false },
  { name: 'Hobby',       icon: 'bag',    spent: 90,  total: 200, period: '2 weeks',  renew: 'every 2 weeks', subs: ['Books', 'Gaming'], stack: false },
  { name: 'Coffee runs', icon: 'flame',  spent: 18,  total: 60,  period: '3 weeks',  renew: 'every 3 weeks', subs: ['Coffee shops'], stack: true, stackMax: 120, stackCur: 42 },
];

function budgetMeta(b) {
  const left = b.total - b.spent;
  const over = left < 0;
  const ratio = b.spent / b.total;
  const close = !over && ratio >= 0.8;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  // status sort weight: over=0, close=1, healthy=2
  const statusOrder = over ? 0 : (close ? 1 : 2);
  return { left, over, close, pct, ratio, statusOrder };
}

function budgetColors(b) {
  const m = budgetMeta(b);
  if (m.over)  return { color: WF.red,   soft: WF.redSoft };
  if (m.close) return { color: WF.amber, soft: WF.amberSoft };
  return         { color: WF.green, soft: WF.greenSoft };
}

// Sort: over first, then close, then healthy. Within each bucket, by remaining ratio asc.
function sortedBudgets(list = BUDGET_DATA) {
  return [...list].sort((a, b) => {
    const ma = budgetMeta(a), mb = budgetMeta(b);
    if (ma.statusOrder !== mb.statusOrder) return ma.statusOrder - mb.statusOrder;
    return ma.ratio - mb.ratio; // less left first within bucket
  });
}

// ── Compact widget for the Home screen ─────────────────────────
// Replaces the old big BudgetsCard. Top 3 attention-needing budgets only.
function BudgetsHomeWidget() {
  const sorted = sortedBudgets();
  // Show only over + close + (filler healthy if we have <3 attention items)
  const attention = sorted.filter(b => {
    const m = budgetMeta(b);
    return m.over || m.close;
  });
  const top = (attention.length >= 3 ? attention : sorted).slice(0, 3);

  const counts = sorted.reduce((acc, b) => {
    const m = budgetMeta(b);
    if (m.over) acc.over++;
    else if (m.close) acc.close++;
    else acc.healthy++;
    return acc;
  }, { over: 0, close: 0, healthy: 0 });

  return (
    <div className="wf-card" style={{ padding: 16 }}>
      <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="wf-section-title">Budgets</div>
        <div className="wf-row" style={{ gap: 4, color: WF.ink3 }}>
          <div className="wf-cap" style={{ fontWeight: 600 }}>See all {sorted.length}</div>
          <Ico name="arrowR" size={12} color={WF.ink3}/>
        </div>
      </div>
      <div className="wf-row" style={{ gap: 6, marginBottom: 12 }}>
        {counts.over > 0 && <span className="wf-pill" style={{ background: WF.redSoft, color: WF.red }}>{counts.over} over</span>}
        {counts.close > 0 && <span className="wf-pill" style={{ background: WF.amberSoft, color: WF.amber }}>{counts.close} close</span>}
        {counts.healthy > 0 && <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>{counts.healthy} healthy</span>}
      </div>

      <div className="wf-col" style={{ gap: 10 }}>
        {top.map(b => <BudgetMiniRow key={b.name} b={b}/>)}
      </div>
    </div>
  );
}

function BudgetMiniRow({ b }) {
  const m = budgetMeta(b);
  const c = budgetColors(b);
  return (
    <div className="wf-row" style={{ gap: 10 }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: c.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ico name={b.icon} size={13} color={c.color}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{b.name}</div>
          <div className="wf-num" style={{ fontSize: 11, fontWeight: 600, color: m.over ? WF.red : WF.ink2 }}>
            {m.over ? `−€${Math.abs(m.left)}` : `€${m.left} left`}
          </div>
        </div>
        <div style={{ height: 4, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${m.pct}%`, height: '100%', background: c.color }}/>
          {m.over && (
            <div style={{
              flex: 1, height: '100%',
              backgroundImage: `repeating-linear-gradient(45deg, ${WF.red} 0 3px, ${WF.redSoft} 3px 6px)`,
            }}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Budgets overview screen (full list) ────────────────────────
function ScreenBudgets() {
  const sorted = sortedBudgets();

  return (
    <ScreenShell>
      <WFAppBar
        title="Budgets"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Top summary */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-cap">Total budgeted · 5 budgets</div>
          <div className="wf-num" style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>€760 · €177 over</div>
          <div className="wf-row" style={{ gap: 8, marginTop: 8 }}>
            <span className="wf-pill" style={{ background: WF.redSoft, color: WF.red }}>1 over</span>
            <span className="wf-pill" style={{ background: WF.amberSoft, color: WF.amber }}>2 close</span>
            <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>2 healthy</span>
          </div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Sorted: over → close → healthy</div>
        <div className="wf-col" style={{ gap: 10 }}>
          {sorted.map(b => <BudgetCard key={b.name} b={b}/>)}
        </div>

        <button className="wf-btn outline" style={{ width: '100%', marginTop: 16, height: 48, borderStyle: 'dashed' }}>
          <Ico name="plus" size={16}/> New budget
        </button>
      </WFBody>
    </ScreenShell>
  );
}

function BudgetCard({ b }) {
  const m = budgetMeta(b);
  const c = budgetColors(b);

  return (
    <div className="wf-card" style={{ padding: 14, position: 'relative', overflow: 'hidden' }}>
      {m.over && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: WF.red }}/>
      )}
      <div className="wf-row" style={{ gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: c.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico name={b.icon} size={16} color={c.color}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
            <div className="wf-num" style={{ fontSize: 13, fontWeight: 600, color: m.over ? WF.red : WF.ink }}>
              {m.over ? `−€${Math.abs(m.left)}` : `€${m.left} left`}
            </div>
          </div>
          <div className="wf-cap" style={{ marginTop: 1 }}>{b.period} · renews {b.renew}</div>
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${m.pct}%`, height: '100%', background: c.color }}/>
        {m.over && (
          <div style={{
            flex: 1, height: '100%',
            backgroundImage: `repeating-linear-gradient(45deg, ${WF.red} 0 4px, ${WF.redSoft} 4px 8px)`,
          }}/>
        )}
      </div>
      <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <div className="wf-cap">€{b.spent} of €{b.total}</div>
        <div className="wf-cap" style={{ color: c.color }}>{m.over ? `${Math.round((b.spent/b.total - 1) * 100)}% over` : `${Math.round(m.pct)}% used`}</div>
      </div>

      {/* Stack indicator */}
      {b.stack && (
        <div className="wf-row" style={{ gap: 6, marginTop: 8, padding: '6px 8px', borderRadius: 6, background: WF.fillSoft }}>
          <Ico name="rocket" size={12} color={WF.ink3}/>
          <div className="wf-cap" style={{ flex: 1, fontSize: 11 }}>
            Stacks · €{b.stackCur} carried · max €{b.stackMax}
          </div>
        </div>
      )}

      <div className="wf-row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {b.subs.map(s => (
          <span key={s} className="wf-pill" style={{ background: WF.fillSoft, color: WF.ink3, fontSize: 10 }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// ── Budget create / edit ───────────────────────────────────────
function ScreenBudgetCreate() {
  return (
    <ScreenShell>
      <WFAppBar
        title="New budget"
        leading={<Ico name="x" size={22}/>}
        trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Save</div>}
      />
      <WFBody>
        {/* Icon + Name combined */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Icon &amp; name</div>
        <div className="wf-row" style={{ gap: 10, marginBottom: 14 }}>
          <button style={{
            width: 56, height: 56, borderRadius: 12,
            border: `1px solid ${WF.line}`, background: WF.fillSoft,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          }}>
            <Ico name="fork" size={20} color={WF.ink2}/>
            <div className="wf-cap" style={{ fontSize: 9, color: WF.ink3 }}>change</div>
          </button>
          <div className="wf-input" style={{ flex: 1 }}>Eating out</div>
        </div>

        {/* Icon picker preview row (hint that it opens a sheet) */}
        <div className="wf-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {['fork','shop','car','bag','house','health','flame','film','rocket','wallet'].map((n, i) => (
            <div key={n} style={{
              width: 36, height: 36, borderRadius: 8,
              border: `1px solid ${i === 0 ? WF.ink : WF.line}`,
              background: i === 0 ? WF.ink : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ico name={n} size={16} color={i === 0 ? '#fff' : WF.ink2}/>
            </div>
          ))}
        </div>

        {/* Amount */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Amount</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, textAlign: 'center' }}>
          <div className="wf-cap">Limit</div>
          <div className="wf-num" style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>€ 120</div>
          <div className="wf-cap" style={{ marginTop: 2 }}>tap to edit</div>
        </div>

        {/* Sub-categories — multi-select with conflict warnings */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Sub-categories</div>
          <div className="wf-cap">2 selected</div>
        </div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 8 }}>
          {[
            { grp: 'Consumptions', name: 'Restaurants', sel: true },
            { grp: 'Consumptions', name: 'Coffee',      sel: true },
            { grp: 'Consumptions', name: 'Groceries',   sel: false, taken: 'Groceries' },
            { grp: 'Consumptions', name: 'Snacks',      sel: false },
            { grp: 'Hobby',        name: 'Books',       sel: false },
            { grp: 'Hobby',        name: 'Gaming',      sel: false, taken: 'Hobby' },
          ].map((s, i, a) => {
            const disabled = !!s.taken;
            return (
              <React.Fragment key={s.name}>
                <div className="wf-row" style={{ padding: '12px 0', gap: 12, opacity: disabled ? 0.55 : 1 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: `2px solid ${s.sel ? WF.ink : WF.line}`,
                    background: s.sel ? WF.ink : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {s.sel && <Ico name="check" size={11} color="#fff" stroke={3}/>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="wf-row" style={{ gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                      {disabled && (
                        <span className="wf-pill" style={{ background: WF.amberSoft, color: WF.amber, fontSize: 9 }}>
                          in &lsquo;{s.taken}&rsquo;
                        </span>
                      )}
                    </div>
                    <div className="wf-cap">{s.grp}</div>
                  </div>
                </div>
                {i < a.length - 1 && <Divider/>}
              </React.Fragment>
            );
          })}
        </div>
        <div className="wf-cap" style={{ marginBottom: 14, color: WF.ink3 }}>
          Greyed-out categories already belong to another budget — a sub-category can only live in one.
        </div>

        {/* Renewal frequency */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Renews every</div>
        <div className="wf-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {[
            { l: '1 day' },
            { l: '1 week', sel: true },
            { l: '2 weeks' },
            { l: '3 weeks' },
            { l: 'Same as period' },
          ].map(o => (
            <span key={o.l} className="wf-chip" style={{
              borderColor: o.sel ? WF.ink : WF.line,
              background: o.sel ? WF.ink : '#fff',
              color: o.sel ? '#fff' : WF.ink2,
              fontWeight: o.sel ? 600 : 400,
            }}>{o.l}</span>
          ))}
        </div>

        {/* Carry-over with stack max */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Carry over leftover</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Stack unused budget</div>
              <div className="wf-cap" style={{ marginTop: 2 }}>
                Unspent €€ rolls into next renewal. Spent €5 of €10 this week → next week starts with €15.
              </div>
            </div>
            {/* On toggle */}
            <div style={{ width: 38, height: 22, borderRadius: 999, background: WF.ink, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: '#fff' }}/>
            </div>
          </div>
        </div>

        {/* Stack max */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Maximum stack</div>
            <div className="wf-cap">optional</div>
          </div>
          <div className="wf-row" style={{ gap: 8, marginBottom: 8 }}>
            <div className="wf-input" style={{ flex: 1, height: 38, fontSize: 14, fontFamily: WF.fontMono }}>€ 600</div>
            <div className="wf-cap" style={{ alignSelf: 'center' }}>cap</div>
          </div>
          {/* Stack visualization — bars showing how stack accumulates */}
          <div className="wf-row" style={{ alignItems: 'flex-end', gap: 4, height: 44 }}>
            {[120, 240, 360, 480, 600, 600].map((amt, i) => {
              const pct = (amt / 600) * 100;
              const capped = i >= 4;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{
                    width: '100%', height: `${pct}%`,
                    background: capped ? WF.amber : WF.ink2,
                    borderRadius: 3,
                  }}/>
                  <div style={{ fontSize: 8, color: WF.ink4 }}>w{i+1}</div>
                </div>
              );
            })}
          </div>
          <div className="wf-cap" style={{ marginTop: 6, fontSize: 10, color: WF.ink3 }}>
            Stack stops growing once it hits the cap (amber).
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenBudgets, ScreenBudgetCreate, BUDGET_DATA, BudgetCard,
  BudgetsHomeWidget, sortedBudgets, budgetMeta, budgetColors,
});
