import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'Courier New', 'monospace'],
        body: ['var(--font-lora)', 'Georgia', 'serif'],
      },
      colors: {
        ink: '#1C1814',
        'ink-muted': '#6B6158',
        cream: '#F0EAD9',
        'cream-dark': '#E4DBCA',
        'cream-darker': '#D5C9B4',
        amber: '#C4391C',
        'amber-soft': '#FAF0DC',
        'amber-mid': '#D4701A',
        golden: '#BF9000',
        slate: '#4A6B8A',
        'slate-soft': '#DDE6EF',
        moss: '#2D6A4F',
        'moss-soft': '#D4EAE0',
      },
    },
  },
  plugins: [],
}

export default config
