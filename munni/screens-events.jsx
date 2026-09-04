// Events tab — list + create + detail

function ScreenEvents() {
  const nav = useNav();
  const [filter, setFilter] = React.useState('all');
  const evs = filter === 'all' ? EVENTS : EVENTS.filter(e => e.status === filter);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Events" large
        trailing={<button className="m-iconbtn m-tap" onClick={() => nav.push('eventCreate')}><I name="plus" size={22}/></button>}
      />
      <div style={{ padding: '0 20px 14px', display: 'flex', gap: 6, flexShrink: 0 }}>
        {[{id:'all',label:'All'},{id:'active',label:'Active'},{id:'closed',label:'Closed'},{id:'planning',label:'Planning'}].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className="m-chip m-tap"
            style={{
              background: filter === f.id ? M.ink : M.card,
              color: filter === f.id ? M.paper : M.ink2,
              borderColor: filter === f.id ? M.ink : M.line,
              fontWeight: filter === f.id ? 600 : 500,
            }}>{f.label}</button>
        ))}
      </div>

      <div className="m-body-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {evs.map(e => <EventCard key={e.id} ev={e} onClick={() => nav.push('eventDetail', { id: e.id })}/>)}
        </div>
      </div>

      <TabBar active="events" onChange={(t) => nav.switchTab(t)}/>
    </div>
  );
}

