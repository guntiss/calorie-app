<script setup lang="ts">
import type { ScanFailure } from '~/composables/useBarcodeScanner'

/**
 * The camera, held over a packet until it reads the code.
 *
 * Opened from wherever a barcode is wanted — the food's own field, or the
 * picker looking one up. It knows nothing about foods: it reports a code and
 * closes, and what that code means is the caller's business.
 */

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{ detected: [code: string] }>()

const video = useTemplateRef<HTMLVideoElement>('video')

const { active, failure, canLight, lit, start, stop, toggleLight } = useBarcodeScanner(video, (code) => {
  // A short buzz, where the phone has one: the eye is on the packet rather than
  // the screen, and this is what says to stop holding it still.
  navigator.vibrate?.(40)
  emit('detected', normaliseBarcode(code) ?? code)
  open.value = false
})

/** What went wrong, said in terms of what the person holding the phone can do. */
const problem = computed<{ title: string, detail: string } | null>(() => {
  const reasons: Record<ScanFailure, { title: string, detail: string }> = {
    denied: {
      title: 'No camera permission',
      detail: 'Allow camera access for this site in your browser settings, then try again.'
    },
    missing: {
      title: 'No camera found',
      detail: 'This device has no camera the browser can open. Type the barcode in instead.'
    },
    insecure: {
      title: 'Camera needs a secure connection',
      detail: 'Browsers only open a camera over HTTPS. Type the barcode in instead.'
    },
    unsupported: {
      title: 'Camera not available here',
      detail: 'This browser will not open a camera for a web page. Type the barcode in instead.'
    },
    reader: {
      title: 'Could not load the reader',
      detail: 'The barcode reader could not be fetched. Check the connection and try again.'
    },
    failed: {
      title: 'Could not open the camera',
      detail: 'Something else may be using it. Close other apps or tabs and try again.'
    }
  }
  return failure.value ? reasons[failure.value] : null
})

// The camera goes on with the dialog and off with it — including when the
// parent unmounts this as it closes, which the composable's own teardown
// covers.
watch(open, (isOpen) => {
  if (isOpen) void start()
  else stop()
}, { immediate: true })
</script>

<template>
  <UModal
    v-model:open="open"
    title="Scan barcode"
    description="Hold the camera over the barcode on the packet."
  >
    <template #body>
      <div class="space-y-3">
        <!-- Black behind the picture rather than the page's own background:
             the frame arrives a beat after the camera opens, and a white box
             that turns into a dark viewfinder reads as a flash in a kitchen at
             six in the morning. -->
        <div class="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
          <!-- `playsinline` is what keeps iOS from taking the video full screen
               and putting its own player over the dialog. Muted because a
               browser will not autoplay anything else. -->
          <video
            ref="video"
            class="size-full object-cover"
            playsinline
            muted
            autoplay
          />

          <!-- A window to aim through. Wide and short, which is the shape of
               the barcode itself — it says "put the bars across this" without a
               line of text saying so. -->
          <div v-if="active" class="pointer-events-none absolute inset-0 grid place-items-center">
            <div class="h-1/4 w-4/5 rounded-lg border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
          </div>

          <div
            v-else-if="!problem"
            class="absolute inset-0 grid place-items-center text-white/80"
          >
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
          </div>

          <UButton
            v-if="canLight"
            :icon="lit ? 'i-lucide-flashlight-off' : 'i-lucide-flashlight'"
            :aria-label="lit ? 'Turn the light off' : 'Turn the light on'"
            color="neutral"
            variant="solid"
            class="absolute bottom-3 right-3 rounded-full"
            @click="toggleLight"
          />
        </div>

        <div v-if="problem" class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
          <p class="text-sm font-medium">
            <UIcon name="i-lucide-camera-off" class="mr-1 size-4 align-text-bottom" />
            {{ problem.title }}
          </p>
          <p class="mt-0.5 text-xs text-dimmed">
            {{ problem.detail }}
          </p>
        </div>

        <p v-else class="text-center text-xs text-dimmed">
          Hold the phone steady, about a hand's width from the packet.
        </p>
      </div>
    </template>

    <template #footer>
      <UButton
        class="w-full justify-center"
        color="neutral"
        variant="ghost"
        label="Cancel"
        @click="open = false"
      />
    </template>
  </UModal>
</template>
