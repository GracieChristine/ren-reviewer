// Mirror of server/types.ts — keep in sync

export interface MRAuthor {
  id: number
  name: string
  username: string
}

export interface MRNote {
  id: number
  author: { name: string; username: string }
  body: string
  createdAt: string
}

export interface PackageBump {
  name: string
  fromVersion: string
  toVersion: string
  bumpType: 'patch' | 'minor' | 'major' | 'unknown'
  compareUrl?: string
  repoUrl?: string
}

export interface ChangelogCategory {
  title: string
  items: string[]
}

export interface ChangelogEntry {
  version: string
  categories: ChangelogCategory[]
  body: string
  hasBreakingChange: boolean
  breakingDetails: string[]
  source: 'release' | 'changelog' | 'none' | 'rate-limited'
}

export interface MRVerdict {
  status: 'safe' | 'pending_approval' | 'review' | 'blocked'
  reason: string
  flags: string[]
}

export interface RenovateMR {
  id: number
  iid: number
  title: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  createdAt: string
  /** True when the MR was opened by the Renovate bot */
  isRenovate: boolean
  author: MRAuthor
  /** True when the fetching user is also the MR author (hide Approve button) */
  isAuthoredByCurrentUser: boolean
  /** GitLab labels attached to this MR */
  labels: string[]
  /** Raw MR description (markdown) */
  description: string
  /** Non-system MR comments/notes */
  notes: MRNote[]
  /** How many commits the source branch is behind the target. 0 = up to date. null = GitLab hasn't computed it yet. */
  divergedCommitsCount: number | null
  packages: PackageBump[]
  ciStatus: 'success' | 'failed' | 'running' | 'pending' | 'unknown'
  approvalCount: number
  alreadyApproved: boolean
  changelog: ChangelogEntry[]
  /** True when changelog data is unavailable — either all entries failed (source:'none') or
   *  the package is a private image with no public changelog. Computed once on the server. */
  changelogUnavailable: boolean
  verdict: MRVerdict
}

export interface AnalyzeResponse {
  projectName: string
  fetchedAt: string
  mrs: RenovateMR[]
}

export interface PipelineVar {
  key: string
  value: string
}

export interface PinnedRepo {
  id: string
  label: string
  projectId: string
  /** CI variables to pass when triggering a pipeline from this repo */
  pipelineVars?: PipelineVar[]
}
