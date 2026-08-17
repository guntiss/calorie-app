import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/**
 * Reading a barcode off the camera.
 *
 * The browser is asked first: Chrome on Android has a `BarcodeDetector` built
 * in, and the platform's own reader is faster than anything shipped in a
 * bundle. Safari has none — which is the phone this app is actually used on —
 * so a WebAssembly reader is loaded in its place, and only then: it is a
 * megabyte, and it is fetched the first time someone opens the scanner rather
 * than by everyone who opens the app.
 */

/** What is worth looking for. A packet carries one of these and nothing else. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] as const

/**
 * How often a frame is actually read.
 *
 * The camera offers sixty a second and the reader wants tens of milliseconds
 * per frame; reading every one would heat the phone up to no purpose, since a
 * hand holding a packet steady is not a thing that changes in 16ms.
 */
const FRAME_INTERVAL_MS = 120

/** Why the camera is not showing anything, in terms the dialog can explain. */
export type ScanFailure = 'insecure' | 'unsupported' | 'denied' | 'missing' | 'reader' | 'failed'

/** The little of a detector's surface that is used here. */
interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

/** The platform's own reader, where there is one. */
interface NativeDetector {
  new (options: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

/** Camera capabilities the DOM types do not know about yet. */
interface TorchCapabilities extends MediaTrackCapabilities { torch?: boolean }

/**
 * The reader, built once per page.
 *
 * Kept at module level so that scanning a second packet does not fetch and
 * compile the WebAssembly again — the dialog is opened and closed once per
 * food, and a shopping bag is several foods.
 */
let detector: Promise<Detector> | null = null

/** Set once the platform's own reader has been tried and found wanting. */
let nativeRefused = false

/** Whether the reader currently held is the platform's rather than the bundled one. */
let usingNative = false

function loadDetector(): Promise<Detector> {
  detector ??= build()
  return detector
}

async function build(): Promise<Detector> {
  const native = (globalThis as unknown as { BarcodeDetector?: NativeDetector }).BarcodeDetector

  if (native && !nativeRefused) {
    try {
      const supported = await native.getSupportedFormats?.() ?? []
      const formats = FORMATS.filter(format => supported.includes(format))
      // An implementation that is there but cannot read a product barcode is no
      // use here; fall through to the one that can.
      if (formats.length) {
        usingNative = true
        return new native({ formats })
      }
    } catch {
      // Present but unusable — some Android builds expose the constructor and
      // then throw on the first question asked of it.
    }
  }

  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/pure')
  // Served from this app rather than from the CDN the library defaults to: the
  // deployment is a private server behind its own domain, and a scanner that
  // silently needs jsdelivr to be reachable is one that stops working in a
  // kitchen with a bad connection — or in a household that never had one.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)
    }
  })
  usingNative = false
  return new BarcodeDetector({ formats: [...FORMATS] })
}

/**
 * Hold the camera open on a video element and report the first code read.
 *
 * The caller owns the element and the markup; this owns the stream, the reading
 * loop and the reasons either can fail. `stop` is safe to call twice and is
 * what releases the camera — a stream left running keeps the indicator light on
 * and the phone warm.
 */
