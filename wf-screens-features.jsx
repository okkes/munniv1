// Recurring — subscriptions + fixed costs (mortgage, etc.) in one place
// Toggle period vs year view. Connection to Allocate (reserved €€).

const RECURRING = {
  fixed: [
    { name: 'Rent',            icon: 'house',  amt: 740,  freq: 'month', next: '01 Mar', cat: 'Housing' },
    { name: 'Health insurance',icon: 'health', amt: 145,  freq: 'month', next: '01 Mar', cat: 'Health' },
    { name: 'Internet',        icon: 'globe',  amt: 35,   freq: 'month', next: '15 Mar', cat: 'Housing' },
    { name: 'Gym',             icon: 'flame',  amt: 29,   freq: 'month', next: '20 Mar', cat: 'Wellbeing' },
  ],
  subs: [
    { name: 'Spotify',     icon: 'film',  amt: 9.99,  freq: 'month',  next: '04 Mar', cat: 'Subscriptions' },
    { name: 'Netflix',     icon: 'film',  amt: 13.99, freq: 'month',  next: '12 Mar', cat: 'Subscriptions', warn: 'Unused 28 days' },
    { name: 'iCloud 200GB',icon: 'globe', amt: 2.99,  freq: 'month',  next: '17 Mar', cat: 'Subscriptions' },
    { name: 'NYTimes',     icon: 'list',  amt: 50,    freq: 'year',   next: '12 Sep', cat: 'Subscriptions' },
    { name: 'Adobe CC',    icon: 'edit',  amt: 12.99, freq: 'month',  next: '21 Mar', cat: 'Subscriptions' },
  ],
};

