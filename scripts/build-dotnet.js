/**
 * Build script for the CodeWalker .NET service.
 * Publishes as a self-contained single-file executable.
 *
 * Requires: .NET 8 SDK installed
 * Run: node scripts/build-dotnet.js
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const projectPath = path.join(__dirname, '..', 'native', 'codewalker-service')
const publishDir = path.join(projectPath, 'publish')

console.log('Building CodeWalker service...')
console.log(`Project: ${projectPath}`)
console.log(`Output: ${publishDir}`)

// Check if .NET SDK is available
try {
  const version = execSync('dotnet --version', { encoding: 'utf-8' }).trim()
  console.log(`.NET SDK version: ${version}`)
} catch {
  console.error('ERROR: .NET 8 SDK is not installed.')
  console.error('Download from: https://dotnet.microsoft.com/download/dotnet/8.0')
  console.error('')
  console.error('The app will still work without it, but will export XML files')
  console.error('instead of binary GTA V files. You can convert them manually')
  console.error('using CodeWalker.')
  process.exit(0) // Don't fail the build
}

try {
  execSync(
    `dotnet publish "${path.join(projectPath, 'CodeWalkerService.csproj')}" ` +
    `-c Release ` +
    `-r win-x64 ` +
    `--self-contained true ` +
    `/p:PublishSingleFile=true ` +
    `/p:IncludeNativeLibrariesForSelfExtract=true ` +
    `-o "${publishDir}"`,
    {
      stdio: 'inherit',
      cwd: projectPath
    }
  )
  console.log('CodeWalker service built successfully!')
} catch (err) {
  console.error('Failed to build CodeWalker service:', err.message)
  console.error('The app will work without it, using XML export mode.')
}
