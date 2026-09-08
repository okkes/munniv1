// Transactions tab — list grouped by day, filter chips, search
// Tx detail screen, reimbursement linker, expenses overview by category

function ScreenTransactions() {
  const nav = useNav();
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  let filtered = TRANSACTIONS;
  if (filter === 'income') filtered = filtered.filter(t => t.amount > 0);
  if (filter === 'expense') filtered = filtered.filter(t => t.amount < 0);
  if (filter === 'review') filtered = filtered.filter(t => t.needsReview);
  if (filter === 'recurring') filtered = filtered.filter(t => t.recurring);
  if (query) filtered = filtered.filter(t => t.merchant.toLowerCase().includes(query.toLowerCase()));

  // Group by day
  const groups = {};
  filtered.forEach(t => {
    const k = t.date;
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'income', label: 'Income' },
    { id: 'expense', label: 'Expense' },
    { id: 'review', label: 'Review' },
    { id: 'recurring', label: 'Recurring' },
  ];

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Transactions" large
        leading={null}
        trailing={
          <>
            <button className="m-iconbtn m-tap" onClick={() => nav.push('expenses')}>
              <I name="sliders" size={20}/>
            </button>
            <button className="m-iconbtn m-tap" onClick={() => nav.push('search')}>
              <I name="search" size={20}/>
            </button>
          </>
        }
      />

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="m-chip m-tap"
            style={{
              background: filter === f.id ? M.ink : M.card,
              color: filter === f.id ? M.paper : M.ink2,
              borderColor: filter === f.id ? M.ink : M.line,
              fontWeight: filter === f.id ? 600 : 500,
              flexShrink: 0,
            }}>{f.label}</button>
        ))}
      </div>

      <div className="m-body-scroll">
        {days.map(d => {
          const dayTotal = groups[d].reduce((s, t) => s + t.amount, 0);
          return (
            <div key={d} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, padding: '0 4px' }}>
                <div className="m-cap">{dayLabel(d)}</div>
                <div className="m-num" style={{ fontSize: 11, color: M.ink3, fontWeight: 600 }}>
                  {dayTotal >= 0 ? '+' : ''}{fmtEur(dayTotal)}
                </div>
              </div>
              <div className="m-card" style={{ padding: '0 16px', border: `1px solid ${M.line}` }}>
                {groups[d].map((t, i, a) => (
                  <React.Fragment key={t.id}>
                    <TxRow tx={t} onClick={() => nav.push('txDetail', { id: t.id })}/>
                    {i < a.length - 1 && <Divider inset={50}/>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
        {days.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: M.ink3 }}>
            <I name="search" size={32} color={M.ink4}/>
            <div style={{ marginTop: 8, fontSize: 14 }}>No transactions</div>
          </div>
        )}
      </div>

      <TabBar active="tx" onChange={(t) => nav.switchTab(t)}/>
    </div>
  );
}

// Tx detail
function ScreenTxDetail({ params }) {
  const nav = useNav();
  const tx = TRANSACTIONS.find(t => t.id === params.id) || TRANSACTIONS[0];
  const cat = CATEGORIES[tx.cat] || {};
  const positive = tx.amount > 0;
  const linkedTx = TRANSACTIONS.find(t => t.linkedTo === tx.id);
  const reimburse = linkedTx ? linkedTx.amount : 0;
  const net = tx.amount + reimburse;
  const account = ACCOUNTS.find(a => a.id === tx.account);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="" 
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<>
          <button className="m-iconbtn m-tap"><I name="edit" size={18}/></button>
          <button className="m-iconbtn m-tap"><I name="more" size={18}/></button>
        </>}
      />
      <div className="m-body-scroll">
        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '8px 0 28px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, background: M.paper2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <I name={cat.icon || 'box'} size={28} color={M.ink2}/>
          </div>
          <div className="m-num" style={{ fontSize: 38, fontWeight: 600, color: positive ? M.sage : (linkedTx ? M.clay : M.ink), letterSpacing: '-0.025em' }}>
            {positive ? '+' : '−'}{fmtEur(Math.abs(net))}
          </div>
          {linkedTx && (
            <div style={{ fontSize: 12, color: M.ink3, marginTop: 6 }}>
              net · originally <span style={{ textDecoration: 'line-through' }}>{fmtEur(Math.abs(tx.amount))}</span> {' · '}
              {fmtEur(reimburse)} reimbursed
            </div>
          )}
          <div className="m-h2" style={{ marginTop: 14 }}>{tx.merchant}</div>
          <div style={{ fontSize: 13, color: M.ink3, marginTop: 4 }}>{fmtDate(tx.date, 'long')} · {tx.time}</div>
        </div>

        {/* Detail rows */}
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          <DetailRow label="Category" value={cat.name} icon={cat.icon} caretR/>
          <Divider inset={0}/>
          <DetailRow label="Account" value={account?.name || '—'}/>
          <Divider inset={0}/>
          <DetailRow label="Description" value={tx.desc} mono/>
          <Divider inset={0}/>
          <DetailRow label="Note" value="Add a note…" placeholder/>
        </div>

        {/* Receipt */}
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Receipt</div>
        <div className="m-card" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${M.line}` }}>
          {tx.hasReceipt ? (
            <>
              <div style={{ width: 40, height: 52, borderRadius: 6, background: M.paper2, border: `1px solid ${M.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I name="receipt" size={20} color={M.ink2}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Albert Heijn · 7 items</div>
                <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>Auto-matched · €42,10</div>
              </div>
              <I name="caretR" size={16} color={M.ink4}/>
            </>
          ) : (
            <>
              <div style={{ width: 40, height: 52, borderRadius: 6, border: `1px dashed ${M.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I name="cam" size={18} color={M.ink4}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: M.ink3 }}>No receipt yet</div>
                <div style={{ fontSize: 12, color: M.sage, fontWeight: 600, marginTop: 4 }}>Connect Albert Heijn →</div>
              </div>
            </>
          )}
        </div>

        {/* Reimbursed by */}
        {linkedTx && (
          <>
            <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Reimbursed by · 1</div>
            <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
              <div className="m-tap" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}
                onClick={() => nav.replace('txDetail', { id: linkedTx.id })}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name="link" size={16} color={M.sage}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{linkedTx.merchant}</div>
                  <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>{fmtDate(linkedTx.date)} · partial</div>
                </div>
                <div className="m-num" style={{ fontWeight: 600, color: M.sage }}>+{fmtEur(linkedTx.amount)}</div>
                <I name="caretR" size={14} color={M.ink4}/>
              </div>
            </div>
          </>
        )}

        {!positive && (
          <button className="m-btn outline m-tap" style={{ width: '100%', marginBottom: 18 }}
            onClick={() => nav.push('linkReimburse', { txId: tx.id })}>
            <I name="link" size={16}/>
            Link a reimbursement
          </button>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon, mono, placeholder, caretR }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0' }}>
      <div style={{ fontSize: 12, color: M.ink3, width: 96 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: placeholder ? M.ink4 : M.ink, fontFamily: mono ? M.fontMono : M.fontUI, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {icon && <I name={icon} size={14} color={M.ink3}/>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </div>
      {caretR && <I name="caretR" size={14} color={M.ink4}/>}
    </div>
  );
}

// Expenses overview — period scrubber + categories
function ScreenExpenses() {
  const nav = useNav();
  // Aggregate by category
  const totals = {};
  TRANSACTIONS.filter(t => t.amount < 0).forEach(t => {
    const c = CATEGORIES[t.cat];
    const grp = c?.parent || c?.id;
    if (!totals[grp]) totals[grp] = { id: grp, name: CATEGORIES[grp]?.name || c?.group || c?.name, icon: CATEGORIES[grp]?.icon || c?.icon, total: 0, subs: {} };
    totals[grp].total += Math.abs(t.amount);
    if (c?.parent) {
      if (!totals[grp].subs[c.id]) totals[grp].subs[c.id] = { id: c.id, name: c.name, total: 0, count: 0 };
      totals[grp].subs[c.id].total += Math.abs(t.amount);
      totals[grp].subs[c.id].count += 1;
    }
  });
  // Make consumptions parent visible
  const consumptions = { id: 'consumptions', name: 'Consumptions', icon: 'shop', total: 0, subs: {} };
  ['restaurants','groceries','coffee'].forEach(id => {
    const t = TRANSACTIONS.filter(x => x.cat === id).reduce((s, x) => s + Math.abs(x.amount), 0);
    if (t > 0) {
      consumptions.total += t;
      consumptions.subs[id] = { id, name: CATEGORIES[id].name, total: t, count: TRANSACTIONS.filter(x => x.cat === id).length };
    }
    delete totals[id];
  });
  totals.consumptions = consumptions;

  const cats = Object.values(totals).sort((a, b) => b.total - a.total);
  const grandTotal = cats.reduce((s, c) => s + c.total, 0);
  const [expanded, setExpanded] = React.useState({ consumptions: true });

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Expenses"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="filter" size={20}/></button>}
      />
      <div className="m-body-scroll">
        {/* Period scrubber */}
        <div style={{ textAlign: 'center', padding: '8px 0 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center', color: M.ink3, marginBottom: 8 }}>
            <button className="m-iconbtn m-tap"><I name="arrowL" size={16}/></button>
            <div style={{ fontSize: 13, fontWeight: 600, color: M.ink2 }}>20 Jan – 19 Feb</div>
            <button className="m-iconbtn m-tap"><I name="arrowR" size={16} color={M.ink4}/></button>
          </div>
          <div className="m-num" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.025em' }}>{fmtEur(grandTotal)}</div>
          <div style={{ fontSize: 12, color: M.clay, marginTop: 4, fontWeight: 500 }}>+€88 vs previous period</div>
        </div>

        {/* Stacked composition bar */}
        <StackedBar height={10} segments={cats.map((c, i) => ({
          value: c.total, color: [M.sage, M.clay, M.ochre, M.violet, M.slate, M.ink3][i % 6],
        }))}/>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, marginBottom: 18 }}>
          {cats.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: M.ink2 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: [M.sage, M.clay, M.ochre, M.violet, M.slate, M.ink3][i % 6] }}/>
              {c.name}
            </div>
          ))}
        </div>

        {/* Category list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cats.map(c => {
            const subs = Object.values(c.subs);
            const isOpen = expanded[c.id];
            const pct = (c.total / grandTotal) * 100;
            return (
              <div key={c.id} className="m-card" style={{ border: `1px solid ${M.line}`, overflow: 'hidden' }}>
                <div className="m-tap" onClick={() => subs.length > 0 && setExpanded({ ...expanded, [c.id]: !isOpen })}
                  style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <I name={c.icon || 'box'} size={18} color={M.ink2}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                      <div className="m-num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtEur(c.total)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 999, background: M.line2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: M.ink2 }}/>
                      </div>
                      <div style={{ fontSize: 11, color: M.ink3, fontWeight: 500, minWidth: 28, textAlign: 'right' }}>{pct.toFixed(0)}%</div>
                    </div>
                  </div>
                  {subs.length > 0 && <I name={isOpen ? 'arrowDn' : 'caretR'} size={14} color={M.ink4}/>}
                </div>
                {isOpen && subs.length > 0 && (
                  <div style={{ background: M.paper2, padding: '4px 0' }}>
                    {subs.map((s, i, a) => (
                      <React.Fragment key={s.id}>
                        <div className="m-tap" onClick={() => nav.push('categoryDrill', { id: s.id })}
                          style={{ padding: '12px 16px 12px 64px', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                              <div className="m-num" style={{ fontSize: 13, fontWeight: 600 }}>{fmtEur(s.total)}</div>
                            </div>
                            <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>{s.count} transactions</div>
                          </div>
                          <I name="caretR" size={12} color={M.ink4}/>
                        </div>
                        {i < a.length - 1 && <Divider inset={64}/>}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Category drill-in — filtered tx + 6mo trend
function ScreenCategoryDrill({ params }) {
  const nav = useNav();
  const cat = CATEGORIES[params?.id] || CATEGORIES.restaurants;
  const txs = TRANSACTIONS.filter(t => t.cat === cat.id);
  const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
  const history = SPEND_HISTORY[cat.id] || [50, 60, 55, 70, 65, total];
  const months = ['Sep','Oct','Nov','Dec','Jan','Feb'];

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title={cat.name} sub={cat.group}
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="filter" size={20}/></button>}
      />
      <div className="m-body-scroll">
        <div className="m-card" style={{ padding: 18, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="m-cap">Spent this period</div>
            <div style={{ fontSize: 11, color: M.clay, fontWeight: 600 }}>+12% vs avg</div>
          </div>
          <div className="m-num" style={{ fontSize: 30, fontWeight: 600, marginTop: 4 }}>{fmtEur(total)}</div>
          <div style={{ marginTop: 16 }}>
            <BarChart data={history} labels={months} height={84} accent={M.ink} color={M.ink}/>
          </div>
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

Object.assign(window, { ScreenTransactions, ScreenTxDetail, ScreenExpenses, ScreenCategoryDrill, DetailRow });
