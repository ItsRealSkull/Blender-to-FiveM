import { useEffect } from 'react'
import { DropZone } from './components/DropZone/DropZone'
import { ModelPreview } from './components/ModelPreview/ModelPreview'
import { ConfigPanel } from './components/ConfigPanel/ConfigPanel'
import { ProgressPanel } from './components/ProgressPanel/ProgressPanel'
import { OutputPreview } from './components/OutputPreview/OutputPreview'
import { useAppStore } from './store/app-store'

export default function App() {
  const { inputFile, pipelineStatus, updateProgress, setComplete, setError } = useAppStore()

  useEffect(() => {
    const unsubProgress = window.electronAPI.convert.onProgress((progress) => {
      updateProgress(progress.step, progress.message)
    })
    const unsubComplete = window.electronAPI.convert.onComplete((result) => {
      setComplete(result.resourcePath, result.files)
    })
    const unsubError = window.electronAPI.convert.onError((error) => {
      setError(error.message)
    })
    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  }, [updateProgress, setComplete, setError])

  const showOutput = pipelineStatus === 'complete'
  const showProgress = pipelineStatus === 'running' || pipelineStatus === 'error'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: 'auto 1fr auto',
      gap: '12px',
      padding: '16px',
      height: '100vh',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        paddingBottom: '4px',
        borderBottom: '1px solid var(--border)'
      }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Blender to FiveM
        </h1>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Prop Converter
        </span>
      </div>

      {/* Left column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
        {!inputFile ? (
          <DropZone />
        ) : (
          <>
            <ModelPreview />
            <ConfigPanel />
          </>
        )}
      </div>

      {/* Right column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>
        {!inputFile && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            Drop a 3D model to get started
          </div>
        )}
        {inputFile && !showProgress && !showOutput && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            Configure settings and click Convert
          </div>
        )}
        {showProgress && <ProgressPanel />}
        {showOutput && <OutputPreview />}
      </div>
    </div>
  )
}
