// Allocate — YNAB-style "give every euro a job"
// Subscriptions on top (actionable), then Fixed costs, then variable topics.
// Period scrubber with arrows, total + remaining, "add recurring" flow, year overview.

const ALLOCATE_TOPICS = [
  // Subscriptions FIRST — actionable, easy to cancel/swap
  { name: 'Subscriptions', icon: 'film',   expected: 50,  actual: 38,  subs: ['Spotify', 'Netflix', 'iCloud', 'Adobe'], group: 'subs' },
  // Fixed costs — rarely changeable
  { name: 'Housing',  icon: 'house',  expected: 800, actual: 415, subs: ['Rent', 'Utilities'], group: 'fixed' },
  // Variable
  { name: 'Food',     icon: 'shop',   expected: 500, actual: 380, subs: ['Groceries', 'Restaurants', 'Coffee'], group: 'var' },
  { name: 'Transport',icon: 'car',    expected: 100, actual: 80,  subs: ['DB Bahn', 'Uber', 'Fuel'], group: 'var' },
  { name: 'Hobby',    icon: 'bag',    expected: 100, actual: 280, subs: ['Books', 'Gaming'], group: 'var' },
  { name: 'Saving',   icon: 'piggy',  expected: 600, actual: 600, subs: ['Emergency', 'Holiday'], group: 'save' },
  { name: 'Buffer',   icon: 'wallet', expected: 280, actual: 0,   subs: ['Buffer'], group: 'save' },
];

