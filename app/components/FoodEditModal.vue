<script setup lang="ts">
import type { SuggestionAsk } from '~/composables/useMacroSuggestion'
import type { DayFood } from '~/stores/dayLog'

type MacroKey = 'kcal' | 'protein' | 'fat' | 'carbs'

/**
 * The form's own shape: `brand` is a plain string so it can bind to an input,
 * and a macro field may be empty — an input cleared to nothing hands back `''`,
 * which is not the same thing as a typed zero.
 */
type FoodDraft = Omit<Partial<DayFood>, 'brand' | 'barcode' | MacroKey>
  & { brand: string, barcode: string }
  & { [K in MacroKey]?: NumericValue }

const props = defineProps<{
  /** The food to correct, or null to create one. */
  food: DayFood | null
}>()

const emit = defineEmits<{ saved: [food: DayFood] }>()

const open = defineModel<boolean>('open', { required: true })

const toast = useToast()
const library = useFoodLibraryStore()
const saving = ref(false)

function blank(): FoodDraft {
  return { name: '', brand: '', barcode: '' }
}

/**
 * A food as the form holds it, with a zero macro left blank.
 *
 * A food quick added while logging is stored as zeros, so a filled-in zero is
 * almost always a placeholder waiting to be typed over, and showing it means
 * clearing every field before the real number can go in. An untouched blank
 * saves the zero straight back, so nothing is lost by not showing it.
 */
function draftFrom(food: DayFood): FoodDraft {
  return {
    ...food,
    brand: food.brand ?? '',
    barcode: food.barcode ?? '',
    kcal: food.kcal || '',
    protein: food.protein || '',
    fat: food.fat || '',
    carbs: food.carbs || ''
  }
}

const draft = ref<FoodDraft>(blank())

/** What a macro field holds, as a number, with `NaN` for one left empty. */
function entered(value: NumericValue | undefined): number {
  return typeof value === 'number' ? value : Number.NaN
}

