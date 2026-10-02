import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { analyzeRouter } from './routes/analyze'
import { approveRouter } from './routes/approve'
import { repoScanRouter } from './routes/repo-scan'
import { pipelineRouter } from './routes/pipeline'
import { cacheRouter } from './routes/cache'

const app = express()

/**
 * Start the Express server.
 * @param port   Port to listen on (default: process.env.PORT or 3000)
 * @param staticPath  If provided, serve a built React app from this directory.
 *                    Used by the Electron production build.
 */
export function startServer(
  port: number | string = process.env.PORT ?? 3000,
  staticPath?: string | null
): Promise<void> {
  // In dev, allow the Vite dev server origin; in prod (Electron), same-origin — no CORS needed
  if (!staticPath) {
    app.use(cors({ origin: ['http://localhost:8000', `http://localhost:${port}`] }))
  }

  app.use(express.json())

  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/analyze', analyzeRouter)
  app.use('/api/approve', approveRouter)
  app.use('/api/repo-scan', repoScanRouter)
  app.use('/api/pipeline', pipelineRouter)
  app.use('/api/cache', cacheRouter)

  // Production: serve the built React app and let React Router handle the rest
  if (staticPath) {
    app.use(express.static(staticPath))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticPath, 'index.html'))
    })
  }

  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`\n  🔍 Renovate Reviewer server running`)
      console.log(`     http://localhost:${port}\n`)
      resolve()
    })
  })
}

// Run directly (ts-node-dev / node dist/server/index.js)
if (require.main === module) {
  startServer()
}
