import { useAppStore } from '../../store/app-store'

const STATUS_ICONS: Record<string, { color: string; symbol: string }> = {
  pending: { color: 'var(--text-muted)', symbol: '\u25CB' },
  running: { color: 'var(--accent)', symbol: '\u25CF' },
  complete: { color: 'var(--success)', symbol: '\u2713' },
  error: { color: 'var(--error)', symbol: '\u2717' }
}

export function ProgressPanel() {
  const steps = useAppStore((s) => s.steps)
  const pipelineStatus = useAppStore((s) => s.pipelineStatus)
  const errorMessage = useAppStore((s) => s.errorMessage)

  const completedCount = steps.filter((s) => s.status === 'complete').length
  const progressPercent = (completedCount / steps.length) * 100

  return (
    <div style={{
      flex: 1,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600 }}>Conversion Progress</h3>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: '4px',
        borderRadius: '2px',
        background: 'var(--bg-tertiary)',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          background: pipelineStatus === 'error' ? 'var(--error)' : 'var(--accent)',
          borderRadius: '2px',
          transition: 'width 0.3s ease'
        }} />
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {steps.map((step, i) => {
          const icon = STATUS_ICONS[step.status]
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: step.status === 'running' ? 'var(--accent-bg)' :
                             step.status === 'error' ? 'var(--error-bg)' : 'transparent'
              }}
            >
              <span style={{
                color: icon.color,
                fontSize: '14px',
                width: '18px',
                textAlign: 'center',
                ...(step.status === 'running' ? {
                  animation: 'pulse 1.5s infinite'
                } : {})
              }}>
                {icon.symbol}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{
                  fontSize: '13px',
                  color: step.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)'
                }}>
                  {step.name}
                </span>
                {step.message && (
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {step.message}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Error message */}
      {pipelineStatus === 'error' && errorMessage && (
        <div style={{
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--error-bg)',
          border: '1px solid rgba(239, 83, 80, 0.3)',
          fontSize: '12px',
          color: 'var(--error)',
          fontFamily: 'var(--font-mono)'
        }}>
          {errorMessage}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
