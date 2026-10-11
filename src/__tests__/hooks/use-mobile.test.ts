import { describe, expect, it } from 'vitest'
import { isMobileViewport } from '@/hooks/use-mobile'

describe('isMobileViewport', () => {
  it.each([320, 375, 390, 430])('uses the mobile layout at %ipx', (width) => {
    expect(isMobileViewport({
      innerWidth: width,
      screenWidth: width,
      hasCoarsePointer: true,
    })).toBe(true)
  })

  it('keeps a phone in the mobile layout when Safari requests desktop width', () => {
    expect(isMobileViewport({
      innerWidth: 980,
      screenWidth: 390,
      hasCoarsePointer: true,
    })).toBe(true)
  })

  it('does not switch a zoomed touch laptop to the mobile layout', () => {
    expect(isMobileViewport({
      innerWidth: 980,
      screenWidth: 1440,
      hasCoarsePointer: true,
    })).toBe(false)
  })

  it('keeps a tablet-sized touch display on the desktop layout', () => {
    expect(isMobileViewport({
      innerWidth: 980,
      screenWidth: 820,
      hasCoarsePointer: true,
    })).toBe(false)
  })
})
