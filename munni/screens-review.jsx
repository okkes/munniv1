// Category review — swipe one-at-a-time interaction
// Skip = back of queue, Confirm = accept AI guess, Fix = pick category

function ScreenReviewSwipe() {
  const nav = useNav();
  const queue = TRANSACTIONS.filter(t => t.needsReview);
  const [idx, setIdx] = React.useState(0);
  const [picking, setPicking] = React.useState(false);
  const [drag, setDrag] = React.useState(0);
  const [done, setDone] = React.useState(false);

  if (queue.length === 0 || done || idx >= queue.length) {
    return (
      <div className="m-screen" style={{ background: M.paper }}>
        <StatusBar/>
        <AppBar title="Review"
          leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 12 }}>
          <div style={{ width: 80, height: 80, borderRadius: 24, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I name="check" size={36} color={M.sage} stroke={2.5}/>
          </div>
          <div className="m-h2" style={{ marginTop: 8 }}>All caught up</div>
          <div style={{ fontSize: 14, color: M.ink3, lineHeight: 1.5, maxWidth: 260 }}>
            Nice work. We'll let you know when new transactions need a quick review.
          </div>
          <button className="m-btn m-tap" style={{ marginTop: 16 }} onClick={() => nav.pop()}>Done</button>
        </div>
      </div>
    );
  }

  const tx = queue[idx];
  const cat = CATEGORIES[tx.cat] || {};

  const handleConfirm = () => {
    setDrag(160);
    setTimeout(() => {
      if (idx + 1 >= queue.length) setDone(true);
      else setIdx(idx + 1);
      setDrag(0);
    }, 200);
  };
  const handleSkip = () => {
    setDrag(-160);
    setTimeout(() => {
      if (idx + 1 >= queue.length) setDone(true);
      else setIdx(idx + 1);
      setDrag(0);
    }, 200);
  };

  return (
    <div className="m-screen" style={{ background: M.paper2 }}>
      <StatusBar/>
      <AppBar title={`Review · ${idx + 1}/${queue.length}`}
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="x" size={20}/></button>}
        trailing={<button className="m-tap" style={{ background: 'transparent', border: 'none', fontSize: 13, fontWeight: 500, color: M.ink3 }} onClick={handleSkip}>Skip</button>}
      />

      {/* Progress dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '0 20px 16px', flexShrink: 0 }}>
        {queue.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 999,
            background: i < idx ? M.sage : i === idx ? M.ink : M.line2,
          }}/>
        ))}
      </div>

      {/* Card */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px', position: 'relative' }}>
        <div className="m-card" style={{
          width: '100%', padding: 24, border: `1px solid ${M.line}`,
          background: '#fff',
          transform: `translateX(${drag}px) rotate(${drag * 0.04}deg)`,
          opacity: 1 - Math.abs(drag) / 400,
          transition: drag === 0 ? 'transform 0.3s, opacity 0.3s' : 'transform 0.2s, opacity 0.2s',
          boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div className="m-num" style={{ fontSize: 36, fontWeight: 600, fontFamily: M.fontDisp, color: tx.amount > 0 ? M.sage : M.ink, letterSpacing: '-0.02em' }}>
              {tx.amount > 0 ? '+' : '−'}{fmtEur(Math.abs(tx.amount))}
            </div>
            <div className="m-h3" style={{ marginTop: 12, fontSize: 18 }}>{tx.merchant}</div>
            <div style={{ fontSize: 12, color: M.ink3, marginTop: 4 }}>{fmtDate(tx.date, 'long')} · {tx.time}</div>
            <div style={{ fontSize: 11, color: M.ink4, fontFamily: M.fontMono, marginTop: 8 }}>{tx.desc}</div>
          </div>

          {/* AI guess */}
          <div style={{ marginTop: 28, padding: '14px 16px', borderRadius: 14, background: M.paper2, border: `1px solid ${M.line2}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: 999, background: M.violet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 4, height: 4, borderRadius: 999, background: '#fff' }}/>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: M.violet }}>AI guess · {tx.confidence}%</div>
            </div>
            <div className="m-tap" onClick={() => setPicking(true)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
              background: '#fff', border: `1px solid ${M.line}`,
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: M.paper2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <I name={cat.icon} size={18} color={M.ink2}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{cat.name}</div>
                <div style={{ fontSize: 11, color: M.ink3, marginTop: 1 }}>{cat.group}</div>
              </div>
              <span style={{ fontSize: 11, color: M.sage, fontWeight: 600 }}>Change</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, padding: '12px 20px 20px', flexShrink: 0 }}>
        <button className="m-tap" onClick={handleSkip} style={{
          flex: 1, height: 56, borderRadius: 16, border: `1px solid ${M.line}`,
          background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 14, fontWeight: 600, color: M.ink3,
        }}>
          <I name="x" size={18} color={M.ink3}/> Skip
        </button>
        <button className="m-tap" onClick={handleConfirm} style={{
          flex: 2, height: 56, borderRadius: 16, border: 'none',
          background: M.sage, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 14, fontWeight: 600,
        }}>
          <I name="check" size={20} color="#fff" stroke={2.5}/> Confirm
        </button>
      </div>

      {/* Picker sheet */}
      {picking && <CategoryPicker selected={tx.cat} onClose={() => setPicking(false)} onPick={() => setPicking(false)}/>}
    </div>
  );
}

function CategoryPicker({ selected, onClose, onPick }) {
  // Group cats by group
  const groups = {};
  Object.values(CATEGORIES).forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, animation: 'mFadeIn 0.2s ease-out both' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose}/>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, top: 80,
        background: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${M.line2}` }}>
          <button className="m-tap" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 14, color: M.ink3 }}>Cancel</button>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Pick category</div>
          <div style={{ width: 50 }}/>
        </div>
        <div style={{ padding: 12, flexShrink: 0 }}>
          <div className="m-input" style={{ background: M.paper2, border: 'none' }}>
            <I name="search" size={16} color={M.ink3}/>
            <span style={{ color: M.ink4 }}>Search categories…</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
          {Object.entries(groups).map(([groupName, cats]) => (
            <div key={groupName} style={{ marginBottom: 18 }}>
              <div className="m-cap" style={{ marginBottom: 8 }}>{groupName}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {cats.map(c => (
                  <button key={c.id} onClick={onPick} className="m-tap" style={{
                    padding: '12px 14px', borderRadius: 12, border: `1px solid ${selected === c.id ? M.sage : M.line}`,
                    background: selected === c.id ? M.sageSoft : '#fff',
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  }}>
                    <I name={c.icon} size={16} color={selected === c.id ? M.sage : M.ink2}/>
                    <span style={{ fontSize: 13, fontWeight: 500, color: M.ink, flex: 1 }}>{c.name}</span>
                    {selected === c.id && <I name="check" size={14} color={M.sage} stroke={2.5}/>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Link reimbursement — picker
function ScreenLinkReimburse({ params }) {
  const nav = useNav();
  const candidates = TRANSACTIONS.filter(t => t.amount > 0).slice(0, 5);
  return (
    <div className="m-screen">
      <StatusBar/>
      <AppBar title="Link reimbursement"
        leading={<button className="m-iconbtn m-tap" onClick={() => nav.pop()}><I name="arrowL" size={20}/></button>}
      />
      <div className="m-body-scroll">
        <div style={{ padding: 14, borderRadius: 12, background: M.sageSoft, marginBottom: 16, fontSize: 13, color: M.sage, fontWeight: 500 }}>
          Suggested matches based on incoming tx in the same week.
        </div>
        <div className="m-card" style={{ padding: '0 16px', marginBottom: 14, border: `1px solid ${M.line}` }}>
          {candidates.map((t, i, a) => (
            <React.Fragment key={t.id}>
              <div className="m-tap" onClick={() => nav.pop()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: M.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <I name="arrow-dn-right" size={16} color={M.sage}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{t.merchant}</div>
                  <div style={{ fontSize: 11, color: M.ink3, marginTop: 2 }}>{fmtDate(t.date)}</div>
                </div>
                <div className="m-num" style={{ fontSize: 14, fontWeight: 600, color: M.sage }}>+{fmtEur(t.amount)}</div>
              </div>
              {i < a.length - 1 && <Divider inset={48}/>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenReviewSwipe, ScreenLinkReimburse, CategoryPicker });
