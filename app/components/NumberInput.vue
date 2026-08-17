<script setup lang="ts">
/**
 * A number field that accepts a comma as a decimal point.
 *
 * A `type="number"` input cannot be typed into on a phone whose region uses the
 * comma — the decimal keypad offers a comma and the input throws it away — so
 * this is a text field that reads numbers itself. `~/utils/numeric` has the
 * whole of that story; everything here is the plumbing around it.
 */
defineProps<{
  /**
   * Ask for the whole-number keypad: kcal, and anything else with no everyday
   * use for a point. Only the keypad — a point that does arrive, from a
   * hardware keyboard or a value typed before, is still a point, because
   * dropping it would multiply the number by ten without saying so.
   */
  integer?: boolean
}>()

const model = defineModel<NumericValue>()

const { raw, onInput } = useNumericField(model)

const input = useTemplateRef<{ inputRef: HTMLInputElement | null }>('input')

/**
 * Put the cursor here, with what is already in the field selected so the next
 * keystroke replaces it rather than appending to it.
 */
defineExpose({
  focus: () => {
    input.value?.inputRef?.focus()
    input.value?.inputRef?.select()
  }
})
</script>

<template>
  <!-- `inputmode` still picks the keypad; only the validation goes away. The
       `@input` here runs alongside the one inside `UInput`, and cleans the text
       on the element before that one reads it back off. -->
  <UInput
    ref="input"
    v-model="raw"
    type="text"
    :inputmode="integer ? 'numeric' : 'decimal'"
    @input="onInput"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </UInput>
</template>
