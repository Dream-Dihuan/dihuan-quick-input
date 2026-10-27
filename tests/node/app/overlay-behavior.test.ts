import { describe, expect, it } from 'vitest'
import {
  OverlayFocusTracker,
  shouldHideOverlayOnShortcut
} from '../../../src/main/app/overlay-behavior'

describe('OverlayFocusTracker', () => {
  it('ignores a blur that arrives before the overlay has gained focus', () => {
    const tracker = new OverlayFocusTracker()
    tracker.beginShow()

    expect(tracker.shouldHideOnBlur()).toBe(false)
  })

  it('closes on blur after the overlay has gained focus', () => {
    const tracker = new OverlayFocusTracker()
    tracker.beginShow()
    tracker.handleFocus()

    expect(tracker.shouldHideOnBlur()).toBe(true)
  })

  it('resets focus state when the overlay is shown or hidden again', () => {
    const tracker = new OverlayFocusTracker()
    tracker.beginShow()
    tracker.handleFocus()

    tracker.beginHide()
    expect(tracker.shouldHideOnBlur()).toBe(false)

    tracker.beginShow()
    tracker.handleFocus()
    tracker.beginShow()
    expect(tracker.shouldHideOnBlur()).toBe(false)
  })
})

describe('shouldHideOverlayOnShortcut', () => {
  it('hides only a visible and focused overlay', () => {
    expect(shouldHideOverlayOnShortcut(true, true)).toBe(true)
  })

  it('reopens a visible overlay that is not focused', () => {
    expect(shouldHideOverlayOnShortcut(true, false)).toBe(false)
  })

  it('reopens a hidden overlay even if it reports focus', () => {
    expect(shouldHideOverlayOnShortcut(false, true)).toBe(false)
  })
})
