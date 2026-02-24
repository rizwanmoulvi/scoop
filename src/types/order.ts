import type { Outcome, Platform } from './market'

export interface TradeInput {
  marketId: string
  platform: Platform
  outcome: Outcome
  /** Price as a decimal 0-1 */
  price: number
  /** Amount in USDC (human-readable) */
  amount: string
  /** Unix timestamp seconds */
  expiration: number
  makerAddress: string
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

export type OrderStatus = 'idle' | 'building' | 'approving' | 'signing' | 'submitting' | 'success' | 'error'

export interface OrderState {
  status: OrderStatus
  signedOrder?: SignedOrder
  response?: ApiResponse
  error?: string
}
