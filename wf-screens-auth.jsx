// Auth + onboarding screens: Splash, Login, Sign-up Demo, Sign-up Prod

function ScreenShell({ children, statusBar = true, tabBar = false, activeTab, dark = false }) {
  return (
    <div className="wf-screen wf-col" style={{ height: '100%', background: dark ? WF.ink : '#fff', color: dark ? '#fff' : WF.ink }}>
      {statusBar && <WFStatusBar />}
      {children}
      {tabBar && <WFTabBar active={activeTab} />}
    </div>
  );
}

// ── Splash ──────────────────────────────────────────────────────
function ScreenSplash() {
  return (
    <ScreenShell>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: '0 32px' }}>
        <div style={{
          width: 96, height: 96, borderRadius: 24, border: `2px solid ${WF.ink}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: WF.fontMono, fontSize: 12, color: WF.ink3, textAlign: 'center', lineHeight: 1.2,
        }}>logo<br/>96×96</div>
        <div style={{ textAlign: 'center' }}>
          <div className="wf-h1" style={{ marginBottom: 8 }}>munni</div>
          <div className="wf-cap">your finances, in one place</div>
        </div>
        <Skel w={120} h={4} bg={WF.line} style={{ marginTop: 32 }} />
      </div>
      <div style={{ height: 34 }}/>
    </ScreenShell>
  );
}

// ── Login ──────────────────────────────────────────────────────
function ScreenLogin() {
  return (
    <ScreenShell>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 24px 32px', gap: 28 }}>
        <div>
          <div className="wf-h1" style={{ marginBottom: 6 }}>Welcome back</div>
          <div className="wf-body">Sign in to continue to munni</div>
        </div>

        <div style={{
          width: '100%', height: 140, borderRadius: 16,
          border: `1px dashed ${WF.line}`,
          backgroundImage: `repeating-linear-gradient(135deg, ${WF.line2} 0 6px, transparent 6px 12px)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: WF.fontMono, fontSize: 11, color: WF.ink3,
        }}>brand illustration</div>

        <div className="wf-col" style={{ gap: 12, marginTop: 'auto' }}>
          <button className="wf-btn outline" style={{ height: 52, justifyContent: 'flex-start', paddingLeft: 20, gap: 14 }}>
            <Ico name="g" size={20}/> Continue with Google
          </button>
          <button className="wf-btn outline" style={{ height: 52, justifyContent: 'flex-start', paddingLeft: 20, gap: 14 }}>
            <Ico name="ms" size={20}/> Continue with Microsoft
          </button>
          <div className="wf-row" style={{ gap: 10, margin: '8px 0' }}>
            <div style={{ flex: 1, height: 1, background: WF.line2 }}/>
            <div className="wf-cap">or</div>
            <div style={{ flex: 1, height: 1, background: WF.line2 }}/>
          </div>
          <div className="wf-input empty">Email address</div>
          <button className="wf-btn" style={{ height: 52 }}>Continue</button>
        </div>
        <div className="wf-cap" style={{ textAlign: 'center', marginTop: 8 }}>
          By continuing, you agree to our Terms & Privacy.
        </div>
      </div>
    </ScreenShell>
  );
}

// ── Sign-up info gate ──────────────────────────────────────────
function ScreenSignupGate() {
  return (
    <ScreenShell>
      <WFAppBar title="" leading={<Ico name="arrowL"/>} />
      <WFBody>
        <div className="wf-h2" style={{ marginBottom: 6 }}>We need a bit more info</div>
        <div className="wf-body" style={{ marginBottom: 24 }}>
          Pick how you'd like to set up munni for your account.
        </div>

        <div className="wf-col" style={{ gap: 12 }}>
          <SignupOption title="Demo user" sub="Connect your own backend by URL. For developers self-hosting." badge="Dev" active />
          <SignupOption title="Real user" sub="Connect your bank account via Open Banking." badge="Prod" />
        </div>

        <div style={{ marginTop: 20, padding: 14, border: `1px solid ${WF.line2}`, borderRadius: 10, background: WF.fillSoft }}>
          <div className="wf-cap" style={{ display:'flex', gap: 6 }}>
            <Ico name="help" size={14} color={WF.ink3}/>
            Not sure? Most users want <b>Real user</b>.
          </div>
        </div>

        <button className="wf-btn" style={{ width: '100%', marginTop: 28, height: 52 }}>Continue</button>
      </WFBody>
    </ScreenShell>
  );
}

