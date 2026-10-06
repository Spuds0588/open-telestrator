import { describe, expect, it } from 'vitest'
import { canShareScreen, classifyCaptureError } from './capture'
import { classifyCameraError } from './mediaErrors'
import { classifyMicError } from './audio'

describe('classifyCaptureError', () => {
  it('treats a dismissed or blocked picker as recoverable', () => {
    expect(classifyCaptureError(new DOMException('nope', 'NotAllowedError')).status).toBe('denied')
    expect(classifyCaptureError(new DOMException('nope', 'SecurityError')).status).toBe('denied')
  })

  it('reports unsupported and missing sources as errors', () => {
    expect(classifyCaptureError(new DOMException('nope', 'NotSupportedError')).status).toBe('error')
    expect(classifyCaptureError(new DOMException('nope', 'NotFoundError')).status).toBe('error')
  })

  it('falls back to a described error for unknown failures', () => {
    const { status, notice } = classifyCaptureError(new Error('boom'))
    expect(status).toBe('error')
    expect(notice).toContain('boom')
  })

  it('names the failure when only the name is available', () => {
    expect(classifyCaptureError(new DOMException('x', 'AbortError')).notice).toContain('AbortError')
  })
})

describe('canShareScreen', () => {
  it('is the capability, not the platform', () => {
    const devices = { getDisplayMedia: () => Promise.resolve() } as unknown as MediaDevices
    expect(canShareScreen(devices)).toBe(true)
  })

  it('says no where there is no picker to call', () => {
    // Android's WebView reports mediaDevices without getDisplayMedia, and a
    // platform with no mediaDevices at all gets the same answer.
    expect(canShareScreen({} as MediaDevices)).toBe(false)
    expect(canShareScreen(undefined)).toBe(false)
  })
})

describe('classifyCameraError', () => {
  it('maps blocked permission to denied', () => {
    const problem = classifyCameraError(new DOMException('nope', 'NotAllowedError'))
    expect(problem.status).toBe('denied')
    expect(problem.notice).toContain('Allow the camera')
  })

  it('maps missing and busy cameras to errors', () => {
    expect(classifyCameraError(new DOMException('nope', 'NotFoundError')).notice).toContain(
      'No camera',
    )
    expect(classifyCameraError(new DOMException('nope', 'OverconstrainedError')).status).toBe('error')
    expect(classifyCameraError(new DOMException('nope', 'NotReadableError')).notice).toContain(
      'in use',
    )
  })

  it('falls back to the browser message', () => {
    expect(classifyCameraError(new Error('gpu crashed')).notice).toBe('Camera error: gpu crashed')
    expect(classifyCameraError('weird').notice).toBe('Could not start the camera.')
  })
})

describe('classifyMicError', () => {
  it('maps blocked permission to denied', () => {
    expect(classifyMicError(new DOMException('nope', 'NotAllowedError')).status).toBe('denied')
  })

  it('maps missing and busy microphones to errors', () => {
    expect(classifyMicError(new DOMException('nope', 'NotFoundError')).notice).toContain(
      'No microphone',
    )
    expect(classifyMicError(new DOMException('nope', 'NotReadableError')).status).toBe('error')
  })
})
