'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useState, useEffect } from 'react'

interface CategoryTileProps {
  slug: string
  label: string
  shortLabel: string
  emoji: string
  unit: string
  pctChange: number
  current: number
  index: number
}

function getBadgeColor(pct: number): string {
  if (pct > 10) return '#A82C14'
  if (pct > 6) return '#C4391C'
  if (pct > 2) return '#D4701A'
  if (pct > 0.5) return '#BF9000'
  if (pct > -0.5) return '#4A6B8A'
  return '#2D6A4F'
}

function getTileStyle(pct: number): { background: string } {
  if (pct > 6) return { background: '#FBF0E0' }
  if (pct > 2) return { background: '#FAF3E8' }
  if (pct < -0.5) return { background: '#EEF8F3' }
  return { background: 'var(--cream)' }
}

// Animated counter for the percentage
function AnimatedPct({ target, delay }: { target: number; delay: number }) {
  const [displayed, setDisplayed] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      const start = performance.now()
      const duration = 900

      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
        setDisplayed(target * eased)
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }, delay * 1000 + 200)

    return () => clearTimeout(timeout)
  }, [target, delay])

  const sign = target >= 0 ? '+' : ''
  return (
    <span>
      {sign}{displayed.toFixed(1)}%
    </span>
  )
}

export default function CategoryTile({
  slug,
  label,
  shortLabel,
  emoji,
  unit,
  pctChange,
  current,
  index,
}: CategoryTileProps) {
  const [hovered, setHovered] = useState(false)
  const badgeColor = getBadgeColor(pctChange)
  const tileStyle = getTileStyle(pctChange)

  return (
    <motion.div
      initial={{ y: 32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: 0.55,
        delay: index * 0.055,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <Link href={`/category/${slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            ...tileStyle,
            border: '1px solid var(--cream-dark)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '1.4rem 0.75rem 1.1rem',
            cursor: 'pointer',
            transition: 'box-shadow 0.2s ease, transform 0.2s ease',
            boxShadow: hovered
              ? '0 10px 32px rgba(28, 24, 20, 0.14)'
              : '0 1px 3px rgba(28, 24, 20, 0.06)',
            transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
            minHeight: 168,
          }}
        >
          {/* Percentage badge — circular */}
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              backgroundColor: badgeColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '0.75rem',
              flexShrink: 0,
              boxShadow: `0 2px 8px ${badgeColor}55`,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono), monospace',
                fontWeight: 600,
                fontSize: '0.7rem',
                color: '#FEFCF8',
                lineHeight: 1.2,
                textAlign: 'center',
                letterSpacing: '-0.01em',
              }}
            >
              <AnimatedPct target={pctChange} delay={index * 0.055} />
            </span>
          </div>

          {/* Emoji */}
          <span
            style={{ fontSize: '1.9rem', marginBottom: '0.5rem', lineHeight: 1 }}
            role="img"
            aria-label={label}
          >
            {emoji}
          </span>

          {/* Short label */}
          <span
            style={{
              fontFamily: 'var(--font-lora), Georgia, serif',
              fontStyle: 'italic',
              fontSize: '0.72rem',
              color: 'var(--ink)',
              textAlign: 'center',
              lineHeight: 1.3,
              marginBottom: '0.2rem',
            }}
          >
            {shortLabel}
          </span>

          {/* Current price */}
          <span
            style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize: '0.62rem',
              color: 'var(--ink-muted)',
              textAlign: 'center',
              letterSpacing: '0.02em',
            }}
          >
            ${current.toFixed(2)}{unit}
          </span>
        </div>
      </Link>
    </motion.div>
  )
}
