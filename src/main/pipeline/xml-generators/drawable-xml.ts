import type { InternalMesh, ConversionConfig } from '../mesh/types'
import { getShaderDef } from './shader-defs'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function vec3(x: number, y: number, z: number): string {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`
}

export function generateDrawableXml(mesh: InternalMesh, config: ConversionConfig): string {
  const bb = mesh.boundingBox
  const bs = mesh.boundingSphere
  const propName = config.propName

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<Drawable>')
  lines.push(`  <Name>${esc(propName)}</Name>`)
  lines.push(`  <BoundingSphereCenter ${vec3(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`  <BoundingSphereRadius value="${bs.radius.toFixed(8)}" />`)
  lines.push(`  <BoundingBoxMin ${vec3(bb.min.x, bb.min.y, bb.min.z)} />`)
  lines.push(`  <BoundingBoxMax ${vec3(bb.max.x, bb.max.y, bb.max.z)} />`)
  lines.push(`  <LodDistHigh value="${config.lodDistHigh.toFixed(8)}" />`)
  lines.push(`  <LodDistMed value="${config.lodDistMed.toFixed(8)}" />`)
  lines.push(`  <LodDistLow value="${config.lodDistLow.toFixed(8)}" />`)
  lines.push(`  <LodDistVlow value="${config.lodDistVlow.toFixed(8)}" />`)
  lines.push(`  <FlagsHigh value="0" />`)
  lines.push(`  <FlagsMed value="0" />`)
  lines.push(`  <FlagsLow value="0" />`)
  lines.push(`  <FlagsVlow value="0" />`)

  // ShaderGroup
  lines.push('  <ShaderGroup>')
  lines.push('    <TextureDictionary />')
  lines.push('    <Shaders>')

  for (let i = 0; i < mesh.materials.length; i++) {
    const mat = mesh.materials[i]
    const shaderName = config.shaderName || mat.shaderName || 'default.sps'
    const shaderDef = getShaderDef(shaderName)

    lines.push('      <Item>')
    lines.push(`        <Name>${esc(mat.name)}</Name>`)
    lines.push(`        <FileName>${esc(shaderDef.fileName)}</FileName>`)
    lines.push(`        <RenderBucket value="${shaderDef.renderBucket}" />`)
    lines.push('        <Parameters>')

    for (const param of shaderDef.params) {
      if (param.type === 'Texture') {
        let texName = `${propName}_diff`
        if (param.name === 'BumpSampler') texName = `${propName}_n`
        else if (param.name === 'SpecSampler') texName = `${propName}_s`

        lines.push(`          <Item name="${param.name}" type="Texture">`)
        lines.push(`            <Name>${esc(texName)}</Name>`)
        lines.push(`          </Item>`)
      } else if (param.type === 'Vector' && param.value) {
        lines.push(`          <Item name="${param.name}" type="Vector">`)
        lines.push(`            <Value x="${param.value[0]}" y="${param.value[1]}" z="${param.value[2]}" w="${param.value[3]}" />`)
        lines.push(`          </Item>`)
      }
    }

    lines.push('        </Parameters>')
    lines.push('      </Item>')
  }

  lines.push('    </Shaders>')
  lines.push('  </ShaderGroup>')

  // DrawableModelsHigh
  lines.push('  <DrawableModelsHigh>')

  for (let gi = 0; gi < mesh.geometries.length; gi++) {
    const geo = mesh.geometries[gi]
    if (geo.vertices.length === 0 || geo.indices.length === 0) continue

    // Compute per-geometry bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const v of geo.vertices) {
      minX = Math.min(minX, v.position.x)
      minY = Math.min(minY, v.position.y)
      minZ = Math.min(minZ, v.position.z)
      maxX = Math.max(maxX, v.position.x)
      maxY = Math.max(maxY, v.position.y)
      maxZ = Math.max(maxZ, v.position.z)
    }

    lines.push('    <Item>')
    lines.push('      <RenderMask value="255" />')
    lines.push('      <Geometries>')
    lines.push('        <Item>')
    lines.push(`          <ShaderIndex value="${geo.materialIndex}" />`)
    lines.push(`          <BoundingBoxMin ${vec3(minX, minY, minZ)} />`)
    lines.push(`          <BoundingBoxMax ${vec3(maxX, maxY, maxZ)} />`)

    // Vertex declaration - Position, Normal, TexCoord
    lines.push('          <VertexBuffer>')
    lines.push('            <Flags value="0" />')
    lines.push('            <Layout type="GTAV1">')
    lines.push('              <Position />')
    lines.push('              <Normal />')
    lines.push('              <Colour0 />')
    lines.push('              <TexCoord0 />')
    lines.push('            </Layout>')
    lines.push(`            <Count value="${geo.vertices.length}" />`)
    lines.push('            <Data>')

    for (const v of geo.vertices) {
      const px = v.position.x.toFixed(8)
      const py = v.position.y.toFixed(8)
      const pz = v.position.z.toFixed(8)
      const nx = v.normal.x.toFixed(8)
      const ny = v.normal.y.toFixed(8)
      const nz = v.normal.z.toFixed(8)
      const cr = v.color ? v.color.x : 255
      const cg = v.color ? v.color.y : 255
      const cb = v.color ? v.color.z : 255
      const ca = v.color ? v.color.w : 255
      const tu = v.texCoord.u.toFixed(8)
      const tv = v.texCoord.v.toFixed(8)

      lines.push(`              ${px} ${py} ${pz}   ${nx} ${ny} ${nz}   ${cr} ${cg} ${cb} ${ca}   ${tu} ${tv}`)
    }

    lines.push('            </Data>')
    lines.push('          </VertexBuffer>')

    // Index buffer
    lines.push('          <IndexBuffer>')
    lines.push(`            <Count value="${geo.indices.length}" />`)
    lines.push('            <Data>')

    // Write indices in groups of 3 (triangles)
    for (let i = 0; i < geo.indices.length; i += 3) {
      const a = geo.indices[i]
      const b = geo.indices[i + 1]
      const c = geo.indices[i + 2]
      lines.push(`              ${a} ${b} ${c}`)
    }

    lines.push('            </Data>')
    lines.push('          </IndexBuffer>')
    lines.push('        </Item>')
    lines.push('      </Geometries>')
    lines.push('    </Item>')
  }

  lines.push('  </DrawableModelsHigh>')
  lines.push('</Drawable>')

  return lines.join('\n')
}
