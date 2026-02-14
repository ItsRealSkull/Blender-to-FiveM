import type { ConversionProgress } from './mesh/types'

const STEP_NAMES = [
  'Parsing 3D model',
  'Processing textures',
  'Generating drawable XML',
  'Generating collision',
  'Converting to GTA V binary',
  'Packaging FiveM resource'
]

export type ProgressCallback = (progress: ConversionProgress) => void

export function emitProgress(
  callback: ProgressCallback,
  step: number,
  message: string
): void {
  callback({
    step,
    totalSteps: STEP_NAMES.length,
    stepName: STEP_NAMES[step] || 'Processing',
    message,
    percent: Math.round(((step + 0.5) / STEP_NAMES.length) * 100)
  })
}
