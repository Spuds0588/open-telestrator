/**
 * A draw loop that survives a background tab.
 *
 * Animation frames stop when a tab is hidden, which would freeze anything being
 * broadcast from a canvas or a media element. The loop keeps a slow tick going
 * while hidden, so the picture becomes a slideshow instead of a still frame,
 * and goes back to full rate the moment the tab is visible again.
 *
 * Returns the stop function.
 */
export function startFrameLoop(draw: () => void, hiddenIntervalMs: number): () => void {
  let raf = 0
  let timer = 0

  const loop = () => {
    draw()
    raf = requestAnimationFrame(loop)
  }

  const sync = () => {
    cancelAnimationFrame(raf)
    window.clearInterval(timer)
    if (document.hidden) {
      draw()
      timer = window.setInterval(draw, hiddenIntervalMs)
    } else {
      raf = requestAnimationFrame(loop)
    }
  }

  document.addEventListener('visibilitychange', sync)
  sync()

  return () => {
    document.removeEventListener('visibilitychange', sync)
    cancelAnimationFrame(raf)
    window.clearInterval(timer)
  }
}
