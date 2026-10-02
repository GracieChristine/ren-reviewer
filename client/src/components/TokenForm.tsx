import React, { useEffect, useState } from 'react'
import type { PinnedRepo } from '../types'

const PINNED_REPOS: PinnedRepo[] = [
  {
    id: 'players-automated-tests',
    label: 'players-automated-tests',
    projectId:
      'poppulo/engineering/domains/digital-signage/test-automation/players-automated-tests',
  },
  {
    id: 'digital-signage-cloud-tests',
    label: 'digital-signage-cloud-tests',
    projectId:
      'poppulo/engineering/domains/digital-signage/test-automation/digital-signage-cloud-tests',
  },
]

interface Props {
  onSubmit: (token: string, projectId: string) => void
  loading: boolean
  /** Pass the error string from App so we can flag an expired token */
  lastError?: string
}

type TokenState = 'loading' | 'saved' | 'manual'

export function TokenForm({ onSubmit, loading, lastError }: Props) {
  const [tokenState, setTokenState] = useState<TokenState>('manual')
  const [cacheCleared, setCacheCleared] = useState(false)
  const [token, setToken] = useState('')
  const [selectedRepo, setSelectedRepo] = useState(PINNED_REPOS[0].id)
  const [customRepo, setCustomRepo] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const isElectron = !!window.electronAPI?.isElectron
  const tokenExpired = !!lastError && (lastError.includes('Invalid') || lastError.includes('401') || lastError.includes('expired'))

  // ── Token persistence helpers ──────────────────────────────────────────────
  // Electron: OS-level encrypted storage via safeStorage
  // Browser:  localStorage (local-only, never leaves the machine)

  async function loadSavedToken(): Promise<string | null> {
    if (isElectron) return window.electronAPI!.getToken()
    return localStorage.getItem('renovate-reviewer:token')
  }

  async function saveToken(t: string) {
    if (isElectron) return window.electronAPI!.setToken(t)
    localStorage.setItem('renovate-reviewer:token', t)
  }

  async function clearToken() {
    if (isElectron) return window.electronAPI!.clearToken()
    localStorage.removeItem('renovate-reviewer:token')
    localStorage.removeItem('renovate-reviewer:repo')
  }

  // On mount: try to restore saved token (and last selected repo)
  useEffect(() => {
    setTokenState('loading')
    loadSavedToken().then((saved) => {
      if (saved) {
        setToken(saved)
        setTokenState('saved')
        // Also restore last used repo selection
        const savedRepo = localStorage.getItem('renovate-reviewer:repo')
        if (savedRepo) {
          const pinned = PINNED_REPOS.find((r) => r.id === savedRepo)
          if (pinned) {
            setSelectedRepo(savedRepo)
            setUseCustom(false)
          } else {
            setCustomRepo(savedRepo)
            setUseCustom(true)
          }
        }
      } else {
        setTokenState('manual')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const raw = useCustom
      ? customRepo.trim()
      : PINNED_REPOS.find((r) => r.id === selectedRepo)?.projectId ?? ''
    // Accept either a full GitLab URL or just the project path
    const projectId = raw.replace(/^https?:\/\/gitlab\.com\//, '').replace(/\/$/, '')
    if (!token || !projectId) return

    // Persist token and repo selection
    await saveToken(token)
    localStorage.setItem('renovate-reviewer:repo', useCustom ? customRepo.trim() : selectedRepo)

    // Pipeline vars come entirely from localStorage (configured via ⚙ Pipeline modal)
    // — no hardcoded defaults so settings are strictly per-repo
    onSubmit(token, projectId)
  }

  async function handleForgetToken() {
    await clearToken()
    setToken('')
    setTokenState('manual')
  }

  const projectId = useCustom
    ? customRepo.trim()
    : PINNED_REPOS.find((r) => r.id === selectedRepo)?.projectId ?? ''

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>
          <img src="/icon.svg" alt="" style={{ width: '2rem', height: '2rem', verticalAlign: 'middle', marginRight: '0.5rem', borderRadius: '6px' }} />
          Ren, the Reviewer
        </h1>
        <p style={styles.subtitle}>
          Review open Renovate MRs — changelogs, CI status, and merge verdict.
          <br />
          <span style={styles.hint}>Your token is encrypted by the OS and never written to disk.</span>
        </p>

        {/* Saved token banner */}
        {isElectron && tokenState === 'saved' && !tokenExpired && (
          <div style={styles.savedBanner}>
            🔑 Saved token detected
            <button style={styles.forgetLink} onClick={handleForgetToken}>
              Use a different token
            </button>
          </div>
        )}

        {/* Expired token warning */}
        {tokenExpired && (
          <div style={styles.errorBanner}>
            ⚠️ Your saved token may be expired. Enter a new one below.
            {isElectron && (
              <button style={styles.forgetLink} onClick={handleForgetToken}>Clear saved token</button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Token field — hidden when saved token is ready and not expired */}
          {(tokenState !== 'saved' || tokenExpired) && (
            <label style={styles.label}>
              GitLab Personal Access Token
              <input
                style={styles.input}
                type="password"
                placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="off"
                autoFocus={tokenExpired}
              />
              <span style={styles.hint}>
                Needs <code>read_api</code> scope (+ <code>api</code> scope to approve MRs)
              </span>
            </label>
          )}

          {/* Repo selector */}
          <label style={styles.label}>
            Repository
            <div style={styles.repoRow}>
              {PINNED_REPOS.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  style={{
                    ...styles.repoChip,
                    ...(selectedRepo === repo.id && !useCustom ? styles.repoChipActive : {}),
                  }}
                  onClick={() => { setSelectedRepo(repo.id); setUseCustom(false) }}
                >
                  {repo.label}
                </button>
              ))}
              <button
                type="button"
                style={{ ...styles.repoChip, ...(useCustom ? styles.repoChipActive : {}) }}
                onClick={() => setUseCustom(true)}
              >
                Custom…
              </button>
            </div>
          </label>

          {useCustom && (
            <label style={styles.label}>
              Custom project path
              <input
                style={styles.input}
                type="text"
                placeholder="namespace/group/project  or  full GitLab URL"
                value={customRepo}
                onChange={(e) => setCustomRepo(e.target.value)}
                required={useCustom}
                autoFocus
              />
            </label>
          )}

          <button
            style={styles.submit}
            type="submit"
            disabled={loading || tokenState === 'loading' || !projectId}
          >
            {loading
              ? 'Fetching…'
              : tokenState === 'loading'
              ? 'Loading saved token…'
              : 'Fetch MRs'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            style={styles.clearCacheLink}
            onClick={() => {
              fetch('/api/cache/clear', { method: 'POST' })
              setCacheCleared(true)
              setTimeout(() => setCacheCleared(false), 2000)
            }}
            title="Remove locally cached changelog data so the next fetch pulls fresh data from GitHub"
          >
            {cacheCleared ? '✔ Cleared' : 'Clear cache'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
  },
  card: {
    background: '#1a1f2e',
    border: '1px solid #2d3748',
    borderRadius: '12px',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '480px',
  },
  title: { fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.5rem' },
  subtitle: { color: '#94a3b8', lineHeight: 1.6, marginBottom: '1.5rem', fontSize: '0.9rem' },
  hint: { color: '#64748b', fontSize: '0.82rem' },
  savedBanner: {
    background: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: '8px',
    color: '#86efac',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
    marginBottom: '1.25rem',
    padding: '0.6rem 0.9rem',
  },
  errorBanner: {
    background: '#1c0606',
    border: '1px solid #dc2626',
    borderRadius: '8px',
    color: '#fca5a5',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
    marginBottom: '1.25rem',
    padding: '0.6rem 0.9rem',
  },
  forgetLink: {
    background: 'transparent',
    border: 'none',
    color: '#63b3ed',
    cursor: 'pointer',
    fontSize: '0.82rem',
    textDecoration: 'underline',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 500 },
  input: {
    background: '#0f1117',
    border: '1px solid #2d3748',
    borderRadius: '6px',
    color: '#e2e8f0',
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    outline: 'none',
  },
  repoRow: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' },
  repoChip: {
    background: '#0f1117',
    border: '1px solid #2d3748',
    borderRadius: '20px',
    color: '#94a3b8',
    fontSize: '0.82rem',
    padding: '0.35rem 0.85rem',
    transition: 'all 0.15s',
  },
  repoChipActive: {
    background: '#1e40af',
    border: '1px solid #3b82f6',
    color: '#eff6ff',
  },
  submit: {
    background: '#2563eb',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    padding: '0.75rem',
    marginTop: '0.5rem',
    transition: 'background 0.15s',
  },
  clearCacheLink: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: '0.78rem',
    textDecoration: 'underline',
    padding: 0,
  },
}
