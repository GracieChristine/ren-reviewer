import React, { useState } from 'react'
import type { PipelineVar } from '../types'

interface Props {
  projectId: string
  initialVars: PipelineVar[]
  onSave: (vars: PipelineVar[]) => void
  onClose: () => void
}

export function PipelineSettingsModal({ projectId, initialVars, onSave, onClose }: Props) {
  const [rows, setRows] = useState<PipelineVar[]>(
    initialVars.length > 0 ? initialVars : [{ key: '', value: '' }]
  )

  function updateRow(i: number, field: 'key' | 'value', val: string) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }])
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    const clean = rows.filter((r) => r.key.trim())
    onSave(clean)
  }

  // Short name for the project (last segment)
  const repoName = projectId.split('/').pop() ?? projectId

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>Pipeline Variables</span>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={styles.subtitle}>
          Variables passed when triggering a pipeline for{' '}
          <span style={styles.repoName}>{repoName}</span>.
          Saved locally in your browser.
        </p>

        {rows.length === 0 && (
          <p style={styles.empty}>No variables. Add one below to enable the Run Pipeline button.</p>
        )}

        <div style={styles.varList}>
          {rows.map((row, i) => (
            <div key={i} style={styles.varRow}>
              <input
                style={styles.keyInput}
                placeholder="KEY"
                value={row.key}
                onChange={(e) => updateRow(i, 'key', e.target.value)}
                spellCheck={false}
              />
              <span style={styles.eq}>=</span>
              <input
                style={styles.valInput}
                placeholder="value"
                value={row.value}
                onChange={(e) => updateRow(i, 'value', e.target.value)}
                spellCheck={false}
              />
              <button
                style={styles.removeBtn}
                onClick={() => removeRow(i)}
                aria-label="Remove variable"
                title="Remove"
              >✕</button>
            </div>
          ))}
        </div>

        <button style={styles.addBtn} onClick={addRow}>+ Add Variable</button>

        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(3px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200,
  },
  modal: {
    background: '#1b1033', border: '1px solid #413e74', borderRadius: '12px',
    padding: '1.75rem', width: '100%', maxWidth: '440px',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#ddd7ef', fontSize: '1rem', fontWeight: 700 },
  closeBtn: {
    background: 'transparent', border: 'none', color: '#736da4',
    cursor: 'pointer', fontSize: '0.9rem', padding: '0.2rem 0.4rem',
  },
  subtitle: { color: '#8c88ba', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 },
  repoName: { color: '#a090de', fontWeight: 600 },
  empty: { color: '#736da4', fontSize: '0.8rem', margin: 0 },
  varList: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  varRow: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  keyInput: {
    background: '#120e23', border: '1px solid #413e74', borderRadius: '5px',
    color: '#ddd7ef', fontSize: '0.8rem', padding: '0.4rem 0.55rem',
    width: '38%', fontFamily: 'monospace', textTransform: 'uppercase' as const,
  },
  eq: { color: '#736da4', fontSize: '0.85rem', flexShrink: 0 },
  valInput: {
    background: '#120e23', border: '1px solid #413e74', borderRadius: '5px',
    color: '#ddd7ef', fontSize: '0.8rem', padding: '0.4rem 0.55rem',
    flex: 1, fontFamily: 'monospace',
  },
  removeBtn: {
    background: 'transparent', border: 'none', color: '#736da4',
    cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.3rem',
    flexShrink: 0,
  },
  addBtn: {
    background: 'transparent', border: '1px dashed #413e74', borderRadius: '6px',
    color: '#8c88ba', cursor: 'pointer', fontSize: '0.8rem',
    padding: '0.4rem 0.75rem', textAlign: 'left' as const,
  },
  actions: { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '0.25rem' },
  cancelBtn: {
    background: 'transparent', border: '1px solid #413e74', borderRadius: '6px',
    color: '#8c88ba', cursor: 'pointer', fontSize: '0.82rem', padding: '0.45rem 1rem',
  },
  saveBtn: {
    background: 'rgba(139,127,204,0.15)', border: '1px solid #a090de', borderRadius: '6px',
    color: '#ddd7ef', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
    padding: '0.45rem 1.25rem',
  },
}
