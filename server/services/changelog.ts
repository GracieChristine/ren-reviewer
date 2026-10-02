import axios from 'axios'
import type { ChangelogCategory, ChangelogEntry, PackageBump } from '../types'
import { cacheKey, getCached, setCached } from './changelog-cache'

const BREAKING_KEYWORDS = [
  'breaking change',
  'BREAKING CHANGE',
  'breaking:',
  'removed api',
  'migration required',
  'incompatible',
  'no longer supported',
]

// Common changelog section headings to normalise
const SECTION_ALIASES: Record<string, string> = {
  // ── Minor Changes — generic/unclassified or explicitly minor ──────────────
  'what\'s changed':    'Minor Changes',
  'whats changed':      'Minor Changes',
  'changes':            'Minor Changes',
  'all changes':        'Minor Changes',
  'changelog':          'Minor Changes',
  'improvements':       'Minor Changes',
  'minor changes':      'Minor Changes', // changesets format
  'minor updates':      'Minor Changes',
  // ── Bug Fixes — patch-level fixes ─────────────────────────────────────────
  'bug fixes':          'Bug Fixes',
  'bugs':               'Bug Fixes',
  'fixes':              'Bug Fixes',
  'fixed':              'Bug Fixes',
  'patch fixes':        'Bug Fixes',
  'patch changes':      'Bug Fixes',     // changesets format
  'patch updates':      'Bug Fixes',
  // ── Added — new features/additions ────────────────────────────────────────
  'new features':       'Added',
  'features':           'Added',
  'enhancements':       'Added',
  'added':              'Added',
  // ── Major Changes — significant version bump ───────────────────────────────
  'major changes':      'Major Changes', // changesets format
  'major updates':      'Major Changes',
  'major':              'Major Changes',
  // ── Breaking Changes — explicit breakage warning (separate from major) ────
  'breaking changes':   'Breaking Changes',
  'breaking':           'Breaking Changes',
  // ── Other specific categories ──────────────────────────────────────────────
  'deprecations':       'Deprecated',
  'removals':           'Removed',
  'performance':        'Performance',
  'security':           'Security',
  'security fixes':     'Security',
  'documentation':      'Documentation',
  'docs':               'Documentation',
  'chores':             'Chores',
  'maintenance':        'Chores',
  'other changes':      'Other',
  'other':              'Other',
  'miscellaneous':      'Other',
}

// Bullet items that are clearly just changeset hashes or package pins — not useful descriptions
const CHANGESET_HASH_RE = /^[a-z]+-[a-z]+-[a-z]+$/  // e.g. "fluffy-apples-return"
const VERSION_PIN_RE = /^[\w/@-]+@[\d.][\d.]*\s*$/   // e.g. "@babel/core@7.24.0"

// Known non-npm packages → their GitHub repos (Docker base images, etc.)
const KNOWN_GITHUB_REPOS: Record<string, string> = {
  node: 'nodejs/node',
  nodejs: 'nodejs/node',
  python: 'python/cpython',
  postgres: 'postgres/postgres',
  redis: 'redis/redis',
  nginx: 'nginx/nginx',
  ubuntu: 'canonical/ubuntu',
}

