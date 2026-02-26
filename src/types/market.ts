export type Platform = 'probable' | 'predict_fun' | 'opinion'

export type Outcome = 'YES' | 'NO'

export interface Market {
  id: string
  /** Numeric market ID used for Probable Orderbook API calls (e.g. 513) */
  numericId?: number
  /** CTF token IDs for CLOB trading: [yesTokenId, noTokenId] */
  clobTokenIds?: string[]
  platform: Platform
  title: string
  description?: string
  /** probability 0-1 */
  probability: number
  /** USDC */
  volume: string
  status: 'open' | 'closed' | 'resolved'
  resolutionDate?: string
  url: string
}

export interface OrderBookEntry {
  price: number
  size: string
}

export interface OrderBook {
  marketId: string
  yes: {
    bids: OrderBookEntry[]
    asks: OrderBookEntry[]
    bestBid: number
    bestAsk: number
  }
  no: {
    bids: OrderBookEntry[]
    asks: OrderBookEntry[]
    bestBid: number
    bestAsk: number
  }
}

export interface DetectedMarket {
  platform: Platform
  marketId: string
  url: string
  /** The tweet element that contained the link */
  sourceTweetElement?: Element
}
