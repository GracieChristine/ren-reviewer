import { Router } from 'express'
import type { Request, Response } from 'express'
import { clearCache, cacheStats } from '../services/changelog-cache'

export const cacheRouter = Router()

cacheRouter.get('/stats', (_req: Request, res: Response) => {
  res.json(cacheStats())
})

cacheRouter.post('/clear', (_req: Request, res: Response) => {
  const result = clearCache()
  res.json(result)
})
