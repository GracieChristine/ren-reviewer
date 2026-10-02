import React, { useState, useEffect } from 'react'
import type { usePipelineRun } from '../hooks/usePipelineRun'

type PipelineRunState = ReturnType<typeof usePipelineRun>

const STATUS_COLOR: Record<string, string> = {
  success:  '#5ecfaa',
  failed:   '#d94f4f',
  canceled: '#8c88ba',
}

const STATUS_LABEL: Record<string, string> = {
  idle:       '▶ Run Pipeline',
  triggering: 'Starting…',
  pending:    '⟳ Queued',
  running:    '⟳ Running',
  success:    '✔ Passed',
  failed:     '✖ Failed',
  canceled:   '· Canceled',
  error:      '⚠ Error — Retry',
}

interface Props {
  pipeline: PipelineRunState
  disabled?: boolean
}

export function PipelineButton({ pipeline, disabled }: Props) {
  const { status, pipelineUrl, errorMsg, trigger } = pipeline
  const [errorDismissed, setErrorDismissed] = useState(false)

  // Un-dismiss error when a new trigger attempt starts
  useEffect(() => {
    if (status === 'triggering') setErrorDismissed(false)
  }, [status])

  const isTerminal = status === 'success' || status === 'failed' || status === 'canceled'
  const isActive   = !disabled && (status === 'idle' || status === 'error')
  const isInFlight = status === 'triggering' || status === 'pending' || status === 'running'

  // ── Disabled (not configured) ─────────────────────────────────────────────
  if (disabled) {
    return (
      <button
        style={triggerBtnStyle({ color: '#8c88ba', bg: 'rgba(107,102,152,0.2)', border: '#6b6698', opacity: 0.7 })}
        aria-disabled
        title="Click ⚙ Pipeline in the top bar to configure CI variables for this repo"
      >
        ▶ Run Pipeline
      </button>
    )
  }

  // ── Terminal state: show status + View link + Run again button ────────────
  if (isTerminal) {
    const col = STATUS_COLOR[status] ?? '#8c88ba'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ color: col, fontSize: '0.72rem', fontWeight: 600 }}>
            {STATUS_LABEL[status]}
          </span>
          {pipelineUrl && (
            <a
              href={pipelineUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#8c88ba', fontSize: '0.7rem', textDecoration: 'none' }}
              onClick={(e) => e.stopPropagation()}
              title="Open pipeline in GitLab"
            >
              View ↗
            </a>
          )}
          <button
            style={triggerBtnStyle({ color: '#c4b8f0', bg: 'rgba(140,136,186,0.2)', border: '#a090de' })}
            onClick={trigger}
            title="Trigger a new pipeline on this branch"
          >
            ▶ Run again
          </button>
        </div>
      </div>
    )
  }

  // ── In-flight: show status + View link (no interaction) ──────────────────
  if (isInFlight) {
    const col = status === 'running' || status === 'pending' ? '#d4854a' : '#a090de'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color: col, fontSize: '0.72rem', fontWeight: 600, opacity: status === 'triggering' ? 0.6 : 1 }}>
          {STATUS_LABEL[status]}
        </span>
        {pipelineUrl && (
          <a
            href={pipelineUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#8c88ba', fontSize: '0.7rem', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
            title="Open pipeline in GitLab"
          >
            View ↗
          </a>
        )}
      </div>
    )
  }

  // ── Idle / error ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
      <button
        style={triggerBtnStyle({ color: '#c4b8f0', bg: 'rgba(140,136,186,0.2)', border: '#a090de' })}
        onClick={isActive ? trigger : undefined}
        title={status === 'idle' ? 'Run pipeline on this branch' : undefined}
      >
        {STATUS_LABEL[status] ?? '▶ Run Pipeline'}
      </button>

      {status === 'error' && errorMsg && !errorDismissed && (
        <div
          style={{
            position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 1000,
            background: '#1b1033', border: '1px solid #d94f4f', borderRadius: '10px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            color: '#fca5a5', fontSize: '0.82rem', lineHeight: 1.5,
            maxWidth: '420px', padding: '1rem 1.25rem',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Pipeline Error</div>
              <div style={{ color: '#fca5a5' }}>{errorMsg}</div>
            </div>
            <button
              onClick={() => setErrorDismissed(true)}
              style={{
                background: 'transparent', border: 'none', color: '#8c88ba',
                cursor: 'pointer', fontSize: '1rem', lineHeight: 1, flexShrink: 0,
                padding: '0.1rem 0.2rem',
              }}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function triggerBtnStyle({ color, bg, border, opacity = 1 }: { color: string; bg: string; border: string; opacity?: number }): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, borderRadius: '5px',
    color, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
    opacity, padding: '0.25rem 0.55rem', whiteSpace: 'nowrap',
  }
}
