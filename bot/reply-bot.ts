/**
 * Scoop Reply Bot — Comment-to-Bet
 *
 * Listens for X/Twitter mentions of the form:
 *   "@scoop_bet YES $5"   or   "@scoop_bet NO 10"
 *
 * When found as a reply to a tweet containing a Probable Markets URL,
 * the bot:
 *   1. Fetches the market question + current orderbook price
 *   2. Builds an EIP-712 CLOB order
 *   3. Signs it using the bot's own BSC wallet (ethers.Wallet)
 *   4. Authenticates with Probable API (L1 EIP-712 + L2 HMAC)
 *   5. Submits the order and replies to the user with confirmation
 *
 * Architecture (custodial v1):
 *   The bot uses its OWN BSC private key and USDT balance to place orders.
 *   Users comment the command; the bot acts as their agent.
 *   UserÔÇÖs contributions are tracked in bot/state.json (allocations).
 *   v2 will replace this with a BSC session-key contract so users stay self-custodial.
 *
 * Usage:
 *   npm run reply-bot             # live mode
 *   npm run reply-bot -- --dry    # parse + preview without posting or signing
 *   npm run reply-bot -- --once   # process once and exit (cron-friendly)
 *
 * Required env vars (bot/.env):
 *   BOT_PRIVATE_KEY              BSC private key for the bot wallet (0x...)
 *   BOT_TWITTER_USER_ID          numeric ID of the bot X account (find via /2/users/by)
 *   TWITTER_API_KEY              OAuth 1.0a app key
 *   TWITTER_API_SECRET
 *   TWITTER_ACCESS_TOKEN         bot account access token
 *   TWITTER_ACCESS_SECRET
 *   PROBABLE_API_BASE            (optional) default: https://api.probable.markets
 */

import 'dotenv/config'
import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'
import { TwitterApi, type TweetV2 } from 'twitter-api-v2'

// ─── Constants ────────────────────────────────────────────────────────────────

const __dir            = dirname(fileURLToPath(import.meta.url))
const STATE_FILE       = resolve(__dir, 'state.json')
const CTF_EXCHANGE     = '0xF99F5367ce708c66F0860B77B4331301A5597c86'
const BSC_CHAIN_ID     = 56
const PROBABLE_MARKET  = 'https://market-api.probable.markets/public/api/v1'
const PROBABLE_ORDERS  = 'https://api.probable.markets/public/api/v1'
const POLL_INTERVAL_MS = 60_000   // 1 minute between mention polls
const MAX_USDT_PER_BET = 100      // safety cap per single bet

// ─── CLI flags ────────────────────────────────────────────────────────────────

const isDry  = process.argv.includes('--dry')
const isOnce = process.argv.includes('--once')
const isMock = process.argv.includes('--mock')   // fully offline simulation, no credentials needed

// ─── Env ──────────────────────────────────────────────────────────────────────

const ENV = {
  BOT_PRIVATE_KEY:         process.env.BOT_PRIVATE_KEY ?? '',
  BOT_TWITTER_USER_ID:     process.env.BOT_TWITTER_USER_ID ?? '',
  TWITTER_API_KEY:         process.env.TWITTER_API_KEY ?? '',
  TWITTER_API_SECRET:      process.env.TWITTER_API_SECRET ?? '',
  TWITTER_ACCESS_TOKEN:    process.env.TWITTER_ACCESS_TOKEN ?? '',
  TWITTER_ACCESS_SECRET:   process.env.TWITTER_ACCESS_SECRET ?? '',
  PROBABLE_API_BASE:       process.env.PROBABLE_API_BASE ?? 'https://api.probable.markets',
}

function validateEnv() {
  const missing = [
    'BOT_PRIVATE_KEY',
    'BOT_TWITTER_USER_ID',
    'TWITTER_API_KEY',
    'TWITTER_API_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
  ].filter((k) => !ENV[k as keyof typeof ENV])

  if (missing.length > 0) {
    throw new Error(`Missing env vars in bot/.env: ${missing.join(', ')}`)
  }
}

// ─── State (persisted between runs) ──────────────────────────────────────────

