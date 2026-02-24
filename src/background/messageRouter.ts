import type { DetectedMarket } from '../types/market'

/**
 * Messages exchanged between content script, sidebar, and background.
 */
export type BackgroundMessage =
  | { type: 'OPEN_SIDEBAR'; payload: DetectedMarket }
  | { type: 'GET_ACTIVE_MARKET' }
  | { type: 'SET_ACTIVE_MARKET'; payload: DetectedMarket }
  | { type: 'CLEAR_ACTIVE_MARKET' }
  /** Proxy a JSON-RPC wallet call through the content script (has window.ethereum) */
  | { type: 'WALLET_REQUEST'; method: string; params: unknown[] }

export type SidebarMessage =
  | { type: 'ACTIVE_MARKET'; payload: DetectedMarket | null }
  | { type: 'PONG' }

/** Forwarded from background to content script */
export type ContentMessage =
  | { type: 'WALLET_REQUEST'; method: string; params: unknown[] }
