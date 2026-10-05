import { useEffect, useState } from 'react'
import { qrOf } from './qrcode'

/** Renders a QR data URL for a link, clearing it when the link goes away. */
export function useQrCode(link: string | null): string | null {
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!link) {
      setQr(null)
      return
    }
    let cancelled = false
    qrOf(link).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [link])

  return qr
}
