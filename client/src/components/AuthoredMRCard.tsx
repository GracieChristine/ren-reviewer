import React, { useState } from 'react'
import type { RenovateMR } from '../types'
import { usePipelineRun } from '../hooks/usePipelineRun'
import { PipelineButton } from './PipelineButton'

// Same verdict styles as MRCard — authored MRs now have a server-computed verdict
const VERDICT_STYLES = {
  safe:             { border: '#5ecfaa', color: '#5ecfaa', bg: 'rgba(94,207,170,0.12)',   label: '✔ Ready to Merge' },
  pending_approval: { border: '#a0c4ff', color: '#a0c4ff', bg: 'rgba(160,196,255,0.10)', label: '⧗ Needs Approval' },
  review:           { border: '#d4854a', color: '#d4854a', bg: 'rgba(212,133,74,0.12)',  label: '⚠ Needs Manual Review' },
  blocked:          { border: '#d94f4f', color: '#d94f4f', bg: 'rgba(217,79,79,0.12)',   label: '✖ Blocked' },
}

type ApproveStatus = 'idle' | 'approving' | 'approved' | 'already' | 'error'

interface DescriptionSection {
  heading: string
  body: string
}

/** Parse a markdown description into named sections (## / ### headers). */
function parseDescriptionSections(raw: string): DescriptionSection[] {
  if (!raw.trim()) return []
  const sections: DescriptionSection[] = []
  const lines = raw.split('\n')
  let currentHeading = ''
  let currentLines: string[] = []

  function flush() {
    const body = currentLines.join('\n').trim()
    if (body) sections.push({ heading: currentHeading, body })
    currentLines = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)/)
    if (headingMatch) {
      flush()
      currentHeading = headingMatch[1].trim()
    } else {
      currentLines.push(line)
    }
  }
  flush()
  return sections
}

/** Render body text: strip markdown syntax, preserve bullet structure */
function renderBody(body: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  for (const [i, raw] of body.split('\n').entries()) {
    if (!raw.trim()) continue
    const bulletMatch = raw.match(/^\s*[-*+]|\d+\.\s+(.*)/)
    // Re-match properly
    const bm = raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)/)
    if (bm) {
      const text = stripInline(bm[1])
      if (text) nodes.push(
        <div key={i} style={styles.bullet}>
          <span style={styles.bulletDot}>•</span>
          <span style={styles.bulletText}>{text}</span>
        </div>
      )
    } else {
      const text = stripInline(raw.trim())
      if (text) nodes.push(<p key={i} style={styles.bodyPara}>{text}</p>)
    }
    void bulletMatch // suppress unused warning
  }
  return nodes
}

function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<!--.*?-->/gs, '')
    .trim()
}

function isPlaceholder(body: string): boolean {
  const s = body.toLowerCase().replace(/[^a-z0-9]/g, '')
  return !s || s === 'na' || s === 'none' || s === 'n/a' || s === 'nope'
}

interface CheckItem { label: string; status: 'ok' | 'warn' | 'fail' }

function buildChecklist(mr: RenovateMR): CheckItem[] {
  const items: CheckItem[] = []

  // CI
  const ciMap: Record<RenovateMR['ciStatus'], CheckItem> = {
    success: { label: 'CI passed',        status: 'ok' },
    failed:  { label: 'CI failed',         status: 'fail' },
    running: { label: 'CI running',        status: 'warn' },
    pending: { label: 'CI pending',        status: 'warn' },
    unknown: { label: 'CI status unknown', status: 'warn' },
  }
  items.push(ciMap[mr.ciStatus])

  return items
}

interface Props {
  mr: RenovateMR
  token: string
  projectId: string
  pipelineVars: { key: string; value: string }[]
  isExpanded: boolean
  onToggle: () => void
}

