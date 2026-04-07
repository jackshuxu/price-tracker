'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'

export default function HeroNav() {
  return (
    <div className="hero-side-column hero-nav-wrap">
      <motion.nav
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.8, ease: 'easeOut' }}
      >
        <p className="hero-nav-title">
          Explore this site:
        </p>

        <NavItem href="/tj" label="Price Tracker" />
        <NavItem href="#" label="Price Data" underConstruction />
      </motion.nav>
    </div>
  )
}

function NavItem({
  href,
  label,
  underConstruction,
}: {
  href: string
  label: string
  underConstruction?: boolean
}) {
  return (
    <Link
      href={href}
      className="hero-nav-link"
      style={{ color: underConstruction ? 'var(--ink-muted)' : 'var(--ink)' }}
    >
      <span className="hero-nav-arrow">&rarr;</span>
      {label}
      {underConstruction && (
        <span
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.5rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-muted)',
            border: '1px solid var(--cream-dark)',
            borderRadius: 2,
            padding: '0.15rem 0.4rem',
            marginLeft: '0.25rem',
          }}
        >
          soon
        </span>
      )}
    </Link>
  )
}
