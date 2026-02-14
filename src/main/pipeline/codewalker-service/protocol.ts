export interface ServiceRequest {
  id: string
  type: 'health' | 'convert_ydr' | 'convert_ytd' | 'convert_ybn' | 'convert_ytyp'
  xmlPath?: string
  inputFolder?: string
  outputPath?: string
}

export interface ServiceResponse {
  id: string
  success: boolean
  outputPath?: string
  error?: string
}

export function createRequest(
  type: ServiceRequest['type'],
  params?: Omit<ServiceRequest, 'id' | 'type'>
): ServiceRequest {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    ...params
  }
}
