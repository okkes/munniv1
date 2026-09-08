// munni — design tokens, fonts, primitives
// Calm editorial finance app: serif numerals, warm paper neutrals,
// sage primary, terracotta negative, ochre warning.

const M = {
  // Paper / ink scale (warm, slightly desaturated)
  paper:   '#F7F4EE',  // app background
  paper2:  '#EFEAE0',  // subtle wash
  card:    '#FFFFFF',
  ink:     '#1B1A17',  // primary text
  ink2:    '#3D3A33',
  ink3:    '#6B6558',
  ink4:    '#9A9384',
  line:    '#E2DCCE',
  line2:   '#EFEAE0',
  // Brand sage (primary, positive)
  sage:    '#4A6A4F',
  sageDk:  '#2F4A33',
  sageSoft:'#DDE6DA',
  // Negative terracotta
  clay:    '#B5503A',
  claySoft:'#F2DDD3',
  // Warning ochre
  ochre:   '#A8782B',
  ochreSoft:'#F0E2C2',
  // Cool slate (info / muted accent)
  slate:   '#3F4E63',
  slateSoft:'#DDE2EA',
  // Investment violet
  violet:   '#5E4A78',
  violetSoft:'#E3DCED',

  fontUI:    "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  fontDisp:  "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
  fontMono:  "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

// Inject fonts + base styles
if (typeof document !== 'undefined' && !document.getElementById('m-styles')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=JetBrains+Mono:wght@400;500&display=swap';
  document.head.appendChild(link);

  const s = document.createElement('style');
  s.id = 'm-styles';
  s.textContent = `
    .m, .m * { box-sizing: border-box; }
    .m-app { font-family: ${M.fontUI}; color: ${M.ink}; background: ${M.paper}; -webkit-font-smoothing: antialiased; }
    .m-num { font-family: ${M.fontDisp}; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .m-mono { font-family: ${M.fontMono}; }
    .m-row { display: flex; align-items: center; }
    .m-col { display: flex; flex-direction: column; }
    .m-card { background: ${M.card}; border-radius: 16px; }
    .m-card-bordered { background: ${M.card}; border: 1px solid ${M.line}; border-radius: 16px; }
    .m-divider { height: 1px; background: ${M.line2}; }
    .m-cap { font-size: 11px; color: ${M.ink3}; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 500; }
    .m-label { font-size: 12px; color: ${M.ink3}; }
    .m-chip { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:500; border:1px solid ${M.line}; background:${M.card}; color:${M.ink2}; }
    .m-pill { display:inline-flex; align-items:center; padding:3px 8px; border-radius:999px; font-size:10px; font-weight:600; letter-spacing:0.02em; }
    .m-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:48px; padding:0 22px; border-radius:14px; font-size:15px; font-weight:600; border:none; background:${M.ink}; color:${M.paper}; cursor:pointer; transition: transform 0.1s, opacity 0.15s; font-family: ${M.fontUI}; }
    .m-btn:active { transform: scale(0.98); opacity: 0.9; }
    .m-btn.outline { background:transparent; color:${M.ink}; border:1px solid ${M.line}; }
    .m-btn.ghost { background:transparent; color:${M.ink}; }
    .m-btn.sage { background:${M.sage}; color:#fff; }
    .m-btn.sm { height: 36px; padding: 0 14px; font-size: 13px; border-radius: 10px; }
    .m-input { height:48px; border:1px solid ${M.line}; border-radius:12px; padding:0 16px; font-size:15px; background:${M.card}; color:${M.ink}; display:flex; align-items:center; gap:8px; font-family: ${M.fontUI}; }
    .m-input.empty { color:${M.ink4}; }
    .m-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${M.ink3}; }
    .m-h1 { font-family: ${M.fontDisp}; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
    .m-h2 { font-family: ${M.fontDisp}; font-size: 24px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.15; }
    .m-h3 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .m-body { font-size: 14px; color: ${M.ink2}; line-height: 1.45; }
    .m-tap { cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
    .m-tap:active { opacity: 0.7; transform: scale(0.98); }
    .m-screen { width:100%; height:100%; background:${M.paper}; color:${M.ink}; font-family:${M.fontUI}; display:flex; flex-direction:column; overflow:hidden; }
    .m-body-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding: 0 20px 24px; }
    .m-body-scroll::-webkit-scrollbar { display: none; }
    .m-appbar { display:flex; align-items:center; justify-content:space-between; padding: 8px 16px 12px; gap: 8px; flex-shrink: 0; }
    .m-iconbtn { width:36px; height:36px; border-radius:999px; background:transparent; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; color:${M.ink}; }
    .m-iconbtn.filled { background:${M.card}; border:1px solid ${M.line}; }

    /* Animation */
    @keyframes mFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .m-fade { animation: mFadeIn 0.28s ease-out both; }

    /* Logo */
    .m-logo { font-family: ${M.fontDisp}; font-weight: 600; letter-spacing: -0.04em; }
    .m-logo .dot { color: ${M.sage}; }
  `;
  document.head.appendChild(s);
}

// ─── Phosphor-ish icon set, 1.5px stroke, geometric ──────────
function I({ name, size = 20, color = 'currentColor', stroke = 1.6 }) {
  const p = { stroke: color, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const f = { fill: color, stroke: 'none' };
  const w = (kids) => <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>{kids}</svg>;
  switch (name) {
    case 'home': return w(<path d="M3.5 11.5L12 4l8.5 7.5V20a1 1 0 01-1 1h-4.5v-6h-6v6H4.5a1 1 0 01-1-1z" {...p}/>);
    case 'list': return w(<><path d="M4 7h16M4 12h16M4 17h12" {...p}/></>);
    case 'star': return w(<path d="M12 4l2.4 5.4L20 10l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.6z" {...p}/>);
    case 'user': return w(<><circle cx="12" cy="9" r="3.5" {...p}/><path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5" {...p}/></>);
    case 'plus': return w(<path d="M12 5v14M5 12h14" {...p}/>);
    case 'minus': return w(<path d="M5 12h14" {...p}/>);
    case 'check': return w(<path d="M5 12.5l4 4 10-10" {...p}/>);
    case 'x': return w(<path d="M6 6l12 12M18 6L6 18" {...p}/>);
    case 'arrowR': return w(<path d="M9 5l7 7-7 7" {...p}/>);
    case 'arrowL': return w(<path d="M15 5l-7 7 7 7" {...p}/>);
    case 'arrowDn': return w(<path d="M5 9l7 7 7-7" {...p}/>);
    case 'arrowUp': return w(<path d="M19 15l-7-7-7 7" {...p}/>);
    case 'caretR': return w(<path d="M10 6l6 6-6 6" {...p}/>);
    case 'edit': return w(<><path d="M4 20h4l10-10-4-4L4 16v4z" {...p}/><path d="M14 6l4 4" {...p}/></>);
    case 'search': return w(<><circle cx="11" cy="11" r="6.5" {...p}/><path d="M20.5 20.5l-4-4" {...p}/></>);
    case 'filter': return w(<path d="M5 6h14M7 12h10M10 18h4" {...p}/>);
    case 'sliders': return w(<><path d="M4 7h10M16 7h4M4 17h4M10 17h10" {...p}/><circle cx="15" cy="7" r="2" {...p}/><circle cx="9" cy="17" r="2" {...p}/></>);
    case 'cal': return w(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...p}/><path d="M3.5 9.5h17M8 3.5v3.5M16 3.5v3.5" {...p}/></>);
    case 'sync': return w(<><path d="M4 12a8 8 0 0114-5.3L20 5v5h-5" {...p}/><path d="M20 12a8 8 0 01-14 5.3L4 19v-5h5" {...p}/></>);
    case 'bell': return w(<><path d="M6 16V11a6 6 0 1112 0v5l1.5 2H4.5z" {...p}/><path d="M10 20a2 2 0 004 0" {...p}/></>);
    case 'lock': return w(<><rect x="5" y="11" width="14" height="9" rx="2.5" {...p}/><path d="M8 11V8a4 4 0 018 0v3" {...p}/></>);
    case 'help': return w(<><circle cx="12" cy="12" r="9" {...p}/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17.5v.5" {...p}/></>);
    case 'menu': return w(<path d="M4 7h16M4 12h16M4 17h16" {...p}/>);
    case 'more': return w(<><circle cx="6" cy="12" r="1.4" {...f}/><circle cx="12" cy="12" r="1.4" {...f}/><circle cx="18" cy="12" r="1.4" {...f}/></>);
    case 'piggy': return w(<><path d="M5 13a6 6 0 0112 0v3a2 2 0 01-2 2h-1l-.5 2h-2l-.5-2h-2l-.5 2h-2L6 18a2 2 0 01-1-2z" {...p}/><circle cx="14" cy="12" r="0.7" {...f}/></>);
    case 'wallet': return w(<><rect x="3" y="6" width="18" height="13" rx="2.5" {...p}/><path d="M16 12.5h3" {...p}/></>);
    case 'card': return w(<><rect x="3" y="6" width="18" height="13" rx="2.5" {...p}/><path d="M3 11h18M7 16h3" {...p}/></>);
    case 'goal': return w(<><circle cx="12" cy="12" r="9" {...p}/><circle cx="12" cy="12" r="5" {...p}/><circle cx="12" cy="12" r="1.5" {...f}/></>);
    case 'rocket': return w(<><path d="M12 3c4 2 6 6 6 10l-3 3-3-1-1-3-3-1 3-3c4 0 8 2 10 6" {...p}/><circle cx="14" cy="10" r="1.4" {...f}/></>);
    case 'house': return w(<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" {...p}/>);
    case 'shop': return w(<><path d="M5 8h14l-1.2 12H6.2z" {...p}/><path d="M9 8a3 3 0 016 0" {...p}/></>);
    case 'bag': return w(<><path d="M5 8h14l-1.2 12H6.2z" {...p}/><path d="M9 8V6a3 3 0 016 0v2" {...p}/></>);
    case 'fork': return w(<><path d="M7 3v7a2 2 0 002 2v9M7 7h4M11 3v7a2 2 0 01-2 2M16 3c-1 3-1 5 0 7v11" {...p}/></>);
    case 'car': return w(<><path d="M5 16v-4l2-5h10l2 5v4M5 16h14M5 16v2h2v-2M17 16v2h2v-2" {...p}/><circle cx="8" cy="13.5" r="0.7" {...f}/><circle cx="16" cy="13.5" r="0.7" {...f}/></>);
    case 'health': return w(<path d="M12 21s-7-4.7-7-11a4 4 0 017-2.6A4 4 0 0119 10c0 6.3-7 11-7 11z" {...p}/>);
    case 'film': return w(<><rect x="3" y="5" width="18" height="14" rx="2.5" {...p}/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" {...p}/></>);
    case 'globe': return w(<><circle cx="12" cy="12" r="9" {...p}/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" {...p}/></>);
    case 'flame': return w(<path d="M12 3c1 4 5 5 5 10a5 5 0 11-10 0c0-3 2-4 2-7 1 1 2 2 3 0z" {...p}/>);
    case 'box': return w(<><rect x="3" y="6" width="18" height="14" rx="2" {...p}/><path d="M3 10h18M9 14h6" {...p}/></>);
    case 'receipt': return w(<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" {...p}/><path d="M8 8h8M8 11h8M8 14h5" {...p}/></>);
    case 'split': return w(<path d="M4 5h6l8 14h2M4 19h6l4-7" {...p}/>);
    case 'link': return w(<><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 10-5.66-5.66L11 7" {...p}/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 105.66 5.66L13 17" {...p}/></>);
    case 'cam': return w(<><rect x="3" y="7" width="18" height="13" rx="2.5" {...p}/><path d="M8 7l2-3h4l2 3" {...p}/><circle cx="12" cy="13.5" r="3.5" {...p}/></>);
    case 'eye': return w(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></>);
    case 'logout': return w(<path d="M14 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1h8a1 1 0 001-1v-3M10 12h11m0 0l-3-3m3 3l-3 3" {...p}/>);
    case 'switch': return w(<path d="M4 8h13l-3-3M20 16H7l3 3" {...p}/>);
    case 'tag': return w(<><path d="M3 12V4h8l9 9-8 8z" {...p}/><circle cx="7.5" cy="7.5" r="1" {...f}/></>);
    case 'g': return w(<><circle cx="12" cy="12" r="9" {...p}/><path d="M12 8v8M8 12h8" {...p}/></>);
    case 'apple': return w(<path d="M16 6c0-2 1.5-3 1.5-3s-1.5-.2-2.5 1c-1 1.2-1 2.5-1 2.5M8 8c-2 0-4 2-4 5 0 4 2.8 8 5 8 1 0 1.5-.6 2.5-.6s1.5.6 2.5.6c2.2 0 5-4 5-8 0-3-2-5-4-5-1.5 0-2.3 1-3.5 1S9.5 8 8 8z" {...p}/>);
    case 'sun': return w(<><circle cx="12" cy="12" r="4" {...p}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" {...p}/></>);
    case 'moon': return w(<path d="M20 14a8 8 0 11-9.5-10A6.5 6.5 0 0020 14z" {...p}/>);
    case 'arrow-up-right': return w(<path d="M7 17L17 7M9 7h8v8" {...p}/>);
    case 'arrow-dn-right': return w(<path d="M7 7l10 10M17 9v8H9" {...p}/>);
    case 'trending-up': return w(<path d="M3 17l6-6 4 4 8-8M14 7h7v7" {...p}/>);
    case 'wave': return w(<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" {...p}/>);
    default: return w(<rect x="4" y="4" width="16" height="16" rx="3" {...p}/>);
  }
}

function Divider({ inset = 0, style = {} }) {
  return <div className="m-divider" style={{ marginLeft: inset, ...style }} />;
}

// Status bar (iOS-ish minimal, our own styling)
function StatusBar({ dark = false, time = '9:41' }) {
  const c = dark ? '#fff' : M.ink;
  return (
    <div style={{
      height: 44, padding: '14px 24px 0', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: c, fontFamily: M.fontUI }}>{time}</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="2.5" height="4" rx="0.6" fill={c}/><rect x="4" y="5" width="2.5" height="6" rx="0.6" fill={c}/><rect x="8" y="3" width="2.5" height="8" rx="0.6" fill={c}/><rect x="12" y="0.5" width="2.5" height="10.5" rx="0.6" fill={c}/></svg>
        <svg width="14" height="11" viewBox="0 0 14 11"><path d="M7 1.5C9.4 1.5 11.7 2.5 13.3 4l-1 1A7 7 0 007 3a7 7 0 00-5.3 2L0.7 4C2.3 2.5 4.6 1.5 7 1.5zM7 5a4.7 4.7 0 013.5 1.5l-1 1A3.3 3.3 0 007 6.5a3.3 3.3 0 00-2.5 1l-1-1A4.7 4.7 0 017 5zM7 8.5A1.5 1.5 0 118.5 10a1.5 1.5 0 01-1.5-1.5z" fill={c}/></svg>
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke={c} strokeOpacity="0.4"/><rect x="2" y="2" width="18" height="8" rx="1.5" fill={c}/><path d="M23 4.5v3c.6-.2 1-.8 1-1.5s-.4-1.3-1-1.5z" fill={c} opacity="0.4"/></svg>
      </div>
    </div>
  );
}

// Home indicator
function HomeIndicator({ dark = false }) {
  return (
    <div style={{ height: 34, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8, flexShrink: 0 }}>
      <div style={{ width: 134, height: 5, borderRadius: 3, background: dark ? '#fff' : M.ink, opacity: 0.85 }}/>
    </div>
  );
}

// App bar
function AppBar({ title, sub, leading, trailing, large }) {
  if (large) {
    return (
      <div style={{ padding: '4px 20px 8px', flexShrink: 0 }}>
        <div className="m-row" style={{ justifyContent: 'space-between', minHeight: 36 }}>
          <div className="m-row" style={{ gap: 4 }}>{leading}</div>
          <div className="m-row" style={{ gap: 4 }}>{trailing}</div>
        </div>
        <div style={{ marginTop: 6 }}>
          <div className="m-h1">{title}</div>
          {sub && <div className="m-label" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="m-appbar">
      <div className="m-row" style={{ width: 56, justifyContent: 'flex-start', gap: 4 }}>{leading}</div>
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div className="m-h3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {sub && <div className="m-label" style={{ marginTop: 1 }}>{sub}</div>}
      </div>
      <div className="m-row" style={{ width: 56, justifyContent: 'flex-end', gap: 4 }}>{trailing}</div>
    </div>
  );
}

// Logo wordmark
function Logo({ size = 32, color = M.ink }) {
  return (
    <div className="m-logo" style={{ fontSize: size, color, lineHeight: 1, display: 'inline-flex', alignItems: 'baseline' }}>
      munni<span className="dot" style={{ color: M.sage }}>.</span>
    </div>
  );
}

Object.assign(window, { M, I, Divider, StatusBar, HomeIndicator, AppBar, Logo });