interface BotState {
  /** The tweet ID of the last mention we processed — used as since_id on next poll */
  lastSeenId: string
  /** Set of tweet IDs we have already replied to (prevents double-processing) */
  processedIds: string[]
}

function loadState(): BotState {
  if (!existsSync(STATE_FILE)) return { lastSeenId: '', processedIds: [] }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as BotState
  } catch {
    return { lastSeenId: '', processedIds: [] }
  }
}

function saveState(state: BotState) {
  // Keep processedIds bounded — remember only the last 500
  state.processedIds = state.processedIds.slice(-500)
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Command parser ───────────────────────────────────────────────────────────
//
// Accepted formats (case-insensitive, with or without $):
//   @scoop_bet YES $5
//   @scoop_bet NO 10.50
//   @scoop_bet yes $25.00
//   @scoop_bet YES $5 on this       ← extra text ignored
//
// Returns null if the mention doesn't match the pattern.

interface BetCommand {
  outcome: 'YES' | 'NO'
  amount: number          // USDT
  tweetId: string
  authorId: string
  authorUsername: string
  /** The tweet that was being replied to (contains the market URL) */
  replyToTweetId: string
}

function parseCommand(tweet: TweetV2): BetCommand | null {
  const text = tweet.text ?? ''
  // Match:   @<anything>  YES|NO  $?<number>
  const match = text.match(/\byes|no\b/i)?.input &&
    text.match(/(?:^|[\s,])@\S+\s+(yes|no)\s+\$?([\d]+(?:\.\d{1,2})?)/i)

  if (!match) return null

  const outcome = (match[1].toUpperCase() as 'YES' | 'NO')
  const amount  = parseFloat(match[2])

  if (isNaN(amount) || amount <= 0 || amount > MAX_USDT_PER_BET) {
    return null
  }

  const replyToTweetId = tweet.referenced_tweets?.find((r) => r.type === 'replied_to')?.id
  if (!replyToTweetId) return null

  return {
    outcome,
    amount,
    tweetId:         tweet.id,
    authorId:        tweet.author_id ?? '',
    authorUsername:  '', // filled below from includes.users
    replyToTweetId,
  }
}

// ─── Probable URL extractor ───────────────────────────────────────────────────
//
// Extracts an event slug from a probable.markets URL in tweet text.
// Handles:
//   https://probable.markets/event/will-satoshi-move-btc-2026
//   probable.markets/event/will-satoshi-move-btc-2026
//   probabledotmarket/will-satoshi-move-btc-2026  (bot-style tweet)
//   #ScoopBet_mkt_will_satoshi_move_btc_2026      (hashtag from posting bot)

function extractMarketSlug(text: string): string | null {
  // Direct URL
  const urlMatch = text.match(
    /probable\.markets\/(?:event|market)\/([a-z0-9-]+)/i
  )
  if (urlMatch) return urlMatch[1]

  // ScoopBet hashtag (underscores → hyphens)
  const hashMatch = text.match(/#ScoopBet_mkt_([a-z0-9_]+)/i)
  if (hashMatch) return hashMatch[1].replace(/_/g, '-')

  return null
}

// ─── Probable API types ───────────────────────────────────────────────────────

interface MarketData {
  slug:          string
  question:      string
  yesTokenId:    string
  noTokenId:     string
  yesBestAsk:    number    // current ask price 0-1
  noBestAsk:     number
}

interface ApiCreds {
  key:        string
  secret:     string
  passphrase: string
}

// ─── Probable market fetcher ──────────────────────────────────────────────────

async function fetchMarket(slug: string): Promise<MarketData | null> {
  try {
    const res  = await fetch(`${PROBABLE_MARKET}/events/slug/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ScoopReplyBot/1.0' },
    })
    if (!res.ok) {
      console.error(`[ReplyBot] Market API ${res.status} for slug "${slug}"`)
      return null
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = await res.json() as any

    // The event may embed one or more markets; take the first active one
    const markets: Array<{
      question: string
      active: boolean
      closed: boolean
      clobTokenIds?: string[] | string
      tokens?: Array<{ token_id: string; outcome: string }>
    }> = event.markets ?? []

    const market = markets.find((m) => m.active && !m.closed) ?? markets[0]
    if (!market) return null

    // Resolve token IDs
    let yesTokenId = ''
    let noTokenId  = ''

    if (Array.isArray(market.clobTokenIds) && market.clobTokenIds.length >= 2) {
      yesTokenId = String(market.clobTokenIds[0])
      noTokenId  = String(market.clobTokenIds[1])
    } else if (typeof market.clobTokenIds === 'string') {
      try {
        const parsed = JSON.parse(market.clobTokenIds) as string[]
        yesTokenId = parsed[0] ?? ''
        noTokenId  = parsed[1] ?? ''
      } catch { /* fall through to tokens[] */ }
    }

    if (!yesTokenId && market.tokens) {
      yesTokenId = market.tokens.find((t) => t.outcome.toUpperCase() === 'YES')?.token_id ?? ''
      noTokenId  = market.tokens.find((t) => t.outcome.toUpperCase() === 'NO')?.token_id  ?? ''
    }

    if (!yesTokenId || !noTokenId) {
      console.error(`[ReplyBot] Could not resolve token IDs for slug "${slug}"`)
      return null
    }

    // Fetch midpoint prices
    const [yRes, nRes] = await Promise.all([
      fetch(`${PROBABLE_ORDERS}/midpoint?token_id=${encodeURIComponent(yesTokenId)}`),
      fetch(`${PROBABLE_ORDERS}/midpoint?token_id=${encodeURIComponent(noTokenId)}`),
    ])
    const [yMid, nMid] = await Promise.all([
      yRes.json() as Promise<{ mid: string }>,
      nRes.json() as Promise<{ mid: string }>,
    ])

    return {
      slug,
      question:   String(market.question ?? event.title ?? slug),
      yesTokenId,
      noTokenId,
      yesBestAsk: parseFloat(yMid.mid) || 0.5,
      noBestAsk:  parseFloat(nMid.mid) || 0.5,
    }
  } catch (err) {
    console.error('[ReplyBot] fetchMarket error:', err)
    return null
  }
}

// ─── Probable L1 Auth (get API key via EIP-712) ───────────────────────────────

async function getApiCreds(wallet: ethers.Wallet): Promise<ApiCreds> {
  const eoaAddress = await wallet.getAddress()
  const timestamp  = Math.floor(Date.now() / 1000)

  const domain = { name: 'ClobAuthDomain', version: '1', chainId: BSC_CHAIN_ID }
  const types  = {
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
    nonce:     0,
    message:   'This message attests that I control the given wallet',
  }

  const l1Sig = await wallet.signTypedData(domain, types, value)

  const res = await fetch(`${PROBABLE_ORDERS}/auth/api-key/${BSC_CHAIN_ID}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'prob_address':  eoaAddress,
      'prob_signature': l1Sig,
      'prob_timestamp': timestamp.toString(),
      'prob_nonce':    '0',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`L1 auth failed ${res.status}: ${body}`)
  }

  const data = await res.json() as { apiKey: string; secret: string; passphrase: string }
  console.log(`[ReplyBot] API credentials obtained for ${eoaAddress}`)
  return { key: data.apiKey, secret: data.secret, passphrase: data.passphrase }
}

// ─── L2 HMAC signature (Node.js crypto) ──────────────────────────────────────

function buildL2Sig(
  secret:    string,
  timestamp: number,
  method:    string,
  path:      string,
  body:      string
): string {
  const message    = `${timestamp}${method}${path}${body}`
  const fixedSecret = secret.replace(/-/g, '+').replace(/_/g, '/')
  const secretBuf  = Buffer.from(fixedSecret, 'base64')
  const hmac       = createHmac('sha256', secretBuf).update(message).digest()
  return hmac.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

// ─── EIP-712 domain ───────────────────────────────────────────────────────────

const EIP712_DOMAIN = {
  name:              'Probable CTF Exchange',
  version:           '1',
  chainId:           BSC_CHAIN_ID,
  verifyingContract: CTF_EXCHANGE,
}

const ORDER_TYPES = {
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

// ─── Order builder + signer ───────────────────────────────────────────────────

interface BuiltOrder {
  signature:   string
  salt:        string
  maker:       string
  signer:      string
  tokenId:     string
  makerAmount: string
  takerAmount: string
  expiration:  string
  nonce:       string
  feeRateBps:  string
  side:        number
}

async function buildAndSign(
  wallet: ethers.Wallet,
  market: MarketData,
  outcome: 'YES' | 'NO',
  usdtAmount: number
): Promise<BuiltOrder> {
  const eoaAddress = await wallet.getAddress()
  const tokenId    = outcome === 'YES' ? market.yesTokenId : market.noTokenId
  const price      = outcome === 'YES' ? market.yesBestAsk : market.noBestAsk

  // BUY: makerAmount = USDT in, takerAmount = shares out
  const shares          = usdtAmount / price
  const RC              = 4   // rounding precision (4 decimal places)
  const roundUp   = (v: number, d: number) => Math.ceil(v * 10 ** d) / 10 ** d
  const roundDown = (v: number, d: number) => Math.floor(v * 10 ** d) / 10 ** d

  const rawMakerAmt = roundUp(usdtAmount, RC)   // USDT (18 dec)
  const rawTakerAmt = roundDown(shares,   RC)   // shares (18 dec)

  // Parse to 18-decimal bigints without float rounding issues
  const toWei = (value: number): bigint => {
    const [intPart, fracPart = ''] = value.toFixed(6).split('.')
    const frac = fracPart.padEnd(18, '0')
    return BigInt((intPart || '0') + frac)
  }

  const makerAmount  = toWei(rawMakerAmt)
  const takerAmount  = toWei(rawTakerAmt)
  const salt         = String(Math.round(Math.random() * Date.now()))
  const expiration   = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24)  // 24h

  const orderValue = {
    salt:          BigInt(salt),
    maker:         eoaAddress as `0x${string}`,
    signer:        eoaAddress as `0x${string}`,
    taker:         '0x0000000000000000000000000000000000000000' as `0x${string}`,
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    BigInt(expiration),
    nonce:         0n,
    feeRateBps:    175n,
    side:          0,   // BUY
    signatureType: 0,   // EOA
  }

  console.log('[ReplyBot] Signing order:', {
    outcome, usdtAmount, price, shares: rawTakerAmt, tokenId,
    makerAmount: makerAmount.toString(), takerAmount: takerAmount.toString(),
  })

  const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderValue)

  return {
    signature,
    salt,
    maker:       eoaAddress,
    signer:      eoaAddress,
    tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    expiration,
    nonce:       '0',
    feeRateBps:  '175',
    side:        0,
  }
}

// ─── Order submission ─────────────────────────────────────────────────────────

async function submitOrder(
  order: BuiltOrder,
  creds: ApiCreds,
  eoaAddress: string
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const path    = `/public/api/v1/order/${BSC_CHAIN_ID}`
  const payload = {
    deferExec: false,
    order: {
      salt:          order.salt,
      maker:         order.maker,
      signer:        order.signer,
      taker:         '0x0000000000000000000000000000000000000000',
      tokenId:       order.tokenId,
      makerAmount:   order.makerAmount,
      takerAmount:   order.takerAmount,
      side:          'BUY',
      expiration:    order.expiration,
      nonce:         order.nonce,
      feeRateBps:    order.feeRateBps,
      signatureType: 0,
      signature:     order.signature,
    },
    owner:     order.maker,
    orderType: 'GTC',
  }

  const body      = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const l2Sig     = buildL2Sig(creds.secret, timestamp, 'POST', path, body)

  console.log('[ReplyBot] Submitting order to Probable on BSC mainnet')

  const res = await fetch(`${PROBABLE_ORDERS}/order/${BSC_CHAIN_ID}`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'prob_address':      eoaAddress,
      'prob_signature':    l2Sig,
      'prob_timestamp':    timestamp.toString(),
      'prob_api_key':      creds.key,
      'prob_passphrase':   creds.passphrase,
      'prob_account_type': 'eoa',
    },
    body,
  })

  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    const errMsg = String(data.error ?? data.message ?? res.statusText)
    console.error(`[ReplyBot] Order submission failed: ${res.status} ${errMsg}`)
    return { success: false, error: errMsg }
  }

  const orderId = String(data.orderId ?? data.id ?? '')
  console.log(`[ReplyBot] ✓ Order accepted. ID: ${orderId}`)
  return { success: true, orderId }
}

