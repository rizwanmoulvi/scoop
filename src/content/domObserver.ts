import type { DetectedMarket, Platform } from '../types/market'

// ─── Detection Rules ─────────────────────────────────────────────────────────

interface PatternRule {
  platform: Platform
  /** Matches the full URL or spoken form; capture group 1 = market ID (optional) */
  regex: RegExp
  /** Base URL used to construct market.url when only a platform mention is found */
  baseUrl: string
}

/**
 * Match both:
 *  • Full URLs:       https://probable.markets/abc123
 *  • Bare domains:    probable.markets/abc123
 *  • Spoken aliases:  probabledotmarket  /  probable dot markets  /  probabledotmarkets
 *
 * Capture group 1 = market ID path segment (optional).
 */
const PATTERNS: PatternRule[] = [
  {
    platform: 'probable',
    // spoken: probabledotmarket(s), probable dot market(s), OR bare/full URL domain
    regex:
      /(?:https?:\/\/)?(?:www\.)?(?:probable\s*(?:dot|\.)\s*market[s]?|probabledotmarket[s]?)(?:\/([A-Za-z0-9_-]+))?/gi,
    baseUrl: 'https://probable.markets',
  },
  {
    platform: 'predict_fun',
    regex:
      /(?:https?:\/\/)?(?:app\.)?(?:predict\s*(?:dot|\.)\s*fun|predictdotfun)(?:\/(?:markets\/)?([A-Za-z0-9_-]+))?/gi,
    baseUrl: 'https://app.predict.fun',
  },
  {
    platform: 'opinion',
    regex:
      /(?:https?:\/\/)?(?:app\.)?(?:opinion\s*(?:dot|\.)\s*trade|opiniondottrade)(?:\/(?:markets\/)?([A-Za-z0-9_-]+))?/gi,
    baseUrl: 'https://app.opinion.trade',
  },
]

// ─── Core Detection ──────────────────────────────────────────────────────────

/**
 * Scan any text string (tweet body, anchor href, etc.) and return all
 * prediction market detections found.
 */
export function parseMarketMentions(text: string): DetectedMarket[] {
  const markets: DetectedMarket[] = []

  for (const { platform, regex, baseUrl } of PATTERNS) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const marketId = match[1] ?? '_platform'
      const url = marketId !== '_platform' ? `${baseUrl}/${marketId}` : baseUrl

      if (!markets.find((m) => m.marketId === marketId && m.platform === platform)) {
        markets.push({ platform, marketId, url })
      }
    }
  }

  return markets
}

// ─── Tweet-level Detection ───────────────────────────────────────────────────

/**
 * Given a tweet article element, return the first DetectedMarket found by:
 *  1. Scanning raw visible text of the tweet body
 *  2. Scanning href of every anchor inside the tweet
 *
 * Returns only the first match (one Bet button per tweet).
 */
export function detectMarketInTweet(tweetEl: Element): DetectedMarket | null {
  // 1. Check anchor hrefs first — they often carry the real resolved URL
  const anchors = Array.from(tweetEl.querySelectorAll<HTMLAnchorElement>('a[href]'))
  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute('href') || ''
    const found = parseMarketMentions(href)
    if (found.length) return { ...found[0], sourceTweetElement: tweetEl }
  }

  // 2. Fall back to visible tweet text
  const textEl = tweetEl.querySelector('[data-testid="tweetText"]')
  const text = textEl?.textContent ?? tweetEl.textContent ?? ''
  const found = parseMarketMentions(text)
  if (found.length) return { ...found[0], sourceTweetElement: tweetEl }

  return null
}
