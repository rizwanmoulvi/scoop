/**
 * Scoop Market Bot
 *
 * Fetches open markets from Probable and posts them to Twitter/X
 * in a format the Scoop extension can detect via the #ScoopBet_mkt_{id} hashtag.
 *
 * Usage:
 *   cp bot/.env.example bot/.env        # fill in your credentials
 *   npm run bot                         # post top markets now
 *   npm run bot -- --dry-run            # preview without posting
 *
 * Twitter API v2 credentials required:
 *   https://developer.twitter.com/en/portal/dashboard
 */

import 'dotenv/config'
import { TwitterApi } from 'twitter-api-v2'

// ─── Config ───────────────────────────────────────────────────────────────────

const env = {
  // Twitter OAuth 1.0a (write permissions required)
  TWITTER_API_KEY: process.env.TWITTER_API_KEY ?? '',
  TWITTER_API_SECRET: process.env.TWITTER_API_SECRET ?? '',
  TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN ?? '',
  TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET ?? '',

  // Probable API base  (override via env if their API URL changes)
  PROBABLE_API_BASE: process.env.PROBABLE_API_BASE ?? 'https://api.probable.markets',

  // How many markets to post per run (default 1 for demo)
  MAX_POSTS: Number(process.env.MAX_POSTS ?? '1'),
}

const isDryRun = process.argv.includes('--dry-run')
const isMock = process.argv.includes('--mock')

// ─── Mock Markets (used with --mock for instant demo) ─────────────────────────
// Replace these IDs with real ones copied from probable.markets in your browser

const MOCK_MARKETS: ProbableMarket[] = [
  {
    id: 'will-satoshi-move-any-bitcoin-in-2026',
    question: 'Will Satoshi move any Bitcoin in 2026?',
    status: 'open',
    probability: 0.07,
    volume: '89000',
    yesBestAsk: 0.08,
    noBestAsk: 0.92,
    resolutionDate: '2026-12-31',
  },
  {
    id: 'will-bitcoin-reach-100k-by-june-2026',
    question: 'Will Bitcoin reach $100,000 by June 2026?',
    status: 'open',
    probability: 0.62,
    volume: '245000',
    yesBestAsk: 0.63,
    noBestAsk: 0.37,
    resolutionDate: '2026-06-30',
  },
  {
    id: 'will-bnb-exceed-1000-in-2026',
    question: 'Will BNB exceed $1,000 in 2026?',
    status: 'open',
    probability: 0.41,
    volume: '67000',
    yesBestAsk: 0.42,
    noBestAsk: 0.58,
    resolutionDate: '2026-12-31',
  },
]

// ─── Probable API Types ───────────────────────────────────────────────────────

interface ProbableMarket {
  id: string
  question: string
  status: 'open' | 'closed' | 'resolved'
  probability: number        // 0-1
  volume: string             // USDC volume
  resolutionDate?: string
  yesBestAsk?: number        // e.g. 0.34  → 34¢
  noBestAsk?: number         // e.g. 0.66  → 66¢
  /** CTF token IDs from the Market Public API: [yesTokenId, noTokenId] (already parsed) */
  _clobTokenIds?: string[]
}

// ─── Probable API Client ──────────────────────────────────────────────────────

async function fetchOpenMarkets(): Promise<ProbableMarket[]> {
  if (isMock) {
    console.log('[Bot] Using mock market data (--mock flag)')
    return MOCK_MARKETS
  }

  // Probable has two API services:
  //   Market Public API:  https://market-api.probable.markets/public/api/v1
  //   Orderbook API:      https://api.probable.markets/public/api/v1
  //
  // The market public API is fully open (no Cloudflare protection on it).
  // We fetch active events → extract embedded markets.
  const MARKET_API = `${env.PROBABLE_API_BASE.replace('api.', 'market-api.')}/public/api/v1`
  const url = `${MARKET_API}/events/?status=active&limit=20&sort=volume`
  console.log(`[Bot] Fetching markets from ${url}`)

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ScoopBot/1.0',
    },
  })

  if (!res.ok) {
    throw new Error(`Probable API error: ${res.status} ${res.statusText}`)
  }

  // GET /events/ returns { events: [...], pagination: {...} }
  // Each event has a .markets array with embedded market objects.
  const json = await res.json() as {
    events?: Array<{
      id: number
      slug: string
      title: string
      status: string
      volume?: number
      markets?: Array<{
        id: number
        question: string
        market_slug: string
        active: boolean
        closed: boolean
        /** JSON-encoded string or array */
        clobTokenIds?: string[] | string
      }>
    }>
  }

  const events = json.events ?? []
  const markets: ProbableMarket[] = []

  for (const event of events) {
    if (!event.markets) continue
    for (const m of event.markets) {
      if (!m.active || m.closed) continue
      // Use the event slug as the market ID (it's what the bot hashtag encodes)
      markets.push({
        id: event.slug,
        question: m.question || event.title,
        status: 'open',
        probability: 0.5,     // enriched below with midpoint
        volume: String(event.volume ?? 0),
        resolutionDate: undefined,
        yesBestAsk: undefined,
        noBestAsk: undefined,
        // Store the CTF token IDs for orderbook lookups
        // clobTokenIds arrives as a JSON-encoded string from the API
        _clobTokenIds: (() => {
          const raw = m.clobTokenIds
          if (Array.isArray(raw)) return raw as string[]
          if (typeof raw === 'string') { try { return JSON.parse(raw) as string[] } catch { return [] } }
          return []
        })(),
      })
      break  // one market per event is enough for the bot tweet
    }
  }

  return markets.filter((m) => m.id)
}

