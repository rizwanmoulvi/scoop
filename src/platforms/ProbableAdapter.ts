import { ethers } from 'ethers'
import type { Market, OrderBook } from '../types/market'
import type { ApiResponse, Order, SignedOrder, TradeInput } from '../types/order'
import type { PredictionPlatform, WalletSigner } from './PredictionPlatform'
import { apiFetch } from '../utils/apiFetch'
import { proxyRequest } from '../wallet/wallet'

/**
 * Probable.markets adapter.
 *
 * Two separate API services (see developer.probable.markets):
 *
 * ┌─ Market Public API ──────────────────────────────────────────────────────┐
 * │ Base: https://market-api.probable.markets                                │
 * │ Auth: none (fully public, Redis-cached)                                  │
 * │ GET /public/api/v1/events/slug/{slug}  → event + embedded markets array │
 * │ GET /public/api/v1/markets/{id}        → single market by numeric ID    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Orderbook API ──────────────────────────────────────────────────────────┐
 * │ Base: https://api.probable.markets                                       │
 * │ GET  /public/api/v1/midpoint?token_id={clobTokenId}   → { mid: "0.62" } │
 * │ GET  /public/api/v1/book?token_id={clobTokenId}       → bids/asks       │
 * │ POST /public/api/v1/order/{chainId}   (L2 HMAC auth required)           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Key facts:
 * - Markets have a numeric ID (e.g. 513) AND a human-readable market_slug.
 * - The URL slug used on the site is the *event* slug (not market_slug).
 * - clobTokenIds[0] = YES token,  clobTokenIds[1] = NO token.
 * - EIP-712 domain: "Probable CTF Exchange" on BSC mainnet (chainId 56).
 * - signatureType = 0 (EOA direct) or 1 (PROB_GNOSIS_SAFE proxy wallet).
 *
 * Contract addresses (BSC mainnet):
 *   CTF_EXCHANGE_ADDRESS = 0xF99F5367ce708c66F0860B77B4331301A5597c86
 */

const CTF_EXCHANGE_ADDRESS = '0xF99F5367ce708c66F0860B77B4331301A5597c86'
const BSC_CHAIN_ID = 56

// ─── API response shapes ──────────────────────────────────────────────────────

interface ProbableMarketResponse {
  id: number | string
  condition_id: string
  question: string
  description?: string
  market_slug: string
  /** May arrive as a JSON string e.g. `"[\"Yes\",\"No\"]"` */
  outcomes: string[] | string
  /** May arrive as a JSON string e.g. `"[\"598...\",\"948...\"]"` */
  clobTokenIds: string[] | string
  /** Already-parsed token list — reliable fallback for clobTokenIds */
  tokens?: Array<{ token_id: string; outcome: string }>
  active: boolean
  closed: boolean
  archived?: boolean
  volume?: number
  volume24hr?: string
  liquidity?: number | string
  event?: { id: number; slug: string; title: string }
}

interface ProbableEventResponse {
  id: number
  slug: string
  title: string
  description?: string
  status: string
  markets: ProbableMarketResponse[]
  volume?: number
}

interface MidpointResponse { mid: string }

