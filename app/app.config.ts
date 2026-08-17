export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'slate'
    },

    /*
     * Nuxt UI's controls only react on focus, which on a desktop means a field
     * gives nothing back until you have already committed to clicking it. These
     * add the hover half. `hover:` is pointer-only in Tailwind v4, so touch
     * devices are left exactly as they were.
     */
    input: {
      slots: { base: 'hover:ring-primary/40' }
    },
    select: {
      slots: { base: 'hover:ring-primary/40' }
    },
    selectMenu: {
      slots: { base: 'hover:ring-primary/40' }
    },
    textarea: {
      slots: { base: 'hover:ring-primary/40' }
    },
    inputNumber: {
      slots: { base: 'hover:ring-primary/40' }
    },
    /*
     * A softer corner than the 0.5rem the theme ships with. This has to hang
     * off the variant rather than the `content` slot: the theme sets its radius
     * in `fullscreen: false`, which is emitted after the slot's own classes, so
     * a `rounded-*` set on the slot is the one tailwind-merge throws away.
     */
    modal: {
      variants: {
        fullscreen: {
          false: { content: 'rounded-2xl' }
        }
      }
    }
  }
})
