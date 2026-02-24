import type { Market, OrderBook } from '../types/market'
import type { ApiResponse, Order, SignedOrder, TradeInput } from '../types/order'

/**
 * Minimal signer interface used by platform adapters.
 * Implemented by both ethers.Signer (direct) and ProxySigner (message proxy).
 */
export interface WalletSigner {
  getAddress(): Promise<string>
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ): Promise<string>
}

/**
 * Every prediction platform adapter must implement this interface.
 * This makes the platform layer pluggable and production-grade.
 */
export interface PredictionPlatform {
  /** Human-readable platform name */
  readonly name: string

  /**
   * Fetch market details by its platform-specific ID.
   */
  getMarket(id: string): Promise<Market>

  /**
   * Fetch the current order book for a market.
   */
  getOrderBook(id: string): Promise<OrderBook>

  /**
   * Build an unsigned order object from user trade inputs.
   */
  buildOrder(params: TradeInput): Order

  /**
   * Sign the order using the connected wallet signer (EIP-712).
   */
  signOrder(order: Order, signer: WalletSigner): Promise<SignedOrder>

  /**
   * Submit the signed order to the platform API.
   */
  submitOrder(order: SignedOrder, signer: WalletSigner): Promise<ApiResponse>
}