// ─── Reply builder ────────────────────────────────────────────────────────────

function buildReply(
  username:   string,
  success:    boolean,
  outcome:    string,
  amount:     number,
  market:     MarketData,
  orderId?:   string,
  error?:     string
): string {
  if (!success) {
    return `@${username} ❌ Could not place your bet. ${error ?? 'Unknown error. Please try again.'}`
  }

  const price    = outcome === 'YES' ? market.yesBestAsk : market.noBestAsk
  const shares   = (amount / price).toFixed(4)
  const priceCnt = Math.round(price * 100)

  return [
    `@${username} ✓ Order placed on BNB Chain!`,
    ``,
    `${outcome} on: "${market.question.slice(0, 60)}${market.question.length > 60 ? '…' : ''}"`,
    ``,
    `$${amount.toFixed(2)} USDT → ~${shares} ${outcome} shares @ ${priceCnt}¢`,
    `Order ID: ${orderId ?? 'pending'}`,
    ``,
    `#Scoop #PredictionMarkets`,
  ].join('\n')
}

// ─── Twitter setup ────────────────────────────────────────────────────────────

function createClient(): TwitterApi {
  return new TwitterApi({
    appKey:      ENV.TWITTER_API_KEY,
    appSecret:   ENV.TWITTER_API_SECRET,
    accessToken: ENV.TWITTER_ACCESS_TOKEN,
    accessSecret: ENV.TWITTER_ACCESS_SECRET,
  })
}

