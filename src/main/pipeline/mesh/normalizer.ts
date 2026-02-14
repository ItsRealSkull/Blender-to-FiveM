import type { InternalMesh, InternalVertex, Vec3, BoundingBox, BoundingSphere } from './types'

export function computeBoundingBox(mesh: InternalMesh): BoundingBox {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }

  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      min.x = Math.min(min.x, v.position.x)
      min.y = Math.min(min.y, v.position.y)
      min.z = Math.min(min.z, v.position.z)
      max.x = Math.max(max.x, v.position.x)
      max.y = Math.max(max.y, v.position.y)
      max.z = Math.max(max.z, v.position.z)
    }
  }

  if (min.x === Infinity) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }

  return { min, max }
}

export function computeBoundingSphere(bb: BoundingBox): BoundingSphere {
  const center: Vec3 = {
    x: (bb.min.x + bb.max.x) / 2,
    y: (bb.min.y + bb.max.y) / 2,
    z: (bb.min.z + bb.max.z) / 2
  }
  const dx = bb.max.x - bb.min.x
  const dy = bb.max.y - bb.min.y
  const dz = bb.max.z - bb.min.z
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2

  return { center, radius }
}

export function computeVertexNormal(
  p0: Vec3, p1: Vec3, p2: Vec3
): Vec3 {
  const ax = p1.x - p0.x
  const ay = p1.y - p0.y
  const az = p1.z - p0.z
  const bx = p2.x - p0.x
  const by = p2.y - p0.y
  const bz = p2.z - p0.z

  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)

  if (len === 0) return { x: 0, y: 1, z: 0 }
  return { x: nx / len, y: ny / len, z: nz / len }
}

export function ensureNormals(mesh: InternalMesh): void {
  for (const geo of mesh.geometries) {
    let hasNormals = true
    for (const v of geo.vertices) {
      if (v.normal.x === 0 && v.normal.y === 0 && v.normal.z === 0) {
        hasNormals = false
        break
      }
    }

    if (hasNormals) continue

    // Compute face normals and assign to vertices
    for (let i = 0; i < geo.indices.length; i += 3) {
      const i0 = geo.indices[i]
      const i1 = geo.indices[i + 1]
      const i2 = geo.indices[i + 2]
      const v0 = geo.vertices[i0]
      const v1 = geo.vertices[i1]
      const v2 = geo.vertices[i2]

      const n = computeVertexNormal(v0.position, v1.position, v2.position)
      v0.normal = n
      v1.normal = n
      v2.normal = n
    }
  }
}

export function ensureTexCoords(mesh: InternalMesh): void {
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      if (!v.texCoord) {
        v.texCoord = { u: 0, v: 0 }
      }
    }
  }
}

export function normalizeMesh(mesh: InternalMesh): InternalMesh {
  ensureNormals(mesh)
  ensureTexCoords(mesh)

  mesh.boundingBox = computeBoundingBox(mesh)
  mesh.boundingSphere = computeBoundingSphere(mesh.boundingBox)

  return mesh
}

export function triangulateQuad(v0: number, v1: number, v2: number, v3: number): number[] {
  return [v0, v1, v2, v0, v2, v3]
}
