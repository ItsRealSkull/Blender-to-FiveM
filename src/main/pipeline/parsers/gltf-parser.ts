import fs from 'fs'
import path from 'path'
import { NodeIO } from '@gltf-transform/core'
import type { ModelParser, InternalMesh, InternalGeometry, InternalVertex, InternalMaterial } from '../mesh/types'
import { normalizeMesh } from '../mesh/normalizer'

export class GltfModelParser implements ModelParser {
  async parse(filePath: string): Promise<InternalMesh> {
    const io = new NodeIO()
    const doc = await io.read(filePath)
    const root = doc.getRoot()

    const materials: InternalMaterial[] = []
    const materialMap = new Map<unknown, number>()
    const dir = path.dirname(filePath)

    // Extract materials
    for (const mat of root.listMaterials()) {
      const idx = materials.length
      materialMap.set(mat, idx)

      const baseColorFactor = mat.getBaseColorFactor()
      const baseColorTex = mat.getBaseColorTexture()
      const normalTex = mat.getNormalTexture()

      let diffusePath: string | null = null
      let normalPath: string | null = null

      if (baseColorTex) {
        const image = baseColorTex.getImage()
        if (image) {
          const texName = baseColorTex.getName() || `texture_${idx}_diff`
          const ext = baseColorTex.getMimeType() === 'image/png' ? '.png' : '.jpg'
          diffusePath = path.join(dir, `${texName}${ext}`)
          fs.writeFileSync(diffusePath, Buffer.from(image))
        }
      }

      if (normalTex) {
        const image = normalTex.getImage()
        if (image) {
          const texName = normalTex.getName() || `texture_${idx}_norm`
          const ext = normalTex.getMimeType() === 'image/png' ? '.png' : '.jpg'
          normalPath = path.join(dir, `${texName}${ext}`)
          fs.writeFileSync(normalPath, Buffer.from(image))
        }
      }

      materials.push({
        name: mat.getName() || `material_${idx}`,
        diffuseTexturePath: diffusePath,
        normalTexturePath: normalPath,
        specularTexturePath: null,
        diffuseColor: {
          x: baseColorFactor[0],
          y: baseColorFactor[1],
          z: baseColorFactor[2],
          w: baseColorFactor[3]
        },
        shaderName: normalPath ? 'normal.sps' : 'default.sps'
      })
    }

    // Default material if none
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

    // Extract geometries
    const geometries: InternalGeometry[] = []

    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const posAccessor = prim.getAttribute('POSITION')
        const normAccessor = prim.getAttribute('NORMAL')
        const uvAccessor = prim.getAttribute('TEXCOORD_0')
        const idxAccessor = prim.getIndices()

        if (!posAccessor) continue

        const positions = posAccessor.getArray()
        const normals = normAccessor?.getArray()
        const uvs = uvAccessor?.getArray()
        const rawIndices = idxAccessor?.getArray()

        if (!positions) continue

        const vertexCount = posAccessor.getCount()
        const vertices: InternalVertex[] = []

        for (let i = 0; i < vertexCount; i++) {
          vertices.push({
            position: {
              x: positions[i * 3],
              y: positions[i * 3 + 1],
              z: positions[i * 3 + 2]
            },
            normal: normals ? {
              x: normals[i * 3],
              y: normals[i * 3 + 1],
              z: normals[i * 3 + 2]
            } : { x: 0, y: 0, z: 0 },
            texCoord: uvs ? {
              u: uvs[i * 2],
              v: 1 - uvs[i * 2 + 1] // Flip V for GTA
            } : { u: 0, v: 0 }
          })
        }

        let indices: number[]
        if (rawIndices) {
          indices = Array.from(rawIndices)
        } else {
          indices = Array.from({ length: vertexCount }, (_, i) => i)
        }

        const mat = prim.getMaterial()
        const matIdx = mat ? (materialMap.get(mat) ?? 0) : 0

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
