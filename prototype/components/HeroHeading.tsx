'use client'
import { useEffect, useRef } from 'react'

export default function HeroHeading() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!headingRef.current) return
    let cleanup: (() => void) | undefined

    Promise.all([
      import('gsap'),
      import('split-type'),
    ]).then(([gsapModule, SplitTypeModule]) => {
      if (!headingRef.current) return
      const gsap = gsapModule.default
      const SplitType = SplitTypeModule.default

      const split = new SplitType(headingRef.current, {
        types: 'words,chars',
        tagName: 'span',
      })

      gsap.from(split.chars, {
        opacity: 0,
        y: 18,
        rotateZ: () => (Math.random() - 0.5) * 14,
        duration: 0.45,
        stagger: 0.03,
        ease: 'back.out(1.4)',
        delay: 0.2,
      })

      cleanup = () => split.revert()
    })

    return () => cleanup?.()
  }, [])

  return (
    <div className="hero-side-column hero-heading-wrap">
      <h1 ref={headingRef} className="hero-heading-text">
        How Much Does It Cost?
      </h1>
    </div>
  )
}
