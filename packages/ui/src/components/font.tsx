import { createRenderEffect } from "solid-js"

export const Font = () => {
  createRenderEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return

    // Preloading the file alone does not activate the CSS face before code is rendered.
    // Start during rendering rather than waiting for deferred mount effects.
    void document.fonts.load('440 13px "IBM Plex Mono"').catch((error) => {
      console.warn("Unable to load the transcript font", error)
    })
  })

  return null
}
