import axios from 'axios'
import type { MRNote, PackageBump, RenovateMR } from '../types'

const GITLAB_BASE = 'https://gitlab.com/api/v4'

// Version pattern: optional v prefix, semver core, optional multi-part pre-release suffix
// Captures: v24.18.0-alpine-build-1102, 1.44.0, 2.0.0-beta.1, etc.
const VERSION_RE = /v?([\d]+\.[\d]+\.[\d]+(?:[\w.-]*)?)/

/** Parse a single-package Renovate MR title.
 *  Handles formats like:
 *  - "chore(deps): update dependency @playwright/test from 1.44.0 to 1.45.0"
 *  - "chore(deps): update @playwright/test to v1.45.0"  (no "from" clause)
 *  - "Update docker tag node to v24.19.0-alpine-build-1163"
 */
function parseSingleTitle(title: string): PackageBump | null {
  // Full "from X to Y" format
  const fullMatch = title.match(
    new RegExp(
      `update\\s+(?:dependency\\s+|dev\\s+dependency\\s+|docker\\s+(?:tag\\s+|image\\s+)?)?(.+?)\\s+from\\s+${VERSION_RE.source}\\s+to\\s+${VERSION_RE.source}`,
      'i'
    )
  )
  if (fullMatch) return buildBump(fullMatch[1].trim(), fullMatch[2], fullMatch[3])

  // "to vX.Y.Z" only (no from version in title)
  const toOnlyMatch = title.match(
    new RegExp(
      `update\\s+(?:dependency\\s+|dev\\s+dependency\\s+|docker\\s+(?:tag\\s+|image\\s+)?)?(.+?)\\s+to\\s+${VERSION_RE.source}`,
      'i'
    )
  )
  if (toOnlyMatch) {
    return buildBump(toOnlyMatch[1].trim(), 'unknown', toOnlyMatch[2])
  }

  return null
}

/** Parse the MR description body for version info and grouped updates.
 *  Works line-by-line so it handles many Renovate table variants:
 *  - | [`pkg`](url) | [`1.0.0` -> `2.0.0`](compare) |
 *  - | pkg | 1.0.0 → 2.0.0 |
 *  - | [`pkg`](url) | `1.0.0` → `2.0.0` | age | adoption |   (multi-column)
 */
function parseDescription(body: string): PackageBump[] {
  const bumps: PackageBump[] = []

  for (const line of body.split('\n')) {
    // Must be a table row with at least two cells and a version arrow
    if (!line.includes('|')) continue
    if (/^[\s|:\-=]+$/.test(line)) continue
    if (!line.includes('->') && !line.includes('→')) continue

    // Extract the from→to version pair from anywhere in the line.
    // Handles: `v24.18.0-alpine-build-1102` -> `v24.19.0...` (backtick comes BEFORE v)
    const arrowMatch = line.match(
      /`?v?([\d]+\.[\d]+\.[\d]+[\w.-]*)`?\s*(?:→|->)\s*`?v?([\d]+\.[\d]+\.[\d]+[\w.-]*)`?/
    )
    if (!arrowMatch) continue
    const fromVer = arrowMatch[1]
    const toVer = arrowMatch[2]

    // Package name is in the first non-empty cell
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 2) continue

    const rawName = cells[0]
    // Strip markdown: [`@scope/name`](url) or [name](url) or `name`
    // then parenthetical notes like "(source)" that Renovate appends
    const stripped = rawName
      .replace(/\[`([^\]]+)`\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s*\([^)]*\)/g, '')   // remove any remaining (…) like "(source)"
      .trim()
    // Extract just the npm package name portion (scoped or plain)
    const name = stripped.match(/^(@[\w-]+\/[\w.-]+|[\w][\w.-]*)/)?.[0] ?? stripped

    if (
      !name ||
      name.toLowerCase() === 'package' ||
      name.toLowerCase() === 'dependency' ||
      /^[-=|:\s]+$/.test(name)
    ) continue

    bumps.push(buildBump(name, fromVer, toVer))
  }

  if (bumps.length > 0) return bumps

  // Fallback: list format "- @foo/bar: 1.0.0 → 1.1.0"
  let m: RegExpExecArray | null
  const listRe = /-\s+([^\s:]+):\s*([\d.]+)\s*(?:→|->)\s*([\d.]+)/g
  while ((m = listRe.exec(body)) !== null) {
    bumps.push(buildBump(m[1].trim(), m[2], m[3]))
  }
  if (bumps.length > 0) return bumps

  // Last resort: "from X to Y" anywhere in the body
  const inlineMatch = body.match(/from\s+v?([\d.]+(?:-[\w.]+)?)\s+to\s+v?([\d.]+(?:-[\w.]+)?)/)
  if (inlineMatch) {
    return [{ name: '', fromVersion: inlineMatch[1], toVersion: inlineMatch[2], bumpType: 'unknown' }]
  }

  return []
}

