// Category Review (full-screen swipe), Category Review list variant, Profile, Settings

// ── Category Review · variant A: swipe one-at-a-time ────────────
function ScreenCategoryReviewSwipe() {
  return (
    <ScreenShell>
      <WFAppBar
        title="Review"
        sub="3 of 12"
        leading={<Ico name="x" size={22}/>}
        trailing={<div className="wf-cap" style={{ fontWeight: 600, color: WF.ink4 }}>{`12 left`}</div>}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 20px 16px' }}>
        <div style={{ height: 4, background: WF.fillSoft, borderRadius: 999, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ width: '25%', height: '100%', background: WF.ink }}/>
        </div>

        {/* Card */}
        <div className="wf-card" style={{ padding: 24, textAlign: 'center', position: 'relative' }}>
          <div className="wf-cap" style={{ marginBottom: 6 }}>17 Feb · 19:42</div>
          <div className="wf-h2" style={{ marginBottom: 4 }}>Vapiano</div>
          <div className="wf-num" style={{ fontSize: 32, fontWeight: 700, color: WF.red, letterSpacing: '-0.02em' }}>− €18,40</div>
          <div style={{ fontFamily: WF.fontMono, fontSize: 11, color: WF.ink3, marginTop: 6 }}>VAPIANO 1234 BERLIN</div>

          <div className="wf-cap" style={{ marginTop: 22, marginBottom: 6 }}>AI suggests</div>
          <div className="wf-row" style={{ justifyContent: 'center', gap: 8 }}>
            <span className="wf-chip" style={{ borderColor: WF.ink, fontWeight: 600 }}>
              <Ico name="fork" size={14}/> Consumptions / Restaurants
            </span>
          </div>
          <div className="wf-cap" style={{ marginTop: 6, color: WF.ink4 }}>92% confidence</div>
        </div>

        <div className="wf-cap" style={{ textAlign: 'center', marginTop: 18, color: WF.ink3 }}>
          Swipe right to confirm · left to fix
        </div>

        {/* Big action buttons — fix · skip · accept */}
        <div className="wf-row" style={{ gap: 14, marginTop: 'auto', justifyContent: 'center', paddingBottom: 8, alignItems: 'center' }}>
          <button style={{
            width: 64, height: 64, borderRadius: 999, border: `2px solid ${WF.red}`,
            background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico name="x" size={26} color={WF.red} stroke={2.4}/>
          </button>
          <button style={{
            width: 56, height: 56, borderRadius: 999, border: `1.5px dashed ${WF.ink3}`,
            background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: WF.ink3, fontSize: 10, fontWeight: 600, gap: 2,
          }}>
            <Ico name="arrowR" size={18} color={WF.ink3}/>
            SKIP
          </button>
          <button style={{
            width: 64, height: 64, borderRadius: 999, border: `2px solid ${WF.green}`,
            background: WF.green, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ico name="check" size={26} color="#fff" stroke={2.6}/>
          </button>
        </div>
        <div className="wf-cap" style={{ textAlign: 'center', marginTop: 6, color: WF.ink4 }}>
          ✗ fix &nbsp;·&nbsp; skip = review later &nbsp;·&nbsp; ✓ accept
        </div>
      </div>
    </ScreenShell>
  );
}

// ── Category Review · "fix this one" detail (after pressing X) ─
function ScreenCategoryReviewFix() {
  return (
    <ScreenShell>
      <WFAppBar title="Fix category" leading={<Ico name="arrowL"/>} trailing={<div style={{ fontSize: 14, fontWeight: 600, color: WF.blue }}>Save</div>}/>
      <WFBody>
        <div className="wf-card" style={{ padding: 16, marginBottom: 18 }}>
          <div className="wf-row" style={{ gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: WF.fillSoft, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="fork" size={18}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Vapiano</div>
              <div className="wf-cap">17 Feb · €18,40</div>
            </div>
          </div>
        </div>

        <div className="wf-input empty" style={{ gap: 8, marginBottom: 12 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search categories…
        </div>

        {[
          { name: 'Consumptions', expanded: true, sub: [
            { name: 'Groceries' },
            { name: 'Restaurants', cur: true },
            { name: 'Coffee', sel: true },
            { name: 'Snacks' },
          ]},
          { name: 'Housing', expanded: false },
          { name: 'Transport', expanded: false },
          { name: 'Hobby', expanded: false },
        ].map(grp => (
          <div key={grp.name} style={{ marginBottom: 8 }}>
            <div className="wf-row" style={{ padding: '12px 4px', gap: 8 }}>
              <Ico name={grp.expanded ? 'arrowDn' : 'arrowR'} size={14} color={WF.ink3}/>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{grp.name}</div>
            </div>
            {grp.expanded && grp.sub && (
              <div className="wf-card" style={{ padding: '0 14px' }}>
                {grp.sub.map((s, i, a) => (
                  <React.Fragment key={s.name}>
                    <div className="wf-row" style={{ padding: '12px 0', gap: 12 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 999, border: `2px solid ${s.sel ? WF.ink : WF.line}`, background: s.sel ? WF.ink : '#fff' }}/>
                      <div style={{ flex: 1, fontSize: 13 }}>{s.name}</div>
                      {s.cur && <span className="wf-pill" style={{ background: WF.amberSoft, color: WF.amber }}>was AI's guess</span>}
                    </div>
                    {i < a.length - 1 && <Divider/>}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="wf-card" style={{ padding: 12, marginTop: 12, background: WF.fillSoft, border: 'none' }}>
          <label className="wf-row" style={{ gap: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${WF.ink}`, background: WF.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico name="check" size={11} color="#fff" stroke={3}/>
            </div>
            <div className="wf-cap" style={{ color: WF.ink2 }}>Apply to similar future transactions</div>
          </label>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Category Review · variant B: stacked list with inline ✓/✗ ───
function ScreenCategoryReviewList() {
  const items = [
    { t: 'Vapiano', amt: 18.40, cat: 'Restaurants', conf: 92, ico: 'fork' },
    { t: 'REWE', amt: 42.10, cat: 'Groceries', conf: 98, ico: 'shop' },
    { t: 'DB Bahn', amt: 12.20, cat: 'Transport', conf: 87, ico: 'car' },
    { t: 'Apotheke Z.', amt: 8.50, cat: 'Health', conf: 71, ico: 'health', warn: true },
    { t: 'Amazon', amt: 34.99, cat: 'Hobby?', conf: 54, ico: 'bag', warn: true },
    { t: 'Spotify', amt: 9.99, cat: 'Subscriptions', conf: 99, ico: 'film' },
  ];
  return (
    <ScreenShell>
      <WFAppBar title="Review · 12" leading={<Ico name="x" size={22}/>} trailing={<div className="wf-cap" style={{ fontWeight: 600 }}>Approve all</div>}/>
      <WFBody>
        <div className="wf-cap" style={{ marginBottom: 10 }}>
          Tap ✓ to confirm AI's category, ✗ to fix it.
        </div>
        <div className="wf-card" style={{ padding: '0 12px' }}>
          {items.map((it, i, a) => (
            <React.Fragment key={i}>
              <div className="wf-row" style={{ padding: '14px 0', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.fillSoft, border: `1px solid ${WF.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name={it.ico} size={16} color={WF.ink2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wf-row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{it.t}</div>
                    <div className="wf-num" style={{ fontSize: 13, fontWeight: 600 }}>−€{it.amt.toFixed(2)}</div>
                  </div>
                  <div className="wf-row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="wf-cap" style={{ color: it.warn ? WF.amber : WF.ink3 }}>{it.cat}</span>
                    <span className="wf-cap" style={{ color: WF.ink4 }}>· {it.conf}%</span>
                  </div>
                </div>
                <button style={{ width: 30, height: 30, borderRadius: 999, border: `1.5px solid ${WF.red}`, background: '#fff', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name="x" size={16} color={WF.red} stroke={2}/>
                </button>
                <button style={{ width: 30, height: 30, borderRadius: 999, border: `1.5px solid ${WF.green}`, background: WF.green, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico name="check" size={16} color="#fff" stroke={2.4}/>
                </button>
              </div>
              {i < a.length - 1 && <Divider/>}
            </React.Fragment>
          ))}
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Profile ────────────────────────────────────────────────────
function ScreenProfile() {
  return (
    <ScreenShell tabBar activeTab="profile">
      <WFAppBar title="Profile" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
          <div style={{ width: 80, height: 80, borderRadius: 999, background: WF.fillSoft, border: `1px solid ${WF.line}`, margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600, color: WF.ink3 }}>D</div>
          <div className="wf-h3">Demo User</div>
          <div className="wf-cap">demo@munni.app · Demo backend</div>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Account</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 16 }}>
          <RowItem icon="user" label="Name" value="Demo User"/>
          <Divider/>
          <RowItem icon="globe" label="Email" value="demo@munni.app"/>
          <Divider/>
          <RowItem icon="cal" label="Period start" value="20th of month"/>
          <Divider/>
          <RowItem icon="globe" label="Currency" value="EUR (€)"/>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Backend</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 16 }}>
          <RowItem icon="link" label="API URL" value="api.munni.local" mono/>
          <Divider/>
          <RowItem icon="card" label="Bank account" value="Not connected (demo)"/>
        </div>

        <div className="wf-card" style={{ padding: '0 14px' }}>
          <RowItem icon="logout" label="Sign out" danger/>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

function RowItem({ icon, label, value, mono, danger, trailing = true }) {
  return (
    <div className="wf-row" style={{ padding: '14px 0', gap: 12 }}>
      <Ico name={icon} size={18} color={danger ? WF.red : WF.ink2}/>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: danger ? WF.red : WF.ink }}>{label}</div>
        {value && <div className="wf-cap" style={{ marginTop: 2, fontFamily: mono ? WF.fontMono : WF.font }}>{value}</div>}
      </div>
      {trailing && !danger && <Ico name="arrowR" size={14} color={WF.ink4}/>}
    </div>
  );
}

// ── Settings (side sheet style — full screen for mobile) ───────
function ScreenSettings() {
  return (
    <ScreenShell>
      <WFAppBar title="Settings" leading={<Ico name="arrowL"/>}/>
      <WFBody>
        <div className="wf-section-title" style={{ marginBottom: 6 }}>Preferences</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 16 }}>
          <RowItem icon="bell" label="Notifications" value="Sync, budgets"/>
          <Divider/>
          <RowItem icon="cal" label="Period" value="20 → 19 monthly"/>
          <Divider/>
          <RowItem icon="tag" label="Categories" value="Manage"/>
          <Divider/>
          <RowItem icon="goal" label="Goals" value="Coming soon"/>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>Data & sync</div>
        <div className="wf-card" style={{ padding: '0 14px', marginBottom: 16 }}>
          <RowItem icon="sync" label="Sync now"/>
          <Divider/>
          <RowItem icon="link" label="Backend connection"/>
          <Divider/>
          <RowItem icon="card" label="Linked accounts"/>
        </div>

        <div className="wf-section-title" style={{ marginBottom: 6 }}>About</div>
        <div className="wf-card" style={{ padding: '0 14px' }}>
          <RowItem icon="lock" label="Privacy"/>
          <Divider/>
          <RowItem icon="help" label="Help & support"/>
          <Divider/>
          <RowItem icon="eye" label="Version" value="0.4.2 (demo)"/>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

// ── Side sheet (drawer) ────────────────────────────────────────
function ScreenSideSheet() {
  return (
    <ScreenShell>
      <WFStatusBar/>
      <div style={{ position: 'relative', flex: 1 }}>
        {/* dimmed bg */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)' }}/>
        {/* sheet */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, right: 0, width: '78%',
          background: '#fff', borderTopLeftRadius: 20, borderBottomLeftRadius: 20,
          boxShadow: '-12px 0 30px rgba(0,0,0,0.12)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div className="wf-row" style={{ gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 999, background: WF.fillSoft, border: `1px solid ${WF.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink3, fontSize: 13, fontWeight: 600 }}>D</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Demo</div>
              <div className="wf-cap">demo@munni.app</div>
            </div>
            <Ico name="x" size={20} color={WF.ink3}/>
          </div>
          <Divider/>
          {[
            { i: 'home', l: 'Home' },
            { i: 'list', l: 'Transactions' },
            { i: 'wallet', l: 'Budgets' },
            { i: 'goal', l: 'Goals' },
            { i: 'tag', l: 'Categories' },
            { i: 'sync', l: 'Sync' },
          ].map(r => (
            <div key={r.l} className="wf-row" style={{ gap: 12, padding: '10px 4px' }}>
              <Ico name={r.i} size={18} color={WF.ink2}/>
              <div style={{ fontSize: 14 }}>{r.l}</div>
            </div>
          ))}
          <Divider/>
          {[
            { i: 'user', l: 'Profile' },
            { i: 'bell', l: 'Notifications' },
            { i: 'help', l: 'Help' },
            { i: 'logout', l: 'Sign out' },
          ].map(r => (
            <div key={r.l} className="wf-row" style={{ gap: 12, padding: '10px 4px' }}>
              <Ico name={r.i} size={18} color={WF.ink2}/>
              <div style={{ fontSize: 14 }}>{r.l}</div>
            </div>
          ))}
        </div>
      </div>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenCategoryReviewSwipe, ScreenCategoryReviewFix, ScreenCategoryReviewList,
  ScreenProfile, ScreenSettings, ScreenSideSheet, RowItem,
});
