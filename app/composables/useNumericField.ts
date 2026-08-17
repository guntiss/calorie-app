import type { Ref } from 'vue'

/**
 * Bind a text input to a number.
 *
 * The field is text — see `~/utils/numeric` for why — so what it shows and what
 * it means are two different things, and this keeps the two in step. It is used
 * by `NumberInput`, and directly by the day grid's own bare input.
 *
 * Returns the text to bind with `:value` and the handler to bind with `@input`.
 */
export function useNumericField(model: Ref<NumericValue | null | undefined>) {
  /** What the field shows, which is not always what the model holds. */
  const raw = ref(formatNumeric(model.value))

  watch(model, (value) => {
    // Rewrite the field only when its text no longer stands for the value.
    // "1." already reports 1, and replacing it with "1" would delete the point
    // the moment it was typed, leaving no way to ever reach 1.5.
    if (parseNumeric(raw.value) !== (value ?? '')) raw.value = formatNumeric(value)
  })

  function onInput(event: Event) {
    const el = event.target as HTMLInputElement
    const cleaned = cleanNumeric(el.value)

    if (cleaned !== el.value) {
      // Put the cleaned text back on the element by hand. A rejected keystroke
      // leaves `raw` as it was, so no re-render follows to take it off the
      // screen, and the caret is restored because assigning to `value` sends it
      // to the end of the field.
      const caret = Math.max(0, (el.selectionStart ?? el.value.length) - (el.value.length - cleaned.length))
      el.value = cleaned
      el.setSelectionRange(caret, caret)
    }

    raw.value = cleaned
    model.value = parseNumeric(cleaned)
  }

  return { raw, onInput }
}
