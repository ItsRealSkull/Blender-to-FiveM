import fs from 'fs'
import path from 'path'
import type { ModelParser, InternalMesh, InternalGeometry, InternalVertex, InternalMaterial, Vec4 } from '../mesh/types'
import { normalizeMesh } from '../mesh/normalizer'

interface ObjData {
  positions: number[][]
  normals: number[][]
  texCoords: number[][]
  faces: { group: string; verts: { v: number; vt: number; vn: number }[] }[]
  mtlFile: string | null
  groups: string[]
}

function parseObjFile(content: string): ObjData {
  const positions: number[][] = []
  const normals: number[][] = []
  const texCoords: number[][] = []
  const faces: ObjData['faces'] = []
  let mtlFile: string | null = null
  let currentGroup = 'default'
  const groups: string[] = ['default']

  const lines = content.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const parts = line.split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case 'v':
        positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])
        break
      case 'vn':
        normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])])
        break
      case 'vt':
        texCoords.push([parseFloat(parts[1]), parseFloat(parts[2]) ?? 0])
        break
      case 'f': {
        const faceVerts: { v: number; vt: number; vn: number }[] = []
        for (let i = 1; i < parts.length; i++) {
          const indices = parts[i].split('/')
          faceVerts.push({
            v: parseInt(indices[0]) - 1,
            vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
            vn: indices[2] ? parseInt(indices[2]) - 1 : -1
          })
        }
        // Triangulate n-gon via fan
        for (let i = 1; i < faceVerts.length - 1; i++) {
          faces.push({
            group: currentGroup,
            verts: [faceVerts[0], faceVerts[i], faceVerts[i + 1]]
          })
        }
        break
      }
      case 'usemtl':
      case 'g':
      case 'o':
        currentGroup = parts.slice(1).join(' ') || 'default'
        if (!groups.includes(currentGroup)) groups.push(currentGroup)
        break
      case 'mtllib':
        mtlFile = parts.slice(1).join(' ')
        break
    }
  }

  return { positions, normals, texCoords, faces, mtlFile, groups }
}

interface MtlData {
  name: string
  diffuseColor: number[]
  diffuseMap: string | null
  normalMap: string | null
  specularMap: string | null
}

function parseMtlFile(content: string): Map<string, MtlData> {
  const materials = new Map<string, MtlData>()
  let current: MtlData | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const parts = line.split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case 'newmtl':
        current = {
          name: parts.slice(1).join(' '),
          diffuseColor: [0.8, 0.8, 0.8, 1],
          diffuseMap: null,
          normalMap: null,
          specularMap: null
        }
        materials.set(current.name, current)
        break
      case 'Kd':
        if (current) {
          current.diffuseColor = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]), 1]
        }
        break
      case 'map_Kd':
        if (current) current.diffuseMap = parts.slice(1).join(' ')
        break
      case 'map_Bump':
      case 'bump':
        if (current) current.normalMap = parts.slice(1).join(' ')
        break
      case 'map_Ks':
        if (current) current.specularMap = parts.slice(1).join(' ')
        break
    }
  }

  return materials
}

export class ObjModelParser implements ModelParser {
  async parse(filePath: string): Promise<InternalMesh> {
    const content = fs.readFileSync(filePath, 'utf-8')
    const dir = path.dirname(filePath)
    const objData = parseObjFile(content)

    // Load MTL if available
    let mtlMaterials = new Map<string, MtlData>()
    if (objData.mtlFile) {
      const mtlPath = path.join(dir, objData.mtlFile)
      if (fs.existsSync(mtlPath)) {
        const mtlContent = fs.readFileSync(mtlPath, 'utf-8')
        mtlMaterials = parseMtlFile(mtlContent)
      }
    }

    // Group faces by material/group
    const groupedFaces = new Map<string, ObjData['faces']>()
    for (const face of objData.faces) {
      const group = face.group
      if (!groupedFaces.has(group)) groupedFaces.set(group, [])
      groupedFaces.get(group)!.push(face)
    }

    const materials: InternalMaterial[] = []
    const geometries: InternalGeometry[] = []

    let matIndex = 0
    for (const [groupName, groupFaces] of groupedFaces) {
      // Create material
      const mtlData = mtlMaterials.get(groupName)
      const mat: InternalMaterial = {
        name: groupName,
        diffuseTexturePath: mtlData?.diffuseMap ? path.resolve(dir, mtlData.diffuseMap) : null,
        normalTexturePath: mtlData?.normalMap ? path.resolve(dir, mtlData.normalMap) : null,
        specularTexturePath: mtlData?.specularMap ? path.resolve(dir, mtlData.specularMap) : null,
        diffuseColor: mtlData
          ? { x: mtlData.diffuseColor[0], y: mtlData.diffuseColor[1], z: mtlData.diffuseColor[2], w: mtlData.diffuseColor[3] }
          : { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: 'default.sps'
      }
      materials.push(mat)

      // Build unique vertices and indices
      const vertices: InternalVertex[] = []
      const indices: number[] = []
      const vertexMap = new Map<string, number>()

      for (const face of groupFaces) {
        for (const fv of face.verts) {
          const key = `${fv.v}/${fv.vt}/${fv.vn}`
          let idx = vertexMap.get(key)
          if (idx === undefined) {
            const pos = objData.positions[fv.v] || [0, 0, 0]
            const norm = fv.vn >= 0 && objData.normals[fv.vn] ? objData.normals[fv.vn] : [0, 0, 0]
            const tc = fv.vt >= 0 && objData.texCoords[fv.vt] ? objData.texCoords[fv.vt] : [0, 0]

            idx = vertices.length
            vertices.push({
              position: { x: pos[0], y: pos[1], z: pos[2] },
              normal: { x: norm[0], y: norm[1], z: norm[2] },
              texCoord: { u: tc[0], v: 1 - tc[1] } // Flip V for GTA
            })
            vertexMap.set(key, idx)
          }
          indices.push(idx)
        }
      }

      geometries.push({
        materialIndex: matIndex,
        vertices,
        indices
      })
      matIndex++
    }

    // If no faces were grouped, create a single default geometry
    if (geometries.length === 0 && objData.faces.length > 0) {
      const vertices: InternalVertex[] = []
      const indices: number[] = []
      const vertexMap = new Map<string, number>()

      for (const face of objData.faces) {
        for (const fv of face.verts) {
          const key = `${fv.v}/${fv.vt}/${fv.vn}`
          let idx = vertexMap.get(key)
          if (idx === undefined) {
            const pos = objData.positions[fv.v] || [0, 0, 0]
            const norm = fv.vn >= 0 && objData.normals[fv.vn] ? objData.normals[fv.vn] : [0, 0, 0]
            const tc = fv.vt >= 0 && objData.texCoords[fv.vt] ? objData.texCoords[fv.vt] : [0, 0]

            idx = vertices.length
            vertices.push({
              position: { x: pos[0], y: pos[1], z: pos[2] },
              normal: { x: norm[0], y: norm[1], z: norm[2] },
              texCoord: { u: tc[0], v: 1 - tc[1] }
            })
            vertexMap.set(key, idx)
          }
          indices.push(idx)
        }
      }

      materials.push({
        name: 'default',
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: 'default.sps'
      })
      geometries.push({ materialIndex: 0, vertices, indices })
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