// ─── Mock poll (offline simulation, no credentials needed) ───────────────────

async function mockPoll(wallet: ethers.Wallet): Promise<void> {
  console.log('\n[ReplyBot] MOCK POLL — simulating a mention …')

  const MOCK_MENTION_TEXT   = '@scoop_bet YES $5'
  const MOCK_PARENT_TEXT    = 'Super interesting market! probable.markets/event/will-satoshi-move-any-bitcoin-in-2026'
  const MOCK_AUTHOR         = 'testuser123'
  const MOCK_SLUG           = 'will-satoshi-move-any-bitcoin-in-2026'

  console.log(`[ReplyBot] Mock mention: "${MOCK_MENTION_TEXT}"`)
  console.log(`[ReplyBot] Mock parent tweet: "${MOCK_PARENT_TEXT}"`)

  // Parse command
  const slug = extractMarketSlug(MOCK_PARENT_TEXT)
  console.log(`[ReplyBot] Extracted slug: "${slug}"`)

  // Parse bet
  const outcomeMatch = MOCK_MENTION_TEXT.match(/(yes|no)\s+\$?([\d.]+)/i)
  if (!outcomeMatch) { console.log('[ReplyBot] No valid bet found.'); return }
  const outcome = outcomeMatch[1].toUpperCase() as 'YES' | 'NO'
  const amount  = parseFloat(outcomeMatch[2])
  console.log(`[ReplyBot] Parsed bet: ${outcome} $${amount}`)

  // Fetch real market data (shows whether Probable API is reachable)
  console.log('[ReplyBot] Fetching market data from Probable API …')
  const market = slug ? await fetchMarket(slug) : null

  if (!market) {
    console.log('[ReplyBot] Could not fetch market (API may be unreachable in this environment).')
    console.log('[ReplyBot] Using synthetic market data for demo:')
    const syntheticMarket: MarketData = {
      slug:       MOCK_SLUG,
      question:   'Will Satoshi move any Bitcoin in 2026?',
      yesTokenId: '123456',
      noTokenId:  '789012',
      yesBestAsk: 0.07,
      noBestAsk:  0.93,
    }
    const reply = buildReply(MOCK_AUTHOR, true, outcome, amount, syntheticMarket, 'mock-order-id-001')
    console.log(`\n[ReplyBot] Reply that would be posted:\n${'─'.repeat(40)}\n${reply}\n${'─'.repeat(40)}`)
    return
  }

  console.log(`[ReplyBot] Market: "${market.question}" — YES ${(market.yesBestAsk * 100).toFixed(0)}¢`)

  // Build + sign order
  const order = await buildAndSign(wallet, market, outcome, amount)
  console.log('[ReplyBot] Order signed (not submitted in mock mode)')

  const reply = buildReply(MOCK_AUTHOR, true, outcome, amount, market, 'mock-order-id-001')
  console.log(`\n[ReplyBot] Reply that would be posted:\n${'─'.repeat(40)}\n${reply}\n${'─'.repeat(40)}`)
  console.log('\n[ReplyBot] Mock complete. In live mode this order would be submitted to Probable Markets on BSC.')
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function poll(
  twitter: TwitterApi,
  wallet:  ethers.Wallet,
  creds:   ApiCreds,
  state:   BotState
): Promise<void> {
  const botAddress = await wallet.getAddress()
  console.log(`\n[ReplyBot] Polling mentions for user ${ENV.BOT_TWITTER_USER_ID} …`)

  // GET /2/users/:id/mentions — returns up to 100 latest mentions
  const params: Record<string, string | number | string[]> = {
    max_results:    20,
    expansions:     ['author_id', 'referenced_tweets.id'],
    'tweet.fields': ['text', 'author_id', 'referenced_tweets'],
    'user.fields':  ['username'],
  }
  if (state.lastSeenId) params['since_id'] = state.lastSeenId

  let mentionsRes
  try {
    mentionsRes = await twitter.v2.userMentionTimeline(ENV.BOT_TWITTER_USER_ID, params)
  } catch (err) {
    console.error('[ReplyBot] Failed to fetch mentions:', err)
    return
  }

  const tweets   = mentionsRes.data.data ?? []
  const includes = mentionsRes.data.includes ?? {}
  const users    = (includes.users ?? []) as Array<{ id: string; username: string }>

  if (tweets.length === 0) {
    console.log('[ReplyBot] No new mentions.')
    return
  }

  console.log(`[ReplyBot] ${tweets.length} new mention(s) found.`)

  // Track highest tweet ID seen this run
  let highestId = state.lastSeenId

  for (const tweet of tweets) {
    // Update highest seen ID (Twitter IDs are chronologically ordered strings)
    if (!highestId || tweet.id > highestId) highestId = tweet.id

    // Skip already processed
    if (state.processedIds.includes(tweet.id)) {
      console.log(`[ReplyBot] Skipping already-processed tweet ${tweet.id}`)
      continue
    }

    console.log(`\n[ReplyBot] Processing mention ${tweet.id}: "${tweet.text}"`)

    // --- 1. Parse command ---
    const cmd = parseCommand(tweet)
    if (!cmd) {
      console.log('[ReplyBot] Not a valid bet command — skipping.')
      state.processedIds.push(tweet.id)
      continue
    }

    // Fill in username from includes
    const author = users.find((u) => u.id === tweet.author_id)
    cmd.authorUsername = author?.username ?? 'user'

    console.log(`[ReplyBot] Command: @${cmd.authorUsername} → ${cmd.outcome} $${cmd.amount}`)

    // --- 2. Fetch parent tweet for market URL ---
    let parentText = ''
    try {
      const parentRes = await twitter.v2.singleTweet(cmd.replyToTweetId, {
        'tweet.fields': ['text'],
      })
      parentText = parentRes.data.text ?? ''
    } catch (err) {
      console.error(`[ReplyBot] Could not fetch parent tweet ${cmd.replyToTweetId}:`, err)
      state.processedIds.push(tweet.id)
      continue
    }

    const slug = extractMarketSlug(parentText)
    if (!slug) {
      console.log(`[ReplyBot] No Probable Markets URL in parent tweet — skipping.`)
      if (!isDry) {
        try {
          await twitter.v2.reply(
            `@${cmd.authorUsername} Couldn't find a Probable Markets link in the tweet you replied to. Make sure you reply to a tweet with a probable.markets URL.`,
            tweet.id
          )
        } catch { /* best effort */ }
      }
      state.processedIds.push(tweet.id)
      continue
    }

    console.log(`[ReplyBot] Market slug: "${slug}"`)

    // --- 3. Fetch market data ---
    const market = await fetchMarket(slug)
    if (!market) {
      console.warn(`[ReplyBot] Could not fetch market for slug "${slug}" — skipping.`)
      state.processedIds.push(tweet.id)
      continue
    }

    console.log(`[ReplyBot] Market: "${market.question}"`)
    console.log(`[ReplyBot] Prices — YES: ${market.yesBestAsk.toFixed(3)}, NO: ${market.noBestAsk.toFixed(3)}`)

    // --- 4. Dry run ---
    if (isDry) {
      console.log(`[ReplyBot] DRY RUN — would place: ${cmd.outcome} $${cmd.amount} on "${market.question}"`)
      console.log(`[ReplyBot] Reply would be:\n${buildReply(cmd.authorUsername, true, cmd.outcome, cmd.amount, market, 'dry-run-id')}`)
      state.processedIds.push(tweet.id)
      continue
    }

    // --- 5. Build + sign order ---
    let order: BuiltOrder
    try {
      order = await buildAndSign(wallet, market, cmd.outcome, cmd.amount)
    } catch (err) {
      console.error('[ReplyBot] Signing failed:', err)
      state.processedIds.push(tweet.id)
      continue
    }

    // --- 6. Submit order ---
    const result = await submitOrder(order, creds, botAddress)

    // --- 7. Reply to user ---
    const replyText = buildReply(
      cmd.authorUsername,
      result.success,
      cmd.outcome,
      cmd.amount,
      market,
      result.orderId,
      result.error
    )

    console.log(`[ReplyBot] Sending reply:\n${replyText}`)
    try {
      await twitter.v2.reply(replyText, tweet.id)
    } catch (err) {
      console.error('[ReplyBot] Failed to post reply:', err)
    }

    state.processedIds.push(tweet.id)
  }

  // Persist updated state
  if (highestId) state.lastSeenId = highestId
  saveState(state)
  console.log(`[ReplyBot] State saved. lastSeenId = ${state.lastSeenId}`)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`[ReplyBot] Scoop Comment-to-Bet Bot starting${isDry ? ' (DRY RUN)' : isMock ? ' (MOCK)' : ''} …`)

  if (!isDry && !isMock) validateEnv()

  // Set up wallet (required in live mode; skipped in dry/mock mode)
  let wallet: ethers.Wallet
  if (ENV.BOT_PRIVATE_KEY) {
    wallet = new ethers.Wallet(ENV.BOT_PRIVATE_KEY)
    const botAddress = await wallet.getAddress()
    console.log(`[ReplyBot] Bot wallet: ${botAddress}`)
  } else if (!isDry && !isMock) {
    throw new Error('BOT_PRIVATE_KEY is required. Add it to bot/.env')
  } else {
    wallet = ethers.Wallet.createRandom()
    console.log('[ReplyBot] No BOT_PRIVATE_KEY — using random wallet for simulation.')
  }

  // Mock mode: fully offline, no Twitter or Probable credentials needed
  if (isMock) {
    await mockPoll(wallet)
    return
  }

  // Authenticate with Probable API (once per session, not per order)
  // Skipped in dry-run (no real signing needed)
  let creds: ApiCreds = { key: '', secret: '', passphrase: '' }
  if (!isDry) {
    console.log('[ReplyBot] Obtaining Probable API credentials …')
    try {
      creds = await getApiCreds(wallet)
    } catch (err) {
      console.error('[ReplyBot] Could not authenticate with Probable API:', err)
      process.exit(1)
    }
  }

  const twitter = createClient()
  const state   = loadState()

  if (isOnce) {
    // Single run (for cron / GitHub Actions)
    await poll(twitter, wallet, creds, state)
    console.log('[ReplyBot] Done (--once).')
    return
  }

  // Continuous loop
  console.log(`[ReplyBot] Polling every ${POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.`)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await poll(twitter, wallet, creds, state)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    // Refresh API creds every ~45 min (they may expire after 1h)
    const age = Math.floor(Date.now() / 1000)
    if (age % 2700 < POLL_INTERVAL_MS / 1000 + 5) {
      console.log('[ReplyBot] Refreshing API credentials …')
      try { creds = await getApiCreds(wallet) } catch { /* keep existing */ }
    }
  }
}

main().catch((err) => {
  console.error('[ReplyBot] Fatal error:', err)
  process.exit(1)
})
