import { Router } from 'express'
import type { Request, Response } from 'express'
import axios from 'axios'

export const approveRouter = Router()

const GITLAB_BASE = 'https://gitlab.com/api/v4'

/**
 * POST /api/approve
 * Body: { gitlabToken, projectId, mrIid }
 * Submits an approval on the given MR using the caller's GitLab token.
 * GitLab requires the approver to be different from the MR author, and
 * the project must have approvals enabled.
 */
approveRouter.post('/', async (req: Request, res: Response) => {
  const { gitlabToken, projectId, mrIid } = req.body as {
    gitlabToken: string
    projectId: string
    mrIid: number
  }

  if (!gitlabToken || !projectId || !mrIid) {
    return res.status(400).json({ error: 'gitlabToken, projectId and mrIid are required.' })
  }

  try {
    const encodedPath = encodeURIComponent(projectId)
    await axios.post(
      `${GITLAB_BASE}/projects/${encodedPath}/merge_requests/${mrIid}/approve`,
      {},
      { headers: { 'PRIVATE-TOKEN': gitlabToken } }
    )
    return res.json({ approved: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('401')) {
      return res.status(401).json({ error: 'Invalid or expired GitLab token.' })
    }
    if (message.includes('403')) {
      return res.status(403).json({
        error: 'Not authorised to approve — you may be the MR author, or approvals are not enabled.',
      })
    }
    if (message.includes('409')) {
      return res.status(409).json({ error: 'Already approved by you.' })
    }
    console.error('[approve]', message)
    return res.status(500).json({ error: 'Could not submit approval. Check the server logs.' })
  }
})
