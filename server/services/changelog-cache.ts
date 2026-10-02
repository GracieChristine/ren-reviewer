import path from 'path'
import fs from 'fs'
import os from 'os'
import type { ChangelogEntry } from '../types'

export interface CacheValue {
  entries: ChangelogEntry[]
  compareUrl?: string
  repoUrl?: string
  cachedAt: number
}

type CacheStore = Record<string, CacheValue>

const CACHE_DIR = process.env.CHANGELOG_CACHE_DIR ?? os.homedir()
const CACHE_FILE = path.join(CACHE_DIR, 'changelog-cache.json')
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let store: CacheStore | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function load(): CacheStore {
  if (store !== null) return store
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheStore
    const now = Date.now()
    store = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => !v.cachedAt || now - v.cachedAt < TTL_MS)
    )
    const purged = Object.keys(raw).length - Object.keys(store).length
    const kept = Object.keys(store).length
    console.log(`[changelog-cache] loaded ${kept} entries${purged > 0 ? `, purged ${purged} expired` : ''}`)
  } catch {
    store = {}
  }
  return store
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[changelog-cache] failed to write cache:', e)
    }
  }, 2000)
}

export function cacheKey(name: string, from: string, to: string): string {
  return `${name}:${from}:${to}`
}

export function getCached(key: string): CacheValue | null {
  return load()[key] ?? null
}

export function setCached(key: string, value: Omit<CacheValue, 'cachedAt'>): void {
  load()[key] = { ...value, cachedAt: Date.now() }
  scheduleFlush()
}

export function clearCache(): { cleared: number } {
  const count = store ? Object.keys(store).length : Object.keys(load()).length
  store = {}
  try {
    fs.writeFileSync(CACHE_FILE, '{}', 'utf-8')
  } catch (e) {
    console.warn('[changelog-cache] failed to clear cache file:', e)
  }
  console.log(`[changelog-cache] cleared ${count} entries`)
  return { cleared: count }
}

export function cacheStats(): { entries: number; filePath: string } {
  return { entries: Object.keys(load()).length, filePath: CACHE_FILE }
}