function ScreenRecurring() {
  const [view, setView] = React.useState('period'); // 'period' | 'year'

  const monthly = (it) => it.freq === 'year' ? it.amt / 12 : it.amt;
  const yearly = (it) => it.freq === 'year' ? it.amt : it.amt * 12;

  const allFixed = RECURRING.fixed;
  const allSubs = RECURRING.subs;

  const periodFixedTotal = allFixed.reduce((s, x) => s + monthly(x), 0);
  const periodSubsTotal  = allSubs.reduce((s, x) => s + monthly(x), 0);
  const yearFixedTotal   = allFixed.reduce((s, x) => s + yearly(x), 0);
  const yearSubsTotal    = allSubs.reduce((s, x) => s + yearly(x), 0);

  const fixedTotal = view === 'period' ? periodFixedTotal : yearFixedTotal;
  const subsTotal  = view === 'period' ? periodSubsTotal  : yearSubsTotal;
  const total = fixedTotal + subsTotal;

  return (
    <ScreenShell>
      <WFAppBar
        title="Recurring"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Period / year toggle */}
        <div className="wf-row" style={{
          padding: 4, background: WF.fillSoft, borderRadius: 10, marginBottom: 14, gap: 4,
        }}>
          {['period', 'year'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              flex: 1, height: 32, borderRadius: 8, border: 'none',
              background: view === v ? '#fff' : 'transparent',
              fontWeight: view === v ? 600 : 500,
              fontSize: 12, color: view === v ? WF.ink : WF.ink3,
              boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
            }}>{v === 'period' ? 'This period' : 'Year overview'}</button>
          ))}
        </div>

        {/* Hero total */}
        <div className="wf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="wf-cap">{view === 'period' ? 'Due this period' : 'Per year'}</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
            €{total.toFixed(0)}
          </div>
          <div className="wf-row" style={{ gap: 10, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ color: WF.ink2 }}>Fixed costs</div>
              <div className="wf-num" style={{ fontSize: 15, fontWeight: 600 }}>€{fixedTotal.toFixed(0)}</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ color: WF.ink2 }}>Subscriptions</div>
              <div className="wf-num" style={{ fontSize: 15, fontWeight: 600 }}>€{subsTotal.toFixed(0)}</div>
            </div>
          </div>

          {/* Stacked bar */}
          <div style={{ height: 6, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', marginTop: 12, display: 'flex' }}>
            <div style={{ width: `${(fixedTotal/total)*100}%`, height: '100%', background: WF.ink }}/>
            <div style={{ width: `${(subsTotal/total)*100}%`, height: '100%', background: WF.ink3 }}/>
          </div>
        </div>

        {/* Allocate handshake */}
        <div className="wf-card" style={{ padding: 12, marginBottom: 14, background: WF.blueSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <Ico name="link" size={16} color={WF.blue}/>
            <div style={{ flex: 1, fontSize: 12, color: WF.ink2 }}>
              <b>Reserve €{periodFixedTotal.toFixed(0)} in Allocate</b> for upcoming fixed payments this period.
            </div>
            <Ico name="arrowR" size={14} color={WF.blue}/>
          </div>
        </div>

        {/* Fixed costs */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Fixed costs · {allFixed.length}</div>
          <div className="wf-cap">€{fixedTotal.toFixed(0)}</div>
        </div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 18 }}>
          {allFixed.map((it, i, a) => (
            <React.Fragment key={it.name}>
              <RecurringRow it={it} view={view}/>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        {/* Subscriptions */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Subscriptions · {allSubs.length}</div>
          <div className="wf-cap">€{subsTotal.toFixed(0)}</div>
        </div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {allSubs.map((it, i, a) => (
            <React.Fragment key={it.name}>
              <RecurringRow it={it} view={view} subscription/>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

function RecurringRow({ it, view, subscription }) {
  const yearly = it.freq === 'year' ? it.amt : it.amt * 12;
  const periodAmt = it.freq === 'year' ? it.amt / 12 : it.amt;
  const showAmt = view === 'period' ? periodAmt : yearly;
  return (
    <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: subscription ? WF.fillSoft : '#fff',
        border: subscription ? 'none' : `1px solid ${WF.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Ico name={it.icon} size={16} color={WF.ink2}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wf-row" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</div>
          <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{showAmt.toFixed(2)}</div>
        </div>
        <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
          <div className="wf-cap">
            {it.freq === 'year' ? 'yearly' : 'monthly'} · next {it.next}
          </div>
          <div className="wf-cap">
            {view === 'period' ? `€${(yearly).toFixed(0)} / yr` : `€${(periodAmt).toFixed(2)} / mo`}
          </div>
        </div>
        {it.warn && (
          <div className="wf-cap" style={{ color: WF.amber, marginTop: 4 }}>
            ⚠ {it.warn}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bank accounts — group view + profile switcher ──────────────
const ACCOUNTS = [
  { name: 'Main · Checking', bank: 'N26',     mask: 'DE…4231', balance: 2480.10, icon: 'card' },
  { name: 'Joint',           bank: 'Bunq',    mask: 'NL…1109', balance: 1320.00, icon: 'card', joint: true },
  { name: 'Savings',         bank: 'Trade R.',mask: 'DE…7733', balance: 7400.00, icon: 'piggy' },
  { name: 'Credit card',     bank: 'Amex',    mask: '··· 1004', balance: -210.50, icon: 'card' },
];

function ScreenAccounts() {
  const total = ACCOUNTS.reduce((s, a) => s + a.balance, 0);

  return (
    <ScreenShell>
      <WFAppBar
        title="Accounts"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Profile switcher */}
        <div className="wf-card" style={{ padding: 10, marginBottom: 14, background: WF.fillSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 8 }}>
            <div className="wf-row" style={{ gap: 6, flex: 1 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: '#fff', border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>P</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Personal</div>
                <div className="wf-cap" style={{ fontSize: 10 }}>4 accounts · default</div>
              </div>
            </div>
            <div className="wf-row" style={{ gap: 4 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: WF.fill, border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: WF.ink3 }}>F</div>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: WF.fill, border: `1px dashed ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Ico name="plus" size={12} color={WF.ink4}/>
              </div>
            </div>
            <Ico name="switch" size={18} color={WF.ink3}/>
          </div>
        </div>

        {/* Total balance */}
        <div className="wf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="wf-cap">Total · across {ACCOUNTS.length} accounts</div>
          <div className="wf-num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>€{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="wf-row" style={{ gap: 8, marginTop: 8 }}>
            <span className="wf-pill" style={{ background: WF.fillSoft, color: WF.ink3 }}>Group as one</span>
            <span className="wf-pill" style={{ background: WF.ink, color: '#fff' }}>Per account</span>
          </div>
        </div>

        {/* Account list */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Linked accounts</div>
        <div className="wf-col" style={{ gap: 8 }}>
          {ACCOUNTS.map(a => (
            <div key={a.name} className="wf-card" style={{ padding: 12 }}>
              <div className="wf-row" style={{ gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={a.icon} size={16} color={WF.ink2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wf-row" style={{ gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                    {a.joint && <span className="wf-pill" style={{ background: WF.amberSoft, color: WF.amber, fontSize: 9 }}>shared</span>}
                  </div>
                  <div className="wf-cap" style={{ fontFamily: WF.fontMono, marginTop: 1 }}>{a.bank} · {a.mask}</div>
                </div>
                <div className="wf-num" style={{ fontSize: 14, fontWeight: 600, color: a.balance < 0 ? WF.red : WF.ink }}>
                  {a.balance < 0 ? '−' : ''}€{Math.abs(a.balance).toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button className="wf-btn outline" style={{ width: '100%', marginTop: 14, height: 44, borderStyle: 'dashed' }}>
          <Ico name="plus" size={16}/> Connect another bank
        </button>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b>Profiles</b> separate budgets &amp; goals (e.g. personal vs family). <b>Group as one</b> merges balances into one wallet within a profile.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Albert Heijn / merchant API integration ─────────────────────
// Connection screen + transaction with auto-attached receipt
function ScreenIntegrations() {
  const integrations = [
    { name: 'Albert Heijn',   sub: 'Bonuskaart receipts',   ico: 'shop',    color: WF.blue,  status: 'connected', last: '2h ago' },
    { name: 'Jumbo',          sub: 'Receipts & loyalty',    ico: 'shop',    color: WF.amber, status: 'available' },
    { name: 'Amazon',         sub: 'Order history',          ico: 'box',     color: WF.amber, status: 'connected', last: '1d ago' },
    { name: 'Uber',           sub: 'Trip receipts',          ico: 'car',     color: WF.ink,   status: 'available' },
    { name: 'Trainline / NS', sub: 'Tickets & receipts',     ico: 'globe',   color: WF.ink,   status: 'available' },
    { name: 'Gmail',          sub: 'Receipt scraping',       ico: 'globe',   color: WF.red,   status: 'available' },
  ];
  return (
    <ScreenShell>
      <WFAppBar title="Integrations" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, background: WF.blueSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <Ico name="receipt" size={18} color={WF.blue}/>
            <div style={{ flex: 1, fontSize: 12, color: WF.ink2 }}>
              Connect merchants to <b>auto-attach receipts</b> and itemise grocery spend by product.
            </div>
          </div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Merchants</div>
        <div className="wf-col" style={{ gap: 8 }}>
          {integrations.map(it => (
            <div key={it.name} className="wf-card" style={{ padding: 12 }}>
              <div className="wf-row" style={{ gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={it.ico} size={18} color={it.color}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</div>
                  <div className="wf-cap" style={{ marginTop: 1 }}>{it.sub}</div>
                </div>
                {it.status === 'connected' ? (
                  <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>
                    ✓ {it.last}
                  </span>
                ) : (
                  <button className="wf-btn outline sm">Connect</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Transaction detail with attached AH receipt (itemised) ─────
function ScreenTxWithReceipt() {
  const items = [
    { n: 'Verse melk 1L',         q: 2, p: 1.49 },
    { n: 'Volkoren brood',        q: 1, p: 2.29 },
    { n: 'Bananen kg',            q: 1, p: 1.79 },
    { n: 'Yoghurt naturel 1L',    q: 1, p: 2.49 },
    { n: 'Kipfilet 500g',         q: 1, p: 6.99 },
    { n: 'Pasta penne',           q: 2, p: 1.19 },
    { n: 'Tomatensaus',           q: 1, p: 1.89 },
    { n: 'Salade meng',           q: 1, p: 2.49 },
    { n: 'Koffie bonen',          q: 1, p: 7.99 },
    { n: 'Bonuskorting',          q: 1, p: -1.20, neg: true },
  ];
  const subtotal = items.reduce((s, it) => s + it.q * it.p, 0);

  return (
    <ScreenShell>
      <WFAppBar title="Transaction" leading={<Ico name="arrowL"/>} trailing={<Ico name="edit" size={20}/>}/>
      <WFBody>
        <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: WF.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Ico name="shop" size={26} color={WF.blue}/>
          </div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, color: WF.red, letterSpacing: '-0.02em' }}>−€{Math.abs(subtotal).toFixed(2)}</div>
          <div className="wf-h3" style={{ marginTop: 6 }}>Albert Heijn</div>
          <div className="wf-cap">19 Feb · 18:14 · AH 1234 Amsterdam</div>
        </div>

        <div className="wf-card" style={{ padding: '4px 14px', marginBottom: 14 }}>
          <DetailRow label="Category" value="Consumptions / Groceries" trailing={<Ico name="arrowR" size={14} color={WF.ink4}/>}/>
          <Divider/>
          <DetailRow label="Account" value="Main · DE…4231"/>
        </div>

        {/* Auto-attached receipt */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Receipt · auto-attached</div>
          <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>via AH API</span>
        </div>
        <div className="wf-card" style={{ padding: 14 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="wf-cap" style={{ fontFamily: WF.fontMono }}>BON #4892 · {items.length} items</div>
            <div className="wf-cap" style={{ color: WF.green }}>€1.20 bonus</div>
          </div>
          <div style={{ borderTop: `1px dashed ${WF.line}`, paddingTop: 8 }}>
            {items.map((it, i) => (
              <div key={i} className="wf-row" style={{ padding: '5px 0', justifyContent: 'space-between', fontSize: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontFamily: WF.fontMono, color: it.neg ? WF.green : WF.ink2 }}>
                  {it.q > 1 ? `${it.q}× ` : ''}{it.n}
                </div>
                <div className="wf-num" style={{ fontWeight: 500, color: it.neg ? WF.green : WF.ink, fontFamily: WF.fontMono }}>
                  {it.neg ? '−' : ''}€{Math.abs(it.q * it.p).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${WF.line2}`, marginTop: 8, paddingTop: 8 }}>
            <div className="wf-row" style={{ justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
              <div>Total</div>
              <div className="wf-num">€{subtotal.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b>Insight:</b> 60% of this trip was fresh produce &amp; protein.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenRecurring, ScreenAccounts, ScreenIntegrations, ScreenTxWithReceipt,
  RECURRING, ACCOUNTS,
});