async function fetchMarketOrderBook(market: ProbableMarket): Promise<{ yesBestAsk: number; noBestAsk: number } | null> {
  // Use the real Orderbook API:
  //   GET https://api.probable.markets/public/api/v1/midpoint?token_id={clobTokenId}
  // clobTokenIds[0] = YES token, clobTokenIds[1] = NO token
  const [yesTokenId, noTokenId] = market._clobTokenIds ?? []
  if (!yesTokenId || !noTokenId) return null

  const ORDERBOOK_API = `${env.PROBABLE_API_BASE}/public/api/v1`

  try {
    const [yesRes, noRes] = await Promise.all([
      fetch(`${ORDERBOOK_API}/midpoint?token_id=${encodeURIComponent(yesTokenId)}`),
      fetch(`${ORDERBOOK_API}/midpoint?token_id=${encodeURIComponent(noTokenId)}`),
    ])

    if (!yesRes.ok || !noRes.ok) return null

    const [yesData, noData] = await Promise.all([
      yesRes.json() as Promise<{ mid: string }>,
      noRes.json() as Promise<{ mid: string }>,
    ])

    const yesBestAsk = parseFloat(yesData.mid)
    const noBestAsk  = parseFloat(noData.mid)

    if (isNaN(yesBestAsk) || isNaN(noBestAsk)) return null
    return { yesBestAsk, noBestAsk }
  } catch {
    return null
  }
}

// ─── Tweet Builder ────────────────────────────────────────────────────────────

function buildTweet(market: ProbableMarket): string {
  const yesCents = market.yesBestAsk != null ? Math.round(market.yesBestAsk * 100) : null
  const noCents = market.noBestAsk != null ? Math.round(market.noBestAsk * 100) : null

  const priceBlock =
    yesCents !== null && noCents !== null
      ? `\nYES ${yesCents}¢  |  NO ${noCents}¢\n`
      : ''

  const probPct = market.probability != null ? `\n📈 Market probability: ${Math.round(market.probability * 100)}%` : ''

  // The hashtag #ScoopBet_mkt_{slug} is what the extension detects.
  // X hashtags stop at hyphens, so we replace hyphens → underscores.
  // The extension decodes underscores → hyphens back to the real market slug.
  const hashtagSlug = market.id.replace(/-/g, '_')

  return [
    `📊 ${market.question}`,
    priceBlock,
    probPct,
    `\nTrade on probabledotmarket `,
    `#ScoopBet_mkt_${hashtagSlug} #PredictionMarket #Scoop`,
  ]
    .filter(Boolean)
    .join('')
    .trim()
}

// ─── Twitter Client ───────────────────────────────────────────────────────────

function createTwitterClient(): TwitterApi {
  const missing = (
    ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET'] as const
  ).filter((k) => !env[k])

  if (missing.length > 0) {
    throw new Error(`Missing Twitter credentials in bot/.env: ${missing.join(', ')}`)
  }

  return new TwitterApi({
    appKey: env.TWITTER_API_KEY,
    appSecret: env.TWITTER_API_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessSecret: env.TWITTER_ACCESS_SECRET,
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[Bot] Starting Scoop Market Bot${isDryRun ? ' (DRY RUN)' : ''}`)

  // 1. Fetch markets
  let markets: ProbableMarket[]
  try {
    markets = await fetchOpenMarkets()
  } catch (err) {
    console.error('[Bot] Failed to fetch markets:', err)
    process.exit(1)
  }

  if (markets.length === 0) {
    console.log('[Bot] No open markets found')
    return
  }

  console.log(`[Bot] Found ${markets.length} open markets, will post up to ${env.MAX_POSTS}`)

  // 2. Enrich with orderbook prices (midpoint = probability)
  for (const market of markets.slice(0, env.MAX_POSTS)) {
    const ob = await fetchMarketOrderBook(market)
    if (ob) {
      market.yesBestAsk = ob.yesBestAsk
      market.noBestAsk  = ob.noBestAsk
      market.probability = ob.yesBestAsk   // midpoint IS the probability
    }
  }

  // 3. Build and post tweets
  const twitter = isDryRun ? null : createTwitterClient()

  for (const market of markets.slice(0, env.MAX_POSTS)) {
    const tweet = buildTweet(market)

    console.log('\n─────────────────────────────────────────')
    console.log('[Bot] Tweet preview:')
    console.log(tweet)
    console.log(`\n[Bot] Characters: ${tweet.length} / 280`)
    console.log('─────────────────────────────────────────')

    if (isDryRun) {
      console.log('[Bot] DRY RUN — skipping post')
      continue
    }

    try {
      const result = await twitter!.v2.tweet(tweet)
      console.log(`[Bot] ✓ Posted! Tweet ID: ${result.data.id}`)
      console.log(`[Bot] URL: https://x.com/i/web/status/${result.data.id}`)
    } catch (err) {
      console.error('[Bot] Failed to post tweet:', err)
    }
  }

  console.log('\n[Bot] Done')
}

run().catch((err) => {
  console.error('[Bot] Unhandled error:', err)
  process.exit(1)
})
