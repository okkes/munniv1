// Transactions list, expenses, categorized list, transaction detail, reimbursement

// ── Transactions tab ───────────────────────────────────────────
const TX_DATA = [
  { d: 'Today', items: [
    { t: 'Vapiano', cat: 'Restaurants', amt: -18.40, ico: 'fork' },
    { t: 'REWE', cat: 'Groceries', amt: -42.10, ico: 'shop' },
    { t: 'Salary', cat: 'Income', amt: 2480.00, ico: 'arrow-dn-right', pos: true },
  ]},
  { d: 'Yesterday', items: [
    { t: 'Spotify', cat: 'Subscriptions', amt: -9.99, ico: 'film' },
    { t: 'DB Bahn', cat: 'Transport', amt: -12.20, ico: 'car' },
    { t: 'Apotheke', cat: 'Health', amt: -8.50, ico: 'health' },
  ]},
  { d: 'Mon, 17 Feb', items: [
    { t: 'Amazon', cat: 'Hobby', amt: -34.99, ico: 'bag' },
    { t: 'Rent', cat: 'Housing', amt: -740.00, ico: 'house' },
    { t: 'Friend → Vapiano', cat: 'Reimbursement', amt: 9.20, ico: 'link', pos: true },
  ]},
];

function TxRow({ tx }) {
  return (
    <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: WF.fillSoft, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ico name={tx.ico} size={18} color={WF.ink2}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{tx.t}</div>
        <div className="wf-cap">{tx.cat}</div>
      </div>
      <div className="wf-num" style={{ fontSize: 14, fontWeight: 600, color: tx.pos ? WF.green : WF.ink }}>
        {tx.pos ? '+' : ''}€{Math.abs(tx.amt).toFixed(2)}
      </div>
    </div>
  );
}

