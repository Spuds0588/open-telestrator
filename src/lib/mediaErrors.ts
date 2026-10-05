/**
 * Shared error classification for camera acquisition.
 *
 * Both the host's webcam input and the cameraman page ask for a camera, so the
 * mapping from a `getUserMedia` rejection to a deliberate UI state lives here
 * instead of in two components.
 */
export interface CameraProblem {
  status: 'denied' | 'error'
  notice: string
}

function errorName(cause: unknown): string {
  return cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : ''
}

/** Maps a `getUserMedia` camera rejection onto a deliberate UI state. */
export function classifyCameraError(cause: unknown): CameraProblem {
  switch (errorName(cause)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        notice: 'Camera access was blocked. Allow the camera for this site, then try again.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { status: 'error', notice: 'No camera was found on this device.' }
    case 'NotReadableError':
      return { status: 'error', notice: 'The camera is in use by another app.' }
    default:
      return {
        status: 'error',
        notice:
          cause instanceof Error && cause.message
            ? `Camera error: ${cause.message}`
            : 'Could not start the camera.',
      }
  }
}