function EventCard({ ev, onClick }) {
  const palette = {
    globe:    { bg: '#3F4E63', accent: '#DDE2EA' },
    star:     { bg: '#A8782B', accent: '#F0E2C2' },
    flame:    { bg: '#A86A4F', accent: '#F0DBC8' },
    cal:      { bg: '#5C4977', accent: '#E3DCED' },
  };
  const p = palette[ev.icon] || palette.globe;
  const status = ({
    active:   { label: 'Active',   bg: '#DCEDDF', color: '#2E5A33' },
    closed:   { label: 'Closed',   bg: '#EAE7E1', color: '#6E6657' },
    planning: { label: 'Planning', bg: '#F0E2C2', color: '#7A5C20' },
    upcoming: { label: 'Upcoming', bg: '#DDE2EA', color: '#3F4E63' },
  }[ev.status]) || { label: ev.status || 'Draft', bg: '#EAE7E1', color: '#6E6657' };

  return (
    <div className="m-card m-tap" onClick={onClick} style={{ overflow: 'hidden', border: `1px solid ${M.line}` }}>
      {/* Cover */}
      <div style={{
        height: 120, background: `linear-gradient(135deg, ${p.bg} 0%, ${p.bg}dd 100%)`,
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.15,
          backgroundImage: `radial-gradient(circle at 20% 30%, ${p.accent} 0%, transparent 40%), radial-gradient(circle at 80% 70%, ${p.accent} 0%, transparent 50%)` }}/>
        <I name={ev.icon} size={42} color={p.accent}/>
        <div style={{ position: 'absolute', top: 12, right: 12, padding: '4px 10px', borderRadius: 999, background: status.bg, color: status.color, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{status.label}</div>
      </div>
      {/* Body */}
      <div style={{ padding: 16 }}>
        <div className="m-h3" style={{ fontFamily: M.fontDisp, fontSize: 18, fontWeight: 600 }}>{ev.name}</div>
        <div style={{ fontSize: 12, color: M.ink3, marginTop: 4 }}>
          {fmtDate(ev.start)} – {fmtDate(ev.end)} · {ev.txCount} transactions
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
          <div className="m-num" style={{ fontSize: 22, fontWeight: 600, fontFamily: M.fontDisp }}>{fmtEur(ev.total)}</div>
          <div style={{ fontSize: 12, color: M.ink3 }}>total spent</div>
        </div>
      </div>
    </div>
  );
}

function ScreenEventDetail({ params }) {
  const nav = useNav();
  const ev = EVENTS.find(e => e.id === params?.id) || EVENTS[0];
  // Mock breakdown
  const breakdown = [
    { id: 'flights',     label: 'Flights',     icon: 'rocket', amount: 412.30, color: M.slate },
    { id: 'lodging',     label: 'Lodging',     icon: 'house',  amount: 380.00, color: M.sage },
    { id: 'food',        label: 'Food',        icon: 'fork',   amount: 248.50, color: M.clay },
    { id: 'transport',   label: 'Transport',   icon: 'car',    amount: 86.40,  color: M.ochre },
    { id: 'activities',  label: 'Activities',  icon: 'film',   amount: 59.10,  color: M.violet },
  ];
  const evTx = TRANSACTIONS.slice(0, 6);

  return (
    <div className="m-screen">
      <div style={{ position: 'relative', height: 220, flexShrink: 0,
        background: `linear-gradient(135deg, #3F4E63 0%, #2C3848 100%)`,
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.18,
          backgroundImage: 'radial-gradient(circle at 30% 30%, #DDE2EA 0%, transparent 50%)' }}/>
        <StatusBar dark/>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <button className="m-iconbtn m-tap" onClick={() => nav.pop()} style={{ color: '#fff' }}><I name="arrowL" size={20} color="#fff"/></button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="m-iconbtn m-tap" style={{ color: '#fff' }}><I name="edit" size={18} color="#fff"/></button>
            <button className="m-iconbtn m-tap" style={{ color: '#fff' }}><I name="more" size={18} color="#fff"/></button>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
          <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>Closed · 7 days</div>
          <div style={{ fontFamily: M.fontDisp, fontSize: 26, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>{ev.name}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>{fmtDate(ev.start)} – {fmtDate(ev.end)}</div>
        </div>
      </div>

      <div className="m-body-scroll" style={{ paddingTop: 16 }}>
        <div className="m-card" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div className="m-cap">Total spent</div>
          <div className="m-num" style={{ fontSize: 32, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 4 }}>{fmtEur(ev.total)}</div>
          <div style={{ fontSize: 12, color: M.ink3, marginTop: 2 }}>{ev.txCount} transactions · €{(ev.total/7).toFixed(0)}/day avg</div>
          <div style={{ marginTop: 14 }}>
            <StackedBar segments={breakdown.map(b => ({ value: b.amount, color: b.color }))} height={8}/>
          </div>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Breakdown</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          {breakdown.map((b, i) => (
            <React.Fragment key={b.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name={b.icon} size={16} color={b.color}/>
                </div>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{b.label}</div>
                <div className="m-num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtEur(b.amount)}</div>
                <div style={{ fontSize: 11, color: M.ink3, minWidth: 36, textAlign: 'right' }}>{((b.amount/ev.total)*100).toFixed(0)}%</div>
              </div>
              {i < breakdown.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingLeft: 4 }}>
          <div className="m-cap">Transactions · {ev.txCount}</div>
          <button className="m-tap" style={{ background: 'transparent', border: 'none', fontSize: 12, color: M.sage, fontWeight: 600 }}>+ Add</button>
        </div>
        <div className="m-card" style={{ padding: '0 16px', border: `1px solid ${M.line}`, marginBottom: 18 }}>
          {evTx.map((t, i, a) => (
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

function ScreenEventCreate() {
  const nav = useNav();
  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="New event"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="x" size={20}/></button>}
        trailing={<button className="m-tap" style={{ background: 'transparent', border: 'none', fontSize: 14, fontWeight: 600, color: M.sage }} onClick={() => nav.pop()}>Save</button>}
      />
      <div className="m-body-scroll">
        <div style={{
          height: 140, borderRadius: 14, background: M.paper2, border: `1px dashed ${M.line}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 6, marginBottom: 18, color: M.ink3,
        }}>
          <I name="cam" size={28} color={M.ink3}/>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Add cover image</div>
          <div style={{ fontSize: 11 }}>or pick a placeholder</div>
        </div>

        <div className="m-cap" style={{ marginBottom: 8 }}>Details</div>
        <div className="m-card" style={{ padding: 4, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <FormRow label="Name" value="Lisbon trip 2026" placeholder="e.g. Anna's birthday"/>
          <Divider inset={16}/>
          <FormRow label="Type" value="Travel" caretR/>
          <Divider inset={16}/>
          <FormRow label="Start" value="12 Sep 2026" icon="cal"/>
          <Divider inset={16}/>
          <FormRow label="End" value="19 Sep 2026" icon="cal"/>
        </div>

        <div className="m-card" style={{ padding: 14, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I name="link" size={16} color={M.sage}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Auto-link transactions</div>
              <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>In date range, tagged "travel"</div>
            </div>
            <Toggle on/>
          </div>
        </div>

        <button className="m-btn sage m-tap" style={{ width: '100%' }} onClick={() => nav.pop()}>Create event</button>
      </div>
    </div>
  );
}

function FormRow({ label, value, icon, caretR, placeholder }) {
  const empty = !value;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px' }}>
      <div style={{ fontSize: 12, color: M.ink3, width: 60 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 14, color: empty ? M.ink4 : M.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <I name={icon} size={14} color={M.ink3}/>}
        {value || placeholder}
      </div>
      {caretR && <I name="caretR" size={14} color={M.ink4}/>}
    </div>
  );
}

function Toggle({ on }) {
  return (
    <div style={{
      width: 40, height: 24, borderRadius: 999, background: on ? M.sage : M.line,
      padding: 2, transition: 'background 0.2s',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 999, background: '#fff',
        transform: on ? 'translateX(16px)' : 'none', transition: 'transform 0.2s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }}/>
    </div>
  );
}

Object.assign(window, { ScreenEvents, ScreenEventDetail, ScreenEventCreate, EventCard, FormRow, Toggle });
