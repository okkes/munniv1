// Charts — geometric SVG, no library

// Sparkline
function Sparkline({ data, width = 60, height = 20, color = M.ink, fill, strokeWidth = 1.5 }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, height - ((v - min) / range) * height]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillD = fill ? `${d} L${width},${height} L0,${height} Z` : null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={fillD} fill={fill} stroke="none"/>}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Bar chart
function BarChart({ data, labels, width = 280, height = 96, highlightLast = true, color = M.ink, accent = M.sage }) {
  const max = Math.max(...data, 1);
  const padding = 6;
  const barAreaH = height - 18;
  const barW = (width - padding * (data.length - 1)) / data.length;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {data.map((v, i) => {
        const h = (v / max) * (barAreaH - 4);
        const x = i * (barW + padding);
        const y = barAreaH - h;
        const isLast = i === data.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={3}
              fill={highlightLast && isLast ? accent : color}
              opacity={highlightLast && !isLast ? 0.18 : 0.92}/>
            {labels && <text x={x + barW / 2} y={height - 2} fontSize="9" fill={M.ink4} textAnchor="middle" fontFamily={M.fontUI} fontWeight="500">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Donut — segments, with center content
function Donut({ data, size = 130, thickness = 18, center }) {
  // data: [{value, color}]
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={M.line2} strokeWidth={thickness}/>
        {data.map((d, i) => {
          const dash = (d.value / total) * (2 * Math.PI * r);
          const offset = (acc / total) * (2 * Math.PI * r);
          acc += d.value;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${2 * Math.PI * r}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"/>
          );
        })}
      </svg>
      {center && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          {center}
        </div>
      )}
    </div>
  );
}

// Stacked horizontal bar (period composition)
function StackedBar({ segments, height = 8, radius = 999 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{
      display: 'flex', height, borderRadius: radius,
      overflow: 'hidden', background: M.line2,
    }}>
      {segments.map((s, i) => (
        <div key={i} style={{
          width: `${(s.value / total) * 100}%`,
          background: s.color,
          borderRight: i < segments.length - 1 ? `1.5px solid ${M.paper}` : 'none',
        }}/>
      ))}
    </div>
  );
}

// Area / line chart with grid
function LineChart({ data, width = 320, height = 120, color = M.sage, fill = 'rgba(74,106,79,0.10)', dots = false }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = (max - min) || 1;
  const padding = 4;
  const stepX = (width - padding * 2) / (data.length - 1);
  const pts = data.map((v, i) => [padding + i * stepX, padding + (height - padding * 2) * (1 - (v - min) / range)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillD = `${d} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={fillD} fill={fill} stroke="none"/>
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
      {dots && pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3 : 0} fill={color}/>
      ))}
    </svg>
  );
}

// Tx row — used everywhere
function TxRow({ tx, onClick, showCat = true, showDate = false, dense = false }) {
  const cat = CATEGORIES[tx.cat] || {};
  const positive = tx.amount > 0;
  return (
    <div onClick={onClick} className={onClick ? 'm-tap' : ''} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: dense ? '10px 0' : '12px 0',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, background: M.paper2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <I name={cat.icon || 'box'} size={18} color={M.ink2} stroke={1.6}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: M.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.merchant}</div>
          <div className="m-num" style={{ fontSize: 15, fontWeight: 600, color: positive ? M.sage : M.ink, flexShrink: 0 }}>
            {positive ? '+' : ''}{fmtEur(tx.amount)}
          </div>
        </div>
        {showCat && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <div style={{ fontSize: 12, color: M.ink3 }}>
              {showDate ? fmtDate(tx.date) : cat.name}
              {tx.recurring && <span style={{ color: M.ink4, marginLeft: 6 }}>· recurring</span>}
              {tx.linkedTo && <span style={{ color: M.sage, marginLeft: 6 }}>· reimburse</span>}
            </div>
            {tx.needsReview && <span className="m-pill" style={{ background: M.ochreSoft, color: M.ochre }}>Review</span>}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Sparkline, BarChart, Donut, StackedBar, LineChart, TxRow });
