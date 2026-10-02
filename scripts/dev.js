#!/usr/bin/env node
/**
 * Cross-platform dev launcher — works in Git Bash, PowerShell, and CMD.
 * Spawns the Express server and Vite client directly via node.exe,
 * so no .cmd / batch files are involved and Ctrl+C terminates cleanly.
 */
const { spawn } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const clientDir = path.join(root, 'client')
const node = process.execPath // the exact node.exe running this script

const procs = []

function run(label, bin, args, cwd) {
  const p = spawn(node, [bin, ...args], {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: false,
  })
  p.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n[${label}] exited with code ${code}`)
    }
    // If one process dies unexpectedly, kill the others
    procs.forEach((other) => { try { other.kill() } catch {} })
    process.exit(code ?? 0)
  })
  procs.push(p)
  return p
}

// Express server (ts-node-dev) — run from project root
run('server', 'node_modules/ts-node-dev/lib/bin.js', [
  '--respawn',
  '--transpile-only',
  '--project', 'server/tsconfig.json',
  'server/index.ts',
])

// Vite dev server — must run from client/ so it finds index.html and config
run('client', path.join(clientDir, 'node_modules/vite/bin/vite.js'), [], clientDir)

// Ctrl+C → kill everything, no prompts
process.on('SIGINT', () => {
  procs.forEach((p) => { try { p.kill('SIGINT') } catch {} })
  process.exit(0)
})

process.on('SIGTERM', () => {
  procs.forEach((p) => { try { p.kill('SIGTERM') } catch {} })
  process.exit(0)
})