// Known Maven groupIds (and groupId:artifactId pairs) → GitHub repos
// Keyed by groupId alone OR full "groupId:artifactId" for precision
const KNOWN_MAVEN_REPOS: Record<string, string> = {
  // AWS
  'software.amazon.awssdk':                     'aws/aws-sdk-java-v2',
  'com.amazonaws':                              'aws/aws-sdk-java',
  // Apache Commons
  'commons-io':                                 'apache/commons-io',
  'commons-io:commons-io':                      'apache/commons-io',
  'commons-lang':                               'apache/commons-lang',
  'commons-lang3':                              'apache/commons-lang',
  'org.apache.commons:commons-lang3':           'apache/commons-lang',
  'org.apache.commons:commons-text':            'apache/commons-text',
  'org.apache.commons:commons-collections4':    'apache/commons-collections',
  'org.apache.commons:commons-compress':        'apache/commons-compress',
  'org.apache.commons:commons-csv':             'apache/commons-csv',
  // Apache HttpComponents
  'org.apache.httpcomponents.client5':          'apache/httpcomponents-client',
  'org.apache.httpcomponents.client5:httpclient5': 'apache/httpcomponents-client',
  'org.apache.httpcomponents.core5':            'apache/httpcomponents-core',
  'org.apache.httpcomponents':                  'apache/httpcomponents-client',
  // REST Assured
  'io.rest-assured':                            'rest-assured/rest-assured',
  'io.rest-assured:rest-assured':               'rest-assured/rest-assured',
  // Logging
  'org.slf4j':                                  'qos-ch/slf4j',
  'ch.qos.logback':                             'qos-ch/logback',
  'org.apache.logging.log4j':                   'apache/logging-log4j2',
  // Lombok
  'org.projectlombok':                          'projectlombok/lombok',
  'org.projectlombok:lombok':                   'projectlombok/lombok',
  // Jakarta / EE
  'jakarta.xml.bind':                           'eclipse-ee4j/jaxb-api',
  'jakarta.persistence':                        'eclipse-ee4j/jpa-api',
  'jakarta.servlet':                            'eclipse-ee4j/servlet-api',
  // Test reporting
  'com.aventstack':                             'extent-framework/extentreports',
  'com.aventstack:extentreports':               'extent-framework/extentreports',
  // Spring
  'org.springframework.boot':                   'spring-projects/spring-boot',
  'org.springframework':                        'spring-projects/spring-framework',
  // Test frameworks
  'org.junit.jupiter':                          'junit-team/junit5',
  'org.junit':                                  'junit-team/junit5',
  'org.testng':                                 'testng-team/testng',
  'org.mockito':                                'mockito/mockito',
  // Selenium / Appium
  'org.seleniumhq.selenium':                    'SeleniumHQ/selenium',
  'io.appium':                                  'appium/java-client',
  'io.github.bonigarcia':                       'bonigarcia/webdrivermanager',
  // Cucumber
  'io.cucumber':                                'cucumber/cucumber-jvm',
  // Jackson
  'com.fasterxml.jackson.core':                 'FasterXML/jackson-core',
  'com.fasterxml.jackson':                      'FasterXML/jackson-databind',
  // Google
  'com.google.guava':                           'google/guava',
  // OkHttp
  'com.squareup.okhttp3':                       'square/okhttp',
}

/** True if the name looks like a Maven/Java artifact (reverse-domain or commons- prefix) */
function isMavenPackage(name: string): boolean {
  return (
    /^(?:org|com|io|net|jakarta|software|javax|ch)\.[a-zA-Z]/.test(name) ||
    /^commons-[a-z]/.test(name)
  )
}

/** Fetch the GitHub repo from a Maven Central POM file.
 *  Only usable when we have both groupId and artifactId (colon-separated). */
