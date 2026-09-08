// Goals — list + detail

function ScreenGoals() {
  const nav = useNav();
  const active = GOALS.filter(g => g.current < g.target);
  const achieved = GOALS.filter(g => g.current >= g.target);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Goals"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="plus" size={20}/></button>}
      />
      <div className="m-body-scroll">
        {/* Saving balance */}
        <div className="m-card" style={{ padding: 18, marginBottom: 16, border: `1px solid ${M.line}` }}>
          <div className="m-cap">Saving balance</div>
          <div className="m-num" style={{ fontSize: 28, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 4 }}>€3 120,50</div>
          <div style={{ fontSize: 12, color: M.ink3, marginTop: 2 }}>across {GOALS.length} goals · linked to ING Savings</div>

          <div style={{ marginTop: 14 }}>
            <StackedBar segments={GOALS.map(g => ({ value: g.current, color: g.color }))} height={8}/>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {GOALS.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: g.color }}/>
                <span style={{ color: M.ink2 }}>{g.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingLeft: 4 }}>
          <div className="m-cap">Active · {active.length}</div>
          <button className="m-tap" style={{ background: 'transparent', border: 'none', fontSize: 12, color: M.sage, fontWeight: 600 }}>Auto-allocate</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map(g => <GoalCardLarge key={g.id} g={g} onClick={() => nav.push('goalDetail', { id: g.id })}/>)}
        </div>

        {achieved.length > 0 && (
          <>
            <div className="m-cap" style={{ marginTop: 18, marginBottom: 8, paddingLeft: 4 }}>Achieved · {achieved.length}</div>
            {achieved.map(g => (
              <div key={g.id} className="m-card" style={{ padding: 14, marginBottom: 8, border: `1px solid ${M.line}`, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name="check" size={14} color={M.sage} stroke={2.5}/>
                </div>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{g.name}</div>
                <div className="m-num" style={{ fontSize: 13, fontWeight: 600 }}>{fmtEur(g.target)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function GoalCardLarge({ g, onClick }) {
  const pct = (g.current / g.target) * 100;
  return (
    <div className="m-card m-tap" onClick={onClick} style={{ padding: 16, border: `1px solid ${M.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: g.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I name={g.icon} size={20} color={g.color}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{g.name}</div>
            <div className="m-num" style={{ fontSize: 12, color: M.ink3, fontWeight: 600 }}>{pct.toFixed(0)}%</div>
          </div>
          <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>by {g.by} · {fmtEur(g.monthly)}/mo</div>
        </div>
      </div>
      <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: M.line2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: g.color }}/>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: M.ink3 }}>
        <span><span className="m-num" style={{ color: M.ink2, fontWeight: 600 }}>{fmtEur(g.current)}</span> saved</span>
        <span>of {fmtEur(g.target)}</span>
      </div>
    </div>
  );
}

function ScreenGoalDetail({ params }) {
  const nav = useNav();
  const g = GOALS.find(x => x.id === params?.id) || GOALS[0];
  const pct = (g.current / g.target) * 100;
  const monthsLeft = Math.ceil((g.target - g.current) / g.monthly);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title=""
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="edit" size={18}/></button>}
      />
      <div className="m-body-scroll">
        <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
          <div style={{ width: 70, height: 70, borderRadius: 20, background: g.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <I name={g.icon} size={32} color={g.color}/>
          </div>
          <div className="m-h2">{g.name}</div>
          <div style={{ fontSize: 13, color: M.ink3, marginTop: 6 }}>by {g.by}</div>
        </div>

        <div className="m-card" style={{ padding: 20, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="m-num" style={{ fontSize: 32, fontWeight: 600, fontFamily: M.fontDisp, letterSpacing: '-0.02em' }}>{fmtEur(g.current)}</div>
            <div style={{ fontSize: 13, color: M.ink3 }}>of {fmtEur(g.target)}</div>
          </div>
          <div style={{ marginTop: 14, height: 10, borderRadius: 999, background: M.line2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: g.color }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: M.ink3 }}>
            <span>{pct.toFixed(0)}% complete</span>
            <span>{monthsLeft} months left</span>
          </div>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Plan</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          <FormRow label="Monthly" value={fmtEur(g.monthly)} icon="cal"/>
          <Divider inset={0}/>
          <FormRow label="Required" value={fmtEur(g.monthly)} caretR/>
          <Divider inset={0}/>
          <FormRow label="Source" value="ING Savings"/>
        </div>

        <button className="m-btn sage m-tap" style={{ width: '100%', marginBottom: 8 }}>
          <I name="plus" size={16}/> Add funds
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenGoals, ScreenGoalDetail, GoalCardLarge });