/** Extract [major, minor, patch] from a version string, ignoring pre-release suffixes.
 *  Works for "1.2.3", "v24.18.0-alpine-build-1102", "2.0.0-beta.1", etc. */
function semverParts(v: string): [number, number, number] {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : [0, 0, 0]
}

function buildBump(name: string, from: string, to: string): PackageBump {
  let bumpType: PackageBump['bumpType'] = 'unknown'
  if (from !== 'unknown') {
    const [fMaj, fMin] = semverParts(from)
    const [tMaj, tMin] = semverParts(to)
    if (fMaj !== tMaj) bumpType = 'major'
    else if (fMin !== tMin) bumpType = 'minor'
    else bumpType = 'patch'
  }
  return { name, fromVersion: from, toVersion: to, bumpType }
}

/** Fetch all open MRs for a project (both Renovate and human-authored). */
export async function fetchAllMRs(
  token: string,
  projectPath: string
): Promise<Omit<RenovateMR, 'changelog' | 'changelogUnavailable' | 'verdict'>[]> {
  const encodedPath = encodeURIComponent(projectPath)
  const headers = { 'PRIVATE-TOKEN': token }

  // Fetch current user ID once — used for self-approval detection and author check
  const currentUserId = await fetchCurrentUserId(token)

  const response = await axios.get(
    `${GITLAB_BASE}/projects/${encodedPath}/merge_requests`,
    {
      headers,
      params: {
        state: 'opened', per_page: 100, order_by: 'created_at', sort: 'desc',
        include_diverged_commits_count: true,
      },
    }
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMRs: any[] = response.data

  // Fetch CI status and approvals for every MR concurrently
  const withCi = await Promise.all(
    allMRs.map(async (mr) => {
      const isRenovate =
        (mr.author?.username ?? '').toLowerCase().includes('renovate') ||
        (mr.source_branch ?? '').startsWith('renovate/')

      const [ciStatus, approvals, notes, divergedCommitsCount] = await Promise.all([
        fetchCiStatus(token, encodedPath, mr),
        fetchApprovals(token, encodedPath, mr.iid, currentUserId),
        fetchMRNotes(token, encodedPath, mr.iid),
        fetchDivergedCount(token, encodedPath, mr.iid),
      ])
      const { approvalCount, alreadyApproved } = approvals

      const isAuthoredByCurrentUser =
        currentUserId !== null && mr.author?.id === currentUserId

      // Package parsing only meaningful for Renovate MRs, but runs harmlessly for others
      const descBumps = isRenovate ? parseDescription(mr.description ?? '') : []
      let packages: PackageBump[]

      if (descBumps.length > 0) {
        packages = descBumps
      } else if (isRenovate) {
        const singleBump = parseSingleTitle(mr.title)
        packages = singleBump
          ? [{ ...singleBump, name: singleBump.name || extractPackageName(mr.title) }]
          : []
      } else {
        packages = []
      }

      const author = {
        id: mr.author?.id ?? 0,
        name: mr.author?.name ?? 'Unknown',
        username: mr.author?.username ?? 'unknown',
      }

      return {
        id: mr.id,
        iid: mr.iid,
        title: mr.title,
        webUrl: mr.web_url,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch ?? 'main',
        createdAt: mr.created_at,
        isRenovate,
        author,
        isAuthoredByCurrentUser,
        labels: Array.isArray(mr.labels) ? mr.labels : [],
        description: mr.description ?? '',
        notes,
        divergedCommitsCount,
        packages,
        ciStatus,
        approvalCount,
        alreadyApproved,
      }
    })
  )

  return withCi
}

/** @deprecated Use fetchAllMRs instead */
export const fetchRenovateMRs = fetchAllMRs

/** Fetch how many commits the source branch is behind the target.
 *  Uses the individual MR endpoint with include_diverged_commits_count=true,
 *  which forces GitLab to compute the value (the list endpoint often returns null). */
async function fetchDivergedCount(
  token: string,
  encodedPath: string,
  iid: number
): Promise<number | null> {
  try {
    const { data } = await axios.get(
      `${GITLAB_BASE}/projects/${encodedPath}/merge_requests/${iid}`,
      {
        headers: { 'PRIVATE-TOKEN': token },
        params: { include_diverged_commits_count: true },
        timeout: 5000,
      }
    )
    return typeof data.diverged_commits_count === 'number' ? data.diverged_commits_count : null
  } catch {
    return null
  }
}

/** Fetch non-system notes (comments) for an MR. */
async function fetchMRNotes(
  token: string,
  encodedPath: string,
  iid: number
): Promise<MRNote[]> {
  try {
    const { data } = await axios.get(
      `${GITLAB_BASE}/projects/${encodedPath}/merge_requests/${iid}/notes`,
      {
        headers: { 'PRIVATE-TOKEN': token },
        params: { per_page: 100, sort: 'asc' },
        timeout: 5000,
      }
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[])
      .filter((n) => !n.system && n.body?.trim())
      .map((n) => ({
        id: n.id,
        author: { name: n.author?.name ?? 'Unknown', username: n.author?.username ?? '' },
        body: n.body.trim(),
        createdAt: n.created_at,
      }))
  } catch {
    return []
  }
}

/** Fetch the current user's GitLab ID. Returns null on error. */
async function fetchCurrentUserId(token: string): Promise<number | null> {
  try {
    const { data } = await axios.get(`${GITLAB_BASE}/user`, {
      headers: { 'PRIVATE-TOKEN': token },
      timeout: 5000,
    })
    return data.id ?? null
  } catch {
    return null
  }
}

/** Fetch approval info for an MR — count and whether the current user already approved. */
async function fetchApprovals(
  token: string,
  encodedPath: string,
  iid: number,
  currentUserId: number | null
): Promise<{ approvalCount: number; alreadyApproved: boolean }> {
  try {
    const { data } = await axios.get(
      `${GITLAB_BASE}/projects/${encodedPath}/merge_requests/${iid}/approvals`,
      { headers: { 'PRIVATE-TOKEN': token }, timeout: 5000 }
    )
    const approvedBy: { user: { id: number } }[] = data.approved_by ?? []
    const approvalCount = approvedBy.length
    const alreadyApproved =
      currentUserId !== null && approvedBy.some((a) => a.user.id === currentUserId)
    return { approvalCount, alreadyApproved }
  } catch {
    return { approvalCount: 0, alreadyApproved: false }
  }
}

/** Fetch the latest CI pipeline status for an MR.
 *  Falls back to the pipelines list endpoint if head_pipeline is missing. */
async function fetchCiStatus(
  token: string,
  encodedPath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mr: any
): Promise<RenovateMR['ciStatus']> {
  // head_pipeline is included in the MR object when available
  if (mr.head_pipeline?.status) {
    return mapCiStatus(mr.head_pipeline.status)
  }

  // Fall back to the pipelines endpoint
  try {
    const { data: pipelines } = await axios.get(
      `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mr.iid}/pipelines`,
      {
        headers: { 'PRIVATE-TOKEN': token },
        params: { per_page: 1 },
        timeout: 5000,
      }
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latest = (pipelines as any[])[0]
    return mapCiStatus(latest?.status)
  } catch {
    return 'unknown'
  }
}

function extractPackageName(title: string): string {
  const m = title.match(/update\s+(?:dependency\s+)?(.+?)\s+to\s+v/i)
  return m ? m[1].trim() : title
}

function mapCiStatus(status: string | undefined): RenovateMR['ciStatus'] {
  switch (status) {
    case 'success': return 'success'
    case 'failed':
    case 'canceled': return 'failed'
    case 'running': return 'running'
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
      return 'pending'
    default: return 'unknown'
  }
}
