import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import Auth from './Auth.jsx'
import {
  fetchContainers, upsertContainer, deleteContainer,
  fetchSettings, saveSettings, uploadPhoto, deletePhoto,
} from './data'
import {
  STATUSES, uid, num, money, containerValue, containerProfit,
  statusClass, shrinkImage, exportCSV,
} from './utils'
import { qrDataUrl, printLabel, printAll } from './print'
import { Html5Qrcode } from 'html5-qrcode'

const MAX_PHOTOS = 2

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!authReady) return <div className="app"><div className="full-center"><div className="spinner" /></div></div>
  if (!session) return <Auth />
  return <Main user={session.user} />
}

function Main({ user }) {
  const [items, setItems] = useState([])
  const [resellerMode, setResellerMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')      // list | form | detail | scan | settings
  const [editing, setEditing] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [toast, setToast] = useState('')

  function flash(t) { setToast(t); setTimeout(() => setToast(''), 1800) }

  useEffect(() => {
    (async () => {
      try {
        const [list, s] = await Promise.all([fetchContainers(user.id), fetchSettings(user.id)])
        setItems(list); setResellerMode(s.resellerMode)
      } catch (e) { flash('Could not load data') }
      finally { setLoading(false) }
    })()
  }, [user.id])

  function openDetail(id) { setEditing(items.find((i) => i.id === id)); setView('detail') }
  function goList() { setView('list'); setEditing(null) }
  function newItem() {
    setEditing({ id: uid(), name: '', location: '', category: '', description: '', contents: [], photos: [], created: Date.now() })
    setView('form')
  }

  async function toggleReseller() {
    const next = !resellerMode
    setResellerMode(next)
    try { await saveSettings(user.id, next) } catch (e) { flash('Could not save setting') }
  }

  async function saveItem(item) {
    try {
      await upsertContainer(user.id, item)
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx >= 0) { const c = [...prev]; c[idx] = item; return c }
        return [item, ...prev]
      })
      setEditing(item); setView('detail'); flash('Saved')
    } catch (e) { flash('Save failed') }
  }

  async function removeItem(item) {
    if (!confirm('Delete this container?')) return
    try {
      for (const p of item.photos || []) await deletePhoto(p)
      await deleteContainer(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      goList(); flash('Deleted')
    } catch (e) { flash('Delete failed') }
  }

  if (loading) return <div className="app"><div className="full-center"><div className="spinner" /><p className="muted">Loading your inventory…</p></div></div>

  const common = { items, resellerMode, user, flash }
  return (
    <div className="app">
      {view === 'list' && <ListView {...common} {...{ query, setQuery, sortBy, setSortBy, openDetail, newItem, setView, signOut: () => supabase.auth.signOut() }} />}
      {view === 'form' && <FormView {...common} editing={editing} setEditing={setEditing} onSave={saveItem} onBack={() => (items.find((i) => i.id === editing.id) ? setView('detail') : goList())} />}
      {view === 'detail' && <DetailView {...common} item={editing} onEdit={() => setView('form')} onDelete={() => removeItem(editing)} onBack={goList} />}
      {view === 'scan' && <ScanView items={items} onFound={openDetail} onBack={goList} flash={flash} />}
      {view === 'settings' && <SettingsView resellerMode={resellerMode} toggleReseller={toggleReseller} onBack={goList} signOut={() => supabase.auth.signOut()} email={user.email} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ---------------- List ---------------- */
function ListView({ items, resellerMode, query, setQuery, sortBy, setSortBy, openDetail, newItem, setView }) {
  const q = query.trim().toLowerCase()
  let results = items.map((it) => ({ it, hit: null }))
  if (q) {
    results = []
    for (const it of items) {
      const fields = [it.name, it.category, it.location, it.description].map((x) => (x || '').toLowerCase())
      const hits = (it.contents || []).filter((c) => (c.name || '').toLowerCase().includes(q)).map((c) => c.name)
      if (fields.some((f) => f.includes(q)) || hits.length) results.push({ it, hit: hits.length ? hits : null })
    }
  }
  results.sort((a, b) => {
    if (sortBy === 'recent') return (b.it.created || 0) - (a.it.created || 0)
    if (sortBy === 'name') return (a.it.name || '').localeCompare(b.it.name || '')
    if (sortBy === 'location') return (a.it.location || '').localeCompare(b.it.location || '')
    if (sortBy === 'value') return containerValue(b.it) - containerValue(a.it)
    return 0
  })
  const total = resellerMode
    ? items.reduce((s, it) => s + containerProfit(it), 0)
    : items.reduce((s, it) => s + containerValue(it), 0)

  return (
    <>
      <div className="topbar">
        <h1>My containers</h1>
        <button className="iconbtn" aria-label="Settings" onClick={() => setView('settings')}>⚙</button>
      </div>

      {items.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="stat"><p className="label">Containers</p><p className="value">{items.length}</p></div>
          <div className="stat"><p className="label">{resellerMode ? 'Profit' : 'Total value'}</p><p className="value">{money(total) || '$0.00'}</p></div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={newItem}>＋ New</button>
        <button className="btn" onClick={() => setView('scan')}>▢ Scan</button>
      </div>

      {items.length > 0 && (
        <>
          <div className="search" style={{ marginBottom: 10 }}>
            <span className="ico">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an item, location, or box…" />
          </div>
          <div className="row" style={{ marginBottom: 16, alignItems: 'center' }}>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="recent">Most recent</option>
              <option value="name">Name A–Z</option>
              <option value="location">Location</option>
              <option value="value">Highest value</option>
            </select>
            <button className="iconbtn" title="Print all labels" onClick={() => printAll(items)}>🖨</button>
            <button className="iconbtn" title="Export CSV" onClick={() => exportCSV(items, resellerMode)}>⤓</button>
          </div>
        </>
      )}

      {!items.length && <div className="full-center muted center"><div style={{ fontSize: 40 }}>📦</div><p>No containers yet.<br />Create your first one above.</p></div>}
      {items.length > 0 && !results.length && <p className="center muted" style={{ padding: '2rem 0' }}>No matches for “{query}”.</p>}

      {results.map(({ it, hit }) => {
        const cv = containerValue(it)
        return (
          <div key={it.id} className="listcard" onClick={() => openDetail(it.id)}>
            {it.photos && it.photos[0]
              ? <img className="thumb" src={it.photos[0]} alt="" />
              : <div className="thumb placeholder">📦</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="ellip" style={{ fontWeight: 500, margin: 0 }}>{it.name || 'Untitled'}</p>
              <p className="ellip muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                {it.location ? `📍 ${it.location}` : 'No location'} · {it.contents ? it.contents.length : 0} items{cv ? ` · ${money(cv)}` : ''}
              </p>
              {hit && <p className="ellip" style={{ fontSize: 12, color: 'var(--brand)', margin: '3px 0 0' }}>↳ {hit.join(', ')}</p>}
            </div>
            <span className="muted">›</span>
          </div>
        )
      })}
    </>
  )
}

/* ---------------- Form ---------------- */
function FormView({ editing, setEditing, onSave, onBack, resellerMode, user, flash }) {
  const [it, setIt] = useState(editing)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const set = (k, v) => setIt((p) => ({ ...p, [k]: v }))
  const setContent = (i, k, v) => setIt((p) => { const c = [...p.contents]; c[i] = { ...c[i], [k]: v }; return { ...p, contents: c } })
  const addContent = () => setIt((p) => ({ ...p, contents: [...(p.contents || []), { name: '', qty: 1, status: 'In stock' }] }))
  const removeContent = (i) => setIt((p) => ({ ...p, contents: p.contents.filter((_, j) => j !== i) }))

  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if ((it.photos || []).length >= MAX_PHOTOS) return
    setUploading(true)
    try {
      const blob = await shrinkImage(file)
      const url = await uploadPhoto(user.id, blob)
      setIt((p) => ({ ...p, photos: [...(p.photos || []), url] }))
    } catch (err) { flash('Photo upload failed') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  async function removePhoto(i) {
    const url = it.photos[i]
    setIt((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }))
    deletePhoto(url)
  }

  function save() {
    const cleaned = { ...it, contents: (it.contents || []).filter((c) => (c.name || '').trim()), name: (it.name || '').trim() || 'Untitled' }
    onSave(cleaned)
  }

  const isNew = !editing.name && !editing.contents.length
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>{isNew ? 'New container' : 'Edit container'}</h1>
      </div>

      <label className="field">Name</label>
      <input value={it.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Garage bin A" style={{ marginBottom: 14 }} />
      <label className="field">Location</label>
      <input value={it.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Garage → Shelf 3" style={{ marginBottom: 14 }} />
      <label className="field">Category</label>
      <input value={it.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Holiday decorations" style={{ marginBottom: 14 }} />
      <label className="field">Description</label>
      <textarea value={it.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional notes" style={{ marginBottom: 14 }} />

      <label className="field">Photos (up to {MAX_PHOTOS})</label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {(it.photos || []).map((p, i) => (
          <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
            <img src={p} alt={`Photo ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border)' }} />
            <button className="iconbtn" aria-label="Remove photo" onClick={() => removePhoto(i)}
              style={{ position: 'absolute', top: -10, right: -10, width: 26, height: 26, borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 14 }}>✕</button>
          </div>
        ))}
        {(it.photos || []).length < MAX_PHOTOS && (
          <button className="iconbtn" aria-label="Add photo" disabled={uploading} onClick={() => fileRef.current && fileRef.current.click()}
            style={{ width: 84, height: 84, flexDirection: 'column', gap: 4, borderStyle: 'dashed' }}>
            {uploading ? <div className="spinner" /> : <><span style={{ fontSize: 22 }}>📷</span><span style={{ fontSize: 11 }}>Add</span></>}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhoto} />
      </div>

      <label className="field">Inventory contents{resellerMode ? ' (with sales tracking)' : ''}</label>
      {(it.contents || []).map((c, i) => (
        <div key={i} className="itemrow">
          <div className="row" style={{ alignItems: 'center', marginBottom: resellerMode || true ? 8 : 0 }}>
            <input value={c.name} onChange={(e) => setContent(i, 'name', e.target.value)} placeholder="Item name" />
            <input type="number" min="1" value={c.qty || 1} onChange={(e) => setContent(i, 'qty', e.target.value)} aria-label="Quantity" style={{ width: 64 }} />
            <button className="iconbtn" aria-label="Remove" onClick={() => removeContent(i)}>🗑</button>
          </div>
          {resellerMode ? (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <input type="number" step="0.01" value={c.cost ?? ''} onChange={(e) => setContent(i, 'cost', e.target.value)} placeholder="Cost $" />
                <input type="number" step="0.01" value={c.sale ?? ''} onChange={(e) => setContent(i, 'sale', e.target.value)} placeholder="Sale $" />
              </div>
              <div className="row" style={{ marginBottom: 8 }}>
                <input value={c.marketplace || ''} onChange={(e) => setContent(i, 'marketplace', e.target.value)} placeholder="Marketplace" />
                <input value={c.sku || ''} onChange={(e) => setContent(i, 'sku', e.target.value)} placeholder="SKU" />
              </div>
              <select value={c.status || 'In stock'} onChange={(e) => setContent(i, 'status', e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          ) : (
            <input type="number" step="0.01" value={c.value ?? ''} onChange={(e) => setContent(i, 'value', e.target.value)} placeholder="Value $ (optional)" />
          )}
        </div>
      ))}
      <button className="btn" onClick={addContent} style={{ marginBottom: 22 }}>＋ Add item</button>
      <button className="btn primary" onClick={save}>Save container</button>
    </>
  )
}

/* ---------------- Detail ---------------- */
function DetailView({ item, resellerMode, onEdit, onDelete, onBack }) {
  const [qr, setQr] = useState('')
  useEffect(() => { qrDataUrl(item.id).then(setQr) }, [item.id])
  const cv = containerValue(item)
  const profit = containerProfit(item)

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Container</h1>
      </div>

      <div className="qrwrap" style={{ marginBottom: 14 }}>
        {qr ? <img src={qr} alt="QR code" /> : <div className="spinner" />}
        <p className="mono" style={{ marginTop: 10 }}>{item.id}</p>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => printLabel(item)}>🖨 Print label</button>
        <button className="btn" onClick={onEdit}>✎ Edit</button>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{item.name}</h2>
      {item.location && <div className="badge brand" style={{ marginBottom: 12 }}>📍 {item.location}</div>}
      <p className="muted" style={{ margin: '0 0 12px' }}>{item.category || 'No category'}</p>

      {item.photos && item.photos.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          {item.photos.map((p, i) => (
            <a key={i} href={p} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0 }}>
              <img src={p} alt="Container" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--border)' }} />
            </a>
          ))}
        </div>
      )}

      {item.description && <p style={{ marginBottom: 16, lineHeight: 1.6 }}>{item.description}</p>}

      {resellerMode ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="stat"><p className="label">Value</p><p className="value" style={{ fontSize: 20 }}>{money(cv) || '$0.00'}</p></div>
          <div className="stat"><p className="label">Profit</p><p className="value" style={{ fontSize: 20, color: profit >= 0 ? 'var(--ok-text)' : 'var(--danger)' }}>{money(profit) || '$0.00'}</p></div>
        </div>
      ) : (cv > 0 && (
        <div className="stat" style={{ marginBottom: 16 }}><p className="label">Total value</p><p className="value" style={{ fontSize: 20 }}>{money(cv)}</p></div>
      ))}

      <p className="muted" style={{ fontWeight: 500, fontSize: 13, margin: '0 0 6px' }}>Contents ({item.contents ? item.contents.length : 0})</p>
      <div style={{ marginBottom: 22 }}>
        {(!item.contents || !item.contents.length) && <p className="muted" style={{ fontSize: 14 }}>No items listed</p>}
        {(item.contents || []).map((c, i) => (
          <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{c.name}{c.qty > 1 ? ` ×${c.qty}` : ''}</span>
              {resellerMode
                ? <span className={`pill ${statusClass(c.status || 'In stock')}`}>{c.status || 'In stock'}</span>
                : (c.value ? <span className="muted" style={{ fontSize: 13 }}>{money(num(c.value) * (num(c.qty) || 1))}</span> : null)}
            </div>
            {resellerMode && (c.cost || c.sale || c.marketplace || c.sku) && (
              <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                {c.cost ? `cost ${money(c.cost)}` : ''}{c.sale ? ` · sale ${money(c.sale)}` : ''}{c.marketplace ? ` · ${c.marketplace}` : ''}{c.sku ? ` · ${c.sku}` : ''}
              </p>
            )}
          </div>
        ))}
      </div>

      <button className="btn danger" onClick={onDelete}>🗑 Delete container</button>
    </>
  )
}

/* ---------------- Scan ---------------- */
function ScanView({ items, onFound, onBack, flash }) {
  const [err, setErr] = useState('')
  const [notFound, setNotFound] = useState('')
  const scannerRef = useRef(null)

  useEffect(() => {
    let scanner
    const id = 'qr-reader'
    const start = async () => {
      try {
        scanner = new Html5Qrcode(id)
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            const found = items.find((i) => i.id === text)
            stop().then(() => { if (found) onFound(found.id); else setNotFound(text) })
          },
          () => {}
        )
      } catch (e) {
        setErr('Could not access the camera. Pick a container from the list instead.')
      }
    }
    const stop = async () => {
      try { if (scanner && scanner.isScanning) await scanner.stop() } catch (e) {}
      try { if (scanner) scanner.clear() } catch (e) {}
    }
    start()
    return () => { stop() }
  }, [items])

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Scan a code</h1>
      </div>
      {!notFound ? (
        <>
          <div id="qr-reader" style={{ width: '100%', borderRadius: 14, overflow: 'hidden', background: '#000' }} />
          <p className="center muted" style={{ fontSize: 13, marginTop: 12 }}>
            {err || 'Point your camera at a container’s QR code.'}
          </p>
        </>
      ) : (
        <div className="full-center center muted">
          <div style={{ fontSize: 36 }}>❔</div>
          <p>Scanned code <span className="mono">{notFound}</span><br />doesn’t match any container.</p>
          <button className="btn" style={{ width: 'auto' }} onClick={() => setNotFound('')}>Scan again</button>
        </div>
      )}
    </>
  )
}

/* ---------------- Settings ---------------- */
function SettingsView({ resellerMode, toggleReseller, onBack, signOut, email }) {
  return (
    <>
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onBack}>‹</button>
        <h1>Settings</h1>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 500, margin: 0 }}>Reseller mode</p>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
              Adds cost, sale price, marketplace, SKU and status to each item, plus a profit summary. Turn off for simple home organizing.
            </p>
          </div>
          <button className={`toggle ${resellerMode ? 'on' : ''}`} aria-label="Toggle reseller mode" onClick={toggleReseller}>
            <span className="knob" />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Signed in as</p>
        <p style={{ margin: '4px 0 0' }}>{email}</p>
      </div>

      <button className="btn" onClick={signOut}>Sign out</button>
      <p className="center muted" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
        Your data is saved to the cloud and syncs across devices when you’re signed in. Use the export button on the main screen for a CSV backup anytime.
      </p>
    </>
  )
}
