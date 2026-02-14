import { spawn, ChildProcess } from 'child_process'
import { createInterface, Interface } from 'readline'
import fs from 'fs'
import { getNativePath } from '../../utils/native-paths'
import { createRequest, ServiceResponse } from './protocol'

type PendingRequest = {
  resolve: (response: ServiceResponse) => void
  reject: (error: Error) => void
}

export class CodeWalkerBridge {
  private static instance: CodeWalkerBridge | null = null
  private process: ChildProcess | null = null
  private readline: Interface | null = null
  private pending = new Map<string, PendingRequest>()
  private available = false

  static getInstance(): CodeWalkerBridge {
    if (!CodeWalkerBridge.instance) {
      CodeWalkerBridge.instance = new CodeWalkerBridge()
    }
    return CodeWalkerBridge.instance
  }

  async start(): Promise<void> {
    const exePath = getNativePath('codewalker-service/CodeWalkerService.exe')

    if (!fs.existsSync(exePath)) {
      console.warn(`CodeWalker service not found at ${exePath}`)
      this.available = false
      return
    }

    this.process = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity
    })

    this.readline.on('line', (line) => {
      try {
        const response: ServiceResponse = JSON.parse(line)
        const pending = this.pending.get(response.id)
        if (pending) {
          this.pending.delete(response.id)
          if (response.success) {
            pending.resolve(response)
          } else {
            pending.reject(new Error(response.error || 'Unknown error'))
          }
        }
      } catch {
        // Non-JSON output, ignore (could be .NET startup messages)
      }
    })

    this.process.stderr?.on('data', (data) => {
      console.error('CodeWalker service error:', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`CodeWalker service exited with code ${code}`)
      this.available = false
      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('Service process exited'))
        this.pending.delete(id)
      }
    })

    // Health check
    try {
      await this.send(createRequest('health'))
      this.available = true
    } catch {
      this.available = false
    }
  }

  isAvailable(): boolean {
    return this.available
  }

  async convertYdr(xmlPath: string, inputFolder: string, outputPath: string): Promise<string> {
    const response = await this.send(createRequest('convert_ydr', { xmlPath, inputFolder, outputPath }))
    return response.outputPath || outputPath
  }

  async convertYtd(xmlPath: string, inputFolder: string, outputPath: string): Promise<string> {
    const response = await this.send(createRequest('convert_ytd', { xmlPath, inputFolder, outputPath }))
    return response.outputPath || outputPath
  }

  async convertYbn(xmlPath: string, outputPath: string): Promise<string> {
    const response = await this.send(createRequest('convert_ybn', { xmlPath, outputPath }))
    return response.outputPath || outputPath
  }

  async convertYtyp(xmlPath: string, outputPath: string): Promise<string> {
    const response = await this.send(createRequest('convert_ytyp', { xmlPath, outputPath }))
    return response.outputPath || outputPath
  }

  private send(request: ReturnType<typeof createRequest>): Promise<ServiceResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('CodeWalker service is not running'))
        return
      }

      this.pending.set(request.id, { resolve, reject })

      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error('CodeWalker service request timed out'))
      }, 60000) // 60 second timeout

      const originalResolve = this.pending.get(request.id)!.resolve
      const originalReject = this.pending.get(request.id)!.reject

      this.pending.set(request.id, {
        resolve: (r) => { clearTimeout(timeout); originalResolve(r) },
        reject: (e) => { clearTimeout(timeout); originalReject(e) }
      })

      this.process.stdin.write(JSON.stringify(request) + '\n')
    })
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.readline = null
    this.available = false
    this.pending.clear()
  }
}
