import { supabase } from './supabaseClient'

// ---- Containers ----
export async function fetchContainers(userId) {
  const { data, error } = await supabase
    .from('containers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToItem)
}

export async function upsertContainer(userId, item) {
  const row = {
    id: item.id,
    user_id: userId,
    name: item.name || 'Untitled',
    location: item.location || '',
    category: item.category || '',
    description: item.description || '',
    photos: item.photos || [],
    contents: item.contents || [],
  }
  const { error } = await supabase.from('containers').upsert(row)
  if (error) throw error
}

export async function deleteContainer(id) {
  const { error } = await supabase.from('containers').delete().eq('id', id)
  if (error) throw error
}

function rowToItem(r) {
  return {
    id: r.id,
    name: r.name,
    location: r.location || '',
    category: r.category || '',
    description: r.description || '',
    photos: r.photos || [],
    contents: r.contents || [],
    created: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  }
}

// ---- Settings ----
export async function fetchSettings(userId) {
  const { data, error } = await supabase
    .from('settings').select('reseller_mode').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return { resellerMode: data ? !!data.reseller_mode : false }
}

export async function saveSettings(userId, resellerMode) {
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, reseller_mode: resellerMode, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ---- Photos (Supabase Storage) ----
export async function uploadPhoto(userId, blob) {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, blob, {
    contentType: 'image/jpeg', upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from('photos').getPublicUrl(path)
  return data.publicUrl
}

export async function deletePhoto(url) {
  try {
    const marker = '/photos/'
    const i = url.indexOf(marker)
    if (i === -1) return
    const path = url.slice(i + marker.length)
    await supabase.storage.from('photos').remove([path])
  } catch (e) { /* non-fatal */ }
}
