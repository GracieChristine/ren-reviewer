import React, { useState, useEffect } from 'react'
import type { ChangelogCategory, RenovateMR } from '../types'
import { usePipelineRun } from '../hooks/usePipelineRun'
import { PipelineButton } from './PipelineButton'

const VERDICT_STYLES = {
  safe:             { border: '#5ecfaa', color: '#5ecfaa', bg: 'rgba(94,207,170,0.12)',   label: '✔ Ready to Merge' },
  pending_approval: { border: '#a0c4ff', color: '#a0c4ff', bg: 'rgba(160,196,255,0.10)', label: '⧗ Needs Approval' },
  review:           { border: '#d4854a', color: '#d4854a', bg: 'rgba(212,133,74,0.12)',  label: '⚠ Needs Manual Review' },
  blocked:          { border: '#d94f4f', color: '#d94f4f', bg: 'rgba(217,79,79,0.12)',   label: '✖ Blocked' },
}

const BUMP_COLOURS: Record<string, string> = {
  patch: '#5ecfaa', minor: '#d4854a', major: '#d94f4f', unknown: '#736da4',
}

const BREAKING_TITLES = ['breaking changes', 'breaking', 'removed', 'major changes', 'major']

/** Map a changelog category title to a theme colour */
function catColor(title: string): string {
  const t = title.toLowerCase()
  if (t.includes('bug') || t.includes('fix') || t.includes('patch'))          return '#5ecece'
  if (t.includes('improve') || t.includes('enhance') || t.includes('perf'))   return '#c9a84c'
  if (t.includes('feat') || t.includes('new') || t.includes('add'))           return '#d966a8'
  if (t.includes('deprecat'))                                                  return '#d4854a'
  if (t.includes('security'))                                                  return '#d94f4f'
  if (t.includes('major') || t.includes('breaking'))                           return '#d94f4f'
  if (t.includes('change') || t.includes('update') || t.includes('notable'))  return '#a090de'
  return '#8c88ba' // default muted
}

/** Truncate title and insert zero-width spaces after - / . so the browser
 *  can wrap at those points within the fixed-width title column. */
function wrapTitle(title: string): string {
  const t = title.length > 120 ? title.slice(0, 120) + '…' : title
  // ​ = zero-width space — invisible but gives the browser a wrap opportunity after delimiters
  return t.replace(/[./\-]/g, (ch) => ch + '​')
}

type ApproveStatus = 'idle' | 'approving' | 'approved' | 'already' | 'error'

interface CheckItem {
  label: string
  status: 'ok' | 'warn' | 'fail'
}

interface RepoScanResult {
  importedIn: string[]
  breakingHits: { keyword: string; files: string[] }[]
}

interface Props {
  mr: RenovateMR
  token: string
  projectId: string
  pipelineVars: { key: string; value: string }[]
  isExpanded: boolean
  onToggle: () => void
}

