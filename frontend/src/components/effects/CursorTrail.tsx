import { useEffect, useRef } from 'react'

type Dot = { x: number; y: number; tx: number; ty: number }

/**
 * Subtle floating dots that ease toward the pointer (pointer-events: none).
 */
export function CursorTrail({ count = 14 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotsRef = useRef<Dot[]>([])
  const targetRef = useRef({ x: 0, y: 0 })
  const raf = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    dotsRef.current = Array.from({ length: count }, () => ({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      tx: window.innerWidth / 2,
      ty: window.innerHeight / 2,
    }))

    const onMove = (e: PointerEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onMove)

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t

    const tick = () => {
      const { x: tx, y: ty } = targetRef.current
      const dots = dotsRef.current
      dots.forEach((d, i) => {
        const lag = 0.04 + i * 0.012
        d.x = lerp(d.x, tx, lag)
        d.y = lerp(d.y, ty, lag)
      })
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      dots.forEach((d, i) => {
        const alpha = 0.04 + (i / dots.length) * 0.12
        ctx.beginPath()
        ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`
        ctx.arc(d.x, d.y, 1.2 + (i % 4) * 0.35, 0, Math.PI * 2)
        ctx.fill()
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf.current)
    }
  }, [count])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="cursor-trail-canvas"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
