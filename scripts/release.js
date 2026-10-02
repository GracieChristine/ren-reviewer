#!/usr/bin/env node
/**
 * Interactive release script — prompts for version bump type,
 * then builds and packages the Electron installer.
 *
 * Usage: node scripts/release.js
 *        npm run release
 */
const { execSync } = require('child_process')
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

console.log('\n🔍 Renovate Reviewer — Release Builder')
console.log('──────────────────────────────────────')
console.log('  patch — bug fix or small tweak   (0.1.x → 0.1.x+1)')
console.log('  minor — new feature added         (0.x.0 → 0.x+1.0)')
console.log('  major — significant overhaul      (x.0.0 → x+1.0.0)')
console.log('')

rl.question('Choose version bump [patch/minor/major]: ', (answer) => {
  rl.close()

  const bump = answer.trim().toLowerCase()

  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error(`\n✗ Invalid choice "${bump}". Run again and enter patch, minor, or major.\n`)
    process.exit(1)
  }

  console.log(`\n→ Version bump: ${bump}`)
  console.log('→ Building...\n')

  try {
    // Bump version in package.json (no git tag — repo may not be set up yet)
    execSync(`npm version ${bump} --no-git-tag-version`, { stdio: 'inherit' })

    // Full build: TypeScript + Vite
    execSync('npm run build', { stdio: 'inherit' })

    // Package with electron-builder (no code signing for internal builds)
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    execSync('npx electron-builder --win --x64', { stdio: 'inherit' })

    // Read the new version to print a summary
    const { version } = require('../package.json')
    console.log(`\n✅ Done! Installer: release/Renovate Reviewer Setup ${version}.exe\n`)
  } catch (err) {
    console.error('\n✗ Build failed. See output above.\n')
    process.exit(1)
  }
})
