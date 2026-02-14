import fs from 'fs'
import path from 'path'
import { parseBinary, parseText } from 'fbx-parser'
import type { ModelParser, InternalMesh, InternalGeometry, InternalVertex, InternalMaterial } from '../mesh/types'
import { normalizeMesh } from '../mesh/normalizer'

interface FBXNode {
  name: string
  props: unknown[]
  nodes: FBXNode[]
}

function findNodes(root: FBXNode[], name: string): FBXNode[] {
  const results: FBXNode[] = []
  for (const node of root) {
    if (node.name === name) results.push(node)
    if (node.nodes) results.push(...findNodes(node.nodes, name))
  }
  return results
}

function findNode(nodes: FBXNode[], name: string): FBXNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node
    if (node.nodes) {
      const found = findNode(node.nodes, name)
      if (found) return found
    }
  }
  return undefined
}

function getPropertyValue(node: FBXNode): unknown[] {
  return node.props || []
}

export class FbxModelParser implements ModelParser {
  async parse(filePath: string): Promise<InternalMesh> {
    const buffer = fs.readFileSync(filePath)
    let fbxTree: FBXNode[]

    // Detect binary or text FBX
    const header = buffer.slice(0, 20).toString('ascii')
    if (header.startsWith('Kaydara FBX Binary')) {
      fbxTree = parseBinary(buffer) as unknown as FBXNode[]
    } else {
      fbxTree = parseText(buffer.toString('utf-8')) as unknown as FBXNode[]
    }

    const dir = path.dirname(filePath)

    // Find all Geometry nodes (type "Mesh")
    const geometryNodes = findNodes(fbxTree, 'Geometry')
    const materials: InternalMaterial[] = []
    const geometries: InternalGeometry[] = []

    // Find connections to resolve material-geometry links
    const connectionNode = findNode(fbxTree, 'Connections')
    const connections: { child: number; parent: number }[] = []
    if (connectionNode?.nodes) {
      for (const c of connectionNode.nodes) {
        if (c.name === 'C' && c.props.length >= 3) {
          connections.push({
            child: Number(c.props[1]),
            parent: Number(c.props[2])
          })
        }
      }
    }

    // Extract materials
    const materialNodes = findNodes(fbxTree, 'Material')
    const materialIdMap = new Map<number, number>()

    for (const matNode of materialNodes) {
      const matId = Number(matNode.props[0] || 0)
      const matName = String(matNode.props[1] || `material_${materials.length}`).replace(/\x00.*/, '')

      const idx = materials.length
      materialIdMap.set(matId, idx)

      materials.push({
        name: matName,
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: 'default.sps'
      })
    }

    // Find texture nodes and link to materials
    const textureNodes = findNodes(fbxTree, 'Texture')
    for (const texNode of textureNodes) {
      const texId = Number(texNode.props[0] || 0)
      const fileNameNode = findNode(texNode.nodes, 'FileName') ||
                          findNode(texNode.nodes, 'RelativeFilename')

      if (!fileNameNode) continue

      const texPath = String(fileNameNode.props[0] || '')
      const resolvedPath = path.isAbsolute(texPath) ? texPath : path.resolve(dir, texPath)

      // Find which material this texture connects to
      for (const conn of connections) {
        if (conn.child === texId) {
          const matIdx = materialIdMap.get(conn.parent)
          if (matIdx !== undefined && fs.existsSync(resolvedPath)) {
            materials[matIdx].diffuseTexturePath = resolvedPath
          }
        }
      }
    }

    // Default material if none found
    if (materials.length === 0) {
      materials.push({
        name: 'default',
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: 'default.sps'
      })
    }

    // Extract geometry data
    for (const geoNode of geometryNodes) {
      const geoId = Number(geoNode.props[0] || 0)

      const verticesNode = findNode(geoNode.nodes, 'Vertices')
      const indicesNode = findNode(geoNode.nodes, 'PolygonVertexIndex')

      if (!verticesNode || !indicesNode) continue

      const rawVerts = verticesNode.props[0] as number[]
      const rawIndices = indicesNode.props[0] as number[]

      if (!rawVerts || !rawIndices) continue

      // Extract normals
      let rawNormals: number[] | null = null
      const normalLayer = findNode(geoNode.nodes, 'LayerElementNormal')
      if (normalLayer) {
        const normNode = findNode(normalLayer.nodes, 'Normals')
        if (normNode) rawNormals = normNode.props[0] as number[]
      }

      // Extract UVs
      let rawUVs: number[] | null = null
      let uvIndices: number[] | null = null
      const uvLayer = findNode(geoNode.nodes, 'LayerElementUV')
      if (uvLayer) {
        const uvNode = findNode(uvLayer.nodes, 'UV')
        const uvIdxNode = findNode(uvLayer.nodes, 'UVIndex')
        if (uvNode) rawUVs = uvNode.props[0] as number[]
        if (uvIdxNode) uvIndices = uvIdxNode.props[0] as number[]
      }

      // Build vertices and triangulate polygons
      const vertices: InternalVertex[] = []
      const indices: number[] = []
      const vertexMap = new Map<string, number>()

      const polygon: number[] = []
      let normalIdx = 0

      for (let i = 0; i < rawIndices.length; i++) {
        let vi = rawIndices[i]
        const isEnd = vi < 0
        if (isEnd) vi = ~vi // Bitwise NOT to get actual index

        polygon.push(vi)

        if (isEnd) {
          // Triangulate polygon using fan
          for (let t = 1; t < polygon.length - 1; t++) {
            const triVerts = [polygon[0], polygon[t], polygon[t + 1]]
            const triNormIndices = [
              normalIdx,
              normalIdx + t,
              normalIdx + t + 1
            ]

            for (let tv = 0; tv < 3; tv++) {
              const pvi = triVerts[tv]
              const ni = triNormIndices[tv]
              const uvIdx = uvIndices ? uvIndices[i - polygon.length + 1 + (tv === 0 ? 0 : tv === 1 ? t : t + 1)] : ni

              const key = `${pvi}/${ni}/${uvIdx}`
              let idx = vertexMap.get(key)

              if (idx === undefined) {
                const px = rawVerts[pvi * 3] || 0
                const py = rawVerts[pvi * 3 + 1] || 0
                const pz = rawVerts[pvi * 3 + 2] || 0

                let nx = 0, ny = 0, nz = 0
                if (rawNormals && ni * 3 + 2 < rawNormals.length) {
                  nx = rawNormals[ni * 3]
                  ny = rawNormals[ni * 3 + 1]
                  nz = rawNormals[ni * 3 + 2]
                }

                let u = 0, v = 0
                if (rawUVs && uvIdx >= 0 && uvIdx * 2 + 1 < rawUVs.length) {
                  u = rawUVs[uvIdx * 2]
                  v = 1 - rawUVs[uvIdx * 2 + 1] // Flip V
                }

                idx = vertices.length
                vertices.push({
                  position: { x: px, y: py, z: pz },
                  normal: { x: nx, y: ny, z: nz },
                  texCoord: { u, v }
                })
                vertexMap.set(key, idx)
              }

              indices.push(idx)
            }
          }

          normalIdx += polygon.length
          polygon.length = 0
        }
      }

      // Find material for this geometry via connections
      let matIdx = 0
      for (const conn of connections) {
        if (conn.parent === geoId) {
          const mi = materialIdMap.get(conn.child)
          if (mi !== undefined) {
            matIdx = mi
            break
          }
        }
      }

      if (vertices.length > 0 && indices.length > 0) {
        geometries.push({
          materialIndex: matIdx,
          vertices,
          indices
        })
      }
    }

    const mesh: InternalMesh = {
      name: path.basename(filePath, path.extname(filePath)),
      geometries,
      materials,
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0 }
    }

    return normalizeMesh(mesh)
  }
}
