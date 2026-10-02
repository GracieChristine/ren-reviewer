import { useEffect, useRef, useState } from 'react'

/**
 * Detects user inactivity and returns `isIdle: true` after `timeoutMs` milliseconds.
 * Activity is reset on any mouse move, key press, or scroll.
 * Default: 30 minutes.
 */
export function useIdleTimeout(timeoutMs = 30 * 60 * 1000) {
  const [isIdle, setIsIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function resetTimer() {
    if (timer.current) clearTimeout(timer.current)
    setIsIdle(false)
    timer.current = setTimeout(() => setIsIdle(true), timeoutMs)
  }

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer() // start the timer on mount

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs])

  return { isIdle, resume: resetTimer }
}
