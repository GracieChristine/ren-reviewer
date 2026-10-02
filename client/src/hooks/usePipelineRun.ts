import { useState, useEffect, useRef } from 'react'

export type PipelineStatus = 'idle' | 'triggering' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'error'

interface PipelineRunState {
  status: PipelineStatus
  pipelineUrl: string | null
  errorMsg: string
}

const TERMINAL: PipelineStatus[] = ['success', 'failed', 'canceled', 'error']
const POLL_MS = 10_000  // poll every 10 s

export interface PipelineVar { key: string; value: string }

export function usePipelineRun(token: string, projectId: string, branch: string, variables: PipelineVar[]) {
  const [state, setState] = useState<PipelineRunState>({ status: 'idle', pipelineUrl: null, errorMsg: '' })
  const pipelineIdRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function pollStatus() {
    if (!pipelineIdRef.current) return
    try {
      const res = await fetch(
        `/api/pipeline/status?gitlabToken=${encodeURIComponent(token)}&projectId=${encodeURIComponent(projectId)}&pipelineId=${pipelineIdRef.current}`
      )
      const data = await res.json()
      const mapped = mapStatus(data.status)
      setState((prev) => ({ ...prev, status: mapped, pipelineUrl: data.webUrl ?? prev.pipelineUrl }))
      if (TERMINAL.includes(mapped)) clearTimer()
    } catch {
      // polling failure — keep trying
    }
  }

  async function trigger() {
    clearTimer()
    pipelineIdRef.current = null
    setState({ status: 'triggering', pipelineUrl: null, errorMsg: '' })
    try {
      const res = await fetch('/api/pipeline/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitlabToken: token, projectId, ref: branch, variables }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
      pipelineIdRef.current = data.id
      const mapped = mapStatus(data.status)
      setState({ status: mapped, pipelineUrl: data.webUrl, errorMsg: '' })

      // Always start polling — catches fast pipelines and confirms status
      timerRef.current = setInterval(pollStatus, POLL_MS)
    } catch (err: unknown) {
      setState({ status: 'error', pipelineUrl: null, errorMsg: err instanceof Error ? err.message : String(err) })
    }
  }

  // Clean up interval on unmount
  useEffect(() => () => clearTimer(), [])

  return { ...state, trigger }
}

function mapStatus(raw: string | undefined): PipelineStatus {
  switch (raw) {
    case 'success':                    return 'success'
    case 'failed':                     return 'failed'
    case 'canceled': case 'canceling': return 'canceled'
    case 'running':                    return 'running'
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':                  return 'pending'
    default:                           return 'pending'
  }
}