interface BookLevel { price: string; size: string }
interface BookResponse {
  market: string
  asset_id: string
  bids: BookLevel[]
  asks: BookLevel[]
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ProbableAdapter implements PredictionPlatform {
  readonly name = 'Probable'

  private readonly marketApiBase = 'https://market-api.probable.markets/public/api/v1'
  private readonly orderbookApiBase = 'https://api.probable.markets/public/api/v1'

  // ── EIP-712 domain + types ─────────────────────────────────────────────────

  private get domain() {
    return {
      name: 'Probable CTF Exchange',
      version: '1',
      chainId: BSC_CHAIN_ID,
      verifyingContract: CTF_EXCHANGE_ADDRESS,
    }
  }

  private get orderTypes() {
    return {
      Order: [
        { name: 'salt',          type: 'uint256' },
        { name: 'maker',         type: 'address' },
        { name: 'signer',        type: 'address' },
        { name: 'taker',         type: 'address' },
        { name: 'tokenId',       type: 'uint256' },
        { name: 'makerAmount',   type: 'uint256' },
        { name: 'takerAmount',   type: 'uint256' },
        { name: 'expiration',    type: 'uint256' },
        { name: 'nonce',         type: 'uint256' },
        { name: 'feeRateBps',    type: 'uint256' },
        { name: 'side',          type: 'uint8'   },
        { name: 'signatureType', type: 'uint8'   },
      ],
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toMarket(data: ProbableMarketResponse, mid: number | null, tokenIds?: string[]): Market {
    // clobTokenIds arrives as a JSON-encoded string from the API — parse if not pre-parsed.
    const resolvedTokenIds: string[] = tokenIds ?? (() => {
      const raw = data.clobTokenIds
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') { try { return JSON.parse(raw) as string[] } catch { /* fall */ } }
      return (data.tokens ?? []).map((t) => t.token_id)
    })()

    return {
      id: data.market_slug,
      numericId: Number(data.id),
      clobTokenIds: resolvedTokenIds,
      platform: 'probable',
      title: data.question,
      description: data.description,
      probability: mid !== null && !isNaN(mid) ? mid : 0.5,
      volume: String(data.volume ?? data.volume24hr ?? 0),
      status: data.active && !data.closed ? 'open' : 'closed',
      url: `https://probable.markets/event/${data.event?.slug ?? data.market_slug}`,
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fetch market by event slug (e.g. "will-satoshi-move-any-bitcoin-in-2026").
   * Calls GET /events/slug/{slug} then enriches with YES midpoint price.
   */
  async getMarket(slug: string): Promise<Market> {
    const event = await apiFetch<ProbableEventResponse>(
      `${this.marketApiBase}/events/slug/${encodeURIComponent(slug)}`
    )
    if (!event.markets || event.markets.length === 0) {
      throw new Error(`Probable: event "${slug}" has no markets`)
    }

    // Prefer first active market, else fall back to index 0
    const marketData =
      event.markets.find((m) => m.active && !m.closed) ?? event.markets[0]

    // Parse clobTokenIds now — the API returns it as a JSON-encoded string
    // e.g. "[\"598...\",\"948...\"]" so we must parse before any token ID use.
    const parsedTokenIds: string[] = (() => {
      const raw = marketData.clobTokenIds
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') { try { return JSON.parse(raw) as string[] } catch { /* fall */ } }
      // last resort: .tokens[] array is always a real array
      return (marketData.tokens ?? []).map((t) => t.token_id)
    })()

    // Fetch YES midpoint price using the correctly-parsed token ID
    let mid: number | null = null
    const yesTokenId = parsedTokenIds[0]
    if (yesTokenId) {
      try {
        const midData = await apiFetch<MidpointResponse>(
          `${this.orderbookApiBase}/midpoint?token_id=${encodeURIComponent(yesTokenId)}`
        )
        const parsed = parseFloat(midData.mid)
        if (!isNaN(parsed) && parsed > 0) mid = parsed
      } catch (e) {
        console.warn('[Probable] midpoint fetch failed:', e)
        // non-fatal — probability will fall back to 0.5
      }
    } else {
      console.warn('[Probable] no clobTokenIds in market response — cannot fetch midpoint price')
    }

    return this.toMarket(marketData, mid, parsedTokenIds)
  }

  /**
   * Fetch full orderbook for a market.
   * Pass `clobTokenIds` from a previously-fetched Market to avoid a redundant
   * /events/slug call.
   */
  async getOrderBook(id: string, clobTokenIds?: string[]): Promise<OrderBook> {
    let tokenIds = clobTokenIds
    if (!tokenIds || tokenIds.length < 2) {
      // clobTokenIds not passed — fetch market to get them
      console.warn('[Probable] getOrderBook called without clobTokenIds, fetching market...')
      const market = await this.getMarket(id)
      tokenIds = market.clobTokenIds ?? []
    }

    if (!tokenIds || tokenIds.length < 2) {
      throw new Error(`[Probable] market "${id}" has no clobTokenIds — cannot fetch orderbook`)
    }

    const [yesTokenId, noTokenId] = tokenIds

    // Fetch books AND midpoints in parallel. Midpoints are a reliable fallback
    // when the book is empty or the API happens to sort asks descending.
    const [yesBook, noBook, yesMid, noMid] = await Promise.all([
      yesTokenId ? this.fetchBook(yesTokenId) : null,
      noTokenId  ? this.fetchBook(noTokenId)  : null,
      yesTokenId ? this.fetchMidpoint(yesTokenId) : null,
      noTokenId  ? this.fetchMidpoint(noTokenId)  : null,
    ])

    const toLevels = (levels: BookLevel[]) =>
      levels.map((l) => ({ price: parseFloat(l.price), size: l.size }))

    // Best bid = highest bid price; best ask = lowest ask price.
    // Always compute via Math.max/Math.min so sort order doesn't matter.
    const bestBidPrice = (levels: BookLevel[]): number => {
      if (!levels.length) return 0
      return Math.max(...levels.map((l) => parseFloat(l.price)))
    }
    const bestAskPrice = (levels: BookLevel[], midFallback: number | null): number => {
      const valid = levels.map((l) => parseFloat(l.price)).filter((p) => p > 0 && p < 1)
      if (valid.length) return Math.min(...valid)
      return midFallback ?? 0
    }

    return {
      marketId: id,
      yes: {
        bids:    toLevels(yesBook?.bids ?? []),
        asks:    toLevels(yesBook?.asks ?? []),
        bestBid: bestBidPrice(yesBook?.bids ?? []),
        bestAsk: bestAskPrice(yesBook?.asks ?? [], yesMid),
      },
      no: {
        bids:    toLevels(noBook?.bids ?? []),
        asks:    toLevels(noBook?.asks ?? []),
        bestBid: bestBidPrice(noBook?.bids ?? []),
        bestAsk: bestAskPrice(noBook?.asks ?? [], noMid),
      },
    }
  }

  private async fetchBook(tokenId: string): Promise<BookResponse | null> {
    try {
      return await apiFetch<BookResponse>(
        `${this.orderbookApiBase}/book?token_id=${encodeURIComponent(tokenId)}`
      )
    } catch {
      return null
    }
  }

  private async fetchMidpoint(tokenId: string): Promise<number | null> {
    try {
      const data = await apiFetch<MidpointResponse>(
        `${this.orderbookApiBase}/midpoint?token_id=${encodeURIComponent(tokenId)}`
      )
      const val = parseFloat(data.mid)
      return isNaN(val) ? null : val
    } catch {
      return null
    }
  }

  // ── Order Building / Signing / Submission ──────────────────────────────────

  /**
   * Build an unsigned order.
   *
   * Probable CLOB order fields:
   *   maker        = proxy wallet address (Gnosis Safe).  Use EOA if no proxy yet.
   *   signer       = EOA address (signs the order).
   *   tokenId      = clobTokenId for the chosen outcome.
   *   makerAmount  = USDT spent  (BUY) or tokens spent (SELL), 18-decimal wei.
   *   takerAmount  = tokens received (BUY) or USDT received (SELL), 18-decimal wei.
   *   side         = 0 (BUY) | 1 (SELL)
   *   signatureType= 0 (EOA direct) or 1 (PROB_GNOSIS_SAFE)
   *
   * When the user hasn't set up a proxy wallet we default signatureType=0
   * (EOA signs directly).  Switch to 1 once the proxy wallet is deployed.
   */
  buildOrder(params: TradeInput): Order {
    // In a betting UI the user is always BUYING the outcome token they select.
    // YES bet → BUY YES tokens (tokenId[0])
    // NO bet  → BUY NO tokens  (tokenId[1])
    // Both are side=0 (BUY). The tokenId distinguishes YES vs NO.
    const side   = 0  // BUY
    const amount = parseFloat(params.amount)  // USDC to spend (BUY) or receive (SELL)

    // Clamp price to valid range
    const rawPrice = Math.min(Math.max(params.price, 0.0001), 0.9999)

    // --- Rounding helpers (matching official clob-examples spec) -------------
    const decimalPlaces = (n: number) => {
      if (Number.isInteger(n)) return 0
      const s = n.toString().split('.')
      return s.length <= 1 ? 0 : s[1]!.length
    }
    const roundDown   = (n: number, dp: number) =>
      decimalPlaces(n) <= dp ? n : Math.floor(n * 10 ** dp) / 10 ** dp
    const roundUp     = (n: number, dp: number) =>
      decimalPlaces(n) <= dp ? n : Math.ceil(n  * 10 ** dp) / 10 ** dp
    const roundNormal = (n: number, dp: number) =>
      decimalPlaces(n) <= dp ? n : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp

    // Rounding config for 0.01 tick size
    const RC = { price: 2, size: 2, amount: 4 }

    const price = roundNormal(rawPrice, RC.price)

    // size = number of outcome tokens (derived from amount USDC the user wants to spend/receive)
    const size = amount / price

    let rawMakerAmt: number
    let rawTakerAmt: number

    if (side === 0) {
      // BUY: user spends USDC (makerAmount), receives tokens (takerAmount)
      rawTakerAmt = roundDown(size, RC.size)
      rawMakerAmt = rawTakerAmt * price
      if (decimalPlaces(rawMakerAmt) > RC.amount) {
        rawMakerAmt = roundUp(rawMakerAmt, RC.amount + 4)
        if (decimalPlaces(rawMakerAmt) > RC.amount) rawMakerAmt = roundDown(rawMakerAmt, RC.amount)
      }
    } else {
      // SELL: user spends tokens (makerAmount), receives USDC (takerAmount)
      rawMakerAmt = roundDown(size, RC.size)
      rawTakerAmt = rawMakerAmt * price
      if (decimalPlaces(rawTakerAmt) > RC.amount) {
        rawTakerAmt = roundUp(rawTakerAmt, RC.amount + 4)
        if (decimalPlaces(rawTakerAmt) > RC.amount) rawTakerAmt = roundDown(rawTakerAmt, RC.amount)
      }
    }

    // Convert to 18-decimal bigints using string-based parseUnits (avoids float rounding)
    const parseUnits18 = (value: string): bigint => {
      const [intPart, fracPart = ''] = value.split('.')
      const frac = fracPart.slice(0, 18).padEnd(18, '0')
      return BigInt((intPart || '0') + frac)
    }
    const makerAmount = parseUnits18(rawMakerAmt.toFixed(6))
    const takerAmount = parseUnits18(rawTakerAmt.toFixed(6))

    return {
      marketId:     params.marketId,
      outcome:      params.outcome,
      price:        String(price),
      amount:       String(amount),
      expiration:   params.expiration,
      makerAddress: params.makerAddress,
      extra: {
        side,
        makerAmount:   makerAmount.toString(),
        takerAmount:   takerAmount.toString(),
        feeRateBps:    '175', // min allowed; must match signed EIP-712 value
        nonce:         '0',
        signatureType: 0,    // EOA direct — signer == maker, no proxy validation chain
        taker:         '0x0000000000000000000000000000000000000000',
        tokenId:       '',   // injected by OrderForm from market.clobTokenIds
        // apiKey / apiSecret / apiPassphrase injected by OrderForm before submitOrder
      },
    }
  }

  /**
   * Fetches the current minimum valid order nonce for a maker address from the
   * CTF Exchange contract.  Any order with nonce < this value is rejected on-chain
   * (PAS-4205).  Falls back to 0n if the call fails.
   */
  private async getMinNonce(makerAddress: string): Promise<bigint> {
    const iface = new ethers.Interface([
      'function getMinNonce(address maker) view returns (uint256)',
    ])
    const calldata = iface.encodeFunctionData('getMinNonce', [makerAddress])
    const BSC_RPCS = [
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-dataseed1.ninicoin.io',
    ]
    for (const rpc of BSC_RPCS) {
      try {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: CTF_EXCHANGE_ADDRESS, data: calldata }, 'latest'],
          }),
        })
        const json = await res.json() as { result?: string; error?: unknown }
        if (json.result && json.result !== '0x') {
          const [val] = iface.decodeFunctionResult('getMinNonce', json.result)
          console.log('[Scoop] getMinNonce for', makerAddress, '=', (val as bigint).toString())
          return val as bigint
        }
      } catch (e) {
        console.warn('[Scoop] getMinNonce direct RPC failed:', e)
      }
    }
    // Last resort: use MetaMask's RPC
    try {
      const result = await proxyRequest('eth_call', [
        { to: CTF_EXCHANGE_ADDRESS, data: calldata }, 'latest'
      ])
      if (result && typeof result === 'string' && result !== '0x') {
        const [val] = iface.decodeFunctionResult('getMinNonce', result)
        console.log('[Scoop] getMinNonce (MetaMask) for', makerAddress, '=', (val as bigint).toString())
        return val as bigint
      }
    } catch (e) {
      console.warn('[Scoop] getMinNonce MetaMask fallback failed:', e)
    }
    console.warn('[Scoop] getMinNonce: all RPCs failed, defaulting to 0')
    return 0n
  }

  /**
   * Verify the proxy wallet has sufficient USDT balance and allowance before
   * signing.  Throws descriptive errors so the user sees a real message instead
   * of the opaque PAS-4205.
   */
  private async verifyOrderPreconditions(
    proxyAddress: string,
    makerAmount: bigint
  ): Promise<void> {
    const USDT    = '0x55d398326f99059fF775485246999027B3197955'
    const pad     = (addr: string) => addr.slice(2).toLowerCase().padStart(64, '0')
    const dec     = (hex: string)  => { try { return BigInt(hex) } catch { return 0n } }
    const fmtUsdt = (wei: bigint)  => {
      const whole = wei / 10n ** 18n
      const frac  = (wei % 10n ** 18n) * 100n / 10n ** 18n
      return `${whole}.${frac.toString().padStart(2, '0')}`
    }

    // balanceOf(proxy)  +  allowance(proxy, CTFExchange) in parallel
    const balData  = '0x70a08231' + pad(proxyAddress)
    const allowData = '0xdd62ed3e' + pad(proxyAddress) + pad(CTF_EXCHANGE_ADDRESS)

    let balance = 0n, allowance = 0n
    try {
      const [balRes, allowRes] = await Promise.all([
        proxyRequest('eth_call', [{ to: USDT, data: balData },   'latest']),
        proxyRequest('eth_call', [{ to: USDT, data: allowData }, 'latest']),
      ])
      balance   = dec(balRes   as string)
      allowance = dec(allowRes as string)
    } catch (e) {
      console.warn('[Scoop] verifyOrderPreconditions: RPC error, skipping checks:', e)
      return // Don't block if we can't check
    }

    console.log('[Scoop] verifyOrderPreconditions:', {
      proxy: proxyAddress,
      balance:   fmtUsdt(balance)   + ' USDT',
      allowance: fmtUsdt(allowance) + ' USDT',
      need:      fmtUsdt(makerAmount) + ' USDT',
    })

    if (balance < makerAmount) {
      throw new Error(
        `Proxy wallet has insufficient USDT balance. ` +
        `Need ${fmtUsdt(makerAmount)} USDT, proxy has ${fmtUsdt(balance)} USDT. ` +
        `Please deposit more USDT first.`
      )
    }
    if (allowance < makerAmount) {
      throw new Error(
        `Proxy wallet has insufficient USDT allowance for the CTF Exchange. ` +
        `Need ${fmtUsdt(makerAmount)} USDT approved, only ${fmtUsdt(allowance)} USDT approved. ` +
        `Please re-run the approvals setup.`
      )
    }
  }

  async signOrder(order: Order, signer: WalletSigner): Promise<SignedOrder> {
    const extra = order.extra as {
      side: number; makerAmount: string; takerAmount: string
      feeRateBps: string; nonce: string; signatureType: number
      taker: string; tokenId: string
    }

    const salt = String(Math.round(Math.random() * Date.now()))

    // For signatureType=0 (EOA direct): maker == signer == EOA.
    // For signatureType=1 (PROB_GNOSIS_SAFE): maker = proxy, signer = EOA.
    const eoaAddress  = await signer.getAddress()
    const makerAddress = extra.signatureType === 0 ? eoaAddress : order.makerAddress

    // Verify the maker has enough USDT balance + allowance before prompting MetaMask.
    // This converts PAS-4205 into a human-readable error message.
    await this.verifyOrderPreconditions(makerAddress, BigInt(extra.makerAmount))

    // Fetch the contract's current minimum nonce for this maker.
    // Using a stale or zero nonce when the contract has advanced it causes PAS-4205.
    const contractMinNonce = await this.getMinNonce(makerAddress)
    const nonce = contractMinNonce > BigInt(extra.nonce) ? contractMinNonce : BigInt(extra.nonce)

    const value = {
      salt:          BigInt(salt),
      maker:         makerAddress as `0x${string}`,
      signer:        eoaAddress as `0x${string}`,
      taker:         extra.taker as `0x${string}`,
      tokenId:       BigInt(extra.tokenId || '0'),
      makerAmount:   BigInt(extra.makerAmount),
      takerAmount:   BigInt(extra.takerAmount),
      expiration:    BigInt(order.expiration),
      nonce,
      feeRateBps:    BigInt(extra.feeRateBps),
      side:          extra.side,
      signatureType: extra.signatureType,
    }

    console.log('[Scoop] signOrder EIP-712 value:', {
      salt, maker: makerAddress, signer: eoaAddress,
      tokenId: extra.tokenId, makerAmount: extra.makerAmount, takerAmount: extra.takerAmount,
      expiration: order.expiration, nonce: nonce.toString(), feeRateBps: extra.feeRateBps,
      side: extra.side, signatureType: extra.signatureType,
    })

    const signature = await signer.signTypedData(this.domain, this.orderTypes, value)

    // Persist the resolved nonce into extra so submitOrder sends the same value
    return { ...order, signature, signedAt: Math.floor(Date.now() / 1000), extra: { ...extra, salt, nonce: nonce.toString() } }
  }

  // ── L1 Authentication ─────────────────────────────────────────────────────

  /**
   * Obtain a Probable L2 API key using an EIP-712 L1 signature (ClobAuthDomain).
   *
   * This triggers ONE MetaMask signature prompt (no gas, no transaction).
   * Cache the returned credentials in the panel store and reuse them for the
   * rest of the session.
   *
   * Spec: POST /public/api/v1/auth/api-key/{chainId}
   *   Headers: prob_address, prob_signature, prob_timestamp, prob_nonce
   */
  async getApiKey(
    signer: WalletSigner
  ): Promise<{ key: string; secret: string; passphrase: string }> {
    const eoaAddress = await signer.getAddress()
    const timestamp  = Math.floor(Date.now() / 1000)
    const nonce      = 0

    // ClobAuthDomain has NO verifyingContract — ProxySigner handles this
    // dynamically by only including domain fields that are present.
    const domain = {
      name:    'ClobAuthDomain',
      version: '1',
      chainId: BSC_CHAIN_ID,
    }
    const types = {
      ClobAuth: [
        { name: 'address',   type: 'address' },
        { name: 'timestamp', type: 'string'  },
        { name: 'nonce',     type: 'uint256' },
        { name: 'message',   type: 'string'  },
      ],
    }
    const value = {
      address:   eoaAddress,
      timestamp: timestamp.toString(),
      nonce,
      message:   'This message attests that I control the given wallet',
    }

    const l1Signature = await signer.signTypedData(domain, types, value)

    const response = await apiFetch<{ apiKey: string; secret: string; passphrase: string }>(
      `${this.orderbookApiBase}/auth/api-key/${BSC_CHAIN_ID}`,
      {
        method: 'POST',
        headers: {
          'prob_address':   eoaAddress,
          'prob_signature': l1Signature,
          'prob_timestamp': timestamp.toString(),
          'prob_nonce':     nonce.toString(),
        },
        // No request body — the auth info is entirely in the headers
      }
    )

    return { key: response.apiKey, secret: response.secret, passphrase: response.passphrase }
  }

  // ── L2 HMAC signature ────────────────────────────────────────────────────

  /**
   * Build the L2 HMAC-SHA256 request signature required by authenticated
   * Probable endpoints (e.g. POST /order/{chainId}).
   *
   * message  = `${timestamp}${method}${path}${body}`
   * signature = URL-safe Base64( HMAC-SHA256(base64Decode(secret), message) )
   *
   * Uses the Web Crypto API (crypto.subtle) — available in Chrome extensions,
   * service workers, and all modern browsers.
   */
  private async buildL2Signature(
    secret: string,
    timestamp: number,
    method: string,
    path: string,
    body: string
  ): Promise<string> {
    const message = `${timestamp}${method}${path}${body}`

    // The secret is standard base64 (may include + and /). normalise before atob().
    const fixedSecret = secret.replace(/-/g, '+').replace(/_/g, '/')
    const secretBytes = Uint8Array.from(atob(fixedSecret), (c) => c.charCodeAt(0))

    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const msgBytes  = new TextEncoder().encode(message)
    const sigBuffer = await crypto.subtle.sign('HMAC', key, msgBytes)

    // Convert ArrayBuffer → URL-safe Base64
    const array = new Uint8Array(sigBuffer)
    let binary  = ''
    for (const byte of array) binary += String.fromCharCode(byte)

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
  }

  // ── Order submission ─────────────────────────────────────────────────────

  /**
   * Submit a signed order to the Probable Orderbook API.
   *
   * Requires L2 HMAC authentication headers.  The OrderForm must inject
   * apiKey / apiSecret / apiPassphrase into order.extra (obtained via
   * getApiKey()) before calling this method.
   *
   * Uses EOA flow (signatureType=0, prob_account_type='eoa').
   */
  async submitOrder(order: SignedOrder, _signer: WalletSigner): Promise<ApiResponse> {
    const extra = order.extra as {
      side: number; makerAmount: string; takerAmount: string
      feeRateBps: string; nonce: string; signatureType: number
      taker?: string; tokenId?: string; salt?: string
      apiKey?: string; apiSecret?: string; apiPassphrase?: string
      proxyAddress?: string  // injected by OrderForm
    }

    if (!extra.apiKey || !extra.apiSecret || !extra.apiPassphrase) {
      return {
        success: false,
        message: 'API credentials missing. Please authenticate before placing an order.',
      }
    }

    // For signatureType=0: maker == signer == EOA (no proxy).
    // For signatureType=1: maker = proxy, signer = EOA.
    const eoaAddress   = await _signer.getAddress()
    const makerAddress = extra.signatureType === 0
      ? eoaAddress
      : (extra.proxyAddress ?? order.makerAddress)
    const path         = `/public/api/v1/order/${BSC_CHAIN_ID}`

    const requestBody = {
      deferExec: true,
      order: {
        salt:          extra.salt ?? String(Math.round(Math.random() * Date.now())),
        maker:         makerAddress,   // EOA (signatureType=0) or proxy (signatureType=1)
        signer:        eoaAddress,     // EOA always
        taker:         extra.taker ?? '0x0000000000000000000000000000000000000000',
        tokenId:       extra.tokenId ?? '0',
        makerAmount:   extra.makerAmount,
        takerAmount:   extra.takerAmount,
        side:          extra.side === 0 ? 'BUY' : 'SELL',
        expiration:    String(order.expiration),
        nonce:         extra.nonce,
        feeRateBps:    extra.feeRateBps,
        signatureType: extra.signatureType,
        signature:     order.signature,
      },
      owner:     eoaAddress,   // always the EOA (API account owner)
      orderType: 'GTC',
    }

    console.log('[Scoop] submitOrder body:', JSON.stringify(requestBody, null, 2))

    const bodyString = JSON.stringify(requestBody)
    const timestamp  = Math.floor(Date.now() / 1000)
    const l2Sig      = await this.buildL2Signature(
      extra.apiSecret, timestamp, 'POST', path, bodyString
    )

    try {
      const data = await apiFetch<Record<string, unknown>>(
        `${this.orderbookApiBase}/order/${BSC_CHAIN_ID}`,
        {
          method: 'POST',
          headers: {
            prob_address:      eoaAddress,
            prob_signature:    l2Sig,
            prob_timestamp:    timestamp.toString(),
            prob_api_key:      extra.apiKey,
            prob_passphrase:   extra.apiPassphrase,
            prob_account_type: 'eoa',  // required for signatureType=0 EOA orders
          },
          body: bodyString,
        }
      )
      return {
        success: true,
        orderId: String(data.orderId ?? data.id ?? ''),
        txHash:  data.txHash as string | undefined,
        message: 'Order accepted',
        raw:     data,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Order submission failed'
      return { success: false, message, raw: err }
    }
  }
}