// Period scrubber with arrows
function PeriodScrubber({ label = '20 Jan – 19 Feb', sub }) {
  return (
    <div className="wf-row" style={{
      gap: 0, marginBottom: 14, padding: '8px 4px',
      borderRadius: 10, border: `1px solid ${WF.line2}`, background: '#fff',
    }}>
      <button style={{
        width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        <Ico name="arrowL" size={18} color={WF.ink2}/>
      </button>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="wf-cap" style={{ fontWeight: 600, color: WF.ink, fontSize: 13 }}>{label}</div>
        {sub && <div className="wf-cap" style={{ fontSize: 10, marginTop: 1 }}>{sub}</div>}
      </div>
      <button style={{
        width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        <Ico name="arrowR" size={18} color={WF.ink2}/>
      </button>
    </div>
  );
}

// ── Allocate overview ──────────────────────────────────────────
function ScreenAllocate() {
  const totalIncome = 2480;
  const totalAllocated = ALLOCATE_TOPICS.reduce((s, t) => s + t.expected, 0);
  const totalSpent = ALLOCATE_TOPICS.reduce((s, t) => s + t.actual, 0);
  const totalLeft = totalAllocated - totalSpent;
  const unallocated = totalIncome - totalAllocated;

  // ordering: subs → fixed → var → save
  const groupOrder = { subs: 0, fixed: 1, var: 2, save: 3 };
  const ordered = [...ALLOCATE_TOPICS].sort((a, b) => groupOrder[a.group] - groupOrder[b.group]);

  return (
    <ScreenShell>
      <WFAppBar
        title="Allocate"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="help" size={20}/>}
      />
      <WFBody>
        <PeriodScrubber label="20 Jan – 19 Feb" sub="period 8 of 12"/>

        {/* Hero — total / spent / left */}
        <div className="wf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="wf-cap">Allocated this period</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>€{totalAllocated.toLocaleString('en-US')}</div>
          {/* Spent / left progress */}
          <div className="wf-row" style={{ gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>SPENT</div>
              <div className="wf-num" style={{ fontSize: 14, fontWeight: 600 }}>€{totalSpent.toLocaleString('en-US')}</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>LEFT</div>
              <div className="wf-num" style={{ fontSize: 14, fontWeight: 600, color: WF.green }}>€{totalLeft.toLocaleString('en-US')}</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>UNALLOC</div>
              <div className="wf-num" style={{ fontSize: 14, fontWeight: 600, color: unallocated === 0 ? WF.green : WF.ink }}>€{Math.abs(unallocated)}</div>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', marginTop: 12 }}>
            <div style={{ width: `${(totalSpent/totalAllocated)*100}%`, height: '100%', background: WF.ink2 }}/>
          </div>
        </div>

        {/* Year overview link */}
        <div className="wf-card" style={{ padding: 12, marginBottom: 14, background: WF.fillSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <Ico name="cal" size={16} color={WF.ink2}/>
            <div style={{ flex: 1, fontSize: 12, color: WF.ink2 }}>
              <b>Year overview</b> · €29 760 allocated across 12 periods
            </div>
            <Ico name="arrowR" size={14} color={WF.ink3}/>
          </div>
        </div>

        {/* Subscriptions FIRST — most actionable */}
        <SectionHeader title="Subscriptions" sub="cancel or swap to save" cta="+ Add"/>
        <div className="wf-col" style={{ gap: 8, marginBottom: 14 }}>
          {ordered.filter(t => t.group === 'subs').map(t => <AllocateRow key={t.name} t={t}/>)}
        </div>

        <SectionHeader title="Fixed costs" sub="hard to change" cta="+ Add"/>
        <div className="wf-col" style={{ gap: 8, marginBottom: 14 }}>
          {ordered.filter(t => t.group === 'fixed').map(t => <AllocateRow key={t.name} t={t}/>)}
        </div>

        <SectionHeader title="Variable topics" cta="+ New topic"/>
        <div className="wf-col" style={{ gap: 8, marginBottom: 14 }}>
          {ordered.filter(t => t.group === 'var').map(t => <AllocateRow key={t.name} t={t}/>)}
        </div>

        <SectionHeader title="Saving & Buffer"/>
        <div className="wf-col" style={{ gap: 8, marginBottom: 14 }}>
          {ordered.filter(t => t.group === 'save').map(t => <AllocateRow key={t.name} t={t}/>)}
        </div>

        <div className="wf-card" style={{ padding: 12, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap" style={{ color: WF.ink2 }}>
            <b>Hobby is €180 over</b> — pull funds from Buffer or Saving to balance.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

function SectionHeader({ title, sub, cta }) {
  return (
    <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
      <div>
        <div className="wf-section-title">{title}</div>
        {sub && <div className="wf-cap" style={{ fontSize: 10, marginTop: 1 }}>{sub}</div>}
      </div>
      {cta && <div className="wf-cap" style={{ color: WF.blue, fontWeight: 600 }}>{cta}</div>}
    </div>
  );
}

function AllocateRow({ t }) {
  const remaining = t.expected - t.actual;
  const over = remaining < 0;
  const pct = Math.min(100, (t.actual / Math.max(1, t.expected)) * 100);
  const color = over ? WF.red : (pct > 90 ? WF.amber : WF.ink2);

  return (
    <div className="wf-card" style={{ padding: 12 }}>
      <div className="wf-row" style={{ gap: 10, marginBottom: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico name={t.icon} size={14} color={WF.ink2}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div className="wf-row" style={{ gap: 5 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
              <Ico name="edit" size={11} color={WF.ink4}/>
            </div>
            <div className="wf-num" style={{ fontSize: 13, fontWeight: 700, color: over ? WF.red : WF.ink }}>
              {over ? '−' : ''}€{Math.abs(remaining)}
            </div>
          </div>
          <div className="wf-cap" style={{ marginTop: 1 }}>
            {t.subs.join(' · ')}
          </div>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }}/>
      </div>
      <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <div className="wf-cap"><span className="wf-num">€{t.actual}</span> spent</div>
        <div className="wf-cap">of <span className="wf-num">€{t.expected}</span> allocated</div>
      </div>
    </div>
  );
}

// ── Add recurring cost (subscription / fixed) ──────────────────
function ScreenAllocateAddRecurring() {
  return (
    <ScreenShell>
      <WFAppBar title="Add recurring cost" leading={<Ico name="x" size={22}/>} trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Save</div>}/>
      <WFBody>
        {/* Type segmented control */}
        <div className="wf-row" style={{ padding: 4, background: WF.fillSoft, borderRadius: 10, marginBottom: 14, gap: 4 }}>
          {[
            { l: 'Subscription', sel: true, ico: 'film' },
            { l: 'Fixed cost',  sel: false, ico: 'house' },
          ].map(o => (
            <button key={o.l} style={{
              flex: 1, height: 36, borderRadius: 8, border: 'none',
              background: o.sel ? '#fff' : 'transparent',
              fontWeight: o.sel ? 600 : 500, fontSize: 12,
              color: o.sel ? WF.ink : WF.ink3,
              boxShadow: o.sel ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Ico name={o.ico} size={13} color={o.sel ? WF.ink : WF.ink3}/>
              {o.l}
            </button>
          ))}
        </div>

        {/* Suggested from existing tx */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Detected from transactions</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 14 }}>
          {[
            { name: 'Disney+', amt: 8.99, freq: '3 charges, monthly', sel: true, ico: 'film' },
            { name: 'NYT',     amt: 4.50, freq: '5 charges, monthly', sel: false, ico: 'list' },
          ].map((s, i, a) => (
            <React.Fragment key={s.name}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={s.ico} size={14} color={WF.ink2}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div className="wf-cap">€{s.amt} · {s.freq}</div>
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: 999,
                  border: `2px solid ${s.sel ? WF.ink : WF.line}`,
                  background: s.sel ? WF.ink : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {s.sel && <Ico name="check" size={11} color="#fff" stroke={3}/>}
                </div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        {/* Manual entry */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Or enter manually</div>
        <div className="wf-input" style={{ marginBottom: 10 }}>Disney+</div>

        <div className="wf-row" style={{ gap: 8, marginBottom: 10 }}>
          <div className="wf-input" style={{ flex: 1, fontFamily: WF.fontMono }}>€ 8,99</div>
          <div className="wf-input" style={{ flex: 1 }}>Monthly ▾</div>
        </div>

        <div className="wf-row" style={{ gap: 8, marginBottom: 14 }}>
          <div className="wf-input" style={{ flex: 1 }}>Subscriptions ▾</div>
          <div className="wf-input" style={{ flex: 1 }}>Next: 04 Mar ▾</div>
        </div>

        <div className="wf-card" style={{ padding: 12, background: WF.blueSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 8 }}>
            <Ico name="link" size={14} color={WF.blue}/>
            <div className="wf-cap" style={{ flex: 1, color: WF.ink2 }}>
              Reserves €8,99/period in <b>Allocate → Subscriptions</b>.
            </div>
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Year overview ──────────────────────────────────────────────
function ScreenAllocateYear() {
  // 12 periods of bars showing allocated vs actual
  const months = ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb'];
  const data = months.map((m, i) => ({
    m,
    alloc: 2480,
    actual: i < 11 ? (1900 + Math.round(Math.sin(i * 1.7) * 300)) : 1755,
    cur: i === 11,
  }));
  const maxV = 2600;
  const totalAlloc = data.reduce((s, d) => s + d.alloc, 0);
  const totalActual = data.reduce((s, d) => s + d.actual, 0);

  return (
    <ScreenShell>
      <WFAppBar title="Year overview" sub="2026" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <PeriodScrubber label="2026" sub="tap year to switch"/>

        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="wf-cap">ALLOCATED</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700 }}>€{totalAlloc.toLocaleString('en-US')}</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap">SPENT</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700 }}>€{totalActual.toLocaleString('en-US')}</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap">SAVED</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700, color: WF.green }}>€{(totalAlloc - totalActual).toLocaleString('en-US')}</div>
            </div>
          </div>
        </div>

        {/* 12-period bar chart */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Spent per period</div>
        <div className="wf-card" style={{ padding: 14 }}>
          <div className="wf-row" style={{ alignItems: 'flex-end', gap: 4, height: 130 }}>
            {data.map(d => {
              const aPct = (d.actual / maxV) * 100;
              const bPct = (d.alloc / maxV) * 100;
              return (
                <div key={d.m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ position: 'relative', width: '100%', height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{
                      position: 'absolute', bottom: `${bPct}%`, left: 0, right: 0,
                      height: 1, borderTop: `1px dashed ${WF.ink3}`,
                    }}/>
                    <div style={{
                      width: '70%', height: `${aPct}%`,
                      background: d.cur ? WF.ink : WF.ink3, borderRadius: 2,
                    }}/>
                  </div>
                  <div style={{ fontSize: 8, color: WF.ink4 }}>{d.m}</div>
                </div>
              );
            })}
          </div>
          <div className="wf-row" style={{ gap: 12, marginTop: 10, justifyContent: 'center' }}>
            <div className="wf-cap"><span style={{ display: 'inline-block', width: 8, height: 8, background: WF.ink3, borderRadius: 2, marginRight: 4 }}/>actual</div>
            <div className="wf-cap"><span style={{ display: 'inline-block', width: 12, height: 1, borderTop: `1px dashed ${WF.ink3}`, marginRight: 4, marginBottom: 2 }}/>allocated</div>
          </div>
        </div>

        {/* Recurring totals year */}
        <div className="wf-section-title" style={{ marginTop: 18, marginBottom: 6 }}>Yearly recurring</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {[
            { n: 'Housing',       y: 9600, ico: 'house' },
            { n: 'Subscriptions', y: 600,  ico: 'film' },
            { n: 'Insurance',     y: 1740, ico: 'health' },
          ].map((r, i, a) => (
            <React.Fragment key={r.n}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <Ico name={r.ico} size={16} color={WF.ink2}/>
                <div style={{ flex: 1, fontSize: 13 }}>{r.n}</div>
                <div className="wf-num" style={{ fontWeight: 600, fontSize: 13 }}>€{r.y.toLocaleString('en-US')}/yr</div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Allocate · topic detail (with history) ────────────────────
function ScreenAllocateTopic() {
  const history = [
    { p: 'Dec',  exp: 500, act: 460 },
    { p: 'Nov',  exp: 500, act: 530 },
    { p: 'Oct',  exp: 450, act: 410 },
    { p: 'Sep',  exp: 450, act: 470 },
    { p: 'Aug',  exp: 400, act: 380 },
  ];

  return (
    <ScreenShell>
      <WFAppBar
        title="Food"
        sub="Topic"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="edit" size={20}/>}
      />
      <WFBody>
        <div className="wf-card" style={{ padding: 16, marginBottom: 14, textAlign: 'center' }}>
          <div className="wf-cap">This period</div>
          <div className="wf-row" style={{ justifyContent: 'center', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div className="wf-num" style={{ fontSize: 28, fontWeight: 700 }}>€380</div>
            <div className="wf-cap">spent of</div>
            <div className="wf-num" style={{ fontSize: 18, fontWeight: 600 }}>€500</div>
          </div>
          <div className="wf-cap" style={{ color: WF.green, marginTop: 4 }}>€120 left · 76% used</div>
          <div style={{ height: 8, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: '76%', height: '100%', background: WF.ink2 }}/>
          </div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Sub-categories · 3</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 14 }}>
          {[
            { n: 'Groceries', a: 240 },
            { n: 'Restaurants', a: 95 },
            { n: 'Coffee', a: 45 },
          ].map((s, i, a) => (
            <React.Fragment key={s.n}>
              <div className="wf-row" style={{ padding: '12px 0', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13 }}>{s.n}</div>
                <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{s.a}</div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>History</div>
        <div className="wf-card" style={{ padding: 14 }}>
          <div className="wf-row" style={{ alignItems: 'flex-end', gap: 8, height: 100 }}>
            {history.map(h => {
              const heightAct = Math.min(100, (h.act / 600) * 100);
              const heightExp = Math.min(100, (h.exp / 600) * 100);
              const overP = h.act > h.exp;
              return (
                <div key={h.p} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ position: 'relative', width: '100%', height: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{
                      position: 'absolute', bottom: `${heightExp}%`, left: 0, right: 0,
                      height: 1, borderTop: `1px dashed ${WF.ink3}`,
                    }}/>
                    <div style={{
                      width: 16, height: `${heightAct}%`,
                      background: overP ? WF.red : WF.ink2, borderRadius: 3,
                    }}/>
                  </div>
                  <div style={{ fontSize: 9, color: WF.ink4 }}>{h.p}</div>
                </div>
              );
            })}
          </div>
        </div>

        <button className="wf-btn outline" style={{ width: '100%', marginTop: 14, height: 44 }}>
          <Ico name="switch" size={16}/> Move funds between topics
        </button>
      </WFBody>
    </ScreenShell>
  );
}

// ── Allocate · "move funds" sheet ─────────────────────────────
function ScreenAllocateMove() {
  return (
    <ScreenShell>
      <WFAppBar
        title="Move funds"
        leading={<Ico name="x" size={22}/>}
        trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Move</div>}
      />
      <WFBody>
        <div className="wf-section-title" style={{ marginBottom: 6 }}>From</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="wallet" size={14}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Buffer</div>
              <div className="wf-cap">€280 available</div>
            </div>
            <Ico name="arrowDn" size={14} color={WF.ink4}/>
          </div>
        </div>

        <div className="wf-card" style={{ padding: 16, marginBottom: 14, textAlign: 'center' }}>
          <div className="wf-cap">Amount</div>
          <div className="wf-num" style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>€ 180</div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>To</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, borderColor: WF.red, background: WF.redSoft }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="bag" size={14} color={WF.red}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Hobby</div>
              <div className="wf-cap" style={{ color: WF.red }}>€180 over budget</div>
            </div>
          </div>
        </div>

        <div className="wf-card" style={{ padding: 12, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap"><b>After move:</b></div>
          <div className="wf-cap">Buffer €100 · Hobby €0 over (balanced)</div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenAllocate, ScreenAllocateTopic, ScreenAllocateMove,
  ScreenAllocateAddRecurring, ScreenAllocateYear,
  ALLOCATE_TOPICS, PeriodScrubber,
});
