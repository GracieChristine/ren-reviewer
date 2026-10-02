import React from 'react'
import type { useSmokeTest } from '../hooks/useSmokeTest'

type SmokeState = ReturnType<typeof useSmokeTest>

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  idle:       { color: '#a090de', bg: 'rgba(140,136,186,0.2)', border: '#8c88ba' },
  triggering: { color: '#a090de', bg: 'rgba(140,136,186,0.2)', border: '#8c88ba' },
  pending:    { color: '#d4854a', bg: 'rgba(212,133,74,0.12)', border: '#d4854a' },
  running:    { color: '#d4854a', bg: 'rgba(212,133,74,0.12)', border: '#d4854a' },
  success:    { color: '#5ecfaa', bg: 'rgba(94,207,170,0.12)', border: '#5ecfaa' },
  failed:     { color: '#d94f4f', bg: 'rgba(217,79,79,0.12)',  border: '#d94f4f' },
  canceled:   { color: '#8c88ba', bg: 'rgba(115,109,164,0.15)',  border: '#8c88ba' },
  error:      { color: '#d94f4f', bg: 'rgba(217,79,79,0.12)',  border: '#d94f4f' },
}

const STATUS_LABEL: Record<string, string> = {
  idle:       '▶ Run Pipeline',
  triggering: 'Starting…',
  pending:    '⟳ Queued',
  running:    '⟳ Running',
  success:    '✔ Passed',
  failed:     '✖ Failed',
  canceled:   '· Canceled',
  error:      '⚠ Error',
}

interface Props {
  smoke: SmokeState
  /** When true the button renders grayed-out with a setup tooltip — no interaction */
  disabled?: boolean
}

export function SmokeButton({ smoke, disabled }: Props) {
  const { status, pipelineUrl, errorMsg, trigger } = smoke
  const isActive = !disabled && (status === 'idle' || status === 'error')
  const isTerminalWithLink = (status === 'success' || status === 'failed' || status === 'canceled' || status === 'running' || status === 'pending') && pipelineUrl

  const s = disabled
    ? { color: '#6b6698', bg: 'rgba(107,102,152,0.2)', border: '#413e74' }
    : STATUS_STYLE[status] ?? STATUS_STYLE.idle

  const label = disabled
    ? '▶ Run Pipeline'
    : STATUS_LABEL[status] ?? '▶ Run Pipeline'

  const tooltip = disabled
    ? 'Click ⚙ Pipeline in the top bar to configure CI variables for this repo'
    : status === 'error'
    ? errorMsg
    : status === 'idle'
    ? 'Run pipeline on this branch'
    : undefined

  const btn = (
    <button
      style={{
        borderRadius: '5px',
        cursor: isActive ? 'pointer' : 'default',
        fontSize: '0.72rem',
        fontWeight: 600,
        padding: '0.25rem 0.55rem',
        whiteSpace: 'nowrap' as const,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        opacity: disabled ? 0.45 : status === 'triggering' ? 0.6 : 1,
      }}
      onClick={isActive ? trigger : undefined}
      aria-disabled={!isActive}
      title={tooltip}
    >
      {label}
    </button>
  )

  if (isTerminalWithLink) {
    return (
      <a
        href={pipelineUrl!}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        {btn}
      </a>
    )
  }

  return btn
}
