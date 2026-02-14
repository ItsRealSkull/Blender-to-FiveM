export interface Vec2 {
  u: number
  v: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Vec4 {
  x: number
  y: number
  z: number
  w: number
}

export interface InternalVertex {
  position: Vec3
  normal: Vec3
  texCoord: Vec2
  tangent?: Vec4
  color?: Vec4
}

export interface InternalGeometry {
  materialIndex: number
  vertices: InternalVertex[]
  indices: number[]
}

export interface InternalMaterial {
  name: string
  diffuseTexturePath: string | null
  normalTexturePath: string | null
  specularTexturePath: string | null
  diffuseColor: Vec4
  shaderName: string
}

export interface BoundingBox {
  min: Vec3
  max: Vec3
}

export interface BoundingSphere {
  center: Vec3
  radius: number
}

export interface InternalMesh {
  name: string
  geometries: InternalGeometry[]
  materials: InternalMaterial[]
  boundingBox: BoundingBox
  boundingSphere: BoundingSphere
}

export type CollisionType = 'bbox' | 'convex' | 'mesh'
export type TextureQuality = 'high' | 'medium' | 'low'

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

export interface ConversionProgress {
  step: number
  totalSteps: number
  stepName: string
  message: string
  percent: number
}

export interface ConversionResult {
  success: boolean
  resourcePath: string
  files: { name: string; size: number; path: string }[]
}

export interface ModelParser {
  parse(filePath: string): Promise<InternalMesh>
}