function ScreenTransactions() {
  return (
    <ScreenShell tabBar activeTab="tx">
      <WFAppBar title="Transactions" leading={<Ico name="filter" size={20}/>} trailing={<Ico name="search" size={20}/>}/>
      <WFBody>
        <div className="wf-row" style={{ gap: 8, marginBottom: 12, overflowX: 'auto' }}>
          <span className="wf-chip" style={{ borderColor: WF.ink, background: WF.ink, color: '#fff' }}>All</span>
          <span className="wf-chip">Income</span>
          <span className="wf-chip">Expense</span>
          <span className="wf-chip">Uncategorized</span>
          <span className="wf-chip">Reimbursed</span>
        </div>
        {TX_DATA.map(group => (
          <div key={group.d} style={{ marginBottom: 8 }}>
            <div className="wf-section-title" style={{ marginTop: 12, marginBottom: 4 }}>{group.d}</div>
            <div className="wf-card" style={{ padding: '0 14px' }}>
              {group.items.map((tx, i) => (
                <React.Fragment key={i}>
                  <TxRow tx={tx}/>
                  {i < group.items.length - 1 && <Divider/>}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </WFBody>
    </ScreenShell>
  );
}

// ── Expenses overview (categories) ─────────────────────────────
// Sub-categories are now first-class — each is its own tappable row inside
// an expanded group. Tapping a sub takes the user to its filtered tx list.
const EXPENSE_CATS = [
  { name: 'Housing', amt: 415.10, ico: 'house', pct: 34, sub: [
    { name: 'Rent', amt: 380.00, count: 1 },
    { name: 'Utilities', amt: 35.10, count: 3 },
  ]},
  { name: 'Consumptions', amt: 380.00, ico: 'shop', pct: 31, sub: [
    { name: 'Groceries', amt: 240.00, count: 8 },
    { name: 'Restaurants', amt: 95.00, count: 4 },
    { name: 'Coffee', amt: 45.00, count: 6 },
  ]},
  { name: 'Hobby', amt: 280.00, ico: 'bag', pct: 23, sub: [
    { name: 'Books', amt: 40.00, count: 2 },
    { name: 'Gaming', amt: 240.00, count: 1 },
  ]},
  { name: 'Transport', amt: 80.40, ico: 'car', pct: 7, sub: [
    { name: 'DB Bahn', amt: 60.20, count: 4 },
    { name: 'Uber', amt: 20.20, count: 1 },
  ]},
  { name: 'Health', amt: 60.00, ico: 'health', pct: 5, sub: [
    { name: 'Pharmacy', amt: 60.00, count: 2 },
  ]},
];

function ScreenExpenses({ variant = 'A' }) {
  return (
    <ScreenShell>
      <WFAppBar title="Expenses" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        {/* Period scrubber */}
        <div style={{ textAlign: 'center', marginTop: 4, marginBottom: 18 }}>
          <div className="wf-row" style={{ justifyContent: 'center', gap: 14, color: WF.ink3 }}>
            <Ico name="arrowL" size={16}/>
            <div className="wf-cap" style={{ fontWeight: 600 }}>20 Jan – 19 Feb</div>
            <Ico name="arrowR" size={16} color={WF.ink4}/>
          </div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, marginTop: 6, letterSpacing: '-0.02em' }}>€1 220,50</div>
          <div className="wf-cap" style={{ color: WF.red }}>+€88 vs previous period</div>
        </div>

        {variant === 'A' ? (
          // Variant A — list with sub-categories visible (Consumptions expanded)
          <div className="wf-col" style={{ gap: 8 }}>
            {EXPENSE_CATS.map((c, i) => (
              <CategoryGroup key={c.name} cat={c} expanded={c.name === 'Consumptions'}/>
            ))}
          </div>
        ) : (
          // Variant B — weighted bars, sub-cats inset under main bar
          <div className="wf-card" style={{ padding: 16 }}>
            <div className="wf-section-title" style={{ marginBottom: 12 }}>by category</div>
            <div className="wf-col" style={{ gap: 16 }}>
              {EXPENSE_CATS.map(c => (
                <div key={c.name}>
                  <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <div className="wf-row" style={{ gap: 10 }}>
                      <Ico name={c.ico} size={16} color={WF.ink2}/>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                    </div>
                    <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{c.amt.toFixed(2)}</div>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', display: 'flex' }}>
                    {c.sub.map((s, si) => {
                      const subPct = c.pct * (s.amt / c.amt);
                      const shades = [WF.ink, WF.ink2, WF.ink3, WF.ink4];
                      return (
                        <div key={s.name} style={{
                          width: `${subPct}%`, height: '100%',
                          background: shades[si % shades.length],
                          borderRight: si < c.sub.length - 1 ? '1px solid #fff' : 'none',
                        }}/>
                      );
                    })}
                  </div>
                  <div className="wf-row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {c.sub.map(s => (
                      <span key={s.name} className="wf-pill" style={{ background: WF.fillSoft, color: WF.ink3, fontSize: 10 }}>
                        {s.name} €{s.amt.toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </WFBody>
    </ScreenShell>
  );
}

// Expandable category group — main row + visible sub-rows
function CategoryGroup({ cat, expanded = false }) {
  return (
    <div className="wf-card" style={{ padding: '0 14px' }}>
      {/* Main row */}
      <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: WF.fillSoft, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico name={cat.ico} size={18} color={WF.ink2}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{cat.name}</div>
            <div className="wf-num" style={{ fontSize: 14, fontWeight: 600 }}>€{cat.amt.toFixed(2)}</div>
          </div>
          <div className="wf-row" style={{ gap: 6, marginTop: 4 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden' }}>
              <div style={{ width: `${cat.pct}%`, height: '100%', background: WF.ink2 }}/>
            </div>
            <div className="wf-cap" style={{ minWidth: 30, textAlign: 'right' }}>{cat.pct}%</div>
          </div>
        </div>
        <Ico name={expanded ? 'arrowDn' : 'arrowR'} size={14} color={WF.ink4}/>
      </div>

      {/* Sub-cat rows — first-class, tappable */}
      {expanded && cat.sub.length > 0 && (
        <>
          <Divider/>
          <div style={{ padding: '4px 0 8px', background: WF.fillSoft, margin: '0 -14px', paddingLeft: 14, paddingRight: 14 }}>
            {cat.sub.map((s, i, a) => (
              <React.Fragment key={s.name}>
                <div className="wf-row" style={{ padding: '10px 0 10px 36px', gap: 10 }}>
                  <div style={{
                    width: 4, alignSelf: 'stretch', background: WF.line, borderRadius: 999,
                    marginLeft: -14, marginRight: 4,
                  }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="wf-row" style={{ justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                      <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{s.amt.toFixed(2)}</div>
                    </div>
                    <div className="wf-cap" style={{ marginTop: 1 }}>{s.count} tx</div>
                  </div>
                  <Ico name="arrowR" size={12} color={WF.ink4}/>
                </div>
                {i < a.length - 1 && <div style={{ height: 1, background: WF.line2, marginLeft: 36 }}/>}
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Categorized transactions (filtered list + graph) ───────────
function ScreenCategorizedTx() {
  return (
    <ScreenShell>
      <WFAppBar title="Restaurants" sub="Consumptions" leading={<Ico name="arrowL"/>} trailing={<Ico name="filter" size={20}/>}/>
      <WFBody>
        <div className="wf-card" style={{ padding: 16 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <div className="wf-cap">Spent this period</div>
            <div className="wf-cap" style={{ color: WF.red }}>+12% vs avg</div>
          </div>
          <div className="wf-num" style={{ fontSize: 26, fontWeight: 700 }}>€95,40</div>
          {/* Mini bar chart */}
          <div className="wf-row" style={{ alignItems: 'flex-end', gap: 6, marginTop: 14, height: 70 }}>
            {[40, 65, 30, 80, 55, 95].map((h, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: '100%', height: `${h}%`, background: i === 5 ? WF.ink : WF.fill, borderRadius: 4 }}/>
                <div style={{ fontSize: 9, color: WF.ink4 }}>{['Sep','Oct','Nov','Dec','Jan','Feb'][i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="wf-section-title" style={{ marginTop: 18, marginBottom: 6 }}>Transactions · 8</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {[
            { t: 'Vapiano', cat: '17 Feb', amt: -18.40, ico: 'fork' },
            { t: 'L\'Osteria', cat: '12 Feb', amt: -32.00, ico: 'fork' },
            { t: 'Friend → Vapiano', cat: 'Reimbursed · 17 Feb', amt: 9.20, ico: 'link', pos: true },
            { t: 'Five Guys', cat: '03 Feb', amt: -22.50, ico: 'fork' },
            { t: 'Sushi Place', cat: '28 Jan', amt: -22.50, ico: 'fork' },
          ].map((tx, i, a) => (
            <React.Fragment key={i}>
              <TxRow tx={tx}/>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Transaction detail ─────────────────────────────────────────
function ScreenTransactionDetail() {
  // Original cost €18,40 minus a €9,20 partial reimbursement = net €9,20.
  return (
    <ScreenShell>
      <WFAppBar title="Transaction" leading={<Ico name="arrowL"/>} trailing={<Ico name="edit" size={20}/>}/>
      <WFBody>
        <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: WF.fillSoft, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Ico name="fork" size={26} color={WF.ink2}/>
          </div>
          {/* Net spent is the headline number */}
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, color: WF.red, letterSpacing: '-0.02em' }}>− €9,20</div>
          <div className="wf-cap" style={{ marginTop: 4 }}>net · originally <span style={{ textDecoration: 'line-through' }}>€18,40</span> − €9,20 reimbursed</div>
          <div className="wf-h3" style={{ marginTop: 10 }}>Vapiano</div>
          <div className="wf-cap">17 Feb 2026 · 19:42</div>
        </div>

        <div className="wf-card" style={{ padding: '4px 14px' }}>
          <DetailRow label="Category" value="Consumptions / Restaurants" trailing={<Ico name="arrowR" size={14} color={WF.ink4}/>}/>
          <Divider/>
          <DetailRow label="Account" value="Main · DE…4231"/>
          <Divider/>
          <DetailRow label="Original description" value="VAPIANO 1234 BERLIN" mono/>
          <Divider/>
          <DetailRow label="Note" value="Add a note…" placeholder/>
        </div>

        {/* Receipt block — Albert Heijn integration */}
        <div className="wf-section-title" style={{ marginTop: 20, marginBottom: 6 }}>Receipt</div>
        <div className="wf-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 44, height: 56, borderRadius: 6, border: `1px dashed ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.fontMono, fontSize: 9, color: WF.ink4, textAlign: 'center', lineHeight: 1.1 }}>no<br/>receipt</div>
          <div style={{ flex: 1 }}>
            <div className="wf-cap">No matched receipt yet.</div>
            <div className="wf-cap" style={{ color: WF.blue, fontWeight: 500, marginTop: 4 }}>Connect Albert Heijn / merchant API →</div>
          </div>
        </div>

        <div className="wf-section-title" style={{ marginTop: 20, marginBottom: 6 }}>Reimbursed by · 1</div>
        <div className="wf-card" style={{ padding: '4px 14px' }}>
          {/* Linked tx — tappable, leads to associated transaction */}
          <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="link" size={16} color={WF.green}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="wf-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Friend · PayPal</div>
                <div className="wf-num" style={{ fontWeight: 600, color: WF.green }}>+€9,20</div>
              </div>
              <div className="wf-cap" style={{ marginTop: 2 }}>17 Feb · split from €18,40 income</div>
            </div>
            <Ico name="arrowR" size={14} color={WF.ink4}/>
          </div>
          <Divider/>
          <div className="wf-row" style={{ padding: '12px 0', gap: 8, color: WF.blue }}>
            <Ico name="plus" size={16} color={WF.blue}/>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Link a reimbursement…</div>
          </div>
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 12, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b style={{ color: WF.ink2 }}>Net spent:</b> €18,40 − €9,20 = <span className="wf-num" style={{ color: WF.red, fontWeight: 600 }}>€9,20</span>
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

function DetailRow({ label, value, trailing, mono, placeholder }) {
  return (
    <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
      <div className="wf-cap" style={{ width: 110 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: placeholder ? WF.ink4 : WF.ink, fontFamily: mono ? WF.fontMono : WF.font }}>{value}</div>
      {trailing}
    </div>
  );
}

// ── Reimbursement picker — supports SPLITTING one income across many tx ─
function ScreenReimbursementPicker() {
  return (
    <ScreenShell>
      <WFAppBar title="Link reimbursement" leading={<Ico name="x" size={20}/>} trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Link</div>}/>
      <WFBody>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, background: WF.fillSoft }}>
          <div className="wf-cap" style={{ marginBottom: 4 }}>Linking against</div>
          <div className="wf-row" style={{ gap: 10 }}>
            <Ico name="fork" size={16} color={WF.ink2}/>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>Vapiano · 17 Feb</div>
            <div className="wf-num" style={{ color: WF.red, fontWeight: 600 }}>−€18,40</div>
          </div>
        </div>

        <div className="wf-input empty" style={{ gap: 8, marginBottom: 12 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search incoming transactions…
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Suggestions · same week</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {/* Selected with split amount input */}
          <div style={{ padding: '12px 0' }}>
            <div className="wf-row" style={{ gap: 12 }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${WF.ink}`, background: WF.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Ico name="check" size={12} color="#fff" stroke={2.4}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Friend · PayPal</div>
                <div className="wf-cap">17 Feb · total received €18,40</div>
              </div>
              <div className="wf-num" style={{ color: WF.green, fontWeight: 600 }}>+€18,40</div>
            </div>
            {/* Amount split UI */}
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
              <div className="wf-cap" style={{ marginBottom: 6, color: WF.ink2 }}>
                Apply only part of this income?
              </div>
              <div className="wf-row" style={{ gap: 8 }}>
                <div className="wf-input" style={{ flex: 1, height: 36, fontSize: 13, fontFamily: WF.fontMono }}>€ 9,20</div>
                <div className="wf-cap" style={{ alignSelf: 'center' }}>of €18,40</div>
              </div>
              <div className="wf-cap" style={{ marginTop: 6, color: WF.ink3 }}>
                Remaining €9,20 stays unattached — link to another tx later.
              </div>
            </div>
          </div>
          <Divider/>
          <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
            <div style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${WF.line}`, background: '#fff' }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Friend B</div>
              <div className="wf-cap">18 Feb · €4.60</div>
            </div>
          </div>
          <Divider/>
          <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
            <div style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${WF.line}`, background: '#fff' }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>PayPal credit</div>
              <div className="wf-cap">17 Feb · €9.20</div>
            </div>
          </div>
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.greenSoft, border: 'none' }}>
          <div className="wf-cap" style={{ color: WF.green, fontWeight: 600 }}>After linking</div>
          <div className="wf-num" style={{ fontSize: 18, fontWeight: 700 }}>Net: −€9,20</div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenTransactions, ScreenExpenses, ScreenCategorizedTx,
  ScreenTransactionDetail, ScreenReimbursementPicker, TxRow,
});