/** The same, saved as the zero an empty field stands for. */
function stated(value: NumericValue | undefined): number {
  const n = entered(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * The macros as numbers, with `NaN` for a field left empty.
 *
 * An empty field is not a claim of zero, and the checks below stay quiet on one
 * rather than reporting a form that is merely half typed.
 */
const macros = computed(() => ({
  kcal: entered(draft.value.kcal),
  protein: entered(draft.value.protein),
  fat: entered(draft.value.fat),
  carbs: entered(draft.value.carbs)
}))

/**
 * What the macros come to, or null when there is nothing yet to say: a field
 * still unfilled, or a food whose macros are all zero and so tells us nothing.
 */
const impliedKcal = computed(() => {
  const { protein, fat, carbs } = macros.value
  if (!protein && !fat && !carbs) return null
  const implied = kcalFromMacros(macros.value)
  return Number.isFinite(implied) ? Math.round(implied) : null
})

/** Set once the stated kcal is too far from the line above to be rounding. */
const mismatch = computed(() => kcalMismatch(macros.value))

/** Take the macros' word for it. The other way round is the user's to type. */
function useImpliedKcal() {
  if (mismatch.value) draft.value.kcal = mismatch.value.implied
}

// --- suggested macros -----------------------------------------------------

/**
 * What to look a suggestion up for, or null when there is nothing to ask about.
 *
 * The kcal field is the switch: a food with its calories filled in is a food
 * someone has already answered for, and offering it a guess would be noise. A
 * food quick added while logging arrives with none, which is exactly the case
 * this is here for — and a name still being typed is too short to place.
 */
const askable = computed<SuggestionAsk | null>(() => {
  const name = draft.value.name?.trim() ?? ''
  if (!open.value || draft.value.kcal || name.length < 2) return null
  return { name, brand: draft.value.brand.trim() || null }
})

const {
  suggestion,
  pending: suggesting,
  failed: suggestFailed,
  retry: retrySuggestion,
  dismiss: dismissSuggestion
} = useMacroSuggestion(askable)

/**
 * Fill the fields in from the suggestion.
 *
 * All four together: the four numbers describe one food, and taking the
 * calories without the macros behind them would leave the form stating a
 * mismatch it was handed. From here they are ordinary typed values — editable,
 * and saved only when the dialog is saved.
 */
function applySuggestion() {
  const suggested = suggestion.value
  if (!suggested) return

  draft.value.kcal = suggested.kcal
  draft.value.protein = suggested.protein
  draft.value.fat = suggested.fat
  draft.value.carbs = suggested.carbs
  // It has done its job; the numbers are the user's now.
  dismissSuggestion()
}

// --- the barcode ----------------------------------------------------------

const scanning = ref(false)

/**
 * Another food already carrying this code, if there is one.
 *
 * Not an error and nothing is blocked: two packets really can share a code —
 * a shop's own label reused across a range — and the honest thing is to say
 * which food is already answering to it and let the person decide. Answered
 * from the copy on the device, so it appears as the scan lands.
 */
const alreadyOn = computed(() => {
  const code = draft.value.barcode.trim()
  if (!code) return null
  const found = library.byBarcode(code)
  return found && found.id !== draft.value.id ? found : null
})

// The draft is taken when the modal opens rather than watched into place, so
// closing without saving really does discard, and so a second edit never shows
// what was typed into the first one.
watch(open, (isOpen) => {
  if (isOpen) {
    draft.value = props.food ? draftFrom(props.food) : blank()
    // So the check above is asking a current library: this dialog is opened
    // from screens that never touch the copy on the device, and a stale one
    // would quietly fail to mention the food already holding the code.
    void library.sync()
  }
}, { immediate: true })

async function save() {
  const name = draft.value.name?.trim()
  if (!name || saving.value) return

  const body = {
    ...draft.value,
    name,
    brand: draft.value.brand.trim() || null,
    // Sent as typed; the server folds it to the one form it is stored in, so a
    // code typed in the spacing it is printed in still matches a scanned one.
    barcode: draft.value.barcode.trim() || null,
    kcal: stated(draft.value.kcal),
    protein: stated(draft.value.protein),
    fat: stated(draft.value.fat),
    carbs: stated(draft.value.carbs)
  }
  saving.value = true
  try {
    const saved = body.id
      ? await $fetch<DayFood>(`/api/foods/${body.id}`, { method: 'PATCH', body })
      : await $fetch<DayFood>('/api/foods', { method: 'POST', body })

    emit('saved', saved)
    // No success toast: the modal closing over the updated food says it already.
    open.value = false
  } catch (e) {
    toast.add({ title: 'Could not save', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="food ? 'Edit food' : 'New food'">
    <template #body>
      <!-- A real form so Enter in any field saves and closes; the hidden submit
           button is what makes that implicit submission fire with several
           inputs on the page. `autocomplete` is off on the form as well as on
           its inputs: Safari treats the form as a whole when guessing whether
           it is being asked for someone's details. -->
      <form class="space-y-3" autocomplete="off" @submit.prevent="save">
        <!-- Labelled "Food" rather than "Name": iOS reads a field's label,
             placeholder and name attribute to guess what belongs in it, and the
             word "name" alone was enough to put "AutoFill Contact" over the
             keyboard and offer the person's own name for a food. The `name`
             here is a second such signal, and carries no dash — a dash in it is
             enough on its own to make Safari offer contacts. -->
        <UFormField label="Food" required>
          <UInput v-model="draft.name" name="food" class="w-full" placeholder="Chicken breast, raw" />
        </UFormField>

        <UFormField label="Brand">
          <UInput v-model="draft.brand" class="w-full" placeholder="Optional" />
        </UFormField>

        <!-- Typed as readily as scanned: the digits under the bars are printed
             right there, and a packet already in the cupboard is often easier
             to read than to hold a camera steady over. The keypad is the
             numeric one, which every retail code in the world fits; the rare
             label carrying letters is one to scan rather than type. -->
        <UFormField label="Barcode">
          <div class="flex gap-2">
            <UInput
              v-model="draft.barcode"
              name="barcode"
              inputmode="numeric"
              autocomplete="off"
              class="num min-w-0 flex-1"
              placeholder="Optional"
            />
            <UButton
              icon="i-lucide-scan-barcode"
              color="neutral"
              variant="subtle"
              aria-label="Scan a barcode"
              class="shrink-0"
              @click="scanning = true"
            />
          </div>
          <template v-if="alreadyOn" #help>
            <span class="text-warning">
              <UIcon name="i-lucide-triangle-alert" class="mr-0.5 size-3.5 align-text-bottom" />
              {{ alreadyOn.name }} already carries this code.
            </span>
          </template>
        </UFormField>

        <div class="grid grid-cols-4 gap-2" data-macros>
          <UFormField label="kcal">
            <NumberInput v-model="draft.kcal" integer class="w-full" placeholder="0" />
          </UFormField>
          <UFormField label="Protein">
            <NumberInput v-model="draft.protein" class="w-full" placeholder="0" />
          </UFormField>
          <UFormField label="Fat">
            <NumberInput v-model="draft.fat" class="w-full" placeholder="0" />
          </UFormField>
          <UFormField label="Carbs">
            <NumberInput v-model="draft.carbs" class="w-full" placeholder="0" />
          </UFormField>
        </div>

        <!-- Only while the calories are still blank, and only ever an offer:
             the numbers are typical for a food of that name, not a reading off
             the packet in someone's hand, so nothing lands in a field until
             "Use" is pressed. It sits above the note below so that accepting it
             hands straight over to the check on what was accepted. -->
        <div
          v-if="suggestion || suggesting || suggestFailed"
          class="rounded-lg border border-default bg-elevated/40 px-3 py-2"
        >
          <div v-if="suggestion" class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="num text-xs">
                <UIcon name="i-lucide-sparkles" class="mr-1 size-3.5 align-text-bottom text-primary" />
                {{ suggestion.kcal.toLocaleString() }} kcal ·
                P{{ suggestion.protein }} F{{ suggestion.fat }} C{{ suggestion.carbs }}
                <span class="text-dimmed">/ 100g</span>
              </p>
              <p class="truncate text-xs text-dimmed">
                Suggested<template v-if="suggestion.note"> · {{ suggestion.note }}</template>
              </p>
            </div>
            <UButton
              size="xs"
              variant="soft"
              label="Use"
              class="shrink-0"
              @click="applySuggestion"
            />
          </div>

          <p v-else-if="suggesting" class="flex items-center gap-2 text-xs text-dimmed">
            <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
            Looking up typical values…
          </p>

          <div v-else class="flex items-center gap-2 text-xs text-dimmed">
            <span class="flex-1">No suggestion for this one.</span>
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="shrink-0 p-0"
              label="Try again"
              @click="retrySuggestion"
            />
          </div>
        </div>

        <!-- Always on the page, turning from a note into a warning, rather than
             appearing on a mismatch: a line that materialises under the cursor
             would move the Save button out from under the tap that is landing
             on it. The row keeps its height whether or not the fix is offered.
             A gap is a question and not an error, so nothing here blocks the
             save — the entered kcal can perfectly well be the right one. -->
        <div
          class="flex min-h-6 items-center gap-2 text-xs"
          :class="mismatch ? 'text-warning' : 'text-dimmed'"
        >
          <p v-if="impliedKcal !== null" class="flex-1">
            <UIcon v-if="mismatch" name="i-lucide-triangle-alert" class="mr-0.5 size-3.5 align-text-bottom" />
            These macros come to <span class="num">{{ impliedKcal.toLocaleString() }}</span> kcal.
          </p>
          <span v-else class="flex-1" />
          <UButton
            v-if="mismatch"
            color="warning"
            variant="link"
            size="xs"
            class="shrink-0 p-0"
            :label="`Use ${mismatch.implied}`"
            @click="useImpliedKcal"
          />
        </div>

        <button type="submit" class="hidden" />
      </form>

      <!-- Outside the form: a camera dialog opened from inside one is a dialog
           whose buttons submit it. -->
      <BarcodeScanner v-model:open="scanning" @detected="draft.barcode = $event" />
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton class="flex-1 justify-center" label="Save" :loading="saving" @click="save" />
      </div>
    </template>
  </UModal>
</template>
