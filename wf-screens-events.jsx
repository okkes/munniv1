// Events / Activities — track total cost of trips, parties, projects
// by associating transactions with an event.

const EVENTS = [
  {
    id: 'norway',
    name: 'Norway road trip',
    date: '12–22 Jul 2025',
    created: 'Created 04 Jul 2025',
    total: 1842.50,
    tx: 23,
    cover: 'mountains', // placeholder kind
    status: 'past',
  },
  {
    id: 'maria-bday',
    name: "Maria's 30th",
    date: '15 Mar 2026',
    created: 'Created 28 Feb 2026',
    total: 245.80,
    tx: 6,
    cover: 'party',
    status: 'upcoming',
  },
  {
    id: 'kitchen',
    name: 'Kitchen renovation',
    date: 'Jan – Apr 2026',
    created: 'Created 08 Jan 2026',
    total: 3120.00,
    tx: 14,
    cover: 'tools',
    status: 'active',
  },
  {
    id: 'lisbon',
    name: 'Lisbon weekend',
    date: '02–05 Nov 2025',
    created: 'Created 28 Oct 2025',
    total: 612.40,
    tx: 11,
    cover: 'beach',
    status: 'past',
  },
  {
    id: 'wedding',
    name: 'Anna & Paul wedding',
    date: '08 Sep 2025',
    created: 'Created 02 Sep 2025',
    total: 380.00,
    tx: 4,
    cover: 'rings',
    status: 'past',
  },
];

