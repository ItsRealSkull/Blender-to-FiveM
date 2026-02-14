import { useState, useCallback, DragEvent } from 'react'
import { useAppStore } from '../../store/app-store'

const ACCEPTED_EXTENSIONS = ['.fbx', '.obj', '.blend', '.glb', '.gltf']

export function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false)
  const setInputFile = useAppStore((s) => s.setInputFile)

  const handleFile = useCallback((filePath: string, fileName: string) => {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return
    }

    setInputFile({
      path: filePath,
      name: fileName,
      extension: ext,
      size: 0
    })
  }, [setInputFile])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      const filePath = (file as unknown as { path: string }).path
      handleFile(filePath, file.name)
    }
  }, [handleFile])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleBrowse = useCallback(async () => {
    const filePath = await window.electronAPI.dialog.selectFile()
    if (filePath) {
      const name = filePath.split(/[\\/]/).pop() || ''
      handleFile(filePath, name)
    }
  }, [handleFile])

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        background: isDragOver ? 'var(--accent-bg)' : 'var(--bg-secondary)',
        border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '48px 32px',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        minHeight: '300px'
      }}
      onClick={handleBrowse}
    >
      {/* Icon */}
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: isDragOver ? 'var(--accent)' : 'var(--bg-tertiary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '28px',
        transition: 'all 0.2s ease'
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isDragOver ? '#fff' : '#999'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontSize: '16px',
          fontWeight: 500,
          color: isDragOver ? 'var(--accent)' : 'var(--text-primary)',
          marginBottom: '8px'
        }}>
          {isDragOver ? 'Drop your model here' : 'Drag & drop a 3D model'}
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          or click to browse
        </p>
      </div>

      <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        justifyContent: 'center'
      }}>
        {ACCEPTED_EXTENSIONS.map((ext) => (
          <span
            key={ext}
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-tertiary)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {ext}
          </span>
        ))}
      </div>
    </div>
  )
}
