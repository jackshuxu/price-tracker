import { createContext, useContext } from 'react'

export interface IconPosition {
  slug: string
  x: number      // viewport-relative center X
  y: number      // viewport-relative center Y
  width: number
  height: number
  rotation: number // radians
}

export type Phase = 'floating' | 'falling' | 'landed'

export interface IconOrchestrator {
  phase: Phase
  positions: Map<string, IconPosition>
  onFallStart: Set<() => void>
  triggerFall: () => void
  updatePosition: (slug: string, pos: IconPosition) => void
  getPositionsSnapshot: () => IconPosition[]
}

export function createOrchestrator(): IconOrchestrator {
  const orch: IconOrchestrator = {
    phase: 'floating',
    positions: new Map(),
    onFallStart: new Set(),
    triggerFall() {
      if (orch.phase !== 'floating') return
      orch.phase = 'falling'
      orch.onFallStart.forEach(cb => cb())
    },
    updatePosition(slug, pos) {
      orch.positions.set(slug, pos)
    },
    getPositionsSnapshot() {
      return Array.from(orch.positions.values())
    },
  }
  return orch
}

export const OrchestratorContext = createContext<IconOrchestrator | null>(null)

export function useOrchestrator() {
  return useContext(OrchestratorContext)
}
