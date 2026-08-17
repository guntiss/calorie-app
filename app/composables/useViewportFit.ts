/**
 * What the browser can actually show right now, published as CSS variables.
 *
 * A phone keypad takes the bottom third of the screen without taking anything
 * off `100dvh`: iOS shrinks the *visual* viewport and leaves the layout one
 * alone, so a sheet sized and centred against dvh keeps its footer — and the
 * bottom of its list — underneath the keys. The visual viewport is the only
 * thing that knows the keypad is up, so it is measured here and handed to CSS:
 *
 *   --viewport-height  what is visible, in px
 *   --viewport-center  the middle of what is visible, in fixed-position coords
 *
 * Both carry sensible fallbacks at the point of use (`100dvh` and `50%`), so a
 * browser without `visualViewport` — and the server-rendered first paint — get
 * the plain full-height layout rather than a collapsed one.
 */

/** How many screens are currently asking, so the last one out detaches. */
let watchers = 0

let frame: number | null = null

function measure() {
  frame = null

  const view = window.visualViewport
  if (!view) return

  const style = document.documentElement.style
  style.setProperty('--viewport-height', `${Math.round(view.height)}px`)
  // Offset first: a fixed element is placed against the layout viewport, and
  // `offsetTop` is how far down it the visible part currently starts.
  style.setProperty('--viewport-center', `${Math.round(view.offsetTop + view.height / 2)}px`)
}

/**
 * Coalesced to a frame: iOS fires `scroll` on the visual viewport throughout a
 * drag, and every one of these writes invalidates layout for the whole page.
 */
function schedule() {
  if (frame === null) frame = requestAnimationFrame(measure)
}

function clear() {
  const style = document.documentElement.style
  style.removeProperty('--viewport-height')
  style.removeProperty('--viewport-center')
}

export function useViewportFit() {
  onMounted(() => {
    if (!window.visualViewport) return

    watchers++
    if (watchers === 1) {
      window.visualViewport.addEventListener('resize', schedule)
      window.visualViewport.addEventListener('scroll', schedule)
    }
    measure()
  })

  onBeforeUnmount(() => {
    if (!window.visualViewport) return

    watchers = Math.max(0, watchers - 1)
    if (watchers) return

    window.visualViewport.removeEventListener('resize', schedule)
    window.visualViewport.removeEventListener('scroll', schedule)
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    // Left set, the last measurement would keep sizing whatever reads it long
    // after anything was watching the keypad.
    clear()
  })
}
