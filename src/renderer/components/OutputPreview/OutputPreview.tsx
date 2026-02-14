import { useAppStore } from '../../store/app-store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

const FILE_ICONS: Record<string, string> = {
  '.ydr': '#5b8def',
  '.ytd': '#4caf50',
  '.ytyp': '#ff9800',
  '.ybn': '#e91e63',
  '.lua': '#9c27b0',
  '.zip': '#795548'
}

export function OutputPreview() {
  const outputPath = useAppStore((s) => s.outputPath)
  const outputFiles = useAppStore((s) => s.outputFiles)
  const config = useAppStore((s) => s.config)
  const reset = useAppStore((s) => s.reset)

  const handleOpenFolder = () => {
    if (outputPath) {
      window.electronAPI.shell.openFolder(outputPath)
    }
  }

  const manifest = `fx_version 'cerulean'
game 'gta5'

description '${config.propName} - Custom prop'

files {
    'stream/${config.propName}.ytyp'
}

data_file 'DLC_ITYP_REQUEST' 'stream/${config.propName}.ytyp'`

  return (
    <div style={{
      flex: 1,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      overflow: 'auto'
    }}>
      {/* Success header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--success-bg)',
        border: '1px solid rgba(76, 175, 80, 0.3)'
      }}>
        <span style={{ color: 'var(--success)', fontSize: '18px' }}>{'\u2713'}</span>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--success)' }}>
            Conversion Complete
          </p>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            FiveM resource ready at: {outputPath}
          </p>
        </div>
      </div>

      {/* File tree */}
      <div>
        <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500 }}>
          Generated Files
        </h4>
        <div style={{
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          padding: '10px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px'
        }}>
          <div style={{ color: 'var(--accent)', marginBottom: '4px' }}>
            {config.propName}/
          </div>
          {outputFiles.map((file) => {
            const ext = file.name.substring(file.name.lastIndexOf('.'))
            const color = FILE_ICONS[ext] || 'var(--text-secondary)'
            return (
              <div key={file.name} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '3px 0 3px 16px',
                color: 'var(--text-primary)'
              }}>
                <span>
                  <span style={{ color, marginRight: '6px' }}>{'\u25CF'}</span>
                  {file.name}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{formatSize(file.size)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Manifest preview */}
      <div>
        <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500 }}>
          fxmanifest.lua
        </h4>
        <pre style={{
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          padding: '10px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          maxHeight: '150px'
        }}>
          {manifest}
        </pre>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleOpenFolder}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: 'var(--radius)',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600
          }}
        >
          Open in Explorer
        </button>
        <button
          onClick={reset}
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: '13px'
          }}
        >
          New Conversion
        </button>
      </div>

      {/* Usage instructions */}
      <div style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-tertiary)',
        fontSize: '11px',
        color: 'var(--text-muted)',
        lineHeight: 1.6
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>How to use in FiveM:</strong><br />
        1. Copy the <code>{config.propName}/</code> folder to your server's <code>resources/</code> directory<br />
        2. Add <code>ensure {config.propName}</code> to your <code>server.cfg</code><br />
        3. Restart the server and spawn with <code>/prop {config.propName}</code>
      </div>
    </div>
  )
}
