import { fetchApiJson } from './fetchApiJson'
import { supabase } from '../lib/supabase'

async function authHeaders() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data?.session?.access_token
  if (!token) throw new Error('You must be signed in to manage ICS feeds.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function listFeeds() {
  const headers = await authHeaders()
  const res = await fetchApiJson('/api/ics/feeds', { headers })
  return res.feeds || []
}

export async function addFeed(url, label) {
  const headers = await authHeaders()
  const res = await fetchApiJson('/api/ics/feeds', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, label: label || null }),
  })
  return res.feed
}

export async function removeFeed(id) {
  const headers = await authHeaders()
  await fetchApiJson(`/api/ics/feeds/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  })
  return true
}

export async function syncAll() {
  const headers = await authHeaders()
  return fetchApiJson('/api/ics/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
}

export async function syncOne(feedId) {
  const headers = await authHeaders()
  return fetchApiJson('/api/ics/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ feedId }),
  })
}