/** Build a ✔/⚠/✖ checklist from the MR data — positive items included */
function buildChecklist(mr: RenovateMR): CheckItem[] {
  const items: CheckItem[] = []

  // CI
  const ciMap: Record<RenovateMR['ciStatus'], CheckItem> = {
    success: { label: 'CI passed',          status: 'ok' },
    failed:  { label: 'CI failed',           status: 'fail' },
    running: { label: 'CI running',          status: 'warn' },
    pending: { label: 'CI pending',          status: 'warn' },
    unknown: { label: 'CI status unknown',   status: 'warn' },
  }
  items.push(ciMap[mr.ciStatus])

  // Bump type
  const hasMajor = mr.packages.some((p) => p.bumpType === 'major')
  const hasMinor = mr.packages.some((p) => p.bumpType === 'minor')
  if (hasMajor) {
    items.push({ label: 'Major bump — check migration guide', status: 'fail' })
  } else if (hasMinor) {
    const isClean = mr.verdict.status === 'safe' || mr.verdict.status === 'pending_approval'
    items.push({
      label: isClean ? 'Minor bump — no issues found' : 'Minor bump — manual review recommended',
      status: isClean ? 'ok' : 'warn',
    })
  } else {
    items.push({ label: 'Patch bump', status: 'ok' })
  }

  // Breaking changes — use the server-computed flag so the logic lives in one place
  const hasBreaking = mr.changelog.some((e) => e.hasBreakingChange)
  const { changelogUnavailable } = mr

  if (hasBreaking) {
    const details = mr.changelog.flatMap((e) => e.breakingDetails).slice(0, 2)
    for (const d of details) items.push({ label: `Breaking: ${d}`, status: 'fail' })
    if (details.length === 0) items.push({ label: 'Breaking change keyword in changelog', status: 'fail' })
  } else if (mr.changelog.some((e) => e.source === 'rate-limited')) {
    const msg = mr.changelog.find((e) => e.source === 'rate-limited')?.body ?? 'GitHub rate limit hit'
    items.push({ label: `⏱ ${msg}`, status: 'warn' })
  } else if (changelogUnavailable) {
    items.push({ label: 'No changelog available', status: 'warn' })
  } else {
    items.push({ label: 'No breaking changes detected', status: 'ok' })
  }

  // Deprecations
  const hasDeprecation = mr.changelog.some((e) =>
    e.categories.some((c) => c.title.toLowerCase().includes('deprecat')) ||
    e.body.toLowerCase().includes('deprecated')
  )
  if (hasDeprecation) items.push({ label: 'Deprecations in changelog', status: 'warn' })

  // Grouped update — informational only, not a warning
  if (mr.packages.length > 1) {
    items.push({ label: `Grouped update — ${mr.packages.length} packages`, status: 'ok' })
  }

  // Approvals rendered separately after repo-scan items so it stays last

  return items
}

/** Aggregate categories across all changelog versions, deduplicating by title */
function aggregateCategories(mr: RenovateMR): ChangelogCategory[] {
  const map = new Map<string, Set<string>>()
  for (const entry of mr.changelog) {
    for (const cat of entry.categories) {
      if (!map.has(cat.title)) map.set(cat.title, new Set())
      for (const item of cat.items) map.get(cat.title)!.add(item)
    }
  }
  return [...map.entries()].map(([title, itemSet]) => ({ title, items: [...itemSet] }))
}

