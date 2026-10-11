import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function isMobileViewport(metrics: {
  innerWidth: number
  screenWidth: number
  hasCoarsePointer: boolean
}) {
  if (metrics.innerWidth < MOBILE_BREAKPOINT) return true

  // iOS Safari's “Request Desktop Website” can keep a desktop-sized layout
  // viewport even on a phone. Use the physical screen/visual viewport only
  // when the primary input is touch, so a zoomed desktop window does not turn
  // into the mobile app layout.
  return metrics.hasCoarsePointer && metrics.screenWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const widthQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)')
    const update = () => {
      setIsMobile(isMobileViewport({
        innerWidth: window.innerWidth,
        screenWidth: Math.min(window.screen.width, window.screen.height),
        hasCoarsePointer: coarsePointerQuery.matches || navigator.maxTouchPoints > 0,
      }))
    }

    widthQuery.addEventListener('change', update)
    coarsePointerQuery.addEventListener('change', update)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.screen.orientation?.addEventListener('change', update)
    update()

    return () => {
      widthQuery.removeEventListener('change', update)
      coarsePointerQuery.removeEventListener('change', update)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.screen.orientation?.removeEventListener('change', update)
    }
  }, [])

  return !!isMobile
}
