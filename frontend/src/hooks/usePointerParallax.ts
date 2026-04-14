import { useCallback, useEffect, useRef, useState } from 'react'

export function usePointerParallax(maxShift = 8) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState({ x: 0, y: 0 })

  const onMove = useCallback(
    (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const nx = (e.clientX - cx) / (r.width / 2)
      const ny = (e.clientY - cy) / (r.height / 2)
      setShift({
        x: Math.max(-1, Math.min(1, nx)) * maxShift,
        y: Math.max(-1, Math.min(1, ny)) * maxShift,
      })
    },
    [maxShift],
  )

  const onLeave = useCallback(() => setShift({ x: 0, y: 0 }), [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [onMove, onLeave])

  return { ref, shift }
}
