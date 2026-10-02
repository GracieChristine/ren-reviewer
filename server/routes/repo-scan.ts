import { Router, Request, Response } from 'express'
import axios from 'axios'

export const repoScanRouter = Router()

/**
 * POST /api/repo-scan
 * Body: { gitlabToken, projectId, packageName, breakingDetails? }
 *
 * Searches the GitLab project's source files to check:
 * 1. Is the package imported/required anywhere? (confirms it actually affects this repo)
 * 2. If breaking changes were found — are any of the affected API names used in the codebase?
 *
 * Returns:
 *   { importedIn: string[], breakingHits: { keyword: string; files: string[] }[] }
 */
repoScanRouter.post('/', async (req: Request, res: Response) => {
  const { gitlabToken, projectId, packageName, breakingDetails } = req.body as {
    gitlabToken: string
    projectId: string
    packageName: string
    breakingDetails?: string[]
  }

  if (!gitlabToken || !projectId || !packageName) {
    return res.status(400).json({ error: 'Missing gitlabToken, projectId, or packageName' })
  }

  const encoded = encodeURIComponent(projectId)
  const headers = { 'PRIVATE-TOKEN': gitlabToken }
  const GITLAB = 'https://gitlab.com/api/v4'

  // Search GitLab blobs for a term, skip lockfiles and node_modules
  async function searchBlobs(term: string): Promise<string[]> {
    try {
      const { data } = await axios.get(`${GITLAB}/projects/${encoded}/search`, {
        headers,
        params: { scope: 'blobs', search: `"${term}"`, per_page: 10 },
        timeout: 8000,
      })
      return (data as Array<{ filename: string }>)
        .map((r) => r.filename)
        .filter(
          (f) =>
            !f.includes('node_modules') &&
            !f.endsWith('.lock') &&
            !f.endsWith('-lock.yaml') &&
            f !== 'package.json' // package.json always mentions it; we want code usage
        )
    } catch {
      return []
    }
  }

  // 1. Check for import statements: `from 'packageName'` or `require('packageName')`
  //    Use the unscoped part for broader matching (e.g. "@scope/name" → "scope/name")
  const importedIn = await searchBlobs(packageName)

  // 2. If breaking changes exist, extract API identifiers and check if they appear in code
  const breakingHits: { keyword: string; files: string[] }[] = []

  if (breakingDetails && breakingDetails.length > 0) {
    const keywords = extractKeywords(breakingDetails)
    for (const kw of keywords) {
      const hits = await searchBlobs(kw)
      if (hits.length > 0) breakingHits.push({ keyword: kw, files: hits })
    }
  }

  return res.json({ importedIn, breakingHits })
})

/** Extract identifiers (camelCase, backtick-quoted, or PascalCase) from breaking change strings. */
function extractKeywords(details: string[]): string[] {
  const keywords = new Set<string>()
  for (const detail of details) {
    // Backtick-quoted: `someApi`
    const backtick = [...detail.matchAll(/`([^`]{2,40})`/g)].map((m) => m[1])
    // camelCase or PascalCase identifiers ≥ 6 chars (avoids common English words)
    const camel = [...detail.matchAll(/\b[A-Z][a-zA-Z0-9]{5,}\b|\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]{3,}\b/g)].map((m) => m[0])
    for (const k of [...backtick, ...camel]) keywords.add(k)
  }
  // Limit searches to 3 keywords to avoid rate-limiting
  return [...keywords].slice(0, 3)
}
