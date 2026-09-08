// Profile tab — user, accounts, integrations, settings

function ScreenProfile() {
  const nav = useNav();
  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Profile" large
        trailing={<button className="m-iconbtn m-tap" onClick={() => nav.push('settings')}><I name="sliders" size={20}/></button>}
      />
      <div className="m-body-scroll">
        {/* User card */}
        <div className="m-card" style={{ padding: 18, marginBottom: 16, border: `1px solid ${M.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 999,
            background: `linear-gradient(135deg, ${M.sage} 0%, ${M.sageDk || '#3D5A42'} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 22, fontFamily: M.fontDisp,
          }}>D</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Demo van der Berg</div>
            <div style={{ fontSize: 12, color: M.ink3, marginTop: 2 }}>demo@munni.app</div>
          </div>
          <I name="caretR" size={16} color={M.ink4}/>
        </div>

        {/* Profile switcher */}
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Profile</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 16, border: `1px solid ${M.line}` }}>
          <ProfileRow active label="Personal" sub="2 accounts · 1 card" icon="user"/>
          <Divider inset={48}/>
          <ProfileRow label="Family" sub="3 accounts · joint with Anna" icon="house"/>
          <Divider inset={48}/>
          <ProfileRow label="Freelance" sub="VAT registered · NL" icon="bag"/>
          <Divider inset={48}/>
          <div className="m-tap" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', color: M.sage }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <I name="plus" size={16} color={M.sage}/>
            </div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Add profile</div>
          </div>
        </div>

        {/* Quick links */}
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Manage</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 16, border: `1px solid ${M.line}` }}>
          <ProfileLink icon="card" label="Bank accounts" sub="2 connected" onClick={() => nav.push('accounts')}/>
          <Divider inset={48}/>
          <ProfileLink icon="receipt" label="Recurring" sub="9 subscriptions · 4 fixed" onClick={() => nav.push('recurring')}/>
          <Divider inset={48}/>
          <ProfileLink icon="link" label="Integrations" sub="3 merchants connected"/>
          <Divider inset={48}/>
          <ProfileLink icon="cal" label="Periods" sub="Monthly · 20th"/>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Account</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 16, border: `1px solid ${M.line}` }}>
          <ProfileLink icon="bell" label="Notifications"/>
          <Divider inset={48}/>
          <ProfileLink icon="lock" label="Privacy & security"/>
          <Divider inset={48}/>
          <ProfileLink icon="help" label="Help & support"/>
          <Divider inset={48}/>
          <ProfileLink icon="logout" label="Sign out" danger/>
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: M.ink4, padding: '12px 0 24px' }}>
          munni · v1.0.0 · build 248
        </div>
      </div>

      <TabBar active="profile" onChange={(t) => nav.switchTab(t)}/>
    </div>
  );
}

function ProfileRow({ active, label, sub, icon }) {
  return (
    <div className="m-tap" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: active ? M.sage : M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I name={icon} size={16} color={active ? '#fff' : M.ink2}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>{sub}</div>
      </div>
      {active ? (
        <I name="check" size={16} color={M.sage}/>
      ) : (
        <I name="caretR" size={14} color={M.ink4}/>
      )}
    </div>
  );
}

function ProfileLink({ icon, label, sub, danger, onClick }) {
  return (
    <div className="m-tap" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I name={icon} size={16} color={danger ? M.clay : M.ink2}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: danger ? M.clay : M.ink }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>{sub}</div>}
      </div>
      {!danger && <I name="caretR" size={14} color={M.ink4}/>}
    </div>
  );
}