export function MRCard({ mr, token, projectId, pipelineVars, isExpanded, onToggle }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [packagesExpanded, setPackagesExpanded] = useState(false)
  const [approveStatus, setApproveStatus] = useState<ApproveStatus>('idle')
  const [approveError, setApproveError] = useState('')
  const [localApprovalCount, setLocalApprovalCount] = useState(mr.approvalCount)
  const [repoScan, setRepoScan] = useState<RepoScanResult | 'loading' | 'error' | null>(null)
  const pipeline = usePipelineRun(token, projectId, mr.sourceBranch, pipelineVars)

  const hasBreaking = mr.changelog.some((e) => e.hasBreakingChange)
  const allBreakingDetails = mr.changelog.flatMap((e) => e.breakingDetails)

  // Run repo scan on mount for all packages (skip unnamed ones from grouped updates)
  useEffect(() => {
    const firstNamedPkg = mr.packages.find((p) => p.name)
    if (!token || !projectId || !firstNamedPkg) return
    setRepoScan('loading')
    fetch('/api/repo-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gitlabToken: token,
        projectId,
        packageName: firstNamedPkg.name,
        breakingDetails: hasBreaking ? allBreakingDetails : [],
      }),
    })
      .then((r) => r.json())
      .then((data: RepoScanResult) => setRepoScan(data))
      .catch(() => setRepoScan('error'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mr.iid])

  const v = VERDICT_STYLES[mr.verdict.status]
  const age = Math.floor((Date.now() - new Date(mr.createdAt).getTime()) / 86_400_000)
  const checklist = buildChecklist(mr)
  const allCategories = aggregateCategories(mr)
  const breakingCats = allCategories.filter((c) =>
    BREAKING_TITLES.some((t) => c.title.toLowerCase().includes(t))
  )
  const regularCats = allCategories.filter(
    (c) => !BREAKING_TITLES.some((t) => c.title.toLowerCase().includes(t))
  )

  // Approve is only allowed when the only non-green items are the approval count
  // and/or "minor bump — manual review recommended". Hard blockers disable it.
  const canApprove = (() => {
    if (mr.ciStatus === 'failed') return false
    if (mr.packages.some((p) => p.bumpType === 'major')) return false
    if (mr.changelog.some((e) => e.hasBreakingChange)) return false
    if (mr.divergedCommitsCount !== null && mr.divergedCommitsCount > 0) return false
    return true
  })()

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

  return (
    <div style={{ ...styles.card, borderColor: v.border }}>

      {/* ── Clickable header (always visible) ── */}
      <div style={styles.cardHeader} onClick={onToggle} role="button" aria-expanded={isExpanded}>

        {/* Top bar: verdict badge + age */}
        <div style={styles.topBar}>
          <span style={{ ...styles.badge, background: v.bg, border: `1px solid ${v.color}`, color: v.color }}>{v.label}</span>
          <span style={styles.age}>{age}d old</span>
        </div>

        {/* Title row: title text (expands card) + open-MR icon + approve + chevron */}
        <div style={styles.titleRow}>
          <div style={styles.titleLeft}>
            <span style={styles.title} title={mr.title.length > 120 ? mr.title : undefined}>
              {wrapTitle(mr.title)}
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

            {/* Already approved at load time — show text only */}
            {mr.alreadyApproved && (
              <span style={styles.approvedText}>✔ Approved</span>
            )}

            {/* Approve button — always shown when not already approved, disabled once clicked */}
            {!mr.alreadyApproved && (() => {
              const isDone = approveStatus === 'approved' || approveStatus === 'already'
              const isWorking = approveStatus === 'approving'
              const isDisabled = isDone || isWorking || !canApprove
              const disabledTitle = isDone
                ? 'Already approved'
                : !canApprove
                ? 'Resolve blocking issues before approving'
                : undefined
              return (
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
                    title={disabledTitle}
                  >
                    {isDone ? '✔ Approved' : isWorking ? 'Approving…' : 'Approve'}
                  </button>
                </>
              )
            })()}
            <PipelineButton pipeline={pipeline} disabled={pipelineVars.length === 0} />
            <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Author tag + GitLab labels */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={styles.authorTag}>{mr.author.name}</span>
          {mr.labels.map((label) => (
            <span key={label} style={styles.labelChip}>{label}</span>
          ))}
        </div>
      </div>

      {/* ── Collapsible body ── */}
      {isExpanded && <>

      {/* ════════════════════════════════════════
          SECTION 1 — WHAT CHANGED
      ════════════════════════════════════════ */}
      <div style={styles.section}>
        <span style={styles.sectionLabel}>What Changed</span>

        {/* Fallback when package parsing found nothing */}
        {mr.packages.length === 0 && (
          <span style={styles.noData}>
            Could not determine package versions from this MR — <a href={mr.webUrl} target="_blank" rel="noreferrer" style={{ color: '#a090de' }}>open MR ↗</a>
          </span>
        )}

        {/* Package version rows — collapse to first 3 for grouped MRs */}
        {(() => {
          const SHOW_MAX = 3
          const pkgsToShow = packagesExpanded || mr.packages.length <= SHOW_MAX
            ? mr.packages
            : mr.packages.slice(0, SHOW_MAX)
          const hiddenCount = mr.packages.length - SHOW_MAX
          return (
            <>
              {pkgsToShow.map((pkg, i) => (
                <div key={i} style={styles.pkgRow}>
                  {pkg.repoUrl
                    ? <a href={pkg.repoUrl} target="_blank" rel="noreferrer" style={styles.pkgLink}>{pkg.name || 'package'}</a>
                    : <span style={styles.pkgName}>{pkg.name || 'package'}</span>
                  }
                  <span style={styles.fromVer}>{pkg.fromVersion === 'unknown' ? '?' : pkg.fromVersion}</span>
                  <span style={styles.arrow}>→</span>
                  <span style={{ color: BUMP_COLOURS[pkg.bumpType] ?? '#94a3b8', fontWeight: 700, fontSize: '0.85rem' }}>
                    {pkg.toVersion}
                  </span>
                  {pkg.bumpType !== 'unknown' && (
                    <span style={{ ...styles.bumpBadge, color: BUMP_COLOURS[pkg.bumpType], borderColor: BUMP_COLOURS[pkg.bumpType] }}>
                      {pkg.bumpType}
                    </span>
                  )}
                  {pkg.compareUrl && (
                    <a href={pkg.compareUrl} target="_blank" rel="noreferrer" style={styles.diffLink}>
                      view diff ↗
                    </a>
                  )}
                </div>
              ))}
              {mr.packages.length > SHOW_MAX && (
                <button style={styles.detailBtn} onClick={() => setPackagesExpanded(!packagesExpanded)}>
                  {packagesExpanded ? 'Show fewer ▲' : `+${hiddenCount} more packages ▼`}
                </button>
              )}
            </>
          )
        })()}

        {/* Breaking changes — always visible */}
        {breakingCats.map((cat, i) => (
          <div key={i} style={styles.breakingBlock}>
            <span style={styles.breakingLabel}>⚠ {cat.title}</span>
            {cat.items.map((item, j) => (
              <div key={j} style={styles.bulletRow}>
                <span style={{ ...styles.bulletDot, color: '#fca5a5' }}>•</span>
                <span style={styles.breakingItem}>{item}</span>
              </div>
            ))}
          </div>
        ))}

        {/* Regular changes — both preview and expanded use the same deduped regularCats */}
        {regularCats.length > 0 && (() => {
          // Flat deduped list — same source as expanded, so counts always match
          const allItems = regularCats.flatMap((cat) =>
            cat.items.map((text) => ({ cat: cat.title, text }))
          )
          const PREVIEW_COUNT = 4
          const previewItems = allItems.slice(0, PREVIEW_COUNT)
          const hiddenCount = allItems.length - PREVIEW_COUNT

          return (
            <>
              {/* Collapsed: group preview bullets under category headers — same style as expanded */}
              {!detailsOpen && (() => {
                // Group consecutive preview items by category
                const groups: { cat: string; items: string[] }[] = []
                for (const item of previewItems) {
                  if (groups.length === 0 || groups[groups.length - 1].cat !== item.cat) {
                    groups.push({ cat: item.cat, items: [item.text] })
                  } else {
                    groups[groups.length - 1].items.push(item.text)
                  }
                }
                return groups.map((group, i) => (
                  <div key={i} style={styles.categoryBlock}>
                    <span style={{ ...styles.categoryTitle, color: catColor(group.cat) }}>{group.cat}</span>
                    {group.items.map((text, j) => (
                      <div key={j} style={styles.bulletRow}>
                        <span style={styles.bulletDot}>•</span>
                        <span style={styles.bulletText}>{text}</span>
                      </div>
                    ))}
                  </div>
                ))
              })()}

              {/* Expanded: all deduped items grouped by category */}
              {detailsOpen && regularCats.map((cat, i) => (
                <div key={i} style={styles.categoryBlock}>
                  <span style={{ ...styles.categoryTitle, color: catColor(cat.title) }}>{cat.title}</span>
                  {cat.items.map((item, k) => (
                    <div key={k} style={styles.bulletRow}>
                      <span style={styles.bulletDot}>•</span>
                      <span style={styles.bulletText}>{item}</span>
                    </div>
                  ))}
                </div>
              ))}

              <button style={styles.detailBtn} onClick={() => setDetailsOpen(!detailsOpen)}>
                {detailsOpen
                  ? 'Show less ▲'
                  : hiddenCount > 0
                    ? `+${hiddenCount} more — Show all ▼`
                    : 'Show all ▼'}
              </button>
            </>
          )
        })()}

        {/* Fallback: when no structured categories could be parsed */}
        {allCategories.length === 0 && mr.changelog.length > 0 && (() => {
          const compareUrl = mr.packages[0]?.compareUrl
          // source:'none' entries only have a generated fallback message — not real release notes.
          // Only treat body as real content when it came from an actual release or changelog file.
          const hasRealNotes = mr.changelog.some(
            (e) => e.source !== 'none' && e.body && e.body.trim().length > 10
          )
          return (
            <>
              {hasRealNotes ? (
                <>
                  <button style={styles.detailBtn} onClick={() => setDetailsOpen(!detailsOpen)}>
                    {detailsOpen ? 'Hide release notes ▲' : 'Show release notes ▼'}
                  </button>
                  {detailsOpen && mr.changelog
                    .filter((e) => e.source !== 'none' && e.body)
                    .slice(0, 3)
                    .map((entry, i) => (
                      <pre key={i} style={styles.rawBody}>{entry.body}</pre>
                    ))}
                </>
              ) : null}
              {compareUrl ? (
                <a href={compareUrl} target="_blank" rel="noreferrer" style={styles.compareLink}>
                  View all changes on GitHub ↗
                </a>
              ) : !hasRealNotes ? (
                <span style={styles.noData}>No changelog data available for this package.</span>
              ) : null}
            </>
          )
        })()}

        {allCategories.length === 0 && mr.changelog.length === 0 && (() => {
          const name = mr.packages[0]?.name ?? ''
          const isPrivate = name.includes('$') || /\.(amazonaws|azurecr|gcr|jfrog)\.io/.test(name)
          return (
            <span style={styles.noData}>
              {isPrivate
                ? 'Private registry image — no public changelog. CI result is the signal here.'
                : 'No changelog data found for this version range.'}
            </span>
          )
        })()}
      </div>

      {/* ════════════════════════════════════════
          SECTION 2 — REVIEW STATUS
      ════════════════════════════════════════ */}
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

          {/* Repo impact scan — runs asynchronously */}
          {repoScan === 'loading' && (
            <li style={styles.checkItem}>
              <span style={{ ...styles.checkIcon, color: '#736da4' }}>·</span>
              <span style={{ color: '#736da4', fontSize: '0.82rem' }}>Scanning repo for package usage…</span>
            </li>
          )}
          {repoScan === 'error' && (
            <li style={styles.checkItem}>
              <span style={{ ...styles.checkIcon, color: '#736da4' }}>·</span>
              <span style={{ color: '#736da4', fontSize: '0.82rem' }}>Repo scan unavailable</span>
            </li>
          )}
          {typeof repoScan === 'object' && repoScan !== null && (() => {
            const { importedIn, breakingHits } = repoScan
            const isUsed = importedIn.length > 0

            const items: React.ReactNode[] = []

            // Usage check
            if (!isUsed) {
              items.push(
                <li key="usage" style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: '#22c55e' }}>✔</span>
                  <span style={{ color: '#9ca3af', fontSize: '0.82rem' }}>
                    Not found in repo code — no impact expected
                  </span>
                </li>
              )
            } else {
              const fileLabel = importedIn.slice(0, 2).join(', ')
              items.push(
                <li key="usage" style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: hasBreaking ? '#f59e0b' : '#22c55e' }}>
                    {hasBreaking ? '⚠' : '✔'}
                  </span>
                  <span style={{ color: hasBreaking ? '#fbbf24' : '#9ca3af', fontSize: '0.82rem' }}>
                    {hasBreaking
                      ? `Package in use — verify breaking changes apply`
                      : `Package in use (${fileLabel}${importedIn.length > 2 ? ', …' : ''})`}
                  </span>
                </li>
              )
            }

            // Breaking API usages in codebase
            for (const hit of breakingHits) {
              items.push(
                <li key={hit.keyword} style={styles.checkItem}>
                  <span style={{ ...styles.checkIcon, color: '#ef4444' }}>✖</span>
                  <span style={{ color: '#fca5a5', fontSize: '0.82rem' }}>
                    <strong>{hit.keyword}</strong> in {hit.files.slice(0, 2).join(', ')} — may break
                  </span>
                </li>
              )
            }

            return <>{items}</>
          })()}

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

          {/* Approvals — always last in the list */}
          {(() => {
            const REQUIRED_APPROVALS = 3
            const count = localApprovalCount
            const isSatisfied = count >= REQUIRED_APPROVALS
            const iconColor = isSatisfied ? '#22c55e' : '#ef4444'
            const textColor = isSatisfied ? '#9ca3af' : '#fca5a5'
            const icon = isSatisfied ? '✔' : '✖'
            const label = isSatisfied
              ? `${count} approvals received`
              : count === 0
                ? `Needs ${REQUIRED_APPROVALS} approvals`
                : `Needs ${REQUIRED_APPROVALS - count} more approval${REQUIRED_APPROVALS - count === 1 ? '' : 's'}`
            return (
              <li style={styles.checkItem}>
                <span style={{ ...styles.checkIcon, color: iconColor }}>{icon}</span>
                <span style={{ color: textColor, fontSize: '0.82rem' }}>{label}</span>
              </li>
            )
          })()}
        </ul>
      </div>

      {/* ════════════════════════════════════════
          SECTION 3 — COMMENTS
      ════════════════════════════════════════ */}
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

      {/* ── Approve button — outside sections ── */}
      </> /* end collapsible body */}

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#1b1033', border: '1px solid', borderRadius: '10px',
    padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem',
  },
  // Clickable header
  cardHeader: { display: 'flex', flexDirection: 'column', gap: '0.35rem', cursor: 'pointer' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: '20px', fontSize: '0.74rem', fontWeight: 700, padding: '0.18rem 0.65rem' },
  age: { color: '#8c88ba', fontSize: '0.72rem' },
  titleRow: { display: 'flex', alignItems: 'flex-start', gap: '1rem' },
  titleLeft: { display: 'flex', alignItems: 'flex-start', gap: '0.35rem', flex: '0 0 42ch' },
  title: {
    color: '#ddd7ef', fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.4,
    flex: 1, minWidth: 0,
    textAlign: 'justify' as const,
    textAlignLast: 'left' as const,
  },
  openMrLink: { color: '#a090de', fontSize: '0.72rem', textDecoration: 'none', flexShrink: 0, marginTop: '0.12rem' },
  titleActions: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: 'auto' },
  chevron: { color: '#8c88ba', fontSize: '0.7rem', userSelect: 'none' as const },
  authorTag: { color: '#8c88ba', fontSize: '0.73rem', fontWeight: 500 },

  section: {
    background: '#120e23', border: '1px solid #6b6698', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', gap: '0.45rem', padding: '0.8rem 0.95rem',
  },
  sectionLabel: {
    color: '#8c88ba', fontSize: '0.67rem', fontWeight: 700,
    letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.05rem',
  },

  // Checklist
  checklist: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.32rem' },
  checkItem: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' },
  checkIcon: { fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, marginTop: '0.05rem', width: '0.9rem' },

  // Package row
  pkgRow: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' },
  pkgName: { color: '#d966a8', fontWeight: 700, fontSize: '0.88rem' },
  pkgLink: { color: '#d966a8', textDecoration: 'none', fontWeight: 700, fontSize: '0.88rem' },
  fromVer: { color: '#8c88ba', fontSize: '0.83rem' },
  arrow: { color: '#8c88ba', fontSize: '0.83rem' },
  bumpBadge: {
    border: '1px solid', borderRadius: '4px',
    fontSize: '0.62rem', fontWeight: 700, padding: '0.03rem 0.3rem', textTransform: 'uppercase',
  },
  diffLink: { color: '#8c88ba', fontSize: '0.73rem', marginLeft: '0.2rem', textDecoration: 'none' },
  morePackagesLink: { color: '#8c88ba', fontSize: '0.75rem', textDecoration: 'none' },

  // Branch name pill
  branchName: {
    background: 'rgba(115,109,164,0.2)', border: '1px solid #413e74',
    borderRadius: '3px', color: '#a090de',
    fontFamily: 'monospace', fontSize: '0.76rem', padding: '0 0.3rem',
  },

  // Breaking
  breakingBlock: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  breakingLabel: { color: '#e8a0a0', fontSize: '0.76rem', fontWeight: 700 },
  breakingItem: { color: '#e8a0a0', fontSize: '0.8rem', lineHeight: 1.45 },

  // Stat chips
  statLine: { display: 'flex', flexWrap: 'wrap' as const, gap: '0.28rem', alignItems: 'center', marginBottom: '0.1rem' },
  statChip: { background: '#413e74', borderRadius: '4px', color: '#8c88ba', fontSize: '0.67rem', fontWeight: 600, padding: '0.08rem 0.4rem' },

  // Bullet items
  bulletRow: { display: 'flex', alignItems: 'flex-start', gap: '0.4rem' },
  bulletDot: { color: '#8c88ba', flexShrink: 0, fontSize: '0.8rem', marginTop: '0.16rem', lineHeight: 1 },
  bulletText: { color: '#ddd7ef', fontSize: '0.8rem', lineHeight: 1.5 },

  // Preview label
  previewCat: { color: '#8c88ba', fontSize: '0.73rem', fontWeight: 600 },
  previewText: { color: '#ddd7ef', fontSize: '0.8rem' },

  // Expand button
  detailBtn: { background: 'transparent', border: 'none', color: '#8c88ba', cursor: 'pointer', fontSize: '0.75rem', padding: 0, marginTop: '0.2rem', textAlign: 'left' as const },

  // Per-version block (expanded)
  versionBlock: { display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingTop: '0.35rem' },
  versionHeader: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  versionTag: { color: '#736da4', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, letterSpacing: '0.03em' },
  versionRule: { flex: 1, height: '1px', background: '#413e74' },

  // Category within a version
  categoryBlock: { display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingLeft: '0.5rem' },
  categoryTitle: { color: '#8c88ba', fontSize: '0.7rem', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '0.04rem' },
  rawBody: {
    color: '#8c88ba', fontSize: '0.75rem', lineHeight: 1.6,
    margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
  },
  changelogSummary: { color: '#8c88ba', fontSize: '0.8rem', margin: 0, lineHeight: 1.5 },
  noData: { color: '#8c88ba', fontSize: '0.79rem' },
  compareLink: { color: '#a090de', fontSize: '0.79rem', textDecoration: 'none' },

  // GitLab labels
  labelRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '0.3rem', marginTop: '0.05rem' },
  labelChip: {
    background: 'rgba(115,109,164,0.25)',
    border: '1px solid #6b6698',
    borderRadius: '4px',
    color: '#a090de',
    fontSize: '0.65rem',
    fontWeight: 500,
    padding: '0.06rem 0.38rem',
  },

  // Comments / notes
  noteList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  noteItem: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  noteMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  noteAuthor: { color: '#a090de', fontSize: '0.73rem', fontWeight: 600 },
  noteDate: { color: '#736da4', fontSize: '0.7rem' },
  noteBody: { color: '#ddd7ef', fontSize: '0.8rem', lineHeight: 1.55, margin: 0 },

  // Approve button — neutral, single style regardless of verdict
  approveBtn: {
    borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
    padding: '0.28rem 0.65rem', whiteSpace: 'nowrap' as const,
    background: 'rgba(140,136,186,0.2)', color: '#a090de', border: '1px solid #8c88ba',
  },
  approvedText: { color: '#ddd7ef', fontSize: '0.73rem', fontWeight: 600, whiteSpace: 'nowrap' as const },
  errorText: { color: '#d94f4f', fontSize: '0.73rem', whiteSpace: 'nowrap' as const },
  mutedText: { color: '#736da4', fontSize: '0.73rem' },
}
