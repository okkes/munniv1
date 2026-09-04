// Investment — overview, portfolio (after broker connection), connect-broker flow

const PORTFOLIO_HOLDINGS = [
  { ticker: 'VWCE',   name: 'FTSE All-World',     shares: 12.4, price: 112.30, change: 1.4,  alloc: 45 },
  { ticker: 'IUSQ',   name: 'MSCI World',          shares: 8.0,  price: 78.20,  change: 0.9,  alloc: 22 },
  { ticker: 'AAPL',   name: 'Apple Inc.',          shares: 4,    price: 195.00, change: -0.3, alloc: 12 },
  { ticker: 'BTC',    name: 'Bitcoin',             shares: 0.018,price: 62400,  change: 3.2,  alloc: 14 },
  { ticker: 'IEAA',   name: 'iShares EUR Bond',    shares: 6,    price: 95.40,  change: 0.1,  alloc: 7 },
];

const BROKERS = [
  { name: 'Trade Republic', sub: 'EU broker · stocks, ETFs, crypto', ico: 'rocket', color: WF.ink, status: 'connected', last: '2h ago' },
  { name: 'DEGIRO',         sub: 'EU broker · stocks, ETFs',         ico: 'card',   color: WF.amber, status: 'available' },
  { name: 'Interactive Brokers', sub: 'Global · all asset classes',  ico: 'globe',  color: WF.ink, status: 'available' },
  { name: 'Coinbase',       sub: 'Crypto wallets',                    ico: 'rocket', color: WF.ink, status: 'available' },
  { name: 'Bitvavo',        sub: 'EU crypto exchange',                ico: 'rocket', color: WF.ink, status: 'available' },
  { name: 'Manual entry',   sub: 'Track positions by hand',           ico: 'edit',   color: WF.ink3, status: 'available' },
];