function ScreenSettings() {
  const nav = useNav();
  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Settings"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
      />
      <div className="m-body-scroll">
        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Appearance</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          <FormRow label="Theme" value="System" caretR/>
          <Divider inset={0}/>
          <FormRow label="Currency" value="EUR (€)" caretR/>
          <Divider inset={0}/>
          <FormRow label="Language" value="English" caretR/>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Behaviour</div>
        <div className="m-card" style={{ padding: '4px 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          <SettingToggle label="Auto-categorize" sub="Use AI to classify new tx" on/>
          <Divider inset={0}/>
          <SettingToggle label="Daily summary" sub="9:00 push notification" on/>
          <Divider inset={0}/>
          <SettingToggle label="Round-up to savings" sub="Round purchases up to nearest €1"/>
        </div>
      </div>
    </div>
  );
}

function SettingToggle({ label, sub, on: onProp }) {
  const [on, setOn] = React.useState(!!onProp);
  return (
    <div className="m-tap" onClick={() => setOn(!on)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>{sub}</div>}
      </div>
      <Toggle on={on}/>
    </div>
  );
}

function ScreenAccounts() {
  const nav = useNav();
  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Bank accounts"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="plus" size={20}/></button>}
      />
      <div className="m-body-scroll">
        <div className="m-card" style={{ padding: 18, marginBottom: 16, border: `1px solid ${M.line}` }}>
          <div className="m-cap">Combined balance</div>
          <div className="m-num" style={{ fontSize: 32, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 4 }}>
            {fmtEur(ACCOUNTS.reduce((s, a) => s + a.balance, 0))}
          </div>
          <div style={{ fontSize: 12, color: M.ink3, marginTop: 2 }}>across {ACCOUNTS.length} accounts</div>
        </div>

        <div className="m-cap" style={{ marginBottom: 8, paddingLeft: 4 }}>Connected accounts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ACCOUNTS.map(a => (
            <div key={a.id} className="m-card" style={{ padding: 16, border: `1px solid ${M.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name={a.type === 'savings' ? 'piggy' : 'card'} size={18} color="#fff"/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: M.ink3, fontFamily: M.fontMono, marginTop: 2 }}>{a.iban}</div>
                </div>
                <div className="m-num" style={{ fontSize: 16, fontWeight: 600 }}>{fmtEur(a.balance)}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: M.sageSoft, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <I name="lock" size={18} color={M.sage}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: M.sage }}>Read-only access</div>
            <div style={{ fontSize: 12, color: M.ink2, marginTop: 4, lineHeight: 1.45 }}>
              munni uses open banking to read your transactions. We can never move money on your behalf.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenRecurring() {
  const nav = useNav();
  const [tab, setTab] = React.useState('subs');
  const subs = RECURRING.filter(r => r.cat !== 'housing' && r.cat !== 'utilities');
  const fixed = RECURRING.filter(r => r.cat === 'housing' || r.cat === 'utilities');
  const items = tab === 'subs' ? subs : fixed;
  const total = items.reduce((s, r) => s + Math.abs(r.amount), 0);

  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Recurring"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        trailing={<button className="m-iconbtn m-tap"><I name="plus" size={20}/></button>}
      />

      <div style={{ padding: '0 20px 14px', display: 'flex', gap: 6, flexShrink: 0 }}>
        {[{id:'subs',label:`Subscriptions · ${subs.length}`},{id:'fixed',label:`Fixed · ${fixed.length}`}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="m-chip m-tap"
            style={{
              background: tab === t.id ? M.ink : M.card,
              color: tab === t.id ? M.paper : M.ink2,
              borderColor: tab === t.id ? M.ink : M.line,
              fontWeight: tab === t.id ? 600 : 500,
            }}>{t.label}</button>
        ))}
      </div>

      <div className="m-body-scroll">
        <div className="m-card" style={{ padding: 16, marginBottom: 14, border: `1px solid ${M.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="m-cap">Total per period</div>
            <div style={{ fontSize: 11, color: M.ink3 }}>{(total * 12).toFixed(0)} / year</div>
          </div>
          <div className="m-num" style={{ fontSize: 28, fontWeight: 600, fontFamily: M.fontDisp, marginTop: 4 }}>{fmtEur(total)}</div>
        </div>

        <div className="m-card" style={{ padding: '0 16px', border: `1px solid ${M.line}` }}>
          {items.map((r, i, a) => (
            <React.Fragment key={r.id}>
              <div className="m-tap" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name={r.icon} size={18} color={M.ink2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>{r.every} · next {r.next}</div>
                </div>
                <div className="m-num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtEur(r.amount)}</div>
              </div>
              {i < a.length - 1 && <Divider inset={48}/>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenProfile, ScreenSettings, ScreenAccounts, ScreenRecurring, ProfileRow, ProfileLink, SettingToggle });
