export interface ShaderParam {
  name: string
  type: 'Texture' | 'Vector'
  value?: number[]
}

export interface ShaderDef {
  fileName: string
  renderBucket: number
  params: ShaderParam[]
}

export const SHADER_DEFS: Record<string, ShaderDef> = {
  'default.sps': {
    fileName: 'default.sps',
    renderBucket: 0,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'HardAlphaBlend', type: 'Vector', value: [0, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  },
  'normal.sps': {
    fileName: 'normal.sps',
    renderBucket: 0,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'BumpSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'HardAlphaBlend', type: 'Vector', value: [0, 0, 0, 0] },
      { name: 'bumpiness', type: 'Vector', value: [1, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  },
  'normal_spec.sps': {
    fileName: 'normal_spec.sps',
    renderBucket: 0,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'BumpSampler', type: 'Texture' },
      { name: 'SpecSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'HardAlphaBlend', type: 'Vector', value: [0, 0, 0, 0] },
      { name: 'bumpiness', type: 'Vector', value: [1, 0, 0, 0] },
      { name: 'specularIntensityMult', type: 'Vector', value: [0.5, 0, 0, 0] },
      { name: 'specularFalloffMult', type: 'Vector', value: [50, 0, 0, 0] },
      { name: 'specularFresnel', type: 'Vector', value: [0.97, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  },
  'spec.sps': {
    fileName: 'spec.sps',
    renderBucket: 0,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'SpecSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'HardAlphaBlend', type: 'Vector', value: [0, 0, 0, 0] },
      { name: 'specularIntensityMult', type: 'Vector', value: [0.5, 0, 0, 0] },
      { name: 'specularFalloffMult', type: 'Vector', value: [50, 0, 0, 0] },
      { name: 'specularFresnel', type: 'Vector', value: [0.97, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  },
  'emissive.sps': {
    fileName: 'emissive.sps',
    renderBucket: 1,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'EmissiveMultiplier', type: 'Vector', value: [1, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  },
  'cutout.sps': {
    fileName: 'cutout.sps',
    renderBucket: 1,
    params: [
      { name: 'DiffuseSampler', type: 'Texture' },
      { name: 'matMaterialColorScale', type: 'Vector', value: [1, 0, 0, 1] },
      { name: 'HardAlphaBlend', type: 'Vector', value: [1, 0, 0, 0] },
      { name: 'useTessellation', type: 'Vector', value: [0, 0, 0, 0] }
    ]
  }
}

export function getShaderDef(name: string): ShaderDef {
  return SHADER_DEFS[name] || SHADER_DEFS['default.sps']
}

export function getTextureSamplerNames(shaderName: string): { diffuse: string; normal?: string; specular?: string } {
  const result: { diffuse: string; normal?: string; specular?: string } = { diffuse: 'DiffuseSampler' }
  const def = getShaderDef(shaderName)

  for (const p of def.params) {
    if (p.name === 'BumpSampler') result.normal = 'BumpSampler'
    if (p.name === 'SpecSampler') result.specular = 'SpecSampler'
  }

  return result
}
