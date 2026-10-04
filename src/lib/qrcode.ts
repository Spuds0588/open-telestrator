import QRCode from 'qrcode'

/**
 * Produce a data URL of a QR code that encodes the cameraman invite link.
 *
 * The QR code is generated on the host (it is cheap and only runs in the
 * browser when the cameraman link exists) so a phone holding this page can
 * point its camera at the sidebar, scan, and jump straight into camera mode.
 * The returned data URL is small enough to embed inline in the sidebar.
 */
export async function qrOf(dataUrl: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(dataUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#0b0f14',
        light: '#ffffff',
      },
    })
  } catch {
    return null
  }
}
