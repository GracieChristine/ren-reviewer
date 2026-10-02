import type { ChangelogEntry, MRVerdict, PackageBump, RenovateMR } from '../types'

const REQUIRED_APPROVALS = 3

export function deriveVerdict(
  ciStatus: RenovateMR['ciStatus'],
  packages: PackageBump[],
  changelog: ChangelogEntry[],
  changelogUnavailable: boolean,
  divergedCommitsCount: number | null = null,
  approvalCount: number = 0
): MRVerdict {
  const flags: string[] = []

  // Branch freshness — a behind branch blocks the MR regardless of CI outcome
  if (divergedCommitsCount === null) {
    flags.push('Branch sync status unknown — verify it is up to date before merging')
  } else if (divergedCommitsCount > 0) {
    flags.push(
      `Branch is ${divergedCommitsCount} commit${divergedCommitsCount === 1 ? '' : 's'} behind target — rebase before merging`
    )
  }

  // CI
  if (ciStatus === 'failed') flags.push('CI pipeline failed — must be resolved before merging')
  if (ciStatus === 'running') flags.push('CI pipeline still running — wait for result')
  if (ciStatus === 'pending') flags.push('CI pipeline pending — wait for result')
  if (ciStatus === 'unknown') flags.push('CI status could not be determined')

  // Bump type
  const hasMajor = packages.some((p) => p.bumpType === 'major')
  const hasMinor = packages.some((p) => p.bumpType === 'minor')
  const isGrouped = packages.length > 1
  if (hasMajor) flags.push('Major version bump — review migration guide')

  // changelogUnavailable is pre-computed by the caller (analyze route).
  // True when all entries have source:'none' (fetch failed) OR changelog is empty
  // (private/internal image — no public changelog exists).
  if (changelogUnavailable) {
    flags.push('Changelog unavailable — could not verify what changed; review manually')
  }

  // Breaking changes from changelog
  const breaking = changelog.filter((e) => e.hasBreakingChange)
  for (const entry of breaking) {
    for (const detail of entry.breakingDetails) {
      flags.push(`Breaking change: ${detail}`)
    }
    if (entry.breakingDetails.length === 0) {
      flags.push(`Breaking change keyword detected in v${entry.version} changelog`)
    }
  }

  // Deprecation warnings
  const hasDeprecation = changelog.some((e) =>
    e.categories.some((c) => c.title.toLowerCase().includes('deprecat')) ||
    e.body.toLowerCase().includes('deprecated')
  )
  if (hasDeprecation) flags.push('Deprecation notices found in changelog — check if your code is affected')

  // Decide status
  const hasApprovals = approvalCount >= REQUIRED_APPROVALS
  const isBehind = divergedCommitsCount !== null && divergedCommitsCount > 0

  // A confirmed-behind branch blocks regardless of CI outcome
  if (isBehind) {
    return { status: 'blocked', reason: `Branch is behind target by ${divergedCommitsCount} commit${divergedCommitsCount === 1 ? '' : 's'} — rebase before merging.`, flags }
  }

  if (ciStatus === 'failed') {
    return { status: 'blocked', reason: 'CI pipeline failed.', flags }
  }

  const hasBreaking = breaking.length > 0
  if (hasBreaking || hasMajor) {
    return { status: 'review', reason: 'Manual review required before merging.', flags }
  }

  if (isGrouped && ciStatus !== 'success') {
    return { status: 'review', reason: 'Grouped update — wait for CI before merging.', flags }
  }

  const isFresh = divergedCommitsCount === 0  // null = unknown = not fresh

  // Minor bump — only safe when CI passed AND changelog is available (or confirms no breaking changes)
  if (hasMinor) {
    if (changelogUnavailable) {
      return { status: 'review', reason: 'Minor bump — changelog unavailable, verify manually.', flags }
    }
    if (flags.length === 0 && ciStatus === 'success' && isFresh) {
      return { status: hasApprovals ? 'safe' : 'pending_approval', reason: hasApprovals ? 'Minor bump, CI passed, no breaking changes detected.' : 'Minor bump, CI passed — waiting on approvals.', flags }
    }
    if (flags.length === 0) {
      return { status: 'review', reason: 'Minor bump — waiting on CI.', flags }
    }
    return { status: 'review', reason: 'Minor bump — manual review recommended.', flags }
  }

  // Patch bump — safe only when CI passed AND we have changelog evidence AND branch is fresh
  if (ciStatus === 'success' && !changelogUnavailable && isFresh) {
    return { status: hasApprovals ? 'safe' : 'pending_approval', reason: hasApprovals ? 'Patch bump, CI passed, no breaking changes.' : 'Patch bump, CI passed — waiting on approvals.', flags }
  }
  if (changelogUnavailable) {
    return { status: 'review', reason: 'Patch bump — changelog unavailable, cannot confirm no breaking changes.', flags }
  }

  if (flags.length > 0) {
    return { status: 'review', reason: 'See review notes below.', flags }
  }

  return { status: hasApprovals ? 'safe' : 'pending_approval', reason: hasApprovals ? 'Patch bump, no issues detected.' : 'Patch bump — waiting on approvals.', flags }
}
