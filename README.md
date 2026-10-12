# Ren, the Reviewer

A desktop app for reviewing open Renovate merge requests on GitLab — fetches changelog data, checks CI status, and gives a clear merge verdict for each MR.

## Features

- Connects to GitLab with your personal access token (held in memory only, never stored)
- Finds all open Renovate-authored MRs in the selected repo
- For each MR: fetches changelog from npm/GitHub, detects breaking changes, checks CI status
- Colour-coded verdict: ✅ Safe to merge / ⚠️ Review needed / ❌ Blocked

## Download

Grab the latest installer from [Releases](../../releases).

## Verdict logic

| Condition | Verdict |
|---|---|
| CI pipeline failed | ❌ Blocked |
| Breaking change keyword in changelog | ⚠️ Review |
| Major version bump | ⚠️ Review |
| Grouped update (multiple packages) | ⚠️ Review |
| Minor bump (CI passed) | ⚠️ Review (skim changelog) |
| Patch bump + CI passed + no breaking | ✅ Safe |

## GitLab token

Create a token at: https://gitlab.com/-/user_settings/personal_access_tokens

Required scope: **read_api** (read-only — fetches MRs and pipeline status only)

## Pinned repositories

The repo selector includes two pre-pinned repos:
- `players-automated-tests`
- `digital-signage-cloud-tests`

Any custom GitLab project path also works (e.g. `namespace/group/project-name`).

## Development

```bash
cd ren-reviewer
npm install
cd client && npm install && cd ..
cp .env.example .env
npm run dev
```

## Build installer

```bash
npm run electron:pack        # patch version bump + NSIS installer
npm run electron:pack:minor  # minor version bump
npm run electron:pack:major  # major version bump
```

Output goes to `release/`.
