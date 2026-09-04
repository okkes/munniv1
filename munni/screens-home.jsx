// Home screen

function ScreenHome() {
  const nav = useNav();
  const reviewCount = TRANSACTIONS.filter(t => t.needsReview).length;
  const budgetTop = [...BUDGETS].sort((a, b) => (b.spent / b.total) - (a.spent / a.total)).slice(0, 3);

  return (
    <div className="m-screen">
      <StatusBar/>

      {/* Header */}
      <div style={{ padding: '4px 20px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 999, background: M.sage, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, fontFamily: M.fontDisp, letterSpacing: '-0.02em',
        }}>J</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: M.ink3 }}>Good morning, Jules</div>
          <div style={{ fontSize: 11, color: M.ink4, marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: M.sage }}/>
            Synced 15:38
          </div>
        </div>
        <button className="m-iconbtn filled m-tap" onClick={() => nav.push('sync')}>
          <I name="sync" size={18}/>
        </button>
        <button className="m-iconbtn filled m-tap" onClick={() => nav.push('notifications')}>
          <I name="bell" size={18}/>
        </button>
      </div>

      <div className="m-body-scroll">
        {/* Net worth hero */}
        <div className="m-fade" style={{
          padding: '8px 0 28px',
        }}>
          <div className="m-cap" style={{ marginBottom: 8 }}>Total balance</div>
          <div className="m-num" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1 }}>
            €8 725<span style={{ fontSize: 24, color: M.ink3 }}>,68</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <span className="m-pill" style={{ background: M.sageSoft, color: M.sageDk }}>
              <I name="trending-up" size={11} stroke={2.2} color={M.sageDk}/>
              <span style={{ marginLeft: 4 }}>+€420 this period</span>
            </span>
          </div>

          {/* 3 accounts mini-row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 18, overflowX: 'auto', marginLeft: -20, paddingLeft: 20, paddingRight: 20, marginRight: -20 }}>
            {ACCOUNTS.map(a => (
              <div key={a.id} className="m-tap"
                onClick={() => nav.push('accountDetail', { id: a.id })}
                style={{
                  flexShrink: 0, width: 152, padding: 14, borderRadius: 14,
                  background: M.card, border: `1px solid ${M.line}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color }}/>
                  <div style={{ fontSize: 11, color: M.ink3, fontWeight: 500 }}>{a.name.split(' · ')[0]}</div>
                </div>
                <div className="m-num" style={{ fontSize: 18, fontWeight: 600 }}>
                  {fmtEurInt(a.balance)}
                </div>
                <div className="m-mono" style={{ fontSize: 10, color: M.ink4, marginTop: 2 }}>{a.iban}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Period card */}
        <div className="m-card m-fade" style={{ padding: 20, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <PeriodHeader/>

          {/* Donut + numbers */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 18 }}>
            <Donut size={120} thickness={14} data={[
              { value: PERIOD.expense, color: M.clay },
              { value: PERIOD.savings, color: M.ochre },
              { value: PERIOD.invest,  color: M.violet },
              { value: PERIOD.unallocated, color: M.line },
            ]} center={
              <>
                <div style={{ fontSize: 9, color: M.ink3, letterSpacing: 0.06, fontWeight: 600 }}>OUT OF</div>
                <div className="m-num" style={{ fontSize: 18, fontWeight: 600, marginTop: 1 }}>{fmtEurInt(PERIOD.income)}</div>
              </>
            }/>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PeriodLegendRow color={M.clay}   label="Spent"     value={PERIOD.expense}/>
              <PeriodLegendRow color={M.ochre}  label="Saved"     value={PERIOD.savings}/>
              <PeriodLegendRow color={M.violet} label="Invested"  value={PERIOD.invest}/>
              <PeriodLegendRow color={M.line}   label="To allocate" value={PERIOD.unallocated} dim/>
            </div>
          </div>

          {/* Allocate CTA */}
          <button className="m-btn outline m-tap" style={{ width: '100%', marginTop: 14, height: 42, fontSize: 13, justifyContent: 'space-between' }}
            onClick={() => nav.push('allocate')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <I name="goal" size={16}/>
              Allocate {fmtEurInt(PERIOD.unallocated)}
            </span>
            <I name="arrowR" size={16}/>
          </button>
        </div>

        {/* Review banner */}
        {reviewCount > 0 && (
          <div className="m-tap m-card m-fade" style={{
            padding: 16, marginBottom: 14,
            border: `1px solid ${M.ochreSoft}`,
            background: '#FBF6E9',
            display: 'flex', alignItems: 'center', gap: 14,
          }} onClick={() => nav.push('reviewSwipe')}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: M.ochreSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <I name="sliders" size={20} color={M.ochre}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Review {reviewCount} categories</div>
              <div style={{ fontSize: 12, color: M.ink3, marginTop: 1 }}>AI's not sure about these — quick check?</div>
            </div>
            <I name="arrowR" size={18} color={M.ink3}/>
          </div>
        )}

        {/* Budgets */}
        <div className="m-card m-fade" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="m-h3">Budgets</div>
            <div className="m-tap" onClick={() => nav.push('budgets')} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: M.ink3, fontWeight: 500 }}>
              See all {BUDGETS.length} <I name="caretR" size={12}/>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {budgetTop.map(b => <BudgetMini key={b.id} b={b} onClick={() => nav.push('budgetDetail', { id: b.id })}/>)}
          </div>
        </div>

        {/* Goals */}
        <div className="m-card m-fade" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="m-h3">Goals</div>
            <div className="m-tap" onClick={() => nav.push('goals')} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: M.ink3, fontWeight: 500 }}>
              See all <I name="caretR" size={12}/>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', marginLeft: -18, paddingLeft: 18, marginRight: -18, paddingRight: 18 }}>
            {GOALS.map(g => <GoalCard key={g.id} g={g} onClick={() => nav.push('goalDetail', { id: g.id })}/>)}
          </div>
        </div>

        {/* Investment teaser */}
        <div className="m-tap m-card m-fade" onClick={() => nav.push('investment')} style={{
          padding: 18, marginBottom: 14, border: `1px solid ${M.line}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: M.violetSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I name="rocket" size={20} color={M.violet}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Portfolio</div>
            <div className="m-num" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {fmtEurInt(PORTFOLIO.total)}
              <span style={{ fontSize: 12, color: M.sage, marginLeft: 8, fontFamily: M.fontUI, fontWeight: 600 }}>+{PORTFOLIO.pnlPct.toFixed(1)}%</span>
            </div>
          </div>
          <Sparkline data={PORTFOLIO.curve} width={64} height={28} color={M.violet} fill="rgba(94,74,120,0.12)" strokeWidth={1.6}/>
          <I name="caretR" size={16} color={M.ink4}/>
        </div>

        <div style={{ height: 12 }}/>
      </div>

      <TabBar active="home" onChange={(t) => nav.switchTab(t)}/>
    </div>
  );
}

function PeriodHeader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="m-cap">This period</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: M.ink3 }}>
        <I name="arrowL" size={14}/>
        <div style={{ fontSize: 12, fontWeight: 600, color: M.ink2 }}>20 Jan – 19 Feb</div>
        <I name="arrowR" size={14}/>
      </div>
    </div>
  );
}

function PeriodLegendRow({ color, label, value, dim }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>
      <div style={{ fontSize: 12, color: dim ? M.ink4 : M.ink2, flex: 1 }}>{label}</div>
      <div className="m-num" style={{ fontSize: 13, fontWeight: 600, color: dim ? M.ink3 : M.ink }}>{fmtEurInt(value)}</div>
    </div>
  );
}

function BudgetMini({ b, onClick }) {
  const ratio = b.spent / b.total;
  const over = ratio > 1;
  const close = ratio >= 0.8 && !over;
  const color = over ? M.clay : (close ? M.ochre : M.sage);
  const left = b.total - b.spent;
  return (
    <div className="m-tap" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: over ? M.claySoft : (close ? M.ochreSoft : M.sageSoft), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I name={b.icon} size={16} color={color}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</div>
          <div className="m-num" style={{ fontSize: 12, fontWeight: 600, color: over ? M.clay : M.ink2 }}>
            {over ? `−${fmtEurInt(Math.abs(left))}` : `${fmtEurInt(left)} left`}
          </div>
        </div>
        <div style={{ height: 5, marginTop: 6, borderRadius: 999, background: M.line2, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: '100%', background: color }}/>
          {over && <div style={{ flex: 1, background: `repeating-linear-gradient(45deg, ${M.clay} 0 3px, ${M.claySoft} 3px 6px)` }}/>}
        </div>
      </div>
    </div>
  );
}

function GoalCard({ g, onClick }) {
  const pct = (g.current / g.target) * 100;
  return (
    <div className="m-tap" onClick={onClick} style={{
      flexShrink: 0, width: 168, padding: 14, borderRadius: 14, background: M.paper2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: M.card, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I name={g.icon} size={14} color={g.color}/>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{g.name}</div>
      </div>
      <div className="m-num" style={{ fontSize: 18, fontWeight: 600 }}>{fmtEurInt(g.current)}</div>
      <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>of {fmtEurInt(g.target)} · by {g.by}</div>
      <div style={{ height: 4, marginTop: 10, borderRadius: 999, background: M.line, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: g.color }}/>
      </div>
      <div style={{ fontSize: 10, color: M.ink3, marginTop: 6, fontWeight: 500 }}>{pct.toFixed(0)}% · +{fmtEurInt(g.monthly)}/mo</div>
    </div>
  );
}

Object.assign(window, { ScreenHome, BudgetMini, GoalCard, PeriodHeader });
