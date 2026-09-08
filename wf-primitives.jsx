// Wireframe primitives — clean low-fi system
// Greyscale boxes, geometric, system font + Caveat for handwritten annotations.
// Semantic accents: green = income, red = expense, amber = savings/budget-warn, blue = action.

const WF = {
  ink: '#1a1a1a',
  ink2: '#3a3a3a',
  ink3: '#6b6b6b',
  ink4: '#9a9a9a',
  line: '#d4d4d4',
  line2: '#e6e6e6',
  paper: '#fafafa',
  paperAlt: '#f1f1f1',
  fill: '#e8e8e8',
  fillSoft: '#f1f1f1',
  // semantic
  green: '#3a8f4f',
  greenSoft: '#dff0e2',
  red: '#c14b3a',
  redSoft: '#f4dedb',
  amber: '#b8862b',
  amberSoft: '#f3e7cb',
  blue: '#3661b8',
  blueSoft: '#dfe7f5',
  // hand
  hand: '#c14b3a',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontHand: '"Caveat", "Bradley Hand", cursive',
};

// Inject one shared stylesheet
if (typeof document !== 'undefined' && !document.getElementById('wf-styles')) {
  const s = document.createElement('style');
  s.id = 'wf-styles';
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap');
    .wf, .wf * { box-sizing: border-box; }
    .wf-skel { background: ${WF.fill}; border-radius: 3px; }
    .wf-skel.lg { height: 12px; }
    .wf-skel.md { height: 9px; }
    .wf-skel.sm { height: 7px; }
    .wf-divider { height: 1px; background: ${WF.line2}; }
    .wf-card { background: #fff; border: 1px solid ${WF.line}; border-radius: 12px; }
    .wf-row { display: flex; align-items: center; }
    .wf-col { display: flex; flex-direction: column; }
    .wf-pill { display:inline-flex; align-items:center; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 500; letter-spacing: 0.02em; }
    .wf-chip { display:inline-flex; align-items:center; gap:4px; padding: 5px 10px; border-radius: 999px; font-size: 11px; border: 1px solid ${WF.line}; background: #fff; color: ${WF.ink2}; }
    .wf-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height: 40px; padding: 0 18px; border-radius: 10px; font-size: 14px; font-weight: 500; border: 1px solid ${WF.ink}; background: ${WF.ink}; color:#fff; }
    .wf-btn.ghost { background: transparent; color: ${WF.ink}; }
    .wf-btn.outline { background: #fff; color: ${WF.ink}; }
    .wf-btn.sm { height: 32px; padding: 0 12px; font-size: 12px; border-radius: 8px; }
    .wf-input { height: 44px; border: 1px solid ${WF.line}; border-radius: 10px; padding: 0 14px; font-size: 14px; background: #fff; color: ${WF.ink}; display:flex; align-items:center; }
    .wf-input.empty { color: ${WF.ink4}; }
    .wf-statbox { padding: 12px; border-radius: 12px; border: 1px solid ${WF.line}; background: #fff; }
    .wf-icon { display:inline-flex; align-items:center; justify-content:center; }
    .wf-bg { background: ${WF.paper}; }
    .wf-screen { width: 100%; height: 100%; background: #fff; color: ${WF.ink}; font-family: ${WF.font}; }
    .wf-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${WF.ink3}; }
    .wf-h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .wf-h2 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
    .wf-h3 { font-size: 17px; font-weight: 600; }
    .wf-body { font-size: 14px; color: ${WF.ink2}; }
    .wf-cap { font-size: 12px; color: ${WF.ink3}; }
    .wf-num { font-variant-numeric: tabular-nums; }

    /* Annotation — handwritten note + arrow */
    .wf-annot { font-family: ${WF.fontHand}; color: ${WF.hand}; font-size: 22px; line-height: 1.1; font-weight: 600; }
    .wf-annot-arrow { stroke: ${WF.hand}; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }

    /* Placeholder box with diagonal stripes */
    .wf-ph {
      background-image: repeating-linear-gradient(135deg,
        ${WF.line2} 0 6px, transparent 6px 12px);
      border: 1px dashed ${WF.line};
      display:flex; align-items:center; justify-content:center;
      font-family: ${WF.fontMono}; font-size: 10px; color: ${WF.ink3};
      letter-spacing: 0.04em; text-align:center; padding: 6px;
    }
  `;
  document.head.appendChild(s);
}

// ─── Generic shapes ───────────────────────────────────────────
function Skel({ w = '100%', h = 9, r = 3, bg = WF.fill, style = {} }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: bg, ...style }} />;
}

function Placeholder({ w = '100%', h = 80, label = '', style = {} }) {
  return <div className="wf-ph" style={{ width: w, height: h, borderRadius: 8, ...style }}>{label}</div>;
}

function Divider({ style = {} }) {
  return <div className="wf-divider" style={style} />;
}

// ─── Pictogram icons (geometric, low-fi) ──────────────────────
function Ico({ name, size = 18, color = WF.ink2, stroke = 1.6 }) {
  const p = { stroke: color, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const wrap = (kids) => <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>{kids}</svg>;
  switch (name) {
    case 'home': return wrap(<><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" {...p}/></>);
    case 'list': return wrap(<><path d="M4 7h16M4 12h16M4 17h16" {...p}/></>);
    case 'wallet': return wrap(<><rect x="3" y="6" width="18" height="13" rx="2" {...p}/><path d="M16 12h3" {...p}/></>);
    case 'user': return wrap(<><circle cx="12" cy="8" r="4" {...p}/><path d="M4 21c1-4 5-6 8-6s7 2 8 6" {...p}/></>);
    case 'menu': return wrap(<><path d="M4 7h16M4 12h16M4 17h10" {...p}/></>);
    case 'sync': return wrap(<><path d="M4 12a8 8 0 0114-5l2-2v6h-6l2-2a5 5 0 00-9 3M20 12a8 8 0 01-14 5l-2 2v-6h6l-2 2a5 5 0 009-3" {...p}/></>);
    case 'check': return wrap(<><path d="M5 12l4 4 10-10" {...p}/></>);
    case 'x': return wrap(<><path d="M6 6l12 12M18 6L6 18" {...p}/></>);
    case 'arrowR': return wrap(<><path d="M9 5l7 7-7 7" {...p}/></>);
    case 'arrowL': return wrap(<><path d="M15 5l-7 7 7 7" {...p}/></>);
    case 'arrowDn': return wrap(<><path d="M5 9l7 7 7-7" {...p}/></>);
    case 'plus': return wrap(<><path d="M12 5v14M5 12h14" {...p}/></>);
    case 'edit': return wrap(<><path d="M4 20h4l10-10-4-4L4 16v4z" {...p}/></>);
    case 'search': return wrap(<><circle cx="11" cy="11" r="6" {...p}/><path d="M20 20l-4-4" {...p}/></>);
    case 'filter': return wrap(<><path d="M4 6h16l-6 8v6l-4-2v-4z" {...p}/></>);
    case 'cal': return wrap(<><rect x="3" y="5" width="18" height="16" rx="2" {...p}/><path d="M3 9h18M8 3v4M16 3v4" {...p}/></>);
    case 'tag': return wrap(<><path d="M3 12V4h8l9 9-8 8z" {...p}/><circle cx="7.5" cy="7.5" r="1" fill={color}/></>);
    case 'arrow-up-right': return wrap(<><path d="M7 17L17 7M9 7h8v8" {...p}/></>);
    case 'arrow-dn-right': return wrap(<><path d="M7 7l10 10M17 9v8H9" {...p}/></>);
    case 'piggy': return wrap(<><path d="M5 13a6 6 0 0112 0v3a2 2 0 01-2 2h-1v2h-2v-2H8v2H6v-2a2 2 0 01-1-2v-3z" {...p}/><circle cx="14" cy="12" r="0.7" fill={color}/></>);
    case 'wrap': return wrap(<><rect x="3" y="6" width="18" height="12" rx="2" {...p}/><path d="M3 10h18" {...p}/></>);
    case 'link': return wrap(<><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 10-5.66-5.66L11 7" {...p}/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 105.66 5.66L13 17" {...p}/></>);
    case 'goal': return wrap(<><circle cx="12" cy="12" r="9" {...p}/><circle cx="12" cy="12" r="5" {...p}/><circle cx="12" cy="12" r="1.5" fill={color}/></>);
    case 'bell': return wrap(<><path d="M6 16V11a6 6 0 1112 0v5l2 2H4z" {...p}/><path d="M10 20a2 2 0 004 0" {...p}/></>);
    case 'lock': return wrap(<><rect x="5" y="11" width="14" height="9" rx="2" {...p}/><path d="M8 11V8a4 4 0 018 0v3" {...p}/></>);
    case 'help': return wrap(<><circle cx="12" cy="12" r="9" {...p}/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17v.5" {...p}/></>);
    case 'logout': return wrap(<><path d="M14 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1h8a1 1 0 001-1v-3M10 12h11m0 0l-3-3m3 3l-3 3" {...p}/></>);
    case 'globe': return wrap(<><circle cx="12" cy="12" r="9" {...p}/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" {...p}/></>);
    case 'card': return wrap(<><rect x="3" y="6" width="18" height="13" rx="2" {...p}/><path d="M3 11h18" {...p}/></>);
    case 'shop': return wrap(<><path d="M5 8h14l-1 12H6z" {...p}/><path d="M9 8a3 3 0 016 0" {...p}/></>);
    case 'fork': return wrap(<><path d="M6 3v8a2 2 0 002 2v8M6 7h4M10 3v8a2 2 0 01-2 2M16 3c-1 3-1 5 0 7v11" {...p}/></>);
    case 'house': return wrap(<><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" {...p}/></>);
    case 'bag': return wrap(<><path d="M5 8h14l-1 12H6z" {...p}/><path d="M9 8V6a3 3 0 016 0v2" {...p}/></>);
    case 'car': return wrap(<><path d="M5 16v-4l2-5h10l2 5v4M5 16h14M5 16v2h2v-2M17 16v2h2v-2" {...p}/><circle cx="8" cy="13.5" r="0.7" fill={color}/><circle cx="16" cy="13.5" r="0.7" fill={color}/></>);
    case 'health': return wrap(<><path d="M12 21s-7-5-7-11a4 4 0 017-2.6A4 4 0 0119 10c0 6-7 11-7 11z" {...p}/></>);
    case 'film': return wrap(<><rect x="3" y="5" width="18" height="14" rx="2" {...p}/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" {...p}/></>);
    case 'g': return wrap(<><circle cx="12" cy="12" r="9" {...p}/><path d="M12 8v8M8 12h8" {...p}/></>);
    case 'ms': return wrap(<><rect x="4" y="4" width="7" height="7" {...p}/><rect x="13" y="4" width="7" height="7" {...p}/><rect x="4" y="13" width="7" height="7" {...p}/><rect x="13" y="13" width="7" height="7" {...p}/></>);
    case 'eye': return wrap(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></>);
    case 'pause': return wrap(<><rect x="6" y="5" width="4" height="14" rx="1" {...p}/><rect x="14" y="5" width="4" height="14" rx="1" {...p}/></>);
    case 'play': return wrap(<><path d="M7 5v14l12-7z" {...p}/></>);
    case 'switch': return wrap(<><path d="M4 8h13l-3-3M20 16H7l3 3" {...p}/></>);
    case 'target': return wrap(<><circle cx="12" cy="12" r="9" {...p}/><circle cx="12" cy="12" r="5" {...p}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" {...p}/></>);
    case 'box': return wrap(<><rect x="3" y="6" width="18" height="14" rx="2" {...p}/><path d="M3 10h18M9 14h6" {...p}/></>);
    case 'receipt': return wrap(<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" {...p}/><path d="M8 8h8M8 11h8M8 14h5" {...p}/></>);
    case 'split': return wrap(<><path d="M4 5h6l8 14h2M4 19h6l4-7" {...p}/></>);
    case 'star': return wrap(<><path d="M12 4l2.5 5.5L20 10l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" {...p}/></>);
    case 'rocket': return wrap(<><path d="M12 3c4 2 6 6 6 10l-3 3-3-1-1-3-3-1 3-3c4 0 8 2 10 6" {...p}/><circle cx="14" cy="10" r="1.4" fill={color}/></>);
    case 'minus': return wrap(<><path d="M5 12h14" {...p}/></>);
    case 'flame': return wrap(<><path d="M12 3c1 4 5 5 5 10a5 5 0 11-10 0c0-3 2-4 2-7 1 1 2 2 3 0z" {...p}/></>);
    case 'cam': return wrap(<><rect x="3" y="7" width="18" height="13" rx="2" {...p}/><path d="M8 7l2-3h4l2 3" {...p}/><circle cx="12" cy="13" r="3.5" {...p}/></>);
    case 'more': return wrap(<><circle cx="6" cy="12" r="1.4" fill={color}/><circle cx="12" cy="12" r="1.4" fill={color}/><circle cx="18" cy="12" r="1.4" fill={color}/></>);
    default: return wrap(<><rect x="4" y="4" width="16" height="16" rx="2" {...p}/></>);
  }
}

// ─── Annotation ───────────────────────────────────────────────
// {x, y, w, h} relative to a positioned parent. arrow points from text
// to (tx,ty). text can wrap with \n.
function Annot({ x, y, w = 160, text, tx, ty, dir = 'down', style = {} }) {
  const lines = String(text).split('\n');
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, pointerEvents: 'none', ...style }}>
      <div className="wf-annot">
        {lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {tx !== undefined && ty !== undefined && (
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width="1" height="1">
          <Arrow fromX={dir === 'left' ? 0 : (dir === 'right' ? w : w * 0.4)}
                 fromY={dir === 'up' ? 0 : (lines.length * 24 + 6)}
                 toX={tx} toY={ty} />
        </svg>
      )}
    </div>
  );
}

function Arrow({ fromX, fromY, toX, toY, curve = 0.4 }) {
  // quadratic curve with arrowhead
  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const cx = mx - dy * curve;
  const cy = my + dx * curve;
  const ang = Math.atan2(toY - cy, toX - cx);
  const ah = 9;
  const ax1 = toX - Math.cos(ang - 0.45) * ah;
  const ay1 = toY - Math.sin(ang - 0.45) * ah;
  const ax2 = toX - Math.cos(ang + 0.45) * ah;
  const ay2 = toY - Math.sin(ang + 0.45) * ah;
  return (
    <g>
      <path className="wf-annot-arrow" d={`M ${fromX} ${fromY} Q ${cx} ${cy} ${toX} ${toY}`} />
      <path className="wf-annot-arrow" d={`M ${ax1} ${ay1} L ${toX} ${toY} L ${ax2} ${ay2}`} />
    </g>
  );
}

// ─── Status bar (low-fi) ──────────────────────────────────────
function WFStatusBar() {
  return (
    <div style={{
      height: 47, paddingTop: 14, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '14px 28px 0', flexShrink: 0,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>9:41</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="18" height="11" viewBox="0 0 18 11"><path d="M0 8h2v3H0zM5 6h2v5H5zM10 4h2v7h-2zM15 1h2v10h-2z" fill={WF.ink}/></svg>
        <svg width="14" height="10" viewBox="0 0 14 10"><path d="M7 0a7 7 0 017 7L7 7z" fill="none" stroke={WF.ink} strokeWidth="1"/><path d="M7 3a4 4 0 014 4l-4 0z" fill={WF.ink}/></svg>
        <svg width="22" height="11" viewBox="0 0 22 11"><rect x="0.5" y="0.5" width="18" height="10" rx="2.5" fill="none" stroke={WF.ink}/><rect x="2" y="2" width="14" height="7" rx="1" fill={WF.ink}/></svg>
      </div>
    </div>
  );
}

// ─── Bottom tab bar (4 tabs: Home, Transactions, Budgets, Profile) ────
function WFTabBar({ active = 'home' }) {
  const tabs = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'tx', icon: 'list', label: 'Transactions' },
    { id: 'events', icon: 'star', label: 'Events' },
    { id: 'profile', icon: 'user', label: 'Profile' },
  ];
  return (
    <div style={{
      height: 78, borderTop: `1px solid ${WF.line}`, background: '#fff',
      display: 'flex', paddingBottom: 18, flexShrink: 0,
    }}>
      {tabs.map(t => (
        <div key={t.id} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 3, color: t.id === active ? WF.ink : WF.ink4,
        }}>
          <Ico name={t.icon} size={22} color={t.id === active ? WF.ink : WF.ink4} stroke={t.id === active ? 2 : 1.6}/>
          <div style={{ fontSize: 10, fontWeight: t.id === active ? 600 : 500 }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── App bar ──────────────────────────────────────────────────
function WFAppBar({ title, leading, trailing, sub }) {
  return (
    <div style={{
      padding: '12px 20px 14px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 12, flexShrink: 0,
    }}>
      <div style={{ width: 28, display:'flex', justifyContent:'flex-start' }}>{leading}</div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="wf-h3">{title}</div>
        {sub && <div className="wf-cap" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ width: 28, display:'flex', justifyContent:'flex-end' }}>{trailing}</div>
    </div>
  );
}

// ─── Wrap the screen scroll area with consistent padding ──────
function WFBody({ children, style = {} }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 24px', ...style }}>{children}</div>
  );
}

Object.assign(window, {
  WF, Skel, Placeholder, Divider, Ico, Annot, Arrow,
  WFStatusBar, WFTabBar, WFAppBar, WFBody,
});