export function AuthoredMRCard({ mr, token, projectId, pipelineVars, isExpanded, onToggle }: Props) {
  const [approveStatus, setApproveStatus] = useState<ApproveStatus>('idle')
  const [approveError, setApproveError] = useState('')
  const [localApprovalCount, setLocalApprovalCount] = useState(mr.approvalCount)
  const pipeline = usePipelineRun(token, projectId, mr.sourceBranch, pipelineVars)

  const age = Math.floor((Date.now() - new Date(mr.createdAt).getTime()) / 86_400_000)
  const ci = VERDICT_STYLES[mr.verdict.status]
  const checklist = buildChecklist(mr)

  const sections = parseDescriptionSections(mr.description)
    .filter((s) => !isPlaceholder(s.body))

  const showApproveBtn = !mr.isAuthoredByCurrentUser && !mr.alreadyApproved

  async function handleApprove() {
    setApproveStatus('approving')
    setApproveError('')
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitlabToken: token, projectId, mrIid: mr.iid }),
      })
      const data = await res.json()
      if (res.status === 409) { setApproveStatus('already'); return }
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
      setApproveStatus('approved')
      setLocalApprovalCount((n) => n + 1)
    } catch (err: unknown) {
      setApproveError(err instanceof Error ? err.message : String(err))
      setApproveStatus('error')
    }
  }

  const isDone = approveStatus === 'approved' || approveStatus === 'already'
  const isWorking = approveStatus === 'approving'
  const isDisabled = isDone || isWorking

  return (
    <div style={{ ...styles.card, borderColor: ci.border }}>

      {/* ── Clickable header ── */}
      <div style={styles.cardHeader} onClick={onToggle} role="button" aria-expanded={isExpanded}>

        {/* Top bar: badge + age */}
        <div style={styles.topBar}>
          <span style={{ ...styles.badge, background: ci.bg, border: `1px solid ${ci.color}`, color: ci.color }}>
            {ci.label}
          </span>
          <span style={styles.age}>{age}d old</span>
        </div>

        {/* Title row: title + link + approve + chevron */}
        <div style={styles.titleRow}>
          <div style={styles.titleLeft}>
            <span style={styles.title} title={mr.title.length > 120 ? mr.title : undefined}>
              {mr.title.length > 120 ? mr.title.slice(0, 120) + '…' : mr.title}
            </span>
            <a
              href={mr.webUrl}
              target="_blank"
              rel="noreferrer"
              style={styles.openMrLink}
              title="Open MR in GitLab"
              onClick={(e) => e.stopPropagation()}
            >↗</a>
          </div>

          <div style={styles.titleActions} onClick={(e) => e.stopPropagation()}>
            {mr.alreadyApproved && (
              <span style={styles.approvedText}>✔ Approved</span>
            )}
            {showApproveBtn && (() => (
              <>
                {approveStatus === 'error' && (
                  <span style={styles.errorText} title={approveError}>⚠ Error</span>
                )}
                <button
                  style={{
                    ...styles.approveBtn,
                    ...(isDisabled ? { opacity: 0.45, cursor: 'default' } : {}),
                  }}
                  onClick={isDisabled ? undefined : handleApprove}
                  aria-disabled={isDisabled}
                  title={isDone ? 'Already approved' : undefined}
                >
                  {isDone ? '✔ Approved' : isWorking ? 'Approving…' : 'Approve'}
                </button>
              </>
            ))()}
            <PipelineButton pipeline={pipeline} disabled={pipelineVars.length === 0} />
            <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Author + labels */}
        <div style={styles.metaRow}>
          <span style={styles.author}>{mr.author.name}</span>
          {mr.labels.map((label) => (
            <span key={label} style={styles.labelChip}>{label}</span>
          ))}
        </div>
      </div>

      {/* ── Collapsible body ── */}
      {isExpanded && <>

        {/* SECTION 1 — DESCRIPTION */}
        <div style={styles.section}>
          <span style={styles.sectionLabel}>Description</span>
          {sections.length === 0 ? (
            <span style={styles.noDesc}>No description provided.</span>
          ) : (
            sections.map((sec, i) => (
              <div key={i} style={styles.descGroup}>
                {sec.heading && (
                  <span style={styles.descHeading}>{sec.heading}</span>
                )}
                <div style={styles.descBody}>
                  {renderBody(sec.body)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* SECTION 2 — REVIEW STATUS */}
        <div style={styles.section}>
          <span style={styles.sectionLabel}>Review Status</span>
          <ul style={styles.checklist}>
            {checklist.map((item, i) => (
              <li key={i} style={styles.checkItem}>
                <span style={{
                  ...styles.checkIcon,
                  color: item.status === 'ok' ? '#22c55e' : item.status === 'fail' ? '#ef4444' : '#f59e0b',
                }}>
                  {item.status === 'ok' ? '✔' : item.status === 'fail' ? '✖' : '⚠'}
                </span>
                <span style={{
                  color: item.status === 'ok' ? '#9ca3af' : item.status === 'fail' ? '#fca5a5' : '#fbbf24',
                  fontSize: '0.82rem',
                }}>
                  {item.label}
                </span>
              </li>
            ))}

            {/* Behind target branch */}
            {(() => {
              const n = mr.divergedCommitsCount
              const base = mr.targetBranch || 'base branch'
              if (n === null) return (
                <li style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: '#f59e0b' }}>⚠</span>
                  <span style={{ color: '#fbbf24', fontSize: '0.82rem' }}>
                    Sync with <span style={styles.branchName}>{base}</span> unknown — verify before merging
                  </span>
                </li>
              )
              if (n === 0) return (
                <li style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: '#22c55e' }}>✔</span>
                  <span style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
                    Up to date with <span style={styles.branchName}>{base}</span>
                  </span>
                </li>
              )
              const tooFar = n >= 20
              return (
                <li style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: tooFar ? '#ef4444' : '#f59e0b' }}>
                    {tooFar ? '✖' : '⚠'}
                  </span>
                  <span style={{ color: tooFar ? '#fca5a5' : '#fbbf24', fontSize: '0.82rem' }}>
                    Behind <span style={styles.branchName}>{base}</span> by {n} commit{n === 1 ? '' : 's'} — rebase before merging
                  </span>
                </li>
              )
            })()}

            {/* Approvals — always last */}
            {(() => {
              const REQUIRED = 3
              const count = localApprovalCount
              const ok = count >= REQUIRED
              return (
                <li style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: ok ? '#22c55e' : '#ef4444' }}>
                    {ok ? '✔' : '✖'}
                  </span>
                  <span style={{ color: ok ? '#9ca3af' : '#fca5a5', fontSize: '0.82rem' }}>
                    {ok
                      ? `${count} approvals received`
                      : count === 0
                        ? `Needs ${REQUIRED} approvals`
                        : `Needs ${REQUIRED - count} more approval${REQUIRED - count === 1 ? '' : 's'}`}
                  </span>
                </li>
              )
            })()}
          </ul>
        </div>

        {/* SECTION 3 — COMMENTS */}
        {mr.notes.length > 0 && (
          <div style={styles.section}>
            <span style={styles.sectionLabel}>Comments ({mr.notes.length})</span>
            <div style={styles.noteList}>
              {mr.notes.map((note) => (
                <div key={note.id} style={styles.noteItem}>
                  <div style={styles.noteMeta}>
                    <span style={styles.noteAuthor}>{note.author.name}</span>
                    <span style={styles.noteDate}>
                      {new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p style={styles.noteBody}>{note.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

      </>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#1b1033', border: '1px solid', borderRadius: '10px',
    padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem',
  },
  cardHeader: { display: 'flex', flexDirection: 'column', gap: '0.35rem', cursor: 'pointer' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: '20px', fontSize: '0.74rem', fontWeight: 700, padding: '0.18rem 0.65rem' },
  age: { color: '#8c88ba', fontSize: '0.72rem' },
  titleRow: { display: 'flex', alignItems: 'flex-start', gap: '1rem' },
  titleLeft: { display: 'flex', alignItems: 'flex-start', gap: '0.35rem', flex: 1, minWidth: 0 },
  title: {
    color: '#ddd7ef', fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.4,
    flex: 1, minWidth: 0,
  },
  openMrLink: { color: '#a090de', fontSize: '0.72rem', textDecoration: 'none', flexShrink: 0, marginTop: '0.12rem' },
  titleActions: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: 'auto' },
  chevron: { color: '#8c88ba', fontSize: '0.7rem', userSelect: 'none' as const },
  approvedText: { color: '#ddd7ef', fontSize: '0.73rem', fontWeight: 600, whiteSpace: 'nowrap' as const },
  errorText: { color: '#d94f4f', fontSize: '0.73rem', whiteSpace: 'nowrap' as const },
  approveBtn: {
    borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
    padding: '0.28rem 0.65rem', whiteSpace: 'nowrap' as const,
    background: 'rgba(140,136,186,0.2)', color: '#a090de', border: '1px solid #8c88ba',
  },
  metaRow: { display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' as const },
  author: { color: '#8c88ba', fontSize: '0.75rem', fontWeight: 500 },
  labelChip: {
    background: 'rgba(115,109,164,0.25)', border: '1px solid #6b6698',
    borderRadius: '4px', color: '#a090de',
    fontSize: '0.65rem', fontWeight: 500, padding: '0.06rem 0.38rem',
  },

  // Shared section style (matches MRCard)
  section: {
    background: '#120e23', border: '1px solid #6b6698', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', gap: '0.45rem', padding: '0.8rem 0.95rem',
  },
  sectionLabel: {
    color: '#8c88ba', fontSize: '0.67rem', fontWeight: 700,
    letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: '0.05rem',
  },

  // Description
  noDesc: { color: '#736da4', fontSize: '0.8rem' },
  descGroup: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  descHeading: { color: '#a090de', fontSize: '0.73rem', fontWeight: 700, letterSpacing: '0.04em' },
  descBody: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  bullet: { display: 'flex', alignItems: 'flex-start', gap: '0.4rem' },
  bulletDot: { color: '#8c88ba', flexShrink: 0, fontSize: '0.8rem', marginTop: '0.16rem', lineHeight: 1 },
  bulletText: { color: '#ddd7ef', fontSize: '0.82rem', lineHeight: 1.5 },
  bodyPara: { color: '#ddd7ef', fontSize: '0.82rem', lineHeight: 1.5, margin: 0 },

  // Branch name pill
  branchName: {
    background: 'rgba(115,109,164,0.2)', border: '1px solid #413e74',
    borderRadius: '3px', color: '#a090de',
    fontFamily: 'monospace', fontSize: '0.76rem', padding: '0 0.3rem',
  },

  // Comments / notes
  noteList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  noteItem: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  noteMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  noteAuthor: { color: '#a090de', fontSize: '0.73rem', fontWeight: 600 },
  noteDate: { color: '#736da4', fontSize: '0.7rem' },
  noteBody: { color: '#ddd7ef', fontSize: '0.8rem', lineHeight: 1.55, margin: 0 },

  // Review status (matches MRCard)
  checklist: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.32rem' },
  checkItem: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' },
  checkIcon: { fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, marginTop: '0.05rem', width: '0.9rem' },
}
