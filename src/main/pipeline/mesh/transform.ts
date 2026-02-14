import type { InternalMesh, Vec3 } from './types'

/**
 * Swaps Y and Z axes for Blender (Z-up) to GTA V coordinate system.
 * GTA V uses a right-handed Y-up system internally for drawables.
 */
export function convertZUpToYUp(mesh: InternalMesh): void {
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      swapYZ(v.position)
      swapYZ(v.normal)
      if (v.tangent) {
        const { x, y, z, w } = v.tangent
        v.tangent = { x, y: z, z: -y, w }
      }
    }
  }
}

function swapYZ(v: Vec3): void {
  const oldY = v.y
  v.y = v.z
  v.z = -oldY
}

export function scaleMesh(mesh: InternalMesh, factor: number): void {
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      v.position.x *= factor
      v.position.y *= factor
      v.position.z *= factor
    }
  }
}

export function centerMesh(mesh: InternalMesh): void {
  let cx = 0, cy = 0, cz = 0, count = 0
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      cx += v.position.x
      cy += v.position.y
      cz += v.position.z
      count++
    }
  }

  if (count === 0) return

  cx /= count
  cy /= count
  cz /= count

  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      v.position.x -= cx
      v.position.y -= cy
      v.position.z -= cz
    }
  }
}
