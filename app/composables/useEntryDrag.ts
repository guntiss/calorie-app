import type { DropTarget } from '~/stores/dayLog'

/**
 * Dragging a logged row to somewhere else.
 *
 * One drag at a time, shared: the row under the finger and the row it is being
 * dropped against are two different components, and neither of them owns the
 * gesture. The grid reads the same state to lift the section being dragged out
 * of and to light up a meal with nothing in it.
 *
 * The row is not reordered while it is being moved — the store is only asked
 * for it on release. That keeps the whole gesture reversible: nothing has
 * happened until it is dropped, and nothing to undo if it is not.
 *
 * The row itself does not travel either. It stays in its place, held and lit,
 * and what follows the finger is the line saying where letting go would put it.
 * A row that follows the finger has to be told where the finger is in the
 * page's terms, and a phone browser is entitled to move the page underneath the
 * gesture, to stop sending it, or to take it away and keep scrolling — each of
 * which was a way for the row to end up somewhere its own, fighting whatever
 * held the other opinion. The line is answerable to none of that: it is drawn
 * against whatever row the finger is over, which is a question with an answer
 * however the day moves.
 *
 * A row is picked up by being held. The day is a list that scrolls and rows
 * that swipe, so a drag cannot also be "moved a finger" — it has to be the one
 * gesture neither of those is, and holding still is that gesture. Nothing is
 * taken from the row: a swipe still swipes, because moving inside the hold
 * gives the press up as a swipe or a scroll rather than becoming a drag.
 */

/** How long the row is held before it is picked up. */
const HOLD_MS = 450
/** How far the finger may drift in that time and still be holding still. */
const HOLD_SLOP = 8
/**
 * How near the top and bottom of the window the drag starts scrolling the day,
 * and — since a finger held down there is usually over a bar rather than over
 * the day — where it aims from when there is nothing under it to aim at.
 *
 * Deeper at the foot than the head, because the day's footer is the taller of
 * the two bars.
 */
const EDGE_TOP = 96
const EDGE_BOTTOM = 150
/** The fastest that scroll goes, in pixels a frame, at the very edge. */
const EDGE_SPEED = 16

/** The one drag in progress, none of which outlives the pointer that made it. */
let pointerId: number | null = null
let pending: string | null = null
let holdTimer: ReturnType<typeof setTimeout> | null = null
let startX = 0
let startY = 0
let pointerX = 0
let pointerY = 0
let frame: number | null = null
/** What the last frame worked out the release would do. */
let landing: { mealId: string | null, index: number } | null = null

