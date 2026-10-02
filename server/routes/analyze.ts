import { Router } from 'express'
import type { Request, Response } from 'express'
import { fetchAllMRs } from '../services/gitlab'
import { fetchChangelog } from '../services/changelog'
import { deriveVerdict } from '../services/verdict'
import type { AnalyzeRequest, AnalyzeResponse, RenovateMR } from '../types'

export const analyzeRouter = Router()

analyzeRouter.post('/', async (req: Request, res: Response) => {
  const { gitlabToken, projectId } = req.body as AnalyzeRequest

  if (!gitlabToken || !projectId) {
    return res.status(400).json({ error: 'gitlabToken and projectId are required.' })
  }

  try {
    const rawMRs = await fetchAllMRs(gitlabToken, projectId)

    const mrs: RenovateMR[] = await Promise.all(
      rawMRs.map(async (mr) => {
        // Authored (non-Renovate) MRs: no package/changelog analysis needed
        if (!mr.isRenovate) {
          // Derive a simple verdict from CI + approvals + branch freshness
          const n = mr.divergedCommitsCount
          const isFresh = n === 0  // null = unknown = not fresh
          const flags: string[] = []
          if (n === null) {
            flags.push('Branch sync status unknown — verify it is up to date before merging')
          } else if (n > 0) {
            flags.push(
              `Branch is ${n} commit${n === 1 ? '' : 's'} behind ${mr.targetBranch} — CI result may be stale; rebase before merging`
            )
          }

          const REQUIRED = 3
          let status: RenovateMR['verdict']['status']
          let reason: string
          if (n !== null && n > 0) {
            // Confirmed behind — blocked regardless of CI
            status = 'blocked'
            reason = `Branch is behind ${mr.targetBranch} by ${n} commit${n === 1 ? '' : 's'} — rebase before merging`
          } else if (mr.ciStatus === 'failed') {
            status = 'blocked'; reason = 'CI failed'
          } else if (mr.ciStatus === 'success' && isFresh && mr.approvalCount >= REQUIRED) {
            status = 'safe'; reason = 'CI passed and approved'
          } else if (mr.ciStatus === 'success' && isFresh && mr.approvalCount < REQUIRED) {
            status = 'pending_approval'
            reason = `CI passed — waiting on ${REQUIRED - mr.approvalCount} more approval${REQUIRED - mr.approvalCount === 1 ? '' : 's'}`
          } else if (mr.ciStatus === 'success' && n === null) {
            status = 'review'; reason = `CI passed but branch sync unknown — verify it is up to date with ${mr.targetBranch}`
          } else {
            status = 'review'; reason = 'Needs review'
          }
          return {
            ...mr,
            changelog: [],
            changelogUnavailable: false,
            verdict: { status, reason, flags },
          }
        }

        // Renovate MRs: full changelog + verdict analysis
        const enrichedPackages = await Promise.all(
          mr.packages.map(async (pkg) => {
            const { entries, compareUrl, repoUrl } = await fetchChangelog(pkg)
            return {
              pkg: { ...pkg, compareUrl, repoUrl },
              entries,
            }
          })
        )

        const packages = enrichedPackages.map((e) => e.pkg)
        const changelog = enrichedPackages.flatMap((e) => e.entries)

        // Single source of truth for "we have no changelog data":
        // - length === 0 → private/internal image, no public changelog
        // - every source === 'none' → we tried all sources and all failed
        // - rate-limited → treat same as unavailable so verdict isn't penalised
        const changelogUnavailable =
          changelog.length === 0 ||
          changelog.every((e) => e.source === 'none' || e.source === 'rate-limited')

        const verdict = deriveVerdict(mr.ciStatus, packages, changelog, changelogUnavailable, mr.divergedCommitsCount, mr.approvalCount)

        return { ...mr, packages, changelog, changelogUnavailable, verdict }
      })
    )

    const response: AnalyzeResponse = {
      projectName: projectId.split('/').pop() ?? projectId,
      fetchedAt: new Date().toISOString(),
      mrs,
    }

    return res.json(response)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('401') || message.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Invalid or expired GitLab token.' })
    }
    if (message.includes('404')) {
      return res.status(404).json({ error: 'Project not found. Check the project path.' })
    }
    console.error('[analyze]', message)
    return res.status(500).json({ error: 'Internal error. Check the server logs.' })
  }
})
