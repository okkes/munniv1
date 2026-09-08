// Allocate — period scrubber, subscriptions first, fixed costs after, topic detail

function ScreenAllocate() {
  const nav = useNav();
  const allocated = 1620;
  const spent = 980;
  const left = allocated - spent;
  const unallocated = 200;

  const subscriptions = RECURRING.filter(r => !['housing','utilities'].includes(r.cat));
  const fixed = RECURRING.filter(r => ['housing','utilities'].includes(r.cat));

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Allocate"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap" onClick={() => nav.push('allocateYear')}><I name="cal" size={18}/></button>}
      />

      {/* Period scrubber */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, padding: '0 20px 14px', flexShrink: 0 }}>
        <button className="m-iconbtn m-tap"><I name="arrowL" size={18}/></button>
        <div style={{ textAlign: 'center' }}>
          <div className="m-cap">Period</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>20 Jan – 19 Feb</div>
        </div>
        <button className="m-iconbtn m-tap"><I name="arrowR" size={18} color={M.ink4}/></button>
      </div>

      <div className="m-body-scroll">
        {/* Summary card */}
        <div className="m-card" style={{ padding: 18, marginBottom: 16, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Stat label="Allocated" value={fmtEur(allocated)} color={M.ink}/>
            <Stat label="Spent" value={fmtEur(spent)} color={M.clay}/>
            <Stat label="Left" value={fmtEur(left)} color={M.sage}/>
            <Stat label="Unallocated" value={fmtEur(unallocated)} color={M.ochre}/>
          </div>
          <div style={{ marginTop: 14 }}>
            <StackedBar segments={[
              { value: spent, color: M.ink },
              { value: left, color: M.sage },
              { value: unallocated, color: M.ochre },
            ]} height={8}/>
          </div>
        </div>

        {/* Subscriptions FIRST — actionable */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, paddingLeft: 4 }}>
          <div className="m-cap">Subscriptions · {subscriptions.length}</div>
          <div className="m-num" style={{ fontSize: 12, color: M.ink3, fontWeight: 600 }}>{fmtEur(subscriptions.reduce((s, r) => s + Math.abs(r.amount), 0))}/mo</div>
        </div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 16, border: `1px solid ${M.line}` }}>
          {subscriptions.map((r, i, a) => (
            <React.Fragment key={r.id}>
              <AllocateRow item={r} actionable onClick={() => nav.push('allocateTopic', { id: r.id })}/>
              {i < a.length - 1 && <Divider inset={48}/>}
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, paddingLeft: 4 }}>
          <div className="m-cap">Fixed costs · {fixed.length}</div>
          <div className="m-num" style={{ fontSize: 12, color: M.ink3, fontWeight: 600 }}>{fmtEur(fixed.reduce((s, r) => s + Math.abs(r.amount), 0))}/mo</div>
        </div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 16, border: `1px solid ${M.line}` }}>
          {fixed.map((r, i, a) => (
            <React.Fragment key={r.id}>
              <AllocateRow item={r} onClick={() => nav.push('allocateTopic', { id: r.id })}/>
              {i < a.length - 1 && <Divider inset={48}/>}
            </React.Fragment>
          ))}
        </div>

        <button className="m-btn outline m-tap" style={{ width: '100%', marginBottom: 18 }}>
          <I name="plus" size={16}/> Add allocation
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="m-cap">{label}</div>
      <div className="m-num" style={{ fontSize: 18, fontWeight: 600, fontFamily: M.fontDisp, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function AllocateRow({ item, actionable, onClick }) {
  return (
    <div className="m-tap" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I name={item.icon} size={16} color={M.ink2}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</div>
        <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>next {item.next}{actionable ? ' · cancel anytime' : ''}</div>
      </div>
      <div className="m-num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtEur(item.amount)}</div>
      <I name="caretR" size={12} color={M.ink4}/>
    </div>
  );
}

function ScreenAllocateTopic({ params }) {
  const nav = useNav();
  const item = RECURRING.find(r => r.id === params?.id) || RECURRING[0];
  const history = [Math.abs(item.amount) * 1.05, Math.abs(item.amount) * 0.98, Math.abs(item.amount) * 1.02, Math.abs(item.amount) * 1, Math.abs(item.amount), Math.abs(item.amount)];

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title=""
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="edit" size={18}/></button>}
      />
      <div className="m-body-scroll">
        <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <I name={item.icon} size={28} color={M.ink2}/>
          </div>
          <div className="m-h2">{item.name}</div>
          <div style={{ fontSize: 13, color: M.ink3, marginTop: 4 }}>{item.every} · next {item.next}</div>
          <div className="m-num" style={{ fontSize: 32, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 14, letterSpacing: '-0.02em' }}>{fmtEur(item.amount)}</div>
          <div style={{ fontSize: 12, color: M.ink3, marginTop: 4 }}>per period</div>
        </div>

        <div className="m-card" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="m-cap">History · 6 periods</div>
            <div style={{ fontSize: 11, color: M.ink3 }}>vs allocated <span style={{ color: M.sage, fontWeight: 600 }}>—— —— ——</span></div>
          </div>
          <BarChart data={history} labels={['Sep','Oct','Nov','Dec','Jan','Feb']} height={84} accent={M.ink}/>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Last transactions</div>
        <div className="m-card" style={{ padding: '0 16px', marginBottom: 18, border: `1px solid ${M.line}` }}>
          {TRANSACTIONS.slice(0, 3).map((t, i, a) => (
            <React.Fragment key={t.id}>
              <TxRow tx={t} showDate onClick={() => nav.push('txDetail', { id: t.id })}/>
              {i < a.length - 1 && <Divider inset={50}/>}
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="m-btn outline m-tap" style={{ flex: 1 }}>Move funds</button>
          <button className="m-btn outline m-tap" style={{ flex: 1, color: M.clay, borderColor: M.claySoft }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenAllocate, ScreenAllocateTopic, AllocateRow, Stat });
