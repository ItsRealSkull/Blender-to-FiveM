import type { InternalMesh, ConversionConfig } from '../mesh/types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function vec3Attr(x: number, y: number, z: number): string {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`
}

export function generateYtypXml(mesh: InternalMesh, config: ConversionConfig): string {
  const bb = mesh.boundingBox
  const bs = mesh.boundingSphere
  const propName = config.propName

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<CMapTypes>')
  lines.push('  <extensions />')
  lines.push('  <archetypes>')
  lines.push('    <Item type="CBaseArchetypeDef">')
  lines.push(`      <lodDist value="${config.lodDistHigh.toFixed(8)}" />`)
  lines.push('      <flags value="32" />')
  lines.push('      <specialAttribute value="0" />')
  lines.push(`      <bbMin ${vec3Attr(bb.min.x, bb.min.y, bb.min.z)} />`)
  lines.push(`      <bbMax ${vec3Attr(bb.max.x, bb.max.y, bb.max.z)} />`)
  lines.push(`      <bsCentre ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`)
  lines.push(`      <bsRadius value="${bs.radius.toFixed(8)}" />`)
  lines.push('      <hdTextureDist value="15.00000000" />')
  lines.push(`      <name>${esc(propName)}</name>`)
  lines.push(`      <textureDictionary>${esc(propName)}</textureDictionary>`)
  lines.push('      <clipDictionary />')
  lines.push('      <drawableDictionary />')
  lines.push(`      <physicsDictionary>${esc(propName)}</physicsDictionary>`)
  lines.push('      <assetType>ASSET_TYPE_DRAWABLE</assetType>')
  lines.push(`      <assetName>${esc(propName)}</assetName>`)
  lines.push('      <extensions />')
  lines.push('    </Item>')
  lines.push('  </archetypes>')
  lines.push(`  <name>${esc(propName)}</name>`)
  lines.push('  <dependencies />')
  lines.push('  <compositeEntityTypes />')
  lines.push('</CMapTypes>')

  return lines.join('\n')
}
