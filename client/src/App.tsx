import React, { useState, useEffect } from 'react'
import { TokenForm } from './components/TokenForm'
import { MRCard } from './components/MRCard'
import { AuthoredMRCard } from './components/AuthoredMRCard'
import { PipelineSettingsModal } from './components/PipelineSettingsModal'
import { useIdleTimeout } from './hooks/useIdleTimeout'
import type { AnalyzeResponse, PipelineVar } from './types'

const PIPELINE_STORAGE_KEY = 'renovate-reviewer:pipelineSettings'

function loadPipelineSettings(): Record<string, PipelineVar[]> {
  try {
    const raw = localStorage.getItem(PIPELINE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PipelineVar[]>) : {}
  } catch { return {} }
}

function savePipelineSettings(settings: Record<string, PipelineVar[]>) {
  localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(settings))
}

type AppState = 'idle' | 'loading' | 'results' | 'error'
type MRFilter = 'all' | 'renovate' | 'authored'

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [results, setResults] = useState<AnalyzeResponse | null>(null)
  const [error, setError] = useState<string>('')
  // Stored so MRCards can call /api/approve without re-prompting
  const [sessionToken, setSessionToken] = useState<string>('')
  const [sessionProjectId, setSessionProjectId] = useState<string>('')
  const [sessionPipelineVars, setSessionPipelineVars] = useState<PipelineVar[]>([])
  const [filter, setFilter] = useState<MRFilter>('all')
  const [showPipelineSettings, setShowPipelineSettings] = useState(false)
  const [rateLimitToast, setRateLimitToast] = useState<string | null>(null)
  const [isRefetching, setIsRefetching] = useState(false)

  const { isIdle, resume } = useIdleTimeout(30 * 60 * 1000) // 30 min

  // Global accordion state — must be here (before early returns) per Rules of Hooks
  const [expandedIid, setExpandedIid] = useState<number | null>(null)
  // When results load, open the first card by default
  useEffect(() => {
    if (!results) { setExpandedIid(null); return }
    const first = [
      ...results.mrs.filter((m) => m.verdict.status === 'safe'),
      ...results.mrs.filter((m) => m.verdict.status === 'pending_approval'),
      ...results.mrs.filter((m) => m.verdict.status === 'review'),
      ...results.mrs.filter((m) => m.verdict.status === 'blocked'),
    ][0]
    setExpandedIid(first?.iid ?? null)
  }, [results])

  async function handleSubmit(token: string, projectId: string) {
    setAppState('loading')
    setError('')
    setSessionToken(token)
    setSessionProjectId(projectId)
    // Pipeline vars come solely from localStorage — strictly per-repo, no defaults
    const stored = loadPipelineSettings()
    setSessionPipelineVars(stored[projectId] ?? [])
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitlabToken: token, projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`)
      setResults(data as AnalyzeResponse)
      setAppState('results')
      // Show toast if any package hit the GitHub rate limit
      const rateLimited = (data as AnalyzeResponse).mrs.flatMap((m) => m.changelog).find((e) => e.source === 'rate-limited')
      setRateLimitToast(rateLimited?.body ?? null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setAppState('error')
    }
  }

  async function handleRefetch() {
    setIsRefetching(true)
    setRateLimitToast(null)
    try {
      await fetch('/api/cache/clear', { method: 'POST' })
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitlabToken: sessionToken, projectId: sessionProjectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`)
      setResults(data as AnalyzeResponse)
      const rateLimited = (data as AnalyzeResponse).mrs.flatMap((m) => m.changelog).find((e) => e.source === 'rate-limited')
      setRateLimitToast(rateLimited?.body ?? null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setAppState('error')
    } finally {
      setIsRefetching(false)
    }
  }

  function handleReset() {
    setAppState('idle')
    setResults(null)
    setError('')
    setSessionPipelineVars([]) // clear so previous repo's vars never leak into the next
  }

  function handlePipelineSave(vars: PipelineVar[]) {
    const settings = loadPipelineSettings()
    settings[sessionProjectId] = vars
    savePipelineSettings(settings)
    setSessionPipelineVars(vars)
    setShowPipelineSettings(false)
  }

  // Both idle and error states show the TokenForm
  if (appState === 'idle' || appState === 'loading' || appState === 'error') {
    return (
      <TokenForm
        onSubmit={(token, projectId) => handleSubmit(token, projectId)}
        loading={appState === 'loading'}
        lastError={appState === 'error' ? error : undefined}
      />
    )
  }

  if (!results) return null

  const renovateMRs = results.mrs.filter((m) => m.isRenovate)
  const authoredMRs  = results.mrs.filter((m) => !m.isRenovate)
  const hasAuthored  = authoredMRs.length > 0

  // All MRs now have proper verdicts — stats cover everyone
  const safe            = results.mrs.filter((m) => m.verdict.status === 'safe')
  const pendingApproval = results.mrs.filter((m) => m.verdict.status === 'pending_approval')
  const review          = results.mrs.filter((m) => m.verdict.status === 'review')
  const blocked         = results.mrs.filter((m) => m.verdict.status === 'blocked')

  // Unified sorted list: safe → pending_approval → review → blocked, then newest-first within each group
  const verdictOrder = { safe: 0, pending_approval: 1, review: 2, blocked: 3 }
  const filteredMRs = results.mrs
    .filter((m) => filter === 'all' || (filter === 'renovate' ? m.isRenovate : !m.isRenovate))
    .sort((a, b) => {
      const vd = verdictOrder[a.verdict.status] - verdictOrder[b.verdict.status]
      return vd !== 0 ? vd : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  function toggleMr(iid: number) {
    setExpandedIid(iid)
  }

  return (
    <div style={styles.page}>
      {/* Rate-limit toast */}
      {rateLimitToast && (
        <div style={toastStyle}>
          <span style={{ flex: 1 }}>⏱ {rateLimitToast}</span>
          <button
            onClick={() => setRateLimitToast(null)}
            style={{ background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem', flexShrink: 0 }}
            title="Dismiss"
          >✕</button>
        </div>
      )}

      {/* Pipeline settings modal */}
      {showPipelineSettings && (
        <PipelineSettingsModal
          projectId={sessionProjectId}
          initialVars={sessionPipelineVars}
          onSave={handlePipelineSave}
          onClose={() => setShowPipelineSettings(false)}
        />
      )}

      {/* Idle overlay */}
      {isIdle && (
        <div style={styles.idleOverlay}>
          <div style={styles.idleCard}>
            <p style={styles.idleIcon}>💤</p>
            <h2 style={styles.idleTitle}>Session paused</h2>
            <p style={styles.idleText}>
              The dashboard has been idle for 30 minutes.
              <br />Results may be stale — resume to refresh.
            </p>
            <div style={styles.idleActions}>
              <button style={styles.resumeBtn} onClick={() => { resume(); handleReset() }}>
                Fetch fresh data
              </button>
              <button style={styles.resumeSecondary} onClick={resume}>
                Resume with current data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header style={styles.topbar}>
        <div>
          <h1 style={styles.heading}>
            <img src="/icon.svg" alt="" style={{ width: '1.3rem', height: '1.3rem', verticalAlign: 'middle', marginRight: '0.4rem', borderRadius: '4px' }} />
            Ren, the Reviewer
          </h1>
          <span style={styles.project}>{results.projectName}</span>
        </div>
        <div style={styles.topRight}>
          <span style={styles.fetchTime}>
            Fetched {new Date(results.fetchedAt).toLocaleTimeString()}
          </span>
          <button style={styles.pipelineBtn} onClick={handleRefetch} disabled={isRefetching} title="Clear changelog cache and refresh all MRs">
            {isRefetching ? '⟳ Refreshing…' : 'Refresh'}
          </button>
          <button style={styles.pipelineBtn} onClick={() => setShowPipelineSettings(true)}
            title="Configure pipeline variables for this repo">
            ⚙ Pipeline
          </button>
          <button style={styles.backBtn} onClick={handleReset}>← Change repo</button>
        </div>
      </header>

      {/* Summary stats — across all MRs */}
      <div style={styles.summary}>
        <Stat label="Ready to Merge"      value={safe.length}            colour="#5ecfaa" />
        <Stat label="Needs Approval"      value={pendingApproval.length} colour="#a0c4ff" />
        <Stat label="Needs Manual Review" value={review.length}          colour="#d4854a" />
        <Stat label="Blocked"             value={blocked.length}         colour="#d94f4f" />
        <Stat label="Total MRs"           value={results.mrs.length}     colour="#8c88ba" />
      </div>

      {/* Filter bar — only shown when there are authored MRs */}
      {hasAuthored && (
        <div style={styles.filterRow}>
          {([
            { key: 'all',      label: `All (${results.mrs.length})` },
            { key: 'renovate', label: `Renovate (${renovateMRs.length})` },
            { key: 'authored', label: `Authored (${authoredMRs.length})` },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              style={{ ...styles.filterChip, ...(filter === key ? styles.filterChipActive : {}) }}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Refresh spinner */}
      {isRefetching && (
        <>
          <style>{`@keyframes ren-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem', color: '#8c88ba', fontSize: '0.82rem' }}>
            <span style={{ display: 'inline-block', animation: 'ren-spin 1s linear infinite', fontSize: '1rem', lineHeight: 1 }}>↻</span>
            Refreshing…
          </div>
        </>
      )}

      {!isRefetching && results.mrs.length === 0 && (
        <p style={{ color: '#736da4', textAlign: 'center', marginTop: '3rem' }}>
          No open MRs found for this repository.
        </p>
      )}

      {/* Single unified list — Renovate and Authored cards mixed, sorted by verdict */}
      {!isRefetching && filteredMRs.length === 0 && results.mrs.length > 0 && (
        <p style={{ color: '#736da4', textAlign: 'center', marginTop: '2rem' }}>
          No MRs match this filter.
        </p>
      )}
      {!isRefetching && filteredMRs.length > 0 && (
        <div style={styles.mrList}>
          {filteredMRs.map((mr) =>
            mr.isRenovate ? (
              <MRCard
                key={`${mr.id}-${results.fetchedAt}`}
                mr={mr}
                token={sessionToken}
                projectId={sessionProjectId}
                pipelineVars={sessionPipelineVars}
                isExpanded={expandedIid === mr.iid}
                onToggle={() => toggleMr(mr.iid)}
              />
            ) : (
              <AuthoredMRCard
                key={`${mr.id}-${results.fetchedAt}`}
                mr={mr}
                token={sessionToken}
                projectId={sessionProjectId}
                pipelineVars={sessionPipelineVars}
                isExpanded={expandedIid === mr.iid}
                onToggle={() => toggleMr(mr.iid)}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div style={styles.statCard}>
      <span style={{ ...styles.statValue, color: colour }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const toastStyle: React.CSSProperties = {
  position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 1000,
  background: '#1c1505', border: '1px solid #d97706', borderRadius: '10px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
  color: '#fbbf24', fontSize: '0.82rem', lineHeight: 1.5,
  maxWidth: '400px', padding: '0.85rem 1.1rem',
  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '860px', margin: '0 auto', padding: '2rem 1.5rem' },
  topbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem',
  },
  heading: { fontSize: '1.4rem', fontWeight: 700, color: '#ddd7ef' },
  project: { color: '#736da4', fontSize: '0.85rem' },
  topRight: { display: 'flex', alignItems: 'center', gap: '1rem' },
  fetchTime: { color: '#736da4', fontSize: '0.8rem' },
  pipelineBtn: {
    background: 'transparent', border: '1px solid #6b6698', borderRadius: '6px',
    color: '#a090de', fontSize: '0.82rem', padding: '0.32rem 0.72rem', cursor: 'pointer',
  },
  backBtn: {
    background: 'transparent', border: '1px solid #6b6698', borderRadius: '6px',
    color: '#a090de', fontSize: '0.82rem', padding: '0.32rem 0.72rem', cursor: 'pointer',
  },
  summary: { display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' },
  statCard: {
    background: '#120e23', border: '1px solid #413e74', borderRadius: '10px',
    padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '0.25rem', flex: '1', minWidth: '100px',
  },
  statValue: { fontSize: '2rem', fontWeight: 700 },
  statLabel: { color: '#736da4', fontSize: '0.78rem', textAlign: 'center' },
  section: { marginBottom: '2rem' },
  mrList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },

  // Filter bar
  filterRow: {
    display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const,
    marginBottom: '1.5rem',
  },
  filterChip: {
    background: '#120e23', border: '1px solid #413e74', borderRadius: '20px',
    color: '#8c88ba', cursor: 'pointer', fontSize: '0.8rem',
    padding: '0.3rem 0.85rem', transition: 'all 0.15s',
  },
  filterChipActive: {
    background: 'rgba(139,127,204,0.15)', border: '1px solid #a090de',
    color: '#ddd7ef',
  },

  // Section dividers when showing "All"
  sectionHeading: {
    color: '#6b6698', fontSize: '0.7rem', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase' as const,
    marginBottom: '0.75rem', marginTop: '0.5rem',
  },

  // Authored MRs list
  authoredList: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' },
  // Idle overlay
  idleOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.8)',
    backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100,
  },
  idleCard: {
    background: '#1b1033', border: '1px solid #413e74', borderRadius: '14px',
    padding: '2.5rem', maxWidth: '380px', width: '100%', textAlign: 'center',
  },
  idleIcon: { fontSize: '2.5rem', marginBottom: '0.75rem' },
  idleTitle: { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#ddd7ef' },
  idleText: { color: '#8c88ba', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  idleActions: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  resumeBtn: {
    background: 'rgba(94,207,170,0.12)', border: '1px solid #5ecfaa', borderRadius: '8px',
    color: '#5ecfaa', fontSize: '0.92rem', fontWeight: 600, padding: '0.65rem', cursor: 'pointer',
  },
  resumeSecondary: {
    background: 'transparent', border: '1px solid #413e74', borderRadius: '8px',
    color: '#8c88ba', fontSize: '0.88rem', padding: '0.58rem', cursor: 'pointer',
  },
}