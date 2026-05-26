export const STATUSES = ['In stock', 'Listed', 'Sold', 'Shipped']

export function uid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// Short, human-readable code shown on labels so blanks are tellable apart.
// Derived from the id so it's stable; e.g. "B-7QX4".
export function shortCode(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const base = h.toString(36).toUpperCase().padStart(4, '0').slice(-4)
  return 'B-' + base
}

// Expiration status for a yyyy-mm-dd date string.
// Returns null (no date), 'expired', 'soon' (<=14 days), or 'ok'.
export function expStatus(dateStr, soonDays = 14) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d - today) / 86400000)
  if (days < 0) return 'expired'
  if (days <= soonDays) return 'soon'
  return 'ok'
}

export function expLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d)) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d - today) / 86400000)
  const nice = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  if (days < 0) return `Expired ${nice}`
  if (days === 0) return `Expires today`
  if (days <= 14) return `Expires ${nice} (${days}d)`
  return `Expires ${nice}`
}

// Soonest upcoming/overdue expiration across a container (item-level + container-level).
export function soonestExp(it) {
  const dates = []
  if (it.expires) dates.push(it.expires)
  for (const c of it.contents || []) if (c.expires) dates.push(c.expires)
  if (!dates.length) return null
  return dates.sort()[0]
}

// Flatten every dated thing (items + container-level dates) across all containers
// that is expired or expiring within `soonDays`. Sorted soonest-first.
export function collectExpiring(items, soonDays = 30) {
  const out = []
  for (const it of items) {
    if (it.expires) {
      const st = expStatus(it.expires, soonDays)
      if (st === 'expired' || st === 'soon')
        out.push({ kind: 'container', containerId: it.id, containerName: it.name, location: it.location, name: '(whole container)', expires: it.expires, status: st })
    }
    ;(it.contents || []).forEach((c, idx) => {
      if (!c.expires) return
      const st = expStatus(c.expires, soonDays)
      if (st === 'expired' || st === 'soon')
        out.push({ kind: 'item', containerId: it.id, containerName: it.name, location: it.location, name: c.name, qty: c.qty, index: idx, expires: c.expires, status: st })
    })
  }
  return out.sort((a, b) => a.expires.localeCompare(b.expires))
}

export function num(n) {
  const v = parseFloat(n)
  return isNaN(v) ? 0 : v
}

export function money(n) {
  const v = parseFloat(n)
  if (isNaN(v)) return ''
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function containerValue(it) {
  return (it.contents || []).reduce((s, c) => s + num(c.value) * (num(c.qty) || 1), 0)
}

export function containerProfit(it) {
  let p = 0
  for (const c of it.contents || []) {
    if (c.status === 'Sold' || c.status === 'Shipped')
      p += (num(c.sale) - num(c.cost)) * (num(c.qty) || 1)
  }
  for (const h of it.history || []) {
    if (h.reason === 'sold')
      p += (num(h.sale) - num(h.cost)) * (num(h.qty) || 1)
  }
  return p
}

export function statusClass(s) {
  return ({ 'In stock': 'stock', Listed: 'listed', Sold: 'sold', Shipped: 'shipped' }[s] || 'stock')
}

// Resize + compress an image File to a JPEG data URL, capped at maxPx on the long edge.
export function shrinkImage(file, maxPx = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width: w, height: h } = img
        if (w > h && w > maxPx) { h = (h * maxPx) / w; w = maxPx }
        else if (h > maxPx) { w = (w * maxPx) / h; h = maxPx }
        const cv = document.createElement('canvas')
        cv.width = w; cv.height = h
        cv.getContext('2d').drawImage(img, 0, 0, w, h)
        cv.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function exportCSV(items, resellerMode) {
  const headers = ['Container', 'Location', 'Category', 'Description', 'Item', 'Qty',
    resellerMode ? 'Cost' : 'Value', 'Sale', 'Marketplace', 'SKU', 'Status', 'Expires']
  const rows = [headers]
  for (const it of items) {
    if (!it.contents || !it.contents.length) {
      rows.push([it.name, it.location, it.category, it.description, '', '', '', '', '', '', '', it.expires || ''])
      continue
    }
    for (const c of it.contents) {
      rows.push([it.name, it.location || '', it.category || '', it.description || '',
        c.name || '', c.qty || 1, resellerMode ? (c.cost || '') : (c.value || ''),
        c.sale || '', c.marketplace || '', c.sku || '', c.status || '', c.expires || ''])
    }
  }
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'binventory.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