// Event cover — striped placeholder with monospace label, like the rest of the wireframes
function EventCover({ kind, label, height = 120, radius = 12 }) {
  const stripes = `repeating-linear-gradient(135deg, ${WF.fillSoft} 0 8px, transparent 8px 16px)`;
  return (
    <div style={{
      height, borderRadius: radius,
      background: `${WF.fillSoft}`,
      backgroundImage: stripes,
      border: `1px solid ${WF.line2}`,
      position: 'relative', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="wf-cap" style={{ fontFamily: WF.fontMono, fontSize: 10, color: WF.ink3 }}>
        [ {kind} photo ]
      </div>
      {label && (
        <div style={{
          position: 'absolute', left: 10, bottom: 8,
          fontFamily: WF.fontMono, fontSize: 9, color: WF.ink4,
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ── Events list (the new bottom-tab) ───────────────────────────
function ScreenEvents() {
  const totalAll = EVENTS.reduce((s, e) => s + e.total, 0);

  return (
    <ScreenShell tabBar activeTab="events">
      <WFAppBar
        title="Events"
        sub={`${EVENTS.length} events · €${totalAll.toLocaleString('en-US', { maximumFractionDigits: 0 })} total`}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Search */}
        <div className="wf-input empty" style={{ gap: 8, marginBottom: 12 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search events…
        </div>

        {/* Filter chips */}
        <div className="wf-row" style={{ gap: 6, marginBottom: 14, overflowX: 'auto' }}>
          {[
            { l: 'All', sel: true, n: EVENTS.length },
            { l: 'Active', n: 1 },
            { l: 'Upcoming', n: 1 },
            { l: 'Past', n: 3 },
          ].map(c => (
            <span key={c.l} className="wf-pill" style={{
              background: c.sel ? WF.ink : '#fff',
              color: c.sel ? '#fff' : WF.ink2,
              border: `1px solid ${c.sel ? WF.ink : WF.line}`,
              padding: '5px 10px',
            }}>
              {c.l} <span style={{ opacity: 0.6, marginLeft: 2 }}>{c.n}</span>
            </span>
          ))}
        </div>

        {/* Events */}
        <div className="wf-col" style={{ gap: 12 }}>
          {EVENTS.map(e => (
            <div key={e.id} className="wf-card" style={{ padding: 0, overflow: 'hidden' }}>
              <EventCover kind={e.cover} label={e.id} height={100} radius={0}/>
              <div style={{ padding: 12 }}>
                <div className="wf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="wf-row" style={{ gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{e.name}</div>
                      {e.status === 'active' && <span className="wf-pill" style={{ background: WF.amberSoft || '#FFF2D6', color: WF.amber, fontSize: 9, padding: '1px 6px' }}>active</span>}
                      {e.status === 'upcoming' && <span className="wf-pill" style={{ background: WF.blueSoft, color: WF.blue, fontSize: 9, padding: '1px 6px' }}>upcoming</span>}
                    </div>
                    <div className="wf-cap">{e.date} · {e.tx} transactions</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="wf-num" style={{ fontSize: 16, fontWeight: 700 }}>€{e.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b>Why events?</b> See what trips, projects or parties really cost you, so you can budget for next time.
          </div>
        </div>
      </WFBody>
      <WFTabBar active="events"/>
    </ScreenShell>
  );
}

// ── Event detail — manage transactions, summary, breakdown ─────
function ScreenEventDetail() {
  const e = EVENTS[0]; // Norway

  const breakdown = [
    { cat: 'Lodging',     amt: 720,    pct: 39, ico: 'house' },
    { cat: 'Food',        amt: 480,    pct: 26, ico: 'shop' },
    { cat: 'Transport',   amt: 380,    pct: 21, ico: 'car' },
    { cat: 'Activities',  amt: 162.50, pct: 9,  ico: 'bag' },
    { cat: 'Other',       amt: 100,    pct: 5,  ico: 'list' },
  ];

  const tx = [
    { d: '15 Jul', m: 'Scandic Hotel Bergen',   c: 'Lodging',   a: -240.00, ico: 'house' },
    { d: '15 Jul', m: 'Bryggen restaurant',     c: 'Food',      a: -68.40,  ico: 'shop' },
    { d: '14 Jul', m: 'Hertz car rental',       c: 'Transport', a: -185.00, ico: 'car' },
    { d: '14 Jul', m: 'Fjord cruise tickets',   c: 'Activities', a: -89.00, ico: 'bag' },
    { d: '13 Jul', m: 'Statoil fuel',           c: 'Transport', a: -52.30,  ico: 'car' },
    { d: '13 Jul', m: 'Coop supermarket',       c: 'Food',      a: -34.10,  ico: 'shop' },
  ];

  return (
    <ScreenShell>
      {/* Cover with overlay back button */}
      <div style={{ position: 'relative' }}>
        <EventCover kind={e.cover} label={e.id} height={180} radius={0}/>
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12 }} className="wf-row">
          <button style={{
            width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,0.9)',
            border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico name="arrowL" size={16}/>
          </button>
          <div style={{ flex: 1 }}/>
          <button style={{
            width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,0.9)',
            border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8,
          }}>
            <Ico name="edit" size={15}/>
          </button>
          <button style={{
            width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,0.9)',
            border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico name="more" size={16}/>
          </button>
        </div>
      </div>

      <WFBody style={{ paddingTop: 14 }}>
        {/* Title + total */}
        <div style={{ marginBottom: 14 }}>
          <div className="wf-h2">{e.name}</div>
          <div className="wf-cap" style={{ marginTop: 2 }}>{e.date} · {e.created}</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8 }}>
            €{e.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="wf-row" style={{ gap: 10, marginTop: 4 }}>
            <div className="wf-cap">{e.tx} transactions</div>
            <div className="wf-cap">·</div>
            <div className="wf-cap">11 days</div>
            <div className="wf-cap">·</div>
            <div className="wf-cap">€{Math.round(e.total / 11)}/day avg</div>
          </div>
        </div>

        {/* Breakdown bar */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-section-title" style={{ marginBottom: 8 }}>Breakdown</div>
          <div style={{ height: 10, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
            {breakdown.map((b, i) => (
              <div key={b.cat} style={{
                width: `${b.pct}%`, height: '100%',
                background: [WF.ink, WF.ink2, WF.ink3, WF.ink4, '#D9D6CF'][i],
                borderRight: i < breakdown.length - 1 ? '1px solid #fff' : 'none',
              }}/>
            ))}
          </div>
          <div className="wf-col" style={{ gap: 6 }}>
            {breakdown.map((b, i) => (
              <div key={b.cat} className="wf-row" style={{ justifyContent: 'space-between' }}>
                <div className="wf-row" style={{ gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: [WF.ink, WF.ink2, WF.ink3, WF.ink4, '#D9D6CF'][i] }}/>
                  <div style={{ fontSize: 12 }}>{b.cat}</div>
                </div>
                <div className="wf-row" style={{ gap: 10 }}>
                  <div className="wf-num" style={{ fontSize: 12, fontWeight: 600 }}>€{b.amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  <div className="wf-cap" style={{ minWidth: 28, textAlign: 'right' }}>{b.pct}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transactions */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Transactions · {e.tx}</div>
          <div className="wf-cap" style={{ color: WF.blue, fontWeight: 600 }}>+ Add</div>
        </div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 14 }}>
          {tx.map((t, i) => (
            <React.Fragment key={i}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={t.ico} size={14} color={WF.ink2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.m}</div>
                  <div className="wf-cap">{t.d} · {t.c}</div>
                </div>
                <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>−€{Math.abs(t.a).toFixed(2)}</div>
                <Ico name="x" size={14} color={WF.ink4}/>
              </div>
              {i < tx.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        <button className="wf-btn outline" style={{ width: '100%', height: 44 }}>
          <Ico name="plus" size={16}/> Link existing transaction
        </button>
      </WFBody>
    </ScreenShell>
  );
}

// ── Create / edit event ────────────────────────────────────────
function ScreenEventCreate() {
  return (
    <ScreenShell>
      <WFAppBar
        title="New event"
        leading={<Ico name="x" size={22}/>}
        trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Create</div>}
      />
      <WFBody>
        {/* Cover image picker */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <EventCover kind="cover" label="tap to add image" height={140}/>
          <div style={{
            position: 'absolute', right: 10, bottom: 10,
            width: 36, height: 36, borderRadius: 999, background: '#fff',
            border: `1px solid ${WF.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico name="cam" size={16}/>
          </div>
        </div>

        {/* Name */}
        <div className="wf-cap" style={{ marginBottom: 4 }}>NAME</div>
        <div className="wf-input" style={{ marginBottom: 12 }}>Norway road trip</div>

        {/* Dates */}
        <div className="wf-cap" style={{ marginBottom: 4 }}>DATES</div>
        <div className="wf-row" style={{ gap: 8, marginBottom: 12 }}>
          <div className="wf-input" style={{ flex: 1 }}>12 Jul 2025</div>
          <div className="wf-cap" style={{ alignSelf: 'center' }}>→</div>
          <div className="wf-input" style={{ flex: 1 }}>22 Jul 2025</div>
        </div>

        {/* Type */}
        <div className="wf-cap" style={{ marginBottom: 4 }}>TYPE</div>
        <div className="wf-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { l: 'Trip', sel: true },
            { l: 'Party' },
            { l: 'Project' },
            { l: 'Wedding' },
            { l: 'Other' },
          ].map(t => (
            <span key={t.l} className="wf-pill" style={{
              background: t.sel ? WF.ink : '#fff',
              color: t.sel ? '#fff' : WF.ink2,
              border: `1px solid ${t.sel ? WF.ink : WF.line}`,
              padding: '6px 12px',
            }}>{t.l}</span>
          ))}
        </div>

        {/* Auto-link suggestion */}
        <div className="wf-card" style={{ padding: 12, marginBottom: 14, background: WF.blueSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6, background: WF.blue,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ico name="check" size={12} color="#fff" stroke={2.5}/>
            </div>
            <div style={{ flex: 1, fontSize: 12, color: WF.ink2 }}>
              <b>Auto-link transactions</b> in this date range that match Travel categories. <span className="wf-cap">Edit before adding</span>
            </div>
          </div>
        </div>

        {/* Budget (optional) */}
        <div className="wf-cap" style={{ marginBottom: 4 }}>OPTIONAL TARGET</div>
        <div className="wf-row" style={{ gap: 8, marginBottom: 6 }}>
          <div className="wf-input" style={{ flex: 1, fontFamily: WF.fontMono }}>€ 1 800</div>
          <div className="wf-input empty" style={{ flex: 1 }}>No target</div>
        </div>
        <div className="wf-cap">Get a heads-up if spend exceeds this</div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Add transactions to event (bulk picker) ────────────────────
function ScreenEventAddTx() {
  const tx = [
    { d: '15 Jul', m: 'Scandic Hotel Bergen', a: -240.00, sel: true,  ico: 'house', match: true },
    { d: '15 Jul', m: 'Bryggen restaurant',   a: -68.40,  sel: true,  ico: 'shop',  match: true },
    { d: '14 Jul', m: 'Hertz car rental',     a: -185.00, sel: true,  ico: 'car',   match: true },
    { d: '14 Jul', m: 'Amazon order',         a: -32.99,  sel: false, ico: 'bag' },
    { d: '13 Jul', m: 'Statoil fuel',         a: -52.30,  sel: true,  ico: 'car',   match: true },
    { d: '12 Jul', m: 'Spotify',              a: -8.99,   sel: false, ico: 'film' },
  ];
  const selectedCount = tx.filter(t => t.sel).length;
  const selectedTotal = tx.filter(t => t.sel).reduce((s, t) => s + Math.abs(t.a), 0);

  return (
    <ScreenShell>
      <WFAppBar
        title="Add transactions"
        sub="Norway road trip"
        leading={<Ico name="x" size={22}/>}
        trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Add {selectedCount}</div>}
      />
      <WFBody>
        <div className="wf-input empty" style={{ gap: 8, marginBottom: 12 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search transactions…
        </div>

        {/* Selection summary */}
        <div className="wf-card" style={{ padding: 12, marginBottom: 14, background: WF.fillSoft, border: 'none' }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div className="wf-cap"><b>{selectedCount} selected</b></div>
            <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{selectedTotal.toFixed(2)}</div>
          </div>
        </div>

        {/* Date range filter */}
        <div className="wf-row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="wf-pill" style={{ background: WF.ink, color: '#fff', border: `1px solid ${WF.ink}`, padding: '5px 10px' }}>12–22 Jul</span>
          <span className="wf-pill" style={{ padding: '5px 10px' }}>All dates</span>
          <span className="wf-pill" style={{ padding: '5px 10px' }}>Travel only</span>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Suggested · auto-matched</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {tx.map((t, i, a) => (
            <React.Fragment key={i}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  border: `2px solid ${t.sel ? WF.ink : WF.line}`,
                  background: t.sel ? WF.ink : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {t.sel && <Ico name="check" size={11} color="#fff" stroke={3}/>}
                </div>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={t.ico} size={13} color={WF.ink2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wf-row" style={{ gap: 5 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.m}</div>
                    {t.match && <span className="wf-pill" style={{ background: WF.blueSoft, color: WF.blue, fontSize: 9, padding: '1px 5px' }}>auto</span>}
                  </div>
                  <div className="wf-cap">{t.d}</div>
                </div>
                <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>−€{Math.abs(t.a).toFixed(2)}</div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenEvents, ScreenEventDetail, ScreenEventCreate, ScreenEventAddTx,
  EVENTS, EventCover,
});