// ── Investment overview (entry from home) ──────────────────────
function ScreenInvestment() {
  // Sparkline-ish data
  const trend = [5, 8, 6, 11, 14, 12, 18, 22, 20, 25, 28, 33];
  const maxTrend = Math.max(...trend);

  return (
    <ScreenShell>
      <WFAppBar
        title="Investment"
        leading={<Ico name="arrowL"/>}
        trailing={<Ico name="plus" size={22}/>}
      />
      <WFBody>
        {/* Hero — total invested + this period contribution */}
        <div className="wf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="wf-cap">Portfolio value</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>€14 820,40</div>
          <div className="wf-row" style={{ gap: 8, marginTop: 4 }}>
            <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>+€1 240 (+9,1%)</span>
            <span className="wf-cap" style={{ alignSelf: 'center' }}>YTD</span>
          </div>
          {/* trend line */}
          <div style={{ marginTop: 14, position: 'relative', height: 56 }}>
            <svg width="100%" height="100%" viewBox="0 0 300 56" preserveAspectRatio="none" style={{ display: 'block' }}>
              <path
                d={`M 0,${56 - (trend[0]/maxTrend)*52} ` + trend.map((v, i) => `L ${(i/(trend.length-1))*300},${56 - (v/maxTrend)*52}`).join(' ')}
                fill="none" stroke={WF.green} strokeWidth="2"
              />
              <path
                d={`M 0,${56 - (trend[0]/maxTrend)*52} ` + trend.map((v, i) => `L ${(i/(trend.length-1))*300},${56 - (v/maxTrend)*52}`).join(' ') + ' L 300,56 L 0,56 Z'}
                fill={WF.greenSoft} opacity="0.5"
              />
            </svg>
          </div>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <div className="wf-cap" style={{ fontSize: 10 }}>Mar &apos;25</div>
            <div className="wf-cap" style={{ fontSize: 10 }}>Feb &apos;26</div>
          </div>
        </div>

        {/* This period contribution */}
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="wf-section-title">This period · 20 Jan – 19 Feb</div>
            <Ico name="arrow-up-right" size={14} color={WF.green}/>
          </div>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>SET ASIDE</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700 }}>€300</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>INVESTED</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700 }}>€250</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: WF.line2 }}/>
            <div style={{ flex: 1 }}>
              <div className="wf-cap" style={{ fontSize: 10 }}>QUEUED</div>
              <div className="wf-num" style={{ fontSize: 18, fontWeight: 700, color: WF.amber }}>€50</div>
            </div>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', marginTop: 10, display: 'flex' }}>
            <div style={{ width: '83%', height: '100%', background: WF.green }}/>
            <div style={{ flex: 1, height: '100%', background: WF.amber }}/>
          </div>
          <div className="wf-cap" style={{ marginTop: 6 }}>83% deployed · €50 sits ready in Allocate → Investment</div>
        </div>

        {/* Connected brokers */}
        <div className="wf-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <div className="wf-section-title">Connected · 1 broker</div>
          <div className="wf-cap" style={{ color: WF.blue, fontWeight: 600 }}>+ Connect</div>
        </div>
        <div className="wf-card" style={{ padding: 12, marginBottom: 14 }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="rocket" size={16} color={WF.ink2}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Trade Republic</div>
              <div className="wf-cap">5 holdings · synced 2h ago</div>
            </div>
            <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>● live</span>
          </div>
        </div>

        {/* Allocation pie / bar */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Allocation</div>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ height: 10, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', display: 'flex' }}>
            {[
              { p: 67, c: WF.ink },
              { p: 14, c: WF.ink2 },
              { p: 12, c: WF.ink3 },
              { p: 7,  c: WF.ink4 },
            ].map((s, i) => (
              <div key={i} style={{ width: `${s.p}%`, height: '100%', background: s.c, borderRight: '1px solid #fff' }}/>
            ))}
          </div>
          <div className="wf-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {[
              { l: 'ETFs', p: 67, c: WF.ink },
              { l: 'Crypto', p: 14, c: WF.ink2 },
              { l: 'Stocks', p: 12, c: WF.ink3 },
              { l: 'Bonds', p: 7, c: WF.ink4 },
            ].map(s => (
              <div key={s.l} className="wf-row" style={{ gap: 4 }}>
                <div style={{ width: 8, height: 8, background: s.c, borderRadius: 2 }}/>
                <div className="wf-cap" style={{ fontSize: 11 }}>{s.l} {s.p}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Holdings */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Holdings · 5</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          {PORTFOLIO_HOLDINGS.map((h, i, a) => (
            <React.Fragment key={h.ticker}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: WF.fillSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.fontMono, fontSize: 9, fontWeight: 700, color: WF.ink2 }}>
                  {h.ticker}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wf-row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{h.name}</div>
                    <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>€{(h.shares * h.price).toFixed(0)}</div>
                  </div>
                  <div className="wf-row" style={{ justifyContent: 'space-between', marginTop: 1 }}>
                    <div className="wf-cap">{h.shares} × €{h.price}</div>
                    <div className="wf-cap" style={{ color: h.change >= 0 ? WF.green : WF.red }}>
                      {h.change >= 0 ? '+' : ''}{h.change}%
                    </div>
                  </div>
                </div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b>How it works:</b> set aside €€/period in Allocate → Investment.
            Connect a broker to see your portfolio live, or track positions manually.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Investment overview · BEFORE connecting any broker ─────────
function ScreenInvestmentEmpty() {
  return (
    <ScreenShell>
      <WFAppBar title="Investment" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        {/* Hero — only contribution, no portfolio yet */}
        <div className="wf-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="wf-cap">Set aside this period</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>€300</div>
          <div className="wf-cap" style={{ marginTop: 4 }}>From your periodical income · 12% rate</div>
          <div style={{ height: 8, borderRadius: 999, background: WF.fillSoft, overflow: 'hidden', marginTop: 12 }}>
            <div style={{ width: '83%', height: '100%', background: WF.ink2 }}/>
          </div>
          <div className="wf-cap" style={{ marginTop: 6 }}>€250 invested · €50 queued</div>
        </div>

        {/* Connect CTA */}
        <div className="wf-card" style={{ padding: 18, marginBottom: 14, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: WF.blueSoft, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="rocket" size={26} color={WF.blue}/>
          </div>
          <div className="wf-h3">See your full portfolio</div>
          <div className="wf-body" style={{ marginTop: 6, marginBottom: 14 }}>
            Connect a broker or wallet to see live positions, performance, and allocation.
          </div>
          <button className="wf-btn" style={{ width: '100%', height: 44 }}>
            <Ico name="link" size={16} color="#fff"/> Connect broker
          </button>
          <div className="wf-cap" style={{ marginTop: 10, color: WF.ink3 }}>or track positions manually</div>
        </div>

        {/* Contribution history */}
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Set aside · last 6 periods</div>
        <div className="wf-card" style={{ padding: 14 }}>
          <div className="wf-row" style={{ alignItems: 'flex-end', gap: 8, height: 90 }}>
            {[200, 250, 250, 300, 300, 300].map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div className="wf-num" style={{ fontSize: 9, color: WF.ink3 }}>€{v}</div>
                <div style={{ width: 16, height: `${(v/300)*70}%`, background: i === 5 ? WF.ink : WF.ink3, borderRadius: 3 }}/>
                <div style={{ fontSize: 9, color: WF.ink4 }}>{['Sep','Oct','Nov','Dec','Jan','Feb'][i]}</div>
              </div>
            ))}
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Connect broker — list of supported brokers/wallets ─────────
function ScreenInvestmentConnect() {
  return (
    <ScreenShell>
      <WFAppBar title="Connect broker" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <div className="wf-card" style={{ padding: 14, marginBottom: 14, background: WF.blueSoft, border: 'none' }}>
          <div className="wf-row" style={{ gap: 10 }}>
            <Ico name="lock" size={18} color={WF.blue}/>
            <div style={{ flex: 1, fontSize: 12, color: WF.ink2 }}>
              <b>Read-only access.</b> munni can&rsquo;t move money or trade — just show your positions.
            </div>
          </div>
        </div>

        <div className="wf-input empty" style={{ gap: 8, marginBottom: 12 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search brokers, wallets…
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Available · {BROKERS.length}</div>
        <div className="wf-col" style={{ gap: 8 }}>
          {BROKERS.map(b => (
            <div key={b.name} className="wf-card" style={{ padding: 12 }}>
              <div className="wf-row" style={{ gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={b.ico} size={18} color={b.color}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{b.name}</div>
                  <div className="wf-cap" style={{ marginTop: 1 }}>{b.sub}</div>
                </div>
                {b.status === 'connected' ? (
                  <span className="wf-pill" style={{ background: WF.greenSoft, color: WF.green }}>✓ {b.last}</span>
                ) : (
                  <button className="wf-btn outline sm">Connect</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="wf-card" style={{ padding: 12, marginTop: 14, background: WF.fillSoft, border: `1px dashed ${WF.line}` }}>
          <div className="wf-cap">
            <b>Don&rsquo;t see your broker?</b> Use Manual entry — paste positions from a CSV or type them in.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Connect broker · authorization step (OAuth-style) ──────────
function ScreenInvestmentAuth() {
  const scopes = [
    { l: 'Read account holdings & positions',     ok: true },
    { l: 'Read transaction history (12 months)',  ok: true },
    { l: 'Read account balances',                  ok: true },
    { l: 'Place trades or move money',             ok: false },
  ];
  return (
    <ScreenShell>
      <WFAppBar title="Connect" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <div style={{ textAlign: 'center', padding: '12px 0 24px' }}>
          <div className="wf-row" style={{ justifyContent: 'center', gap: 16, marginBottom: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: WF.fillSoft, border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>m</div>
            <div className="wf-row" style={{ gap: 4, color: WF.ink3 }}>
              <Ico name="link" size={16} color={WF.ink3}/>
            </div>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: WF.fillSoft, border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="rocket" size={22} color={WF.ink}/>
            </div>
          </div>
          <div className="wf-h3">Connect Trade Republic</div>
          <div className="wf-body" style={{ marginTop: 6 }}>
            You&rsquo;ll be redirected to log in. munni receives a read-only token.
          </div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>What we&rsquo;ll see</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 14 }}>
          {scopes.map((s, i, a) => (
            <React.Fragment key={s.l}>
              <div className="wf-row" style={{ padding: '12px 0', gap: 10 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: s.ok ? WF.greenSoft : WF.fillSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ico name={s.ok ? 'check' : 'x'} size={12} color={s.ok ? WF.green : WF.ink3} stroke={2.5}/>
                </div>
                <div style={{ flex: 1, fontSize: 13, color: s.ok ? WF.ink : WF.ink3 }}>
                  {s.l}
                </div>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>

        <div className="wf-card" style={{ padding: 12, marginBottom: 14, background: WF.fillSoft, border: 'none' }}>
          <div className="wf-cap">
            Tokens are stored encrypted on your device. Disconnect any time in Settings.
          </div>
        </div>

        <button className="wf-btn" style={{ width: '100%', height: 48 }}>
          Continue to Trade Republic
        </button>
        <button className="wf-btn ghost" style={{ width: '100%', height: 44, marginTop: 6, color: WF.ink3 }}>
          Cancel
        </button>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenInvestment, ScreenInvestmentEmpty, ScreenInvestmentConnect, ScreenInvestmentAuth,
  PORTFOLIO_HOLDINGS, BROKERS,
});
