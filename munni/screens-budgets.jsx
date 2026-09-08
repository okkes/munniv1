// Budgets — list, drill-in, create

function ScreenBudgets() {
  const nav = useNav();
  // sort: over -> close -> healthy
  const sorted = [...BUDGETS].sort((a, b) => {
    const ra = a.spent / a.total;
    const rb = b.spent / b.total;
    return rb - ra;
  });

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Budgets"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap" onClick={() => nav.push('budgetCreate')}><I name="plus" size={20}/></button>}
      />
      <div className="m-body-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(b => <BudgetCard key={b.id} b={b} onClick={() => nav.push('budgetDetail', { id: b.id })}/>)}
        </div>

        <button className="m-btn outline m-tap" style={{ width: '100%', marginTop: 18 }} onClick={() => nav.push('budgetCreate')}>
          <I name="plus" size={16}/> New budget
        </button>
      </div>
    </div>
  );
}

function BudgetCard({ b, onClick }) {
  const ratio = b.spent / b.total;
  const over = ratio > 1;
  const close = ratio > 0.85 && !over;
  const status = over ? { color: M.clay, soft: M.claySoft, label: `${fmtEur(b.spent - b.total).replace('−','')} over` }
    : close ? { color: M.ochre, soft: M.ochreSoft, label: `${fmtEur(b.total - b.spent)} left` }
    : { color: M.sage, soft: M.sageSoft, label: `${fmtEur(b.total - b.spent)} left` };
  const remaining = Math.max(0, b.total - b.spent);
  const pct = Math.min(100, ratio * 100);

  return (
    <div className="m-card m-tap" onClick={onClick} style={{ padding: 16, border: `1px solid ${M.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: status.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I name={b.icon} size={18} color={status.color}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{b.name}</div>
            <div className="m-num" style={{ fontSize: 14, fontWeight: 600, color: status.color }}>{status.label}</div>
          </div>
          <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>{b.period} · resets {b.renew}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: M.line2, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: status.color, borderRadius: 999 }}/>
        {over && <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.3) 4px 8px)` }}/>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: M.ink3 }}>
        <span><span className="m-num" style={{ color: M.ink2, fontWeight: 600 }}>{fmtEur(b.spent)}</span> spent</span>
        <span>of {fmtEur(b.total)}</span>
      </div>
      {b.stack && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: M.paper2, fontSize: 11, color: M.ink2, display: 'flex', alignItems: 'center', gap: 8 }}>
          <I name="box" size={13} color={M.ink3}/>
          Carry-over: <span className="m-num" style={{ fontWeight: 600 }}>{fmtEur(b.stackCur)}</span> · max <span className="m-num">{fmtEur(b.stackMax)}</span>
        </div>
      )}
    </div>
  );
}