export function useBarcodeScanner(
  video: Ref<HTMLVideoElement | null>,
  onDetected: (code: string) => void
) {
  /** Whether the picture is up yet. The dialog shows a spinner until it is. */
  const active = ref(false)
  const failure = ref<ScanFailure | null>(null)

  /** Whether this camera has a lamp, and whether it is on. */
  const canLight = ref(false)
  const lit = ref(false)

  let stream: MediaStream | null = null
  let frame: number | null = null
  let running = false
  let lastRead = 0

  async function start() {
    if (running) return
    running = true
    failure.value = null

    // getUserMedia exists only on a secure origin, so a deployment served over
    // plain HTTP fails here rather than at the permission prompt — worth saying
    // apart, because it is fixed by the person running the server, not by the
    // person holding the phone.
    if (!window.isSecureContext) return fail('insecure')
    if (!navigator.mediaDevices?.getUserMedia) return fail('unsupported')

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // The camera on the back of the phone, which is the one pointing at
          // the packet. `ideal` rather than `exact` so a laptop with only a
          // front camera still opens one.
          facingMode: { ideal: 'environment' },
          // Enough pixels for the bars of an EAN-13 to survive: at 640 wide a
          // code has to fill the frame before it reads.
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })
    } catch (e) {
      const name = (e as DOMException).name
      return fail(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'failed')
    }

    // Closed while the permission prompt was up.
    if (!running) return release()

    // The element is usually already there, but a dialog that starts the camera
    // as it opens asks for the stream before its own body has rendered — and on
    // a first visit the permission prompt makes that the other way round. Wait
    // for it rather than deciding the camera failed.
    const el = await waitForVideo()
    // Closed while waiting: the camera goes off and nothing is reported.
    if (!running) return release()
    if (!el) return fail('failed')

    el.srcObject = stream
    try {
      await el.play()
    } catch {
      // Autoplay refused. The element is muted and inline, so this is rare —
      // and the frames are there either way if the browser starts it itself.
    }

    const track = stream.getVideoTracks()[0]
    canLight.value = Boolean((track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch)

    active.value = true
    frame = requestAnimationFrame(tick)
  }

  /**
   * Read one frame, at most every `FRAME_INTERVAL_MS`.
   *
   * Scheduled with `requestAnimationFrame` rather than a timer so that a phone
   * put in a pocket mid-scan stops reading instead of grinding away behind a
   * locked screen.
   */
  async function tick() {
    frame = null
    if (!running) return

    const el = video.value
    const now = performance.now()

    if (el && el.readyState >= 2 && el.videoWidth && now - lastRead >= FRAME_INTERVAL_MS) {
      lastRead = now

      let reader: Detector
      try {
        reader = await loadDetector()
      } catch {
        // The reader itself could not be fetched — offline on a first scan, or
        // a bundle that never made it onto the server. A live picture that will
        // never read anything is worse than saying so.
        detector = null
        return fail('reader')
      }

      try {
        const [found] = await reader.detect(el)
        // Checked after the await: the dialog may have been closed while the
        // frame was being decoded, and a code reported then would arrive at a
        // form that has moved on.
        if (found?.rawValue && running) {
          onDetected(found.rawValue)
          return
        }
      } catch {
        // A frame that could not be read is the ordinary case — it is what
        // every frame without a barcode in it does. The next one is along in a
        // tenth of a second. Unless it was the platform's own reader that broke,
        // in which case it has had its chance and the bundled one takes over.
        if (usingNative) {
          nativeRefused = true
          usingNative = false
          detector = null
        }
      }
    }

    if (running) frame = requestAnimationFrame(tick)
  }

  /** Turn the camera's lamp on or off, where there is one. */
  async function toggleLight() {
    const track = stream?.getVideoTracks()[0]
    if (!track || !canLight.value) return
    const next = !lit.value
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      lit.value = next
    } catch {
      // The lamp is in use by something else, or the browser lied about having
      // one. Nothing to say; the picture is still there.
    }
  }

  /** The element, once the dialog holding it has rendered. */
  function waitForVideo(): Promise<HTMLVideoElement | null> {
    return new Promise((resolve) => {
      let left = 60
      const look = () => {
        if (video.value || !running || left-- <= 0) resolve(video.value)
        else requestAnimationFrame(look)
      }
      look()
    })
  }

  function fail(reason: ScanFailure) {
    failure.value = reason
    stop()
  }

  function release() {
    stream?.getTracks().forEach(track => track.stop())
    stream = null
    const el = video.value
    if (el) el.srcObject = null
  }

  function stop() {
    running = false
    active.value = false
    lit.value = false
    canLight.value = false
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    release()
  }

  // The camera is never left on by a component going away — a route change, a
  // parent that unmounts the dialog as it closes.
  onScopeDispose(stop)

  return { active, failure, canLight, lit, start, stop, toggleLight }
}
