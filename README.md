# Renovate Reviewer

A local web dashboard for reviewing open Renovate MRs — fetches changelog data, checks CI status, and gives a clear merge verdict for each MR.

## What it does

1. Connects to GitLab using your personal access token (held in memory only, never stored)
2. Finds all open Renovate-authored MRs in the selected repo
3. For each MR: fetches changelog from npm/GitHub, detects breaking changes, checks CI status
4. Displays a colour-coded verdict: ✅ Safe to merge / ⚠️ Review needed / ❌ Blocked

## Setup

```bash
# 1. Install dependencies (run once)
cd renovate-reviewer
npm install
cd client && npm install && cd ..

# 2. Copy the env file (no values needed — token is entered in the UI)
cp .env.example .env

# 3. Start the app
npm run dev
```

Then open http://localhost:5173 in your browser.

## Pinned repositories

The repo selector includes two pre-pinned repos:
- `players-automated-tests`
- `digital-signage-cloud-tests`

You can also enter any custom GitLab project path (e.g. `namespace/group/project-name`).

## GitLab token

Create a token at: https://gitlab.com/-/user_settings/personal_access_tokens

Required scope: **read_api** (read-only is enough to fetch MRs and pipeline status)

## Verdict logic

| Condition | Verdict |
|---|---|
| CI pipeline failed | ❌ Blocked |
| Breaking change keyword in changelog | ⚠️ Review |
| Major version bump | ⚠️ Review |
| Grouped update (multiple packages) | ⚠️ Review |
| Minor bump (CI passed) | ⚠️ Review (skim changelog) |
| Patch bump + CI passed + no breaking | ✅ Safe |

## Future: desktop app

The plan is to wrap this in Electron so it launches as a standalone desktop app — the Express server starts automatically when you open the app, and stops when you close it. No browser tab needed.
