import { useCallback } from 'react'
import { useAppStore, CollisionType, TextureQuality } from '../../store/app-store'

const SHADERS = [
  { value: 'default.sps', label: 'Default (diffuse only)' },
  { value: 'normal.sps', label: 'Normal (diffuse + normal map)' },
  { value: 'normal_spec.sps', label: 'Normal + Specular' },
  { value: 'spec.sps', label: 'Specular' },
  { value: 'emissive.sps', label: 'Emissive (self-illuminating)' },
  { value: 'cutout.sps', label: 'Cutout (alpha cutout)' }
]

const COLLISION_TYPES: { value: CollisionType; label: string; desc: string }[] = [
  { value: 'bbox', label: 'Bounding Box', desc: 'Fast, simple box collision' },
  { value: 'convex', label: 'Convex Hull', desc: 'Follows the shape, balanced' },
  { value: 'mesh', label: 'Triangle Mesh', desc: 'Precise, more expensive' }
]

const TEXTURE_QUALITIES: { value: TextureQuality; label: string; desc: string }[] = [
  { value: 'high', label: 'High', desc: 'BC7, 1024px' },
  { value: 'medium', label: 'Medium', desc: 'BC3, 512px' },
  { value: 'low', label: 'Low', desc: 'BC1, 256px' }
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: '13px',
  outline: 'none',
  width: '100%'
}

export function ConfigPanel() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const pipelineStatus = useAppStore((s) => s.pipelineStatus)
  const startConversion = useAppStore((s) => s.startConversion)

  const handleConvert = useCallback(async () => {
    if (!config.outputFolder) {
      const folder = await window.electronAPI.dialog.selectOutputFolder()
      if (!folder) return
      updateConfig({ outputFolder: folder })
      startConversion()
      window.electronAPI.convert.start({ ...config, outputFolder: folder })
    } else {
      startConversion()
      window.electronAPI.convert.start(config)
    }
  }, [config, updateConfig, startConversion])

  const handleSelectOutput = useCallback(async () => {
    const folder = await window.electronAPI.dialog.selectOutputFolder()
    if (folder) updateConfig({ outputFolder: folder })
  }, [updateConfig])

  const isRunning = pipelineStatus === 'running'

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      overflow: 'auto'
    }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
        Configuration
      </h3>

      {/* Prop Name */}
      <Field label="Prop Name">
        <input
          type="text"
          value={config.propName}
          onChange={(e) => updateConfig({ propName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          placeholder="prop_custom_name"
          style={inputStyle}
          disabled={isRunning}
        />
      </Field>

      {/* Shader */}
      <Field label="Shader">
        <select
          value={config.shaderName}
          onChange={(e) => updateConfig({ shaderName: e.target.value })}
          style={inputStyle}
          disabled={isRunning}
        >
          {SHADERS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </Field>

      {/* Collision Type */}
      <Field label="Collision">
        <div style={{ display: 'flex', gap: '6px' }}>
          {COLLISION_TYPES.map((ct) => (
            <button
              key={ct.value}
              onClick={() => updateConfig({ collisionType: ct.value })}
              disabled={isRunning}
              title={ct.desc}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: config.collisionType === ct.value ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                border: `1px solid ${config.collisionType === ct.value ? 'var(--accent)' : 'var(--border)'}`,
                color: config.collisionType === ct.value ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 500,
                cursor: isRunning ? 'default' : 'pointer'
              }}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Texture Quality */}
      <Field label="Texture Quality">
        <div style={{ display: 'flex', gap: '6px' }}>
          {TEXTURE_QUALITIES.map((tq) => (
            <button
              key={tq.value}
              onClick={() => updateConfig({ textureQuality: tq.value })}
              disabled={isRunning}
              title={tq.desc}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: config.textureQuality === tq.value ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                border: `1px solid ${config.textureQuality === tq.value ? 'var(--accent)' : 'var(--border)'}`,
                color: config.textureQuality === tq.value ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 500,
                cursor: isRunning ? 'default' : 'pointer'
              }}
            >
              {tq.label}
            </button>
          ))}
        </div>
      </Field>

      {/* LOD Distance */}
      <Field label="LOD High Distance">
        <input
          type="number"
          value={config.lodDistHigh}
          onChange={(e) => updateConfig({ lodDistHigh: Number(e.target.value) })}
          min={10}
          max={500}
          style={inputStyle}
          disabled={isRunning}
        />
      </Field>

      {/* Output Folder */}
      <Field label="Output Folder">
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            value={config.outputFolder}
            readOnly
            placeholder="Select output folder..."
            style={{ ...inputStyle, flex: 1, cursor: 'pointer', opacity: config.outputFolder ? 1 : 0.5 }}
            onClick={handleSelectOutput}
          />
          <button
            onClick={handleSelectOutput}
            disabled={isRunning}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              whiteSpace: 'nowrap'
            }}
          >
            Browse
          </button>
        </div>
      </Field>

      {/* Convert Button */}
      <button
        onClick={handleConvert}
        disabled={isRunning || !config.inputFile}
        style={{
          padding: '12px',
          borderRadius: 'var(--radius)',
          background: isRunning ? 'var(--bg-tertiary)' : 'var(--accent)',
          color: isRunning ? 'var(--text-muted)' : '#fff',
          fontSize: '14px',
          fontWeight: 600,
          cursor: isRunning ? 'default' : 'pointer',
          transition: 'all 0.2s ease',
          marginTop: '4px'
        }}
      >
        {isRunning ? 'Converting...' : 'Convert to FiveM Prop'}
      </button>
    </div>
  )
}
