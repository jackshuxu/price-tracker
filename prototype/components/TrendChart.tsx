'use client'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { formatDate } from '@/lib/bls'

interface DataPoint {
  date: string
  value: number
}

interface Annotation {
  date: string // YYYY-MM format
  label: string
}

interface TrendChartProps {
  data: DataPoint[]
  unit: string
  color?: string
  annotations?: Annotation[]
  height?: number
}

const KNOWN_ANNOTATIONS: Annotation[] = [
  { date: '2020-03', label: 'COVID lockdowns' },
  { date: '2022-02', label: 'Ukraine invasion' },
  { date: '2022-06', label: 'Inflation peak' },
  { date: '2023-01', label: 'Avian flu peak' },
]

function CustomTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
  unit: string
}) {
  if (!active || !payload?.length || !label) return null
  return (
    <div
      style={{
        background: 'var(--ink)',
        border: 'none',
        padding: '0.5rem 0.85rem',
        borderRadius: 2,
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.65rem',
          color: 'rgba(240,234,217,0.6)',
          marginBottom: 2,
          letterSpacing: '0.05em',
        }}
      >
        {formatDate(label)}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.9rem',
          color: 'var(--cream)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        ${payload[0].value.toFixed(3)}{unit}
      </p>
    </div>
  )
}

export default function TrendChart({
  data,
  unit,
  color,
  annotations,
  height = 320,
}: TrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.75rem',
          color: 'var(--ink-muted)',
          letterSpacing: '0.05em',
        }}
      >
        No data available
      </div>
    )
  }

  // Determine trend color from first to last
  const trend = data.length > 1 ? data[data.length - 1].value - data[0].value : 0
  const lineColor = color ?? (trend >= 0 ? 'var(--amber)' : 'var(--moss)')
  const lineColorHex = trend >= 0 ? '#C4391C' : '#2D6A4F'

  // Find annotations that fall within data range
  const dataStart = data[0]?.date ?? ''
  const dataEnd = data[data.length - 1]?.date ?? ''
  const activeAnnotations = (annotations ?? KNOWN_ANNOTATIONS).filter(
    a => a.date >= dataStart && a.date <= dataEnd
  )

  // Format x-axis labels: show every ~4 months
  const xFormatter = (tick: string) => {
    if (!tick) return ''
    const [year, month] = tick.split('-')
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const m = parseInt(month) - 1
    // Show label every 4 months
    if (m % 4 !== 0) return ''
    return `${monthNames[m]} '${year.slice(2)}`
  }

  const yValues = data.map(d => d.value)
  const yMin = Math.min(...yValues)
  const yMax = Math.max(...yValues)
  const yPad = (yMax - yMin) * 0.12 || yMin * 0.1

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={lineColorHex} stopOpacity={0.7} />
            <stop offset="100%" stopColor={lineColorHex} stopOpacity={1} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--cream-darker)"
          vertical={false}
        />

        <XAxis
          dataKey="date"
          tickFormatter={xFormatter}
          tick={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 11,
            fill: 'var(--ink-muted)',
            letterSpacing: '0.03em',
          }}
          axisLine={{ stroke: 'var(--cream-darker)' }}
          tickLine={false}
          interval={0}
        />

        <YAxis
          domain={[yMin - yPad, yMax + yPad]}
          tickFormatter={v => `$${v.toFixed(2)}`}
          tick={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 11,
            fill: 'var(--ink-muted)',
          }}
          axisLine={false}
          tickLine={false}
          width={56}
        />

        <Tooltip
          content={<CustomTooltip unit={unit} />}
          cursor={{ stroke: 'var(--ink)', strokeWidth: 1, strokeDasharray: '3 3' }}
        />

        {/* Event annotation lines */}
        {activeAnnotations.map(ann => (
          <ReferenceLine
            key={ann.date}
            x={ann.date}
            stroke="var(--ink-muted)"
            strokeDasharray="3 3"
            strokeWidth={1}
            label={{
              value: ann.label,
              position: 'insideTopRight',
              fontFamily: 'var(--font-mono), monospace',
              fontSize: 9,
              fill: 'var(--ink-muted)',
              dy: -4,
            }}
          />
        ))}

        <Line
          type="monotone"
          dataKey="value"
          stroke={lineColorHex}
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 4,
            fill: lineColorHex,
            stroke: 'var(--cream)',
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
