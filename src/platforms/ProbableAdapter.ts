import type { Market, OrderBook } from '../types/market'
import type { ApiResponse, Order, SignedOrder, TradeInput } from '../types/order'
import type { PredictionPlatform, WalletSigner } from './PredictionPlatform'

/**
 * Probable.markets adapter (PRIMARY integration).
 *
 * Probable uses a CLOB architecture with:
 * - Off-chain orderbook
 * - On-chain settlement on BNB Chain
 * - EIP-712 signed orders
 *
 * API base: https://probable.markets/api  (schema reverse-engineered from DevTools)
 */
export class ProbableAdapter implements PredictionPlatform {
  readonly name = 'Probable'

  private readonly baseUrl = 'https://probable.markets/api'

  // ─── EIP-712 Domain ──────────────────────────────────────────────────────────

  private get domain() {
    return {
      name: 'Probable',
      version: '1',
      // BNB Chain mainnet chainId = 56, testnet = 97
      chainId: 56,
      verifyingContract: '0x0000000000000000000000000000000000000000', // TODO: replace with real contract
    }
  }

  private get orderTypes() {
    return {
      Order: [
        { name: 'marketId', type: 'string' },
        { name: 'outcome', type: 'string' },
        { name: 'price', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'expiration', type: 'uint256' },
        { name: 'maker', type: 'address' },
      ],
    }
  }

  // ─── API Methods ─────────────────────────────────────────────────────────────

  async getMarket(id: string): Promise<Market> {
    const res = await fetch(`${this.baseUrl}/markets/${id}`)
    if (!res.ok) throw new Error(`Probable: failed to fetch market ${id}: ${res.status}`)
    const data = await res.json()

    return {
      id: data.id ?? id,
      platform: 'probable',
      title: data.title ?? data.question ?? 'Unknown Market',
      description: data.description,
      probability: data.probability ?? data.yesPrice ?? 0.5,
      volume: data.volume ?? '0',
      status: data.status ?? 'open',
      resolutionDate: data.resolutionDate ?? data.endDate,
      url: `https://probable.markets/${id}`,
    }
  }

  async getOrderBook(id: string): Promise<OrderBook> {
    const res = await fetch(`${this.baseUrl}/markets/${id}/orderbook`)
    if (!res.ok) throw new Error(`Probable: failed to fetch orderbook for ${id}: ${res.status}`)
    const data = await res.json()

    return {
      marketId: id,
      yes: {
        bids: data.yes?.bids ?? [],
        asks: data.yes?.asks ?? [],
        bestBid: data.yes?.bids?.[0]?.price ?? 0,
        bestAsk: data.yes?.asks?.[0]?.price ?? 0,
      },
      no: {
        bids: data.no?.bids ?? [],
        asks: data.no?.asks ?? [],
        bestBid: data.no?.bids?.[0]?.price ?? 0,
        bestAsk: data.no?.asks?.[0]?.price ?? 0,
      },
    }
  }

  buildOrder(params: TradeInput): Order {
    return {
      marketId: params.marketId,
      outcome: params.outcome,
      price: String(Math.round(params.price * 1e6)), // scaled to 6 decimals (USDC)
      amount: String(Math.round(parseFloat(params.amount) * 1e6)),
      expiration: params.expiration,
      makerAddress: params.makerAddress,
    }
  }

  async signOrder(order: Order, signer: WalletSigner): Promise<SignedOrder> {
    const value = {
      marketId: order.marketId,
      outcome: order.outcome,
      price: BigInt(order.price),
      amount: BigInt(order.amount),
      expiration: BigInt(order.expiration),
      maker: order.makerAddress,
    }

    const signature = await signer.signTypedData(this.domain, this.orderTypes, value)

    return {
      ...order,
      signature,
      signedAt: Math.floor(Date.now() / 1000),
    }
  }

  async submitOrder(order: SignedOrder, _signer: WalletSigner): Promise<ApiResponse> {
    const body = {
      marketId: order.marketId,
      outcome: order.outcome,
      price: order.price,
      amount: order.amount,
      expiration: order.expiration,
      maker: order.makerAddress,
      signature: order.signature,
    }

    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({ message: res.statusText }))

    if (!res.ok) {
      return { success: false, message: data.message ?? 'Order submission failed', raw: data }
    }

    return {
      success: true,
      orderId: data.orderId ?? data.id,
      txHash: data.txHash,
      message: data.message ?? 'Order accepted',
      raw: data,
    }
  }
}