function SignupOption({ title, sub, badge, active }) {
  return (
    <div style={{
      padding: 16, borderRadius: 12,
      border: `${active ? 2 : 1}px solid ${active ? WF.ink : WF.line}`,
      background: '#fff', display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 999,
        border: `2px solid ${active ? WF.ink : WF.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && <div style={{ width: 10, height: 10, borderRadius: 999, background: WF.ink }}/>}
      </div>
      <div style={{ flex: 1 }}>
        <div className="wf-row" style={{ gap: 8, marginBottom: 2 }}>
          <div className="wf-h3">{title}</div>
          <span className="wf-pill" style={{ background: WF.fillSoft, color: WF.ink3, border: `1px solid ${WF.line}` }}>{badge}</span>
        </div>
        <div className="wf-cap">{sub}</div>
      </div>
    </div>
  );
}

// ── Sign-up Demo (api url) ─────────────────────────────────────
function ScreenSignupDemo() {
  return (
    <ScreenShell>
      <WFAppBar title="Demo setup" leading={<Ico name="arrowL"/>} />
      <WFBody>
        <div className="wf-body" style={{ marginBottom: 20 }}>
          Point munni at your self-hosted backend. We never store this URL outside your device.
        </div>

        <div className="wf-section-title" style={{ marginBottom: 8 }}>Backend</div>
        <div className="wf-col" style={{ gap: 14 }}>
          <div>
            <div className="wf-cap" style={{ marginBottom: 6 }}>API base URL</div>
            <div className="wf-input" style={{ fontFamily: WF.fontMono, fontSize: 13 }}>https://api.munni.local</div>
          </div>
          <div>
            <div className="wf-cap" style={{ marginBottom: 6 }}>API token (optional)</div>
            <div className="wf-input empty">paste token…</div>
          </div>
          <button className="wf-btn outline sm" style={{ alignSelf: 'flex-start' }}>
            <Ico name="check" size={14}/> Test connection
          </button>
        </div>

        <Divider style={{ margin: '24px 0' }}/>

        <div className="wf-section-title" style={{ marginBottom: 8 }}>Display name</div>
        <div className="wf-input">Acme Dev</div>

        <button className="wf-btn" style={{ width: '100%', marginTop: 32, height: 52 }}>Create demo account</button>
      </WFBody>
    </ScreenShell>
  );
}

// ── Sign-up Prod (bank) ────────────────────────────────────────
function ScreenSignupProd() {
  return (
    <ScreenShell>
      <WFAppBar title="Connect your bank" leading={<Ico name="arrowL"/>} sub="Step 1 of 3" />
      <WFBody>
        <div className="wf-body" style={{ marginBottom: 20 }}>
          We use your bank's secure Open Banking API. munni gets read-only access.
        </div>

        <div className="wf-section-title" style={{ marginBottom: 8 }}>Country</div>
        <div className="wf-input">Germany</div>

        <div className="wf-section-title" style={{ marginTop: 16, marginBottom: 8 }}>Choose your bank</div>
        <div className="wf-input empty" style={{ gap: 8 }}>
          <Ico name="search" size={16} color={WF.ink4}/>
          Search 200+ banks…
        </div>
        <div className="wf-col" style={{ gap: 0, marginTop: 12, border: `1px solid ${WF.line}`, borderRadius: 12, overflow: 'hidden' }}>
          {['Deutsche Bank', 'Commerzbank', 'ING', 'N26', 'Sparkasse'].map((b, i) => (
            <div key={b} style={{ padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: i < 4 ? `1px solid ${WF.line2}` : 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: WF.fillSoft, border: `1px solid ${WF.line2}`, fontFamily: WF.fontMono, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink3 }}>{b[0]}</div>
              <div style={{ flex: 1, fontSize: 14 }}>{b}</div>
              <Ico name="arrowR" size={14} color={WF.ink4}/>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, padding: 14, border: `1px solid ${WF.line2}`, borderRadius: 10, background: WF.fillSoft, display: 'flex', gap: 10 }}>
          <Ico name="lock" size={16} color={WF.ink3}/>
          <div className="wf-cap" style={{ flex: 1 }}>
            Read-only access. munni cannot move money. Revoke any time.
          </div>
        </div>
      </WFBody>
    </ScreenShell>
  );
}

Object.assign(window, {
  ScreenShell, ScreenSplash, ScreenLogin,
  ScreenSignupGate, ScreenSignupDemo, ScreenSignupProd,
});
