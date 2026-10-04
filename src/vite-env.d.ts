/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * JSON array of `RTCIceServer` objects, e.g.
   * `[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com","username":"u","credential":"p"}]`.
   * When unset, PeerJS's own default STUN is used.
   */
  readonly VITE_ICE_SERVERS?: string
  /** PeerJS signaling server host. Unset → the PeerJS public broker. */
  readonly VITE_PEER_HOST?: string
  readonly VITE_PEER_PORT?: string
  readonly VITE_PEER_PATH?: string
  readonly VITE_PEER_KEY?: string
  /** `'true'` to open the signaling socket over TLS. */
  readonly VITE_PEER_SECURE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
