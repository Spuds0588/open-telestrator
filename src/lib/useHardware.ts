import { useCallback, useEffect, useRef, useState } from 'react'
import { GAMEPAD_BUTTONS, midiAction, pressedActions, type HardwareAction } from './hardware'

/** How often gamepad state is read. Fast enough for a deliberate press. */
const POLL_MS = 100

export type MidiStatus = 'off' | 'on' | 'unsupported' | 'denied'

export interface HardwareController {
  /** The gamepads currently connected, by name. */
  gamepads: string[]
  midi: MidiStatus
  /** Ask for MIDI access. Must be called from a user gesture. */
  enableMidi: () => Promise<void>
}

/**
 * Hardware triggers: gamepads, pedals and button boxes (polled, no permission
 * needed) and MIDI pads or foot controllers (opted into with a button, because
 * the browser prompts for it).
 *
 * Both dispatch the same small set of actions as the keyboard shortcuts, so a
 * desk can flip feeds, replay a moment or clear the board without touching the
 * keyboard. A Stream Deck needs none of this — its software sends those keys.
 */
export function useHardware(dispatch: (action: HardwareAction) => void): HardwareController {
  const [gamepads, setGamepads] = useState<string[]>([])
  const [midi, setMidi] = useState<MidiStatus>(() =>
    typeof navigator.requestMIDIAccess === 'function' ? 'off' : 'unsupported',
  )

  const dispatchRef = useRef(dispatch)
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  useEffect(() => {
    if (typeof navigator.getGamepads !== 'function') return
    /** Last seen press state per pad index, so a held button fires once. */
    const previous = new Map<number, boolean[]>()

    const poll = () => {
      const pads = navigator.getGamepads()
      const connected: string[] = []
      for (const pad of pads) {
        if (!pad) continue
        connected.push(pad.id)
        const pressed = pad.buttons.map((button) => button.pressed)
        for (const action of pressedActions(pressed, previous.get(pad.index) ?? [], GAMEPAD_BUTTONS)) {
          dispatchRef.current(action)
        }
        previous.set(pad.index, pressed)
      }
      for (const index of [...previous.keys()]) {
        if (!pads[index]) previous.delete(index)
      }
      const names = connected.join('|')
      setGamepads((current) => (current.join('|') === names ? current : connected))
    }

    const timer = window.setInterval(poll, POLL_MS)
    poll()
    return () => window.clearInterval(timer)
  }, [])

  const enableMidi = useCallback(async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      setMidi('unsupported')
      return
    }
    try {
      const access = await navigator.requestMIDIAccess()
      const onMessage = (event: MIDIMessageEvent) => {
        const data = event.data
        if (!data || data.length < 3) return
        const status = data[0]
        const note = data[1]
        const velocity = data[2]
        // Note-on with a real velocity; note-offs and aftertouch are ignored.
        if ((status & 0xf0) !== 0x90 || velocity === 0) return
        const action = midiAction(note)
        if (action) dispatchRef.current(action)
      }
      const listen = () => {
        for (const input of access.inputs.values()) {
          input.addEventListener('midimessage', onMessage)
        }
      }
      listen()
      // Devices plugged in after the grant need the listener attaching too.
      access.onstatechange = listen
      setMidi('on')
    } catch {
      setMidi('denied')
    }
  }, [])

  return { gamepads, midi, enableMidi }
}
