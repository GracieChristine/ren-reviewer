import { Router } from 'express'
import type { Request, Response } from 'express'
import axios from 'axios'

export const pipelineRouter = Router()

const GITLAB_BASE = 'https://gitlab.com/api/v4'

/** Trigger a pipeline on the MR's source branch.
 *  Uses POST /projects/:id/pipeline (source=api) so it always creates a fresh
 *  pipeline and custom variables (BROWSER, TEST_SUITE, etc.) are applied.
 *  The CI job's rules must include `if: '$CI_PIPELINE_SOURCE == "api"'` for
 *  the test jobs to match. */
pipelineRouter.post('/trigger', async (req: Request, res: Response) => {
  const { gitlabToken, projectId, ref, variables = [] } = req.body
  if (!gitlabToken || !projectId || !ref) {
    return res.status(400).json({ error: 'gitlabToken, projectId, and ref are required.' })
  }

  try {
    // Normalise variables — GitLab requires variable_type on some versions
    const normalizedVars = (variables as { key: string; value: string }[]).map((v) => ({
      key: v.key,
      value: v.value,
      variable_type: 'env_var',
    }))

    const { data } = await axios.post(
      `${GITLAB_BASE}/projects/${encodeURIComponent(projectId)}/pipeline`,
      { ref, variables: normalizedVars },
      { headers: { 'PRIVATE-TOKEN': gitlabToken }, timeout: 10000 }
    )
    return res.json({ id: data.id, webUrl: data.web_url, status: data.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gitlabBody = (err as any)?.response?.data
    // GitLab returns { message: { base: ['...'] } } or { message: '...' } or { error: '...' }
    const rawMsg = gitlabBody?.message
    const gitlabMessage: string =
      typeof rawMsg === 'string' ? rawMsg
      : Array.isArray(rawMsg?.base) ? (rawMsg.base as string[]).join('; ')
      : typeof gitlabBody?.error === 'string' ? gitlabBody.error
      : JSON.stringify(gitlabBody ?? message)
    console.error('[pipeline/trigger]', message, gitlabBody ?? '')
    if (message.includes('401')) return res.status(401).json({ error: 'Invalid token.' })
    if (message.includes('404')) return res.status(404).json({ error: 'Branch or project not found.' })
    if (message.includes('400')) {
      const isEmpty = gitlabMessage.toLowerCase().includes('empty')
      const friendly = isEmpty
        ? 'No jobs matched — the test job rules need to allow API-triggered pipelines. Add this to the test job rules in .gitlab-ci.yml:  - if: \'$CI_PIPELINE_SOURCE == "api"\''
        : `GitLab rejected the request: ${gitlabMessage}`
      return res.status(400).json({ error: friendly })
    }
    return res.status(500).json({ error: `Failed to trigger pipeline: ${gitlabMessage}` })
  }
})

/** Poll a pipeline's current status. */
pipelineRouter.get('/status', async (req: Request, res: Response) => {
  const { gitlabToken, projectId, pipelineId } = req.query as Record<string, string>
  if (!gitlabToken || !projectId || !pipelineId) {
    return res.status(400).json({ error: 'gitlabToken, projectId, and pipelineId are required.' })
  }

  try {
    const { data } = await axios.get(
      `${GITLAB_BASE}/projects/${encodeURIComponent(projectId)}/pipelines/${pipelineId}`,
      { headers: { 'PRIVATE-TOKEN': gitlabToken }, timeout: 5000 }
    )
    return res.json({ status: data.status, webUrl: data.web_url })
  } catch (err: unknown) {
    console.error('[pipeline/status]', err instanceof Error ? err.message : err)
    return res.status(500).json({ error: 'Failed to fetch pipeline status.' })
  }
})
