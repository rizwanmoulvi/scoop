import type { Signer } from 'ethers'
import type { Market, OrderBook } from '../types/market'
import type { ApiResponse, Order, SignedOrder, TradeInput } from '../types/order'
import type { PredictionPlatform } from './PredictionPlatform'

/**
 * Opinion.trade adapter.
 *
 * Opinion uses a hybrid CLOB with signed structured orders and on-chain resolution.
 *
 * TODO: Inspect network calls at https://app.opinion.trade and update:
 *  - API base URL
 *  - EIP-712 domain / types
 *  - Order payload shape
 */
export class OpinionAdapter implements PredictionPlatform {
  readonly name = 'Opinion'

  private readonly baseUrl = 'https://app.opinion.trade/api'

  private get domain() {
    return {
      name: 'Opinion',
      version: '1',
      chainId: 56, // BNB Chain
      verifyingContract: '0x0000000000000000000000000000000000000000', // TODO
    }
  }

  private get orderTypes() {
    return {
      Order: [
        { name: 'marketId', type: 'string' },
        { name: 'side', type: 'string' },
        { name: 'price', type: 'uint256' },
        { name: 'size', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'maker', type: 'address' },
      ],
    }
  }

  async getMarket(id: string): Promise<Market> {
    const res = await fetch(`${this.baseUrl}/markets/${id}`)
    if (!res.ok) throw new Error(`Opinion: failed to fetch market ${id}: ${res.status}`)
    const data = await res.json()

    return {
      id: data.id ?? id,
      platform: 'opinion',
      title: data.title ?? data.question ?? 'Unknown Market',
      description: data.description,
      probability: data.probability ?? 0.5,
      volume: data.volume ?? '0',
      status: data.status ?? 'open',
      resolutionDate: data.resolutionDate,
      url: `https://app.opinion.trade/markets/${id}`,
    }
  }

  async getOrderBook(id: string): Promise<OrderBook> {
    const res = await fetch(`${this.baseUrl}/markets/${id}/orderbook`)
    if (!res.ok) throw new Error(`Opinion: failed to fetch orderbook for ${id}: ${res.status}`)
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
      price: String(Math.round(params.price * 1e6)),
      amount: String(Math.round(parseFloat(params.amount) * 1e6)),
      expiration: params.expiration,
      makerAddress: params.makerAddress,
    }
  }

  async signOrder(order: Order, signer: Signer): Promise<SignedOrder> {
    const value = {
      marketId: order.marketId,
      side: order.outcome,
      price: BigInt(order.price),
      size: BigInt(order.amount),
      expiry: BigInt(order.expiration),
      maker: order.makerAddress,
    }

    const signature = await signer.signTypedData(this.domain, this.orderTypes, value)
    return { ...order, signature, signedAt: Math.floor(Date.now() / 1000) }
  }

  async submitOrder(order: SignedOrder, _signer: Signer): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketId: order.marketId,
        side: order.outcome,
        price: order.price,
        size: order.amount,
        expiry: order.expiration,
        maker: order.makerAddress,
        signature: order.signature,
      }),
    })

    const data = await res.json().catch(() => ({ message: res.statusText }))
    if (!res.ok) return { success: false, message: data.message ?? 'Order submission failed', raw: data }

    return { success: true, orderId: data.orderId, txHash: data.txHash, message: 'Order accepted', raw: data }
  }
}
