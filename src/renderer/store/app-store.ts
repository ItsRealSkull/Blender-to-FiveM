import { create } from 'zustand'

export type CollisionType = 'bbox' | 'convex' | 'mesh'
export type TextureQuality = 'high' | 'medium' | 'low'
export type PipelineStatus = 'idle' | 'running' | 'complete' | 'error'

export interface FileInfo {
  path: string
  name: string
  extension: string
  size: number
}

export interface ConversionConfig {
  inputFile: string
  propName: string
  outputFolder: string
  collisionType: CollisionType
  textureQuality: TextureQuality
  shaderName: string
  lodDistHigh: number
  lodDistMed: number
  lodDistLow: number
  lodDistVlow: number
  generateZip: boolean
}

export interface PipelineStep {
  name: string
  status: 'pending' | 'running' | 'complete' | 'error'
  message?: string
}

export interface OutputFile {
  name: string
  size: number
  path: string
}

export interface AppState {
  inputFile: FileInfo | null
  config: ConversionConfig
  pipelineStatus: PipelineStatus
  steps: PipelineStep[]
  outputPath: string | null
  outputFiles: OutputFile[]
  errorMessage: string | null

  setInputFile: (file: FileInfo | null) => void
  updateConfig: (partial: Partial<ConversionConfig>) => void
  setOutputFolder: (path: string) => void
  startConversion: () => void
  updateProgress: (step: number, message: string) => void
  setComplete: (outputPath: string, files: OutputFile[]) => void
  setError: (message: string) => void
  reset: () => void
}

const PIPELINE_STEPS: string[] = [
  'Parsing 3D model',
  'Processing textures',
  'Generating drawable XML',
  'Generating collision',
  'Converting to GTA V binary',
  'Packaging FiveM resource'
]

const defaultConfig: ConversionConfig = {
  inputFile: '',
  propName: 'prop_custom',
  outputFolder: '',
  collisionType: 'bbox',
  textureQuality: 'high',
  shaderName: 'default.sps',
  lodDistHigh: 100,
  lodDistMed: 0,
  lodDistLow: 0,
  lodDistVlow: 0,
  generateZip: false
}

export const useAppStore = create<AppState>((set) => ({
  inputFile: null,
  config: { ...defaultConfig },
  pipelineStatus: 'idle',
  steps: PIPELINE_STEPS.map((name) => ({ name, status: 'pending' as const })),
  outputPath: null,
  outputFiles: [],
  errorMessage: null,

  setInputFile: (file) => {
    set((state) => {
      const propName = file
        ? file.name
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^(\d)/, 'prop_$1')
        : 'prop_custom'

      return {
        inputFile: file,
        config: { ...state.config, inputFile: file?.path ?? '', propName },
        pipelineStatus: 'idle',
        steps: PIPELINE_STEPS.map((name) => ({ name, status: 'pending' as const })),
        outputPath: null,
        outputFiles: [],
        errorMessage: null
      }
    })
  },

  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),

  setOutputFolder: (path) =>
    set((state) => ({ config: { ...state.config, outputFolder: path } })),

  startConversion: () =>
    set({
      pipelineStatus: 'running',
      steps: PIPELINE_STEPS.map((name) => ({ name, status: 'pending' as const })),
      outputPath: null,
      outputFiles: [],
      errorMessage: null
    }),

  updateProgress: (step, message) =>
    set((state) => ({
      steps: state.steps.map((s, i) => {
        if (i < step) return { ...s, status: 'complete' as const }
        if (i === step) return { ...s, status: 'running' as const, message }
        return { ...s, status: 'pending' as const }
      })
    })),

  setComplete: (outputPath, files) =>
    set((state) => ({
      pipelineStatus: 'complete',
      outputPath,
      outputFiles: files,
      steps: state.steps.map((s) => ({ ...s, status: 'complete' as const }))
    })),

  setError: (message) =>
    set((state) => ({
      pipelineStatus: 'error',
      errorMessage: message,
      steps: state.steps.map((s) =>
        s.status === 'running' ? { ...s, status: 'error' as const, message } : s
      )
    })),

  reset: () =>
    set({
      inputFile: null,
      config: { ...defaultConfig },
      pipelineStatus: 'idle',
      steps: PIPELINE_STEPS.map((name) => ({ name, status: 'pending' as const })),
      outputPath: null,
      outputFiles: [],
      errorMessage: null
    })
}))
