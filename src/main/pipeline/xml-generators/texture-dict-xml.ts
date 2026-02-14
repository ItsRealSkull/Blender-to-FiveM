import path from 'path'

export interface TextureEntry {
  name: string
  ddsFileName: string
  width: number
  height: number
  mipLevels: number
  format: string
}

export function generateTextureDictXml(propName: string, textures: TextureEntry[]): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<TextureDictionary>')
  lines.push('  <Textures>')

  for (const tex of textures) {
    lines.push('    <Item>')
    lines.push(`      <Name>${tex.name}</Name>`)
    lines.push(`      <FileName>${tex.ddsFileName}</FileName>`)
    lines.push(`      <Width value="${tex.width}" />`)
    lines.push(`      <Height value="${tex.height}" />`)
    lines.push(`      <MipLevels value="${tex.mipLevels}" />`)
    lines.push(`      <Format>${tex.format}</Format>`)
    lines.push(`      <Usage>DIFFUSE</Usage>`)
    lines.push('    </Item>')
  }

  lines.push('  </Textures>')
  lines.push('</TextureDictionary>')

  return lines.join('\n')
}

/**
 * Generate a minimal placeholder texture dictionary XML
 * when no textures are available (solid color props).
 */
export function generatePlaceholderTextureDictXml(propName: string): string {
  return generateTextureDictXml(propName, [{
    name: `${propName}_diff`,
    ddsFileName: `${propName}_diff.dds`,
    width: 64,
    height: 64,
    mipLevels: 7,
    format: 'D3DFMT_DXT1'
  }])
}
