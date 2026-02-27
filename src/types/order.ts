import type { Outcome, Platform } from './market'

export interface TradeInput {
  marketId: string
  platform: Platform
  outcome: Outcome
  /** Price as a decimal 0-1 */
  price: number
  /** Amount in USDT for BUY, or USDT-equivalent value of shares for SELL (human-readable) */
  amount: string
  /** Unix timestamp seconds */
  expiration: number
  makerAddress: string
  /** 0 = BUY (default), 1 = SELL */
  side?: 0 | 1
}

export interface Order {
  marketId: string
  outcome: Outcome
  price: string
  amount: string
  expiration: number
  makerAddress: string
  /** Platform-specific extra fields */
  extra?: Record<string, unknown>
}

export interface SignedOrder extends Order {
  signature: string
  signedAt: number
}

export interface ApiResponse {
  success: boolean
  orderId?: string
  txHash?: string
  message?: string
  raw?: unknown
}

export type OrderStatus = 'idle' | 'building' | 'approving' | 'depositing' | 'signing' | 'submitting' | 'success' | 'error'

export interface OrderState {
  status: OrderStatus
  signedOrder?: SignedOrder
  response?: ApiResponse
  error?: string
}
