// Tab bar + nav store
// Simple route-based nav: { tab, stack: [{screen, params}, ...] }

const NavCtx = React.createContext(null);

function NavProvider({ children, initial = 'home' }) {
  const [tab, setTab] = React.useState(initial);
  const [stacks, setStacks] = React.useState({ home: [], tx: [], events: [], profile: [] });

  const push = (screen, params = {}) => {
    setStacks(s => ({ ...s, [tab]: [...s[tab], { screen, params }] }));
  };
  const pop = () => {
    setStacks(s => ({ ...s, [tab]: s[tab].slice(0, -1) }));
  };
  const popAll = () => {
    setStacks(s => ({ ...s, [tab]: [] }));
  };
  const switchTab = (t) => setTab(t);
  const replace = (screen, params = {}) => {
    setStacks(s => ({ ...s, [tab]: [...s[tab].slice(0, -1), { screen, params }] }));
  };

  const value = { tab, stack: stacks[tab], push, pop, popAll, switchTab, replace };
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

const useNav = () => React.useContext(NavCtx);

// Tab bar
function TabBar({ active, onChange }) {
  const tabs = [
    { id: 'home',    icon: 'home', label: 'Home' },
    { id: 'tx',      icon: 'list', label: 'Transactions' },
    { id: 'events',  icon: 'star', label: 'Events' },
    { id: 'profile', icon: 'user', label: 'Profile' },
  ];
  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${M.line}`,
      background: 'rgba(247, 244, 238, 0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      paddingBottom: 18, paddingTop: 8,
      display: 'flex',
    }}>
      {tabs.map(t => {
        const a = t.id === active;
        return (
          <button key={t.id}
            onClick={() => onChange(t.id)}
            className="m-tap"
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3, padding: '6px 0',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: a ? M.ink : M.ink4, fontFamily: M.fontUI,
            }}>
            <I name={t.icon} size={22} stroke={a ? 1.9 : 1.5}/>
            <div style={{ fontSize: 10, fontWeight: a ? 600 : 500, letterSpacing: 0.02 }}>{t.label}</div>
          </button>
        );
      })}
    </div>
  );
}

// Stack screen wrapper with simple slide animation
function StackScreen({ children, depth = 0 }) {
  return (
    <div key={depth} style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      animation: depth > 0 ? 'mSlideIn 0.28s cubic-bezier(.2,.7,.2,1) both' : undefined,
      background: M.paper,
    }}>
      {children}
    </div>
  );
}

// Inject slide keyframes once
if (typeof document !== 'undefined' && !document.getElementById('m-nav-styles')) {
  const s = document.createElement('style');
  s.id = 'm-nav-styles';
  s.textContent = `
    @keyframes mSlideIn { from { transform: translateX(100%); } to { transform: none; } }
    @keyframes mSheetUp { from { transform: translateY(100%); } to { transform: none; } }
  `;
  document.head.appendChild(s);
}

// Sheet (modal) wrapper
function Sheet({ children, onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(27,26,23,0.45)', zIndex: 50,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      animation: 'mFadeIn 0.2s ease-out',
    }} onClick={onClose}>
      <div style={{
        background: M.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        animation: 'mSheetUp 0.32s cubic-bezier(.2,.7,.2,1)',
        maxHeight: '88%', display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: M.line }}/>
        </div>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { NavProvider, NavCtx, useNav, TabBar, StackScreen, Sheet });
