declare module 'react-simple-maps' {
  import { ComponentType, ReactNode, CSSProperties } from 'react'

  interface ComposableMapProps {
    projection?: string
    projectionConfig?: Record<string, unknown>
    style?: CSSProperties
    children?: ReactNode
    [key: string]: unknown
  }

  interface Geography {
    rsmKey: string
    id: string
    properties: Record<string, string>
    [key: string]: unknown
  }

  interface GeographiesProps {
    geography: string | object
    children: (props: { geographies: Geography[] }) => ReactNode
    [key: string]: unknown
  }

  interface GeographyProps {
    geography: Geography
    style?: {
      default?: CSSProperties
      hover?: CSSProperties
      pressed?: CSSProperties
    }
    onClick?: () => void
    onMouseEnter?: () => void
    onMouseLeave?: () => void
    [key: string]: unknown
  }

  export const ComposableMap: ComponentType<ComposableMapProps>
  export const Geographies: ComponentType<GeographiesProps>
  export const Geography: ComponentType<GeographyProps>
  export const ZoomableGroup: ComponentType<{ [key: string]: unknown }>
  export const Marker: ComponentType<{ [key: string]: unknown }>
}
