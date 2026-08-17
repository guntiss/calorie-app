<script setup lang="ts">
/**
 * Pull down at the top of the page to reload it.
 *
 * Installed as a home-screen app there is no browser chrome, so there is no
 * reload button either — this is the only way back from a stale day short of
 * force-quitting. The gesture is implemented here rather than left to the
 * browser because `overscroll-behavior-y: none` (which keeps the rubber-band
 * off the sticky day footer) also takes the native pull-to-refresh with it.
 *
 * Drop it anywhere on a page; it renders only its own indicator, pinned over
 * the page's sticky header, and never wraps or moves the content.
 *
 * Temporarily switched off via ENABLED below — the gesture is inert and the
 * indicator never renders, while both call sites stay wired up. Flip the flag
 * back to true to restore it.
 */

/** Master switch for the gesture. See the note above before changing. */
const ENABLED = false

const props = defineProps<{
  /** Reloads the page's data. Awaited: the spinner runs until it settles. */
  onRefresh: () => unknown
}>()

/** How far the finger has to travel before the release counts. */
const THRESHOLD = 64
/** Past this the indicator stops following, so an overlong pull says nothing. */
const MAX = 96
/** Under 1 the indicator trails the finger, which is what makes it feel held. */
const RESISTANCE = 0.5
/** A reload off a warm cache is instant; a spinner flashing in and out reads as a glitch. */
const MIN_SPIN_MS = 400

const distance = ref(0)
const refreshing = ref(false)
const dragging = ref(false)

/** The touch began somewhere a pull is possible: one finger, page at the top. */
let tracking = false
let startX = 0
let startY = 0

const armed = computed(() => distance.value >= THRESHOLD)

/**
 * A touch inside a dialog or a scrollable list of its own is that element's to
 * handle — the picker's results and the food modal both sit still at the top of
 * an unscrolled page.
 */
function isOwnedElsewhere(target: EventTarget | null) {
  let node = target instanceof Element ? target : null
  if (node?.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return true

  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return true
    node = node.parentElement
  }
  return false
}

function onTouchStart(e: TouchEvent) {
  tracking = false
  dragging.value = false
  const touch = e.touches[0]
  if (!touch || refreshing.value || e.touches.length !== 1) return
  if (window.scrollY > 0 || isOwnedElsewhere(e.target)) return

  startX = touch.clientX
  startY = touch.clientY
  tracking = true
}

function onTouchMove(e: TouchEvent) {
  if (!tracking || refreshing.value) return

  const touch = e.touches[0]
  if (!touch || e.touches.length !== 1) return cancel()

  const dy = touch.clientY - startY
  const dx = touch.clientX - startX

  if (!dragging.value) {
    // Wait for the gesture to declare itself. Anything that is not a downward
    // drag from a standstill — a flick up, a sideways swipe — is given up on
    // for the rest of the touch rather than fought over.
    if (Math.abs(dx) > Math.abs(dy) || dy < -4) {
      tracking = false
      return
    }
    if (dy < 8) return
    // Momentum from a previous flick can still be running the page down.
    if (window.scrollY > 0) {
      tracking = false
      return
    }
    dragging.value = true
  }

  // Only ever reached while the page is at the top and the finger is moving
  // down, where there is nothing left for the browser to scroll.
  if (e.cancelable) e.preventDefault()
  distance.value = Math.min(dy * RESISTANCE, MAX)
}

async function onTouchEnd() {
  if (!tracking) return
  const release = dragging.value && armed.value
  tracking = false
  dragging.value = false

  if (!release) {
    distance.value = 0
    return
  }

  refreshing.value = true
  distance.value = THRESHOLD
  try {
    await Promise.all([props.onRefresh(), new Promise(r => setTimeout(r, MIN_SPIN_MS))])
  } finally {
    refreshing.value = false
    distance.value = 0
  }
}

function cancel() {
  tracking = false
  dragging.value = false
  if (!refreshing.value) distance.value = 0
}

// Bound to the document, not to an element: the gesture starts wherever the
// finger lands, and this component renders nothing the user aims at.
onMounted(() => {
  if (!ENABLED) return
  document.addEventListener('touchstart', onTouchStart, { passive: true })
  // Not passive: a pull at the top is ours to keep, bounce and all.
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onTouchEnd, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('touchstart', onTouchStart)
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onTouchEnd)
  document.removeEventListener('touchcancel', cancel)
})
</script>

<template>
  <div
    v-if="ENABLED"
    class="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[env(safe-area-inset-top)]"
    role="status"
    :aria-label="refreshing ? 'Refreshing' : undefined"
  >
    <div
      class="grid size-9 place-items-center rounded-full border border-default bg-default shadow-lg"
      :class="dragging ? '' : 'transition-all duration-200 ease-out'"
      :style="{
        // Parked out of sight above the viewport until the pull brings it in.
        transform: `translateY(${distance - 48}px)`,
        opacity: Math.min(distance / THRESHOLD, 1)
      }"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4.5"
        :class="[refreshing && 'animate-spin', armed ? 'text-primary' : 'text-dimmed']"
        :style="refreshing ? undefined : { transform: `rotate(${distance * 3}deg)` }"
      />
    </div>
  </div>
</template>
