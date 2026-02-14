import type { InternalMesh, CollisionType } from '../mesh/types'
import { generateBoundsXml } from '../xml-generators/bounds-xml'

export function generateCollisionXml(mesh: InternalMesh, type: CollisionType): string {
  return generateBoundsXml(mesh, type)
}
