import type { InternalMesh, CollisionType, Vec3 } from '../mesh/types'

function vec3Attr(x: number, y: number, z: number): string {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`
}

export function generateBoundsXml(mesh: InternalMesh, collisionType: CollisionType): string {
  const bb = mesh.boundingBox
  const bs = mesh.boundingSphere

  switch (collisionType) {
    case 'bbox':
      return generateBBoxXml(bb, bs)
    case 'convex':
      return generateConvexHullXml(mesh, bb, bs)
    case 'mesh':
      return generateTriangleMeshXml(mesh, bb, bs)
    default:
      return generateBBoxXml(bb, bs)
  }
}

function generateBBoxXml(
  bb: { min: Vec3; max: Vec3 },
  bs: { center: Vec3; radius: number }
): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<Bounds>')
  lines.push('  <Type>Box</Type>')
  lines.push(`  <BoxCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`  <BoxSize ${vec3Attr(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z)} />`)
  lines.push(`  <SphereCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`)
  lines.push(`  <BoundingBoxMin ${vec3Attr(bb.min.x, bb.min.y, bb.min.z)} />`)
  lines.push(`  <BoundingBoxMax ${vec3Attr(bb.max.x, bb.max.y, bb.max.z)} />`)
  lines.push(`  <BoundingBoxCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push('  <Margin value="0.04000000" />')
  lines.push('  <MaterialIndex value="0" />')
  lines.push('  <MaterialColourIndex value="0" />')
  lines.push('  <ProceduralId value="0" />')
  lines.push('</Bounds>')
  return lines.join('\n')
}

function generateConvexHullXml(
  mesh: InternalMesh,
  bb: { min: Vec3; max: Vec3 },
  bs: { center: Vec3; radius: number }
): string {
  // Collect all unique positions
  const allPositions: Vec3[] = []
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      allPositions.push(v.position)
    }
  }

  // Simple convex hull approximation: use bounding box corners
  // plus extrema from each axis for a better fit
  const hullPoints: Vec3[] = [
    { x: bb.min.x, y: bb.min.y, z: bb.min.z },
    { x: bb.max.x, y: bb.min.y, z: bb.min.z },
    { x: bb.min.x, y: bb.max.y, z: bb.min.z },
    { x: bb.max.x, y: bb.max.y, z: bb.min.z },
    { x: bb.min.x, y: bb.min.y, z: bb.max.z },
    { x: bb.max.x, y: bb.min.y, z: bb.max.z },
    { x: bb.min.x, y: bb.max.y, z: bb.max.z },
    { x: bb.max.x, y: bb.max.y, z: bb.max.z }
  ]

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<Bounds>')
  lines.push('  <Type>Geometry</Type>')
  lines.push(`  <SphereCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`)
  lines.push(`  <BoundingBoxMin ${vec3Attr(bb.min.x, bb.min.y, bb.min.z)} />`)
  lines.push(`  <BoundingBoxMax ${vec3Attr(bb.max.x, bb.max.y, bb.max.z)} />`)
  lines.push(`  <BoundingBoxCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push('  <Margin value="0.04000000" />')
  lines.push('  <MaterialIndex value="0" />')
  lines.push('  <MaterialColourIndex value="0" />')
  lines.push('  <Vertices>')
  for (const p of hullPoints) {
    lines.push(`    <Item ${vec3Attr(p.x, p.y, p.z)} />`)
  }
  lines.push('  </Vertices>')

  // Generate triangles for the box hull
  lines.push('  <Polygons>')
  // 6 faces * 2 triangles = 12 triangles
  const boxTris = [
    [0,1,3],[0,3,2], // bottom
    [4,6,7],[4,7,5], // top
    [0,4,5],[0,5,1], // front
    [2,3,7],[2,7,6], // back
    [0,2,6],[0,6,4], // left
    [1,5,7],[1,7,3]  // right
  ]
  for (const tri of boxTris) {
    lines.push(`    <Item v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" materialIndex="0" />`)
  }
  lines.push('  </Polygons>')

  lines.push('</Bounds>')
  return lines.join('\n')
}

function generateTriangleMeshXml(
  mesh: InternalMesh,
  bb: { min: Vec3; max: Vec3 },
  bs: { center: Vec3; radius: number }
): string {
  // Collect all vertices and indices
  const allVerts: Vec3[] = []
  const allIndices: number[][] = []
  let vertexOffset = 0

  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      allVerts.push(v.position)
    }
    for (let i = 0; i < geo.indices.length; i += 3) {
      allIndices.push([
        geo.indices[i] + vertexOffset,
        geo.indices[i + 1] + vertexOffset,
        geo.indices[i + 2] + vertexOffset
      ])
    }
    vertexOffset += geo.vertices.length
  }

  // Limit to reasonable number of triangles for collision
  const maxTris = 1000
  let triStep = 1
  if (allIndices.length > maxTris) {
    triStep = Math.ceil(allIndices.length / maxTris)
  }

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<Bounds>')
  lines.push('  <Type>GeometryBVH</Type>')
  lines.push(`  <SphereCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`)
  lines.push(`  <BoundingBoxMin ${vec3Attr(bb.min.x, bb.min.y, bb.min.z)} />`)
  lines.push(`  <BoundingBoxMax ${vec3Attr(bb.max.x, bb.max.y, bb.max.z)} />`)
  lines.push(`  <BoundingBoxCenter ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push('  <Margin value="0.04000000" />')
  lines.push('  <MaterialIndex value="0" />')
  lines.push('  <MaterialColourIndex value="0" />')

  lines.push('  <Vertices>')
  for (const v of allVerts) {
    lines.push(`    <Item ${vec3Attr(v.x, v.y, v.z)} />`)
  }
  lines.push('  </Vertices>')

  lines.push('  <Polygons>')
  for (let i = 0; i < allIndices.length; i += triStep) {
    const tri = allIndices[i]
    lines.push(`    <Item v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" materialIndex="0" />`)
  }
  lines.push('  </Polygons>')

  lines.push('</Bounds>')
  return lines.join('\n')
}
