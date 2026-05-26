export const STATUSES = ['In stock', 'Listed', 'Sold', 'Shipped']

export function uid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
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
  return (it.contents || []).reduce((s, c) => {
    if (c.status === 'Sold' || c.status === 'Shipped')
      return s + (num(c.sale) - num(c.cost)) * (num(c.qty) || 1)
    return s
  }, 0)
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
    resellerMode ? 'Cost' : 'Value', 'Sale', 'Marketplace', 'SKU', 'Status']
  const rows = [headers]
  for (const it of items) {
    if (!it.contents || !it.contents.length) {
      rows.push([it.name, it.location, it.category, it.description, '', '', '', '', '', '', ''])
      continue
    }
    for (const c of it.contents) {
      rows.push([it.name, it.location || '', it.category || '', it.description || '',
        c.name || '', c.qty || 1, resellerMode ? (c.cost || '') : (c.value || ''),
        c.sale || '', c.marketplace || '', c.sku || '', c.status || ''])
    }
  }
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'binventory.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
