declare module 'qrcode' {
  const QRCode: {
    toDataURL(dataUrl: string, opts?: Record<string, unknown>): Promise<string>
  }
  export default QRCode
}
