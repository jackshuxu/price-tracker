'use client'
import { useEffect, useRef } from 'react'
import type { Category } from '@/lib/categories'
import type { PriceData } from '@/lib/price-fetcher'
import BasketPhysics from './BasketPhysics'
import HeroHeading from './HeroHeading'
import HeroNav from './HeroNav'

interface Props {
  categories: Category[]
  priceDataMap: Record<string, PriceData>
}

export default function HeroSection({ categories, priceDataMap }: Props) {
  const sectionRef = useRef<HTMLElement>(null)
  const triggerFallRef = useRef<(() => void) | null>(null)
  const fallFiredRef = useRef(false)

  useEffect(() => {
    if (!sectionRef.current) return
    let cleanup: (() => void) | undefined

    import('gsap').then(async (gsapModule) => {
      const gsap = gsapModule.default
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      // Parallax heading and nav upward + fade as user scrolls
      gsap.to('.hero-side-column', {
        y: -250,
        opacity: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: '40% top',
          scrub: true,
        },
      })

      // Trigger the fall at ~35% scroll through the section
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: '30% top',
        onEnter: () => {
          if (!fallFiredRef.current) {
            fallFiredRef.current = true
            triggerFallRef.current?.()
          }
        },
      })

      cleanup = () => ScrollTrigger.getAll().forEach(t => t.kill())
    })

    return () => cleanup?.()
  }, [])

  return (
    <section
      ref={sectionRef}
      style={{ height: '200vh', position: 'relative' }}
    >
      {/* Sticky container: pins to viewport while scrolling through 200vh */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {/* Single unified canvas — float phase then fall phase */}
        <BasketPhysics
          categories={categories}
          priceDataMap={priceDataMap}
          heroMode
          onFallReady={(fn) => { triggerFallRef.current = fn }}
        />

        {/* Text overlay — responsive: side-by-side on desktop, stacked on mobile/tablet */}
        <div className="hero-text-overlay">
          <HeroHeading />
          <HeroNav />
        </div>
      </div>
    </section>
  )
}
