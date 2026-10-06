import { useEffect, useState } from 'react'
import { shellMode } from './desktop'
import { layoutFor, type Layout } from './touch'

/** Whether the primary pointer is a finger or a stylus rather than a mouse. */
function coarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

function same(a: Layout | null, b: Layout | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.form === b.form &&
    a.orientation === b.orientation &&
    a.rail === b.rail &&
    a.panel === b.panel &&
    a.touch === b.touch
  )
}

/**
 * The layout this viewport should be drawn in, applied to the body.
 *
 * The rules live in `touch.ts`; this is only the part that has to notice a
 * change — a rotation, a window resize, or a stylus being put down and picked up
 * again — and hang the answer on `<body>` for the CSS to read:
 *
 * ```text
 * body[data-layout="compact"] the rail runs along the bottom
 * body.touch                  controls are sized for a fingertip
 * ```
 *
 * In a browser this is deliberately inert: it answers `null` and sets nothing,
 * so the web build keeps its desktop-only notice exactly as it was.
 */
export function useLayout(): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null)

  useEffect(() => {
    const measure = () => {
      const next = layoutFor({
        mode: shellMode(),
        userAgent: navigator.userAgent,
        width: window.innerWidth,
        height: window.innerHeight,
        touch: coarsePointer(),
      })
      // Only when it actually changed: a resize fires many times a second, and
      // a new object every time would re-render the studio for nothing.
      setLayout((current) => (same(current, next) ? current : next))
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    // A detachable keyboard, or a stylus switched for a trackpad, changes the
    // primary pointer without changing the window.
    const media = window.matchMedia('(pointer: coarse)')
    media.addEventListener('change', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      media.removeEventListener('change', measure)
    }
  }, [])

  useEffect(() => {
    const body = document.body
    if (!layout) return
    body.dataset.layout = layout.rail === 'bottom' ? 'compact' : 'wide'
    body.classList.toggle('touch', layout.touch)
    return () => {
      delete body.dataset.layout
      body.classList.remove('touch')
    }
  }, [layout])

  return layout
}