async function fetchMavenPomRepo(
  groupId: string,
  artifactId: string,
  version: string
): Promise<string | null> {
  try {
    const groupPath = groupId.replace(/\./g, '/')
    const url = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`
    const { data: pom } = await axios.get<string>(url, {
      timeout: 8000,
      headers: { Accept: 'application/xml, text/xml, */*' },
    })
    // Look for <scm><url>https://github.com/org/repo</url></scm>
    const scmUrl = pom.match(/<scm>[\s\S]*?<url>\s*(.*?)\s*<\/url>[\s\S]*?<\/scm>/)?.[1] ?? ''
    const gh = scmUrl.match(/github\.com[:/]([^/\s]+\/[^/.\s]+?)(?:\.git)?(?:[\s/]|$)/)
    if (gh) return gh[1]
    return null
  } catch {
    return null
  }
}

/** Strip pre-release/image suffixes to get the base semver for changelog lookup.
 *  "24.18.0-alpine-build-1102" → "24.18.0"  */
function baseVersion(v: string): string {
  return v.replace(/^v/, '').match(/^\d+\.\d+\.\d+/)?.[0] ?? v
}

/** True if the package name looks like a private registry image (env vars, ECR, ACR, GCR). */
function isPrivateImage(name: string): boolean {
  return (
    name.includes('$') ||                          // env var like $ECR_HOST/...
    /\.(amazonaws|azurecr|gcr|jfrog)\.io/.test(name) // known private registries
  )
}

export async function fetchChangelog(
  bump: PackageBump
): Promise<{ entries: ChangelogEntry[]; compareUrl?: string; repoUrl?: string }> {
  // Disk cache — keyed by exact version range, never expires (historical data is immutable)
  const key = cacheKey(bump.name, bump.fromVersion, bump.toVersion)
  const cached = getCached(key)
  if (cached) {
    console.log(`[changelog] ${bump.name}: cache hit`)
    return cached
  }

  console.log(`[changelog] processing: ${bump.name} ${bump.fromVersion} → ${bump.toVersion}`)

  // Private registry images have no public changelog — return empty silently
  if (isPrivateImage(bump.name)) {
    console.log(`[changelog] ${bump.name}: private registry image — skipping`)
    return { entries: [] }
  }

  // First, try resolving via npm (covers most JS packages)
  let npmInfo = await fetchNpmInfo(bump.name)

  // If npm fails, check if we recognise the base image/package name (Docker etc.)
  if (!npmInfo?.githubRepo) {
    const baseName = bump.name.split(':')[0].split('/').pop()?.toLowerCase() ?? ''
    const knownRepo = KNOWN_GITHUB_REPOS[baseName]
    if (knownRepo) {
      console.log(`[changelog] ${bump.name}: KNOWN_GITHUB_REPOS → ${knownRepo}`)
      npmInfo = { githubRepo: knownRepo }
    }
  } else if (npmInfo.githubRepo) {
    console.log(`[changelog] ${bump.name}: npm registry → github/${npmInfo.githubRepo}`)
  }

  // Maven / Java package? Try known repos map, then Maven Central POM
  if (!npmInfo?.githubRepo && isMavenPackage(bump.name)) {
    // Most specific key first: "groupId:artifactId", then "groupId" alone
    const mavenRepo =
      KNOWN_MAVEN_REPOS[bump.name] ??
      KNOWN_MAVEN_REPOS[bump.name.split(':')[0]]

    if (mavenRepo) {
      console.log(`[changelog] ${bump.name}: KNOWN_MAVEN_REPOS → ${mavenRepo}`)
      npmInfo = { githubRepo: mavenRepo }
    } else if (bump.name.includes(':')) {
      // groupId:artifactId — try fetching the POM from Maven Central
      const [groupId, artifactId] = bump.name.split(':')
      const version = bump.toVersion !== 'unknown' ? bump.toVersion : bump.fromVersion
      if (version && version !== 'unknown') {
        const pomRepo = await fetchMavenPomRepo(groupId, artifactId, version)
        if (pomRepo) {
          console.log(`[changelog] ${bump.name}: Maven Central POM → github/${pomRepo}`)
          npmInfo = { githubRepo: pomRepo }
        } else {
          console.log(`[changelog] ${bump.name}: Maven Central POM — no GitHub URL found`)
        }
      }
    } else {
      console.log(`[changelog] ${bump.name}: Maven package — not in KNOWN_MAVEN_REPOS, groupId-only — skipping`)
    }
  }

  // For Docker-style versions, compare using the stripped semver
  const fromBase = baseVersion(bump.fromVersion)
  const toBase = baseVersion(bump.toVersion)

  const compareUrl = npmInfo?.githubRepo
    ? buildCompareUrl(npmInfo.githubRepo, fromBase, toBase)
    : undefined

  const repoUrl = npmInfo?.githubRepo
    ? `https://github.com/${npmInfo.githubRepo}`
    : undefined

  if (!npmInfo?.githubRepo) {
    console.log(`[changelog] ${bump.name}: no GitHub repo found — no changelog`)
    const result = {
      entries: [{
        version: bump.toVersion,
        categories: [],
        body: `No public changelog found for "${bump.name}". This may be a private or Docker image.`,
        hasBreakingChange: false,
        breakingDetails: [],
        source: 'none' as const,
      }],
    }
    setCached(key, result)
    return result
  }

  const repo = npmInfo.githubRepo

  // Try GitHub releases first (use stripped base version for tag matching)
  const releaseEntries = await fetchGitHubReleases(repo, fromBase, toBase)

  // Rate limited — return immediately without caching so the next run retries
  if (releaseEntries.some((e) => e.source === 'rate-limited')) {
    return { entries: releaseEntries, compareUrl, repoUrl }
  }

  if (releaseEntries.length > 0) {
    const result = { entries: releaseEntries, compareUrl, repoUrl }
    setCached(key, result)
    return result
  }

  // Fall back to CHANGELOG.md (and other common changelog file names)
  const changelogEntries = await fetchChangelogMd(repo)
  if (changelogEntries.length > 0) {
    const result = { entries: changelogEntries, compareUrl, repoUrl }
    setCached(key, result)
    return result
  }

  // Fall back to GitHub Compare API — extract commit messages between the two version tags
  const compareEntries = await fetchGitHubCompare(repo, fromBase, toBase)
  if (compareEntries.some((e) => e.source === 'rate-limited')) {
    return { entries: compareEntries, compareUrl, repoUrl }
  }
  if (compareEntries.length > 0) {
    const result = { entries: compareEntries, compareUrl, repoUrl }
    setCached(key, result)
    return result
  }

  // Nothing found — cache so we don't retry GitHub on every refresh
  console.log(`[changelog] ${bump.name}: no release entries found — returning compareUrl fallback`)
  const result = {
    entries: [{
      version: `${bump.fromVersion} → ${bump.toVersion}`,
      categories: [],
      body: compareUrl
        ? `No changelog entries found.\nView all changes: ${compareUrl}`
        : `No changelog data available.`,
      hasBreakingChange: false,
      breakingDetails: [],
      source: 'none' as const,
    }],
    compareUrl,
    repoUrl,
  }
  setCached(key, result)
  return result
}

// ── npm registry ──────────────────────────────────────────────────────────────

async function fetchNpmInfo(
  packageName: string
): Promise<{ githubRepo: string | null } | null> {
  try {
    const { data } = await axios.get(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      { timeout: 8000, headers: { Accept: 'application/json' } }
    )

    // npm `repository` can be:
    //   { type: 'git', url: 'https://github.com/org/repo.git' }  ← normal object
    //   'github:org/repo'                                         ← shorthand string
    //   'org/repo'                                                ← bare shorthand (implies GitHub)
    const repoRaw = data.repository
    const repoUrl: string =
      typeof repoRaw === 'string'         ? repoRaw :
      typeof repoRaw?.url === 'string'    ? repoRaw.url : ''

    // Full URL: https://github.com/org/repo or git+ssh://git@github.com:org/repo.git
    const ghMatch = repoUrl.match(/github\.com[:/]([^/\s]+\/[^/.\s]+?)(?:\.git)?(?:\s|$)/)
    if (ghMatch) return { githubRepo: ghMatch[1] }

    // Shorthand: 'github:org/repo' or bare 'org/repo' (npm defaults to GitHub)
    const shorthand = repoUrl.match(/^(?:github:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
    if (shorthand) return { githubRepo: shorthand[1] }

    console.log(`[changelog] npm/${packageName}: no GitHub URL in registry (repo field: ${JSON.stringify(repoRaw)})`)
    return { githubRepo: null }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[changelog] npm/${packageName}: registry fetch failed — ${msg}`)
    return null
  }
}

// ── GitHub releases ───────────────────────────────────────────────────────────

/** Compare two stripped semver strings ("1.2.3"). Returns -1, 0, or 1. */
function semverCmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}

/** True if the tag's semver is in the range (from, to].
 *  Extracts semver from ANYWHERE in the tag to handle prefixes like "cli/v2.5.11". */
function isVersionInRange(tag: string, from: string, to: string): boolean {
  const stripped = tag.match(/(\d+\.\d+\.\d+)/)?.[1] ?? tag
  return semverCmp(stripped, from) > 0 && semverCmp(stripped, to) <= 0
}

async function fetchGitHubReleases(
  repo: string,
  fromVersion?: string,
  toVersion?: string
): Promise<ChangelogEntry[]> {
  try {
    const { data: releases } = await axios.get(
      `https://api.github.com/repos/${repo}/releases`,
      {
        timeout: 8000,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        params: { per_page: 100 },
      }
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = releases as any[]
    console.log(`[changelog] github/${repo}/releases: ${all.length} total, range ${fromVersion}→${toVersion}`)

    // Step 1 — filter by version range first
    let inRange = all
    if (fromVersion && toVersion && fromVersion !== 'unknown') {
      inRange = all.filter((r) => {
        const tag = (r.tag_name ?? '').replace(/^v/, '')
        return isVersionInRange(tag, fromVersion, toVersion)
      })
    } else if (toVersion && toVersion !== 'unknown') {
      const toMajor = parseInt(toVersion.split('.')[0], 10)
      inRange = all.filter((r) => {
        const stripped = (r.tag_name ?? '').match(/(\d+\.\d+\.\d+)/)?.[1] ?? ''
        if (!stripped) return false
        return parseInt(stripped.split('.')[0], 10) === toMajor && semverCmp(stripped, toVersion) <= 0
      })
    }

    // Step 2 — prefer releases that have body content; fall back to all in-range if none do
    const withBody = inRange.filter((r) => r.body && r.body.trim().length > 10)
    const filtered = withBody.length > 0 ? withBody : inRange

    const kept = filtered.slice(0, 8)
    console.log(`[changelog] github/${repo}/releases: ${inRange.length} in range, ${withBody.length} with notes, using ${kept.length}`)
    return kept.map((r) => {
      const body: string = r.body ?? ''
      const categories = parseIntoCategories(body)
      const breaking = detectBreaking(body)
      return {
        version: r.tag_name?.replace(/^v/, '') ?? r.name,
        categories,
        body: categories.length > 0 ? '' : truncate(body, 800),
        hasBreakingChange: breaking.found,
        breakingDetails: breaking.details,
        source: 'release' as const,
      }
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.response?.status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = (err as any)?.response?.headers ?? {}
    if (status === 403 || status === 429) {
      const resetTs = parseInt(headers['x-ratelimit-reset'] ?? '0', 10)
      const minutesLeft = resetTs > 0
        ? Math.max(1, Math.ceil((resetTs - Date.now() / 1000) / 60))
        : 60
      console.warn(`[changelog] github/${repo}/releases: rate limited — resets in ${minutesLeft}min`)
      return [{
        version: 'rate-limited',
        categories: [],
        body: `GitHub API rate limit reached — try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
        hasBreakingChange: false,
        breakingDetails: [],
        source: 'rate-limited' as const,
      }]
    }
    console.warn(`[changelog] github/${repo}/releases: FAILED — ${msg}`)
    return []
  }
}

// ── GitHub Compare API (commit messages as fallback) ─────────────────────────

const CONV_TYPE_TO_CAT: Record<string, string> = {
  feat:     'Added',
  fix:      'Bug Fixes',
  perf:     'Performance',
  refactor: 'Minor Changes',
  docs:     'Documentation',
  chore:    'Chores',
  test:     'Chores',
  build:    'Chores',
  ci:       'Chores',
  style:    'Chores',
  revert:   'Minor Changes',
}

async function fetchGitHubCompare(
  repo: string,
  fromVersion: string,
  toVersion: string
): Promise<ChangelogEntry[]> {
  if (!fromVersion || fromVersion === 'unknown' || !toVersion || toVersion === 'unknown') return []

  for (const prefix of ['v', '']) {
    const base = `${prefix}${fromVersion}`
    const head = `${prefix}${toVersion}`
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${repo}/compare/${base}...${head}`,
        {
          timeout: 10000,
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const commits = (data.commits ?? []) as any[]
      if (commits.length === 0) continue

      // Extract first line of each commit message, filter noise
      const subjects = commits
        .map((c) => (c.commit?.message ?? '').split('\n')[0].trim())
        .filter((msg) => {
          const lower = msg.toLowerCase()
          return (
            msg.length > 5 &&
            !lower.startsWith('merge ') &&
            !lower.startsWith('release ') &&
            !lower.match(/^bump version/i) &&
            !lower.match(/^chore\(deps\)/i)
          )
        })

      if (subjects.length === 0) continue

      // Group by conventional commit prefix; uncategorised → Minor Changes
      const catMap = new Map<string, string[]>()
      for (const msg of subjects) {
        const m = msg.match(/^(\w+)(?:\([^)]+\))?!?:\s+(.+)/)
        const cat = m ? (CONV_TYPE_TO_CAT[m[1].toLowerCase()] ?? 'Minor Changes') : 'Minor Changes'
        const text = m ? m[2] : msg
        if (!catMap.has(cat)) catMap.set(cat, [])
        catMap.get(cat)!.push(text)
      }

      const categories: ChangelogCategory[] = [...catMap.entries()].map(([title, items]) => ({
        title,
        items: items.slice(0, 8),
      }))

      const hasBreaking = subjects.some((m) => m.includes('BREAKING') || /^[^:]+!:/.test(m))

      console.log(`[changelog] github/${repo}/compare ${base}...${head}: ${subjects.length} commits → ${categories.length} categories`)
      return [{
        version: `${fromVersion} → ${toVersion}`,
        categories,
        body: '',
        hasBreakingChange: hasBreaking,
        breakingDetails: [],
        source: 'release' as const,
      }]
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.response?.status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headers = (err as any)?.response?.headers ?? {}
      if (status === 403 || status === 429) {
        const resetTs = parseInt(headers['x-ratelimit-reset'] ?? '0', 10)
        const minutesLeft = resetTs > 0 ? Math.max(1, Math.ceil((resetTs - Date.now() / 1000) / 60)) : 60
        console.warn(`[changelog] github/${repo}/compare: rate limited — resets in ${minutesLeft}min`)
        return [{
          version: 'rate-limited', categories: [], body:
            `GitHub API rate limit reached — try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
          hasBreakingChange: false, breakingDetails: [], source: 'rate-limited' as const,
        }]
      }
      if (status === 404) continue  // try next prefix
      console.warn(`[changelog] github/${repo}/compare: FAILED — ${err instanceof Error ? err.message : err}`)
    }
  }
  return []
}

// ── CHANGELOG.md ──────────────────────────────────────────────────────────────

async function fetchChangelogMd(repo: string): Promise<ChangelogEntry[]> {
  const candidates = [
    `https://raw.githubusercontent.com/${repo}/HEAD/CHANGELOG.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/changelog.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/CHANGES.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/CHANGES`,
    `https://raw.githubusercontent.com/${repo}/HEAD/RELEASE_NOTES.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/RELEASE-NOTES.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/History.md`,
    `https://raw.githubusercontent.com/${repo}/main/CHANGELOG.md`,
    `https://raw.githubusercontent.com/${repo}/master/CHANGELOG.md`,
  ]
  for (const url of candidates) {
    try {
      const { data: text } = await axios.get<string>(url, { timeout: 6000 })
      if (text && text.length > 100) {
        const entries = parseChangelogMd(text)
        console.log(`[changelog] CHANGELOG.md ${url}: parsed ${entries.length} entries`)
        return entries
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status !== 404) {
        console.warn(`[changelog] CHANGELOG.md ${url}: FAILED (${status ?? (err instanceof Error ? err.message : 'error')})`)
      }
    }
  }
  console.log(`[changelog] CHANGELOG.md ${repo}: not found`)
  return []
}

function parseChangelogMd(text: string): ChangelogEntry[] {
  // Matches: ## 1.2.3 | ## [v1.2.3] | ## Version 1.2.3 | ### Release 1.2.3 (date) | == 1.2.3 ==
  const versionRe = /^(?:#{1,3}\s+(?:\[?v?|[Vv]ersion\s+|[Rr]elease\s+)|\={2,}\s*v?)([\d]+\.[\d]+\.[\d]+[^\]\s\n]*)/gm
  const matches = [...text.matchAll(versionRe)]
  const entries: ChangelogEntry[] = []

  for (let i = 0; i < matches.length && i < 10; i++) {
    const m = matches[i]
    const version = m[1]
    const start = (m.index ?? 0) + m[0].length
    const end = matches[i + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    if (!body || body.length < 10) continue

    const categories = parseIntoCategories(body)
    const breaking = detectBreaking(body)
    entries.push({
      version,
      categories,
      body: categories.length > 0 ? '' : truncate(body, 800),
      hasBreakingChange: breaking.found,
      breakingDetails: breaking.details,
      source: 'changelog',
    })
  }
  return entries
}

// ── Bullet text cleanup ───────────────────────────────────────────────────────

/**
 * Strip noise from GitHub release bullet text.
 * Handles formats like:
 *   "* #11499 9743d0c Thanks @scs0209! - Fixed #11496: useValidAnchor now..."
 *   "- fix: resolve memory leak in handler by @user in #123"
 *   "* [feat] add new option ([#456](url)) by @user"
 */
function cleanBulletText(raw: string): string {
  return raw
    .replace(/^([•·*\-]\s*)+/, '')                                 // strip one or more leading bullet markers (•, *, -, ·)
    .replace(/^\d+\.\s+/, '')                                      // strip numbered marker
    // GitHub release PR+hash+author: "#11499 9743d0c Thanks @user! - "
    .replace(/^#\d+\s+[0-9a-f]{6,40}\s+Thanks\s+@[\w-]+[!,]?\s*[-–]?\s*/i, '')
    // hash+Thanks: "9743d0c Thanks @user! - "
    .replace(/^[0-9a-f]{6,40}\s+Thanks\s+@[\w-]+[!,]?\s*[-–]?\s*/i, '')
    // Node.js commit format: "abc1234def **subsystem**: description (user)"
    // Strip leading commit hash
    .replace(/^[0-9a-f]{7,40}\s+/, '')
    // Strip bold **subsystem** wrappers, keeping the text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    // standalone Thanks: "Thanks @user! - "
    .replace(/^Thanks\s+@[\w-]+[!,]?\s*[-–]?\s*/i, '')
    // trailing "(username)" contributor attribution
    .replace(/\s*\([A-Za-z][\w-]{1,30}\)\s*$/, '')
    // "by @user in #123" or "by @user"
    .replace(/\s+by\s+@[\w-]+(\s+in\s+#\d+)?/gi, '')
    // "in https://..." links
    .replace(/\s+in\s+https?:\/\/\S+/g, '')
    // Unwrap [text](url) markdown links → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Unwrap `code` → code
    .replace(/`([^`]+)`/g, '$1')
    // "#1234: text" — strip issue-ref prefix, keep description
    .replace(/#\d+:\s*/g, '')
    // remaining bare "#1234" refs
    .replace(/\s*#\d+\b/g, '')
    // collapse spaces
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Category parser ───────────────────────────────────────────────────────────

function parseIntoCategories(body: string): ChangelogCategory[] {
  const categories: ChangelogCategory[] = []

  // Split on ### sub-headings
  const sections = body.split(/^###\s+/m)

  for (const section of sections.slice(1)) {
    const lines = section.split('\n')
    const rawTitle = lines[0]
      .replace(/[\u{1F300}-\u{1FFFF}]/gu, '') // strip emoji
      .replace(/[*_`]/g, '')
      .trim()

    const normTitle = SECTION_ALIASES[rawTitle.toLowerCase()] ?? capitalise(rawTitle)

    const items = lines.slice(1)
      .map((l) => l.trim())
      .filter((l) => /^[•·*\-\d]/.test(l))      // bullet or numbered line (incl. Unicode bullets)
      .map(cleanBulletText)
      .filter((l) => l.length > 4 && l.length < 250)
      .filter((l) => !CHANGESET_HASH_RE.test(l) && !VERSION_PIN_RE.test(l))
      // Skip pure commit-hash lines that slipped through
      .filter((l) => !/^[0-9a-f]{7,40}$/.test(l))
      .slice(0, 6)

    if (items.length > 0) {
      categories.push({ title: normTitle, items })
    }
  }

  // Node.js / Go style: "Notable Changes" listed as `* **subsystem**: description`
  // under a non-### heading like "**Notable Changes**" or plain header
  if (categories.length === 0) {
    const notableMatch = body.match(/Notable Changes[^\n]*\n([\s\S]*?)(?:\n##|\n\*\*Commits|\z)/i)
    if (notableMatch) {
      const items = notableMatch[1]
        .split('\n')
        .filter((l) => /^[•·*\-]\s*/.test(l.trim()))
        .map(cleanBulletText)
        .filter((l) => l.length > 4 && l.length < 250)
        .slice(0, 6)
      if (items.length > 0) categories.push({ title: 'Minor Changes', items })
    }
  }

  // If no ### sections but there are top-level bullets, collect them as "Changes"
  if (categories.length === 0) {
    const bullets = body
      .split('\n')
      .filter((l) => /^[•·*\-]\s*/.test(l.trim()))
      .map(cleanBulletText)
      .filter((l) => l.length > 4 && l.length < 250)
      .filter((l) => !CHANGESET_HASH_RE.test(l) && !VERSION_PIN_RE.test(l))
      .filter((l) => !/^[0-9a-f]{7,40}$/.test(l))
      .slice(0, 8)

    if (bullets.length > 0) {
      categories.push({ title: 'Minor Changes', items: bullets })
    }
  }

  return categories
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompareUrl(repo: string, from: string, to: string): string {
  const tag = (v: string) => (v === 'unknown' ? '' : v.startsWith('v') ? v : `v${v}`)
  if (!tag(from)) return `https://github.com/${repo}/releases/tag/${tag(to)}`
  return `https://github.com/${repo}/compare/${tag(from)}...${tag(to)}`
}

function detectBreaking(body: string): { found: boolean; details: string[] } {
  const details: string[] = []
  const lower = body.toLowerCase()
  for (const kw of BREAKING_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      const line = body.split('\n').find((l) => l.toLowerCase().includes(kw.toLowerCase()))
      if (line) details.push(line.replace(/^[#*>\-\s]+/, '').trim())
    }
  }
  return { found: details.length > 0, details: [...new Set(details)].slice(0, 3) }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '\n…(truncated)'
}
