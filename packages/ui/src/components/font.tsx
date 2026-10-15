import { onMount } from "solid-js"

export const Font = () => {
  onMount(() => {
    // Preloading the file alone does not activate the CSS face before code is rendered.
    void document.fonts.load('440 13px "IBM Plex Mono"').catch((error) => {
      console.warn("Unable to load the transcript font", error)
    })
  })

  return null
}
