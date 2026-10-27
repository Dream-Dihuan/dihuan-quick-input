/**
 * Tracks whether the overlay has actually gained keyboard focus since it was
 * shown. macOS can deliver a blur event while a newly shown window is still
 * becoming active; hiding on that first blur makes the overlay disappear
 * immediately after the global shortcut is pressed.
 */
export class OverlayFocusTracker {
  private focusedSinceShow = false

  beginShow(): void {
    this.focusedSinceShow = false
  }

  beginHide(): void {
    this.focusedSinceShow = false
  }

  handleFocus(): void {
    this.focusedSinceShow = true
  }

  shouldHideOnBlur(): boolean {
    return this.focusedSinceShow
  }
}

/**
 * A shortcut press should hide the overlay only when it is visible and focused.
 * If a visible overlay has lost activation (for example after switching apps or
 * displays), pressing the shortcut must bring it back instead of hiding it.
 */
export function shouldHideOverlayOnShortcut(isVisible: boolean, isFocused: boolean): boolean {
  return isVisible && isFocused
}
