'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavBar() {
  const pathname = usePathname()

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 'var(--nav-h)',
        backgroundColor: 'var(--ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.75rem',
        borderBottom: '2px solid var(--amber)',
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          fontFamily: 'var(--font-fraunces), Georgia, serif',
          color: 'var(--cream)',
          fontSize: '0.8rem',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          textDecoration: 'none',
          fontWeight: 300,
          lineHeight: 1,
        }}
      >
        The Inflation Ledger
      </Link>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
        <NavLink href="/" active={pathname === '/' || pathname.startsWith('/category')}>
          Overview
        </NavLink>
        <NavLink href="/tj" active={pathname.startsWith('/tj')}>
          Trader Joe&apos;s
        </NavLink>
      </div>
    </nav>
  )
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: 'var(--font-mono), monospace',
        fontSize: '0.65rem',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        color: active ? 'var(--amber)' : 'rgba(240,234,217,0.55)',
        transition: 'color 0.15s ease',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </Link>
  )
}