function ScreenBudgetDetail({ params }) {
  const nav = useNav();
  const b = BUDGETS.find(x => x.id === params?.id) || BUDGETS[0];
  const txs = TRANSACTIONS.filter(t => b.cats.includes(t.cat));
  const ratio = b.spent / b.total;
  const over = ratio > 1;

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title={b.name}
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="edit" size={18}/></button>}
      />
      <div className="m-body-scroll">
        <div className="m-card" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 90, height: 90, position: 'relative' }}>
              <Donut size={90} thickness={10} data={[
                { value: Math.min(b.spent, b.total), color: over ? M.clay : (ratio > 0.85 ? M.ochre : M.sage) },
                { value: Math.max(0, b.total - b.spent), color: M.line2 },
              ]} center={
                <div style={{ textAlign: 'center' }}>
                  <div className="m-num" style={{ fontSize: 16, fontWeight: 700 }}>{(ratio * 100).toFixed(0)}%</div>
                </div>
              }/>
            </div>
            <div style={{ flex: 1 }}>
              <div className="m-cap">Spent of {fmtEur(b.total)}</div>
              <div className="m-num" style={{ fontSize: 26, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 4 }}>{fmtEur(b.spent)}</div>
              <div style={{ fontSize: 12, color: over ? M.clay : M.ink3, marginTop: 4, fontWeight: over ? 600 : 400 }}>
                {over ? `${fmtEur(b.spent - b.total).replace('−','')} over budget` : `${fmtEur(b.total - b.spent)} remaining`}
              </div>
            </div>
          </div>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Categories</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          {b.cats.map((cId, i) => {
            const c = CATEGORIES[cId];
            const cTotal = TRANSACTIONS.filter(t => t.cat === cId).reduce((s, t) => s + Math.abs(t.amount), 0);
            return (
              <React.Fragment key={cId}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                  <I name={c.icon} size={16} color={M.ink2}/>
                  <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
                  <div className="m-num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtEur(cTotal)}</div>
                </div>
                {i < b.cats.length - 1 && <Divider/>}
              </React.Fragment>
            );
          })}
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Transactions · {txs.length}</div>
        <div className="m-card" style={{ padding: '0 16px', border: `1px solid ${M.line}` }}>
          {txs.map((t, i, a) => (
            <React.Fragment key={t.id}>
              <TxRow tx={t} showDate onClick={() => nav.push('txDetail', { id: t.id })}/>
              {i < a.length - 1 && <Divider inset={50}/>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreenBudgetCreate() {
  const nav = useNav();
  const [icon, setIcon] = React.useState('fork');
  const icons = ['fork','shop','car','flame','film','star','health','bag','globe','rocket'];
  const [stack, setStack] = React.useState(false);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="New budget"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="x" size={20}/></button>}
        trailing={<button className="m-tap" style={{ background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: M.sage }} onClick={() => nav.pop()}>Save</button>}
      />
      <div className="m-body-scroll">
        {/* Icon picker */}
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Icon</div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
          {icons.map(i => (
            <button key={i} onClick={() => setIcon(i)} className="m-tap" style={{
              flexShrink: 0, width: 48, height: 48, borderRadius: 12,
              background: icon === i ? M.ink : M.card,
              border: `1px solid ${icon === i ? M.ink : M.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <I name={i} size={20} color={icon === i ? '#fff' : M.ink2}/>
            </button>
          ))}
        </div>

        <div className="m-card" style={{ padding: 4, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <FormRow label="Name" value="Restaurants" placeholder="e.g. Eating out"/>
          <Divider inset={16}/>
          <FormRow label="Amount" value="€120,00" icon="wallet"/>
          <Divider inset={16}/>
          <FormRow label="Period" value="Weekly" caretR/>
        </div>

        {/* Categories */}
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Categories · 2 selected</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          {[
            { id: 'restaurants', name: 'Restaurants', selected: true },
            { id: 'coffee', name: 'Coffee & bars', selected: true },
            { id: 'groceries', name: 'Groceries', disabled: 'In Groceries budget' },
            { id: 'transport', name: 'Transport' },
            { id: 'health', name: 'Health' },
          ].map((c, i, a) => (
            <React.Fragment key={c.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', opacity: c.disabled ? 0.4 : 1 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 6,
                  border: `1.5px solid ${c.selected ? M.sage : M.line}`,
                  background: c.selected ? M.sage : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {c.selected && <I name="check" size={12} color="#fff" stroke={2.5}/>}
                </div>
                <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
                {c.disabled && <span style={{ fontSize: 10, padding: '3px 7px', borderRadius: 999, background: M.paper2, color: M.ink3, fontWeight: 500 }}>{c.disabled}</span>}
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        {/* Stack carry-over */}
        <div className="m-card" style={{ padding: 16, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div className="m-tap" onClick={() => setStack(!stack)} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Stack carry-over</div>
              <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>Unused budget rolls into the next period</div>
            </div>
            <Toggle on={stack}/>
          </div>
          {stack && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${M.line2}` }}>
              <FormRow label="Max" value="€480,00"/>
              <div style={{ marginTop: 12, display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
                {[40, 60, 80, 100, 80, 100].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: h * 0.6, background: i === 5 ? M.sage : M.sageSoft, borderRadius: 3 }}/>
                ))}
              </div>
              <div style={{ fontSize: 11, color: M.ink3, marginTop: 6 }}>Last 6 weeks · accumulated carry</div>
            </div>
          )}
        </div>

        <button className="m-btn sage m-tap" style={{ width: '100%', marginBottom: 18 }} onClick={() => nav.pop()}>Create budget</button>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenBudgets, ScreenBudgetDetail, ScreenBudgetCreate, BudgetCard });
