'use client'
import { useEffect, useRef, useCallback } from 'react'
import type { Category } from '@/lib/categories'
import { ICON_URLS } from '@/lib/icon-urls'
import { useOrchestrator } from '@/lib/icon-orchestrator'

interface Props {
  categories: Category[]
}

// Golden-angle spiral for organic initial placement
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

interface IconState {
  slug: string
  baseX: number
  baseY: number
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  freqX: number
  freqY: number
  phaseX: number
  phaseY: number
  ampX: number
  ampY: number
  size: number
  el: HTMLImageElement | null
}

export default function FloatingIcons({ categories }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<IconState[]>([])
  const rafRef = useRef(0)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const orchestrator = useOrchestrator()

  const initIcons = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const cw = rect.width
    const ch = rect.height
    const centerX = cw / 2
    const centerY = ch / 2
    const maxRadius = Math.min(cw, ch) * 0.38

    const validCats = categories.filter(c => ICON_URLS[c.slug])
    const iconSize = Math.round(Math.min(cw, ch) * 0.18)

    stateRef.current = validCats.map((cat, i) => {
      // Golden-angle spiral placement
      const r = Math.sqrt((i + 0.5) / validCats.length) * maxRadius
      const theta = i * GOLDEN_ANGLE
      const jitterX = (Math.random() - 0.5) * iconSize * 0.4
      const jitterY = (Math.random() - 0.5) * iconSize * 0.4
      const baseX = centerX + r * Math.cos(theta) + jitterX
      const baseY = centerY + r * Math.sin(theta) + jitterY

      return {
        slug: cat.slug,
        baseX,
        baseY,
        x: baseX,
        y: baseY,
        vx: 0,
        vy: 0,
        rotation: (Math.random() - 0.5) * 0.2,
        freqX: 0.0004 + Math.random() * 0.0003,
        freqY: 0.0003 + Math.random() * 0.0004,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        ampX: 6 + Math.random() * 10,
        ampY: 5 + Math.random() * 8,
        size: iconSize,
        el: null,
      }
    })
  }, [categories])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    initIcons()

    // Create DOM elements
    const icons = stateRef.current
    icons.forEach(icon => {
      const img = document.createElement('img')
      img.src = ICON_URLS[icon.slug]
      img.alt = icon.slug
      img.draggable = false
      img.style.cssText = `
        position: absolute;
        width: ${icon.size}px;
        height: ${icon.size}px;
        object-fit: contain;
        pointer-events: none;
        will-change: transform;
        user-select: none;
      `
      container.appendChild(img)
      icon.el = img
    })

    const DAMPING = 0.92
    const REPULSE_RADIUS = 120
    const REPULSE_FORCE = 1.8

    function animate() {
      if (orchestrator?.phase === 'falling') {
        // Snapshot positions and hide
        icons.forEach(icon => {
          if (!icon.el) return
          const elRect = icon.el.getBoundingClientRect()
          orchestrator.updatePosition(icon.slug, {
            slug: icon.slug,
            x: elRect.left + elRect.width / 2,
            y: elRect.top + elRect.height / 2,
            width: elRect.width,
            height: elRect.height,
            rotation: icon.rotation,
          })
          icon.el.style.opacity = '0'
        })
        return // stop loop
      }

      const now = performance.now()
      const mouse = mouseRef.current

      for (const icon of icons) {
        if (!icon.el) continue

        // Sinusoidal drift
        const driftX = icon.ampX * Math.sin(icon.freqX * now + icon.phaseX)
        const driftY = icon.ampY * Math.cos(icon.freqY * now + icon.phaseY)

        // Mouse repulsion
        if (mouse && container) {
          const containerRect = container.getBoundingClientRect()
          const mx = mouse.x - containerRect.left
          const my = mouse.y - containerRect.top
          const dx = icon.x - mx
          const dy = icon.y - my
          const dist = Math.hypot(dx, dy)
          if (dist < REPULSE_RADIUS && dist > 0) {
            const force = (1 - dist / REPULSE_RADIUS) * REPULSE_FORCE
            icon.vx += (dx / dist) * force
            icon.vy += (dy / dist) * force
          }
        }

        // Apply velocity with damping
        icon.vx *= DAMPING
        icon.vy *= DAMPING
        icon.x = icon.baseX + driftX + icon.vx * 3
        icon.y = icon.baseY + driftY + icon.vy * 3

        // Rotation drift
        const rotDrift = 0.03 * Math.sin(icon.freqX * now * 0.5 + icon.phaseY)

        icon.el.style.transform = `translate(${icon.x - icon.size / 2}px, ${icon.y - icon.size / 2}px) rotate(${icon.rotation + rotDrift}rad)`
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    // Mouse tracking
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseLeave = () => {
      mouseRef.current = null
    }

    container.addEventListener('mousemove', onMouseMove)
    container.addEventListener('mouseleave', onMouseLeave)

    return () => {
      cancelAnimationFrame(rafRef.current)
      container.removeEventListener('mousemove', onMouseMove)
      container.removeEventListener('mouseleave', onMouseLeave)
      // Remove created img elements
      icons.forEach(icon => {
        if (icon.el && container.contains(icon.el)) {
          container.removeChild(icon.el)
        }
      })
    }
  }, [categories, initIcons, orchestrator])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  )
}
