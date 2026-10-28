import { afterEach, describe, expect, it } from 'vitest'
import {
  VIEW_STORAGE_KEY,
  isViewId,
  readStoredView,
  resolveInitialView,
  storeView,
  viewDirection
} from '../../../src/renderer/src/shell/navigation'

afterEach(() => {
  window.localStorage.clear()
})

describe('shell navigation', () => {
  it('recognizes only known view ids', () => {
    expect(isViewId('mappings')).toBe(true)
    expect(isViewId('settings')).toBe(true)
    expect(isViewId('plugins')).toBe(false)
    expect(isViewId(null)).toBe(false)
  })

  it('treats missing or invalid stored values as no choice', () => {
    expect(readStoredView()).toBeNull()
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'nope')
    expect(readStoredView()).toBeNull()
  })

  it('round-trips a stored view', () => {
    storeView('settings')
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('settings')
    expect(readStoredView()).toBe('settings')
  })

  it('lands on settings until onboarding is complete, then on mappings', () => {
    expect(resolveInitialView({ onboardingComplete: false })).toBe('settings')
    expect(resolveInitialView({ onboardingComplete: true })).toBe('mappings')
  })

  it('prefers an explicit stored choice over the onboarding default', () => {
    expect(resolveInitialView({ onboardingComplete: true, storedView: 'settings' })).toBe(
      'settings'
    )
    expect(resolveInitialView({ onboardingComplete: false, storedView: 'mappings' })).toBe(
      'mappings'
    )
  })

  it('reports switch direction for the animation', () => {
    expect(viewDirection('mappings', 'settings')).toBe(1)
    expect(viewDirection('settings', 'mappings')).toBe(-1)
    expect(viewDirection('settings', 'settings')).toBe(0)
  })

  it('survives a storage that throws', () => {
    const original = window.localStorage.getItem
    window.localStorage.getItem = () => {
      throw new Error('denied')
    }
    try {
      expect(readStoredView()).toBeNull()
    } finally {
      window.localStorage.getItem = original
    }
  })
})
