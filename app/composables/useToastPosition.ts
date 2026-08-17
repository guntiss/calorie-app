export type ToastPosition = 'top-center' | 'bottom-center'

/**
 * Where the toaster puts its toasts.
 *
 * Bottom by default: a toast carrying an Undo wants to be within thumb reach of
 * the thumb that just deleted something. Raised to the top for as long as
 * anything with the keypad up is on screen — the bottom third of a phone is
 * under the keyboard then, and a confirmation nobody can see is not a
 * confirmation.
 *
 * Counted rather than set, so one screen putting it back does not pull it out
 * from under another that still wants it up.
 */
export function useToastPosition() {
  const position = useState<ToastPosition>('toast-position', () => 'bottom-center')
  const raisers = useState<number>('toast-raisers', () => 0)

  function raise() {
    raisers.value++
    position.value = 'top-center'
  }

  /**
   * Give it back — after `linger` ms, so a toast raised on the way out is read
   * where it appeared instead of jumping down the screen mid-sentence.
   */
  function lower(linger = 0) {
    raisers.value = Math.max(0, raisers.value - 1)
    setTimeout(() => {
      if (!raisers.value) position.value = 'bottom-center'
    }, linger)
  }

  return { position, raise, lower }
}