export function useEntryDrag() {
  const store = useDayLogStore()
  const { isCollapsed, expand } = useMealCollapse()

  /** The row being dragged, if any. */
  const dragging = useState<string | null>('entry-drag', () => null)
  /** Where the line is drawn, and so where letting go would put the row. */
  const target = useState<DropTarget | null>('entry-drag-target', () => null)

  /**
   * A press has landed on a row: start counting it as a hold.
   *
   * Nothing is a drag yet, and most presses never become one — this is also the
   * beginning of a swipe, of a scroll, and of tapping the row's own controls.
   */
  function press(event: PointerEvent, id: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (pending || dragging.value) return
    // A press that lands on a control belongs to that control.
    if ((event.target as HTMLElement | null)?.closest('input, button, a')) return

    pointerId = event.pointerId
    pending = id
    startX = pointerX = event.clientX
    startY = pointerY = event.clientY
    holdTimer = setTimeout(pickUp, HOLD_MS)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    // The touch is followed as well as the pointer it is reported as, so the
    // whole gesture stands up on either one. A phone that stops sending pointer
    // events mid-gesture — something else has claimed the touch — otherwise
    // leaves a row held by nobody, at a finger that stopped reporting.
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onCancel)
  }

  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    moveTo(event.clientX, event.clientY)
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (touch) moveTo(touch.clientX, touch.clientY)
  }

  /** Where the finger is now, from whichever kind of event brought the news. */
  function moveTo(x: number, y: number) {
    pointerX = x
    pointerY = y
    if (dragging.value) return

    // The finger went somewhere during the hold, so it was never a hold: what
    // it was — a swipe across the row, a scroll down the day — belongs to
    // whoever else is watching this pointer.
    if (Math.abs(x - startX) > HOLD_SLOP || Math.abs(y - startY) > HOLD_SLOP) finish(false)
  }

  /** The hold was held: the row is picked up, and stays where it is. */
  function pickUp() {
    if (!pending) return

    dragging.value = pending

    // The one moment the phone can say what happened, since the finger is
    // holding still and there is nothing yet to see move.
    navigator.vibrate?.(8)

    frame = requestAnimationFrame(tick)
  }

  function onUp(event: PointerEvent | TouchEvent) {
    if (event instanceof PointerEvent) {
      if (event.pointerId !== pointerId) return
      moveTo(event.clientX, event.clientY)
    } else {
      // Where the finger left the screen, which is where it means.
      const touch = event.changedTouches[0]
      if (touch) moveTo(touch.clientX, touch.clientY)
    }
    finish(true)
  }

  /** The system took the gesture: a call, one of its own, a second finger. */
  function onCancel() {
    finish(false)
  }

  /** A drag is a held gesture, so escape is the way out of one. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !dragging.value) return
    event.preventDefault()
    finish(false)
  }

  /**
   * One frame of the drag.
   *
   * Driven by the clock rather than by the pointer, because the day scrolls
   * itself near the edges: the finger can be still while what is under it
   * moves, and the landing place has to keep up with that too.
   */
  function tick() {
    frame = requestAnimationFrame(tick)

    autoScroll()
    resolve()
  }

  /** Work out what letting go here would do, and show it. */
  function resolve() {
    const id = dragging.value
    if (!id) return

    // Over one of the bars rather than the day, which is where a finger ends up
    // holding the row against the foot of the window to scroll: aim at the
    // nearest row the bar is covering, so the drag keeps saying where it would
    // land while the day moves under it. Past that — off the grid altogether —
    // the last place it was over stands, rather than the drop being lost.
    const found = hitTest(pointerY) ?? hitTest(aimed())
    if (!found) return

    const outcome = store.resolveDrop(id, found)
    target.value = outcome ? found : null
    landing = outcome
  }

  function autoScroll() {
    const above = pointerY - EDGE_TOP
    const below = pointerY - (window.innerHeight - EDGE_BOTTOM)

    // How far into the band the pointer is, as a share of it — the day scrolls
    // gently at the near edge of the band and quickest against the window.
    const into = above < 0
      ? Math.max(above, -EDGE_TOP) / EDGE_TOP
      : below > 0 ? Math.min(below, EDGE_BOTTOM) / EDGE_BOTTOM : 0

    if (into) window.scrollBy(0, into * EDGE_SPEED)
  }

  /** The pointer, pulled back to the part of the day the bars leave visible. */
  function aimed() {
    return Math.min(Math.max(pointerY, EDGE_TOP), window.innerHeight - EDGE_BOTTOM)
  }

  /**
   * What is under a point: a row to sit against, or a meal to join the end of.
   *
   * The whole stack under it rather than the topmost of it, because the row
   * being dragged is itself the topmost thing there and has to be seen past.
   */
  function hitTest(y: number): DropTarget | null {
    for (const element of document.elementsFromPoint(pointerX, y)) {
      const row = element.closest<HTMLElement>('[data-entry]')
      if (row) {
        if (row.dataset.entry === dragging.value) continue

        const section = row.closest<HTMLElement>('[data-meal]')
        if (!section) continue

        const box = row.getBoundingClientRect()
        return {
          mealId: mealOf(section),
          entryId: row.dataset.entry ?? null,
          edge: y < box.top + box.height / 2 ? 'before' : 'after'
        }
      }

      const section = element.closest<HTMLElement>('[data-meal]')
      if (section) return sectionTarget(section, y)
    }
    return null
  }

  /**
   * Over a meal but not over any of its rows: its header, or a card with
   * nothing under one — a meal not eaten yet, or one folded shut.
   */
  function sectionTarget(section: HTMLElement, y: number): DropTarget {
    const mealId = mealOf(section)
    const rows = [...section.querySelectorAll<HTMLElement>('[data-entry]')]
      .filter(row => row.dataset.entry !== dragging.value)

    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first && last) {
      // Above the rows means the top of the meal — the header is over them, and
      // pointing at it to mean "the end" would read backwards.
      return y < first.getBoundingClientRect().top
        ? { mealId, entryId: first.dataset.entry ?? null, edge: 'before' }
        : { mealId, entryId: last.dataset.entry ?? null, edge: 'after' }
    }

    return { mealId, entryId: null, edge: 'after' }
  }

  /** The catch-all section is keyed by name, the way a folded section is. */
  function mealOf(section: HTMLElement) {
    const meal = section.dataset.meal
    return !meal || meal === 'unsorted' ? null : meal
  }

  function finish(apply: boolean) {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onUp)
    window.removeEventListener('touchcancel', onCancel)
    if (holdTimer) clearTimeout(holdTimer)
    if (frame !== null) cancelAnimationFrame(frame)

    // Where the pointer ended up, which a drag let go of between two frames
    // would not otherwise have been asked about.
    if (apply) resolve()

    const id = dragging.value
    // The row is still lifted as this runs, so the grid animates it from where
    // the finger left it to where it landed rather than from its old slot.
    if (apply && id && landing) {
      land(landing.mealId)
      store.moveEntry(id, landing.mealId, landing.index)
    }

    pointerId = null
    pending = null
    holdTimer = null
    frame = null
    landing = null
    dragging.value = null
    target.value = null
  }

  /** A row dropped into a folded meal has to be visible where it landed. */
  function land(mealId: string | null) {
    if (isCollapsed(mealId)) expand(mealId)
  }

  /**
   * Move a row one place from the keyboard, which has no gesture to hold.
   *
   * Crossing into another meal replaces the row's component with a new one, so
   * the focus has to be put back on the button that arrives in its place.
   */
  function nudge(id: string, delta: -1 | 1) {
    const landed = store.nudgeEntry(id, delta)
    if (!landed) return

    land(landed.mealId)
    void nextTick(() => {
      const way = delta < 0 ? 'up' : 'down'
      document.querySelector<HTMLElement>(`[data-entry="${id}"] [data-move="${way}"]`)?.focus()
    })
  }

  return {
    dragging,
    target,
    press,
    nudge,
    /** Called by the row itself if it is taken off the grid mid-drag. */
    cancel: () => finish(false)
  }
}
