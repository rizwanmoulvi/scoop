import type { DetectedMarket } from '../types/market'

/**
 * Message types exchanged between content script, sidebar, and background.
 */
export type BackgroundMessage =
  | { type: 'OPEN_SIDEBAR'; payload: DetectedMarket }
  | { type: 'GET_ACTIVE_MARKET' }
  | { type: 'SET_ACTIVE_MARKET'; payload: DetectedMarket }
  | { type: 'CLEAR_ACTIVE_MARKET' }

export type SidebarMessage =
  | { type: 'ACTIVE_MARKET'; payload: DetectedMarket | null }
  | { type: 'PONG' }
