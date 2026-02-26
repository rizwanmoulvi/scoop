import type { DetectedMarket, Platform } from '../types/market'

// ─── Scoop Bot Hashtag ───────────────────────────────────────────────────────
// When our bot posts a market it embeds #ScoopBet_mkt_{slug_with_underscores}.
// X hashtags stop at hyphens, so the bot converts slug hyphens → underscores.
// The extension converts back: underscores → hyphens to get the real market slug.
// e.g. tweet:     #ScoopBet_mkt_will_satoshi_move_any_bitcoin_in_2026
//      marketId:  will-satoshi-move-any-bitcoin-in-2026
const SCOOP_HASHTAG_REGEX = /#ScoopBet_mkt_([A-Za-z0-9_]+)/i

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
      // Probable markets live at /event/{slug}
      const url =
        marketId !== '_platform'
          ? platform === 'probable'
            ? `${baseUrl}/event/${marketId}`
            : `${baseUrl}/${marketId}`
          : baseUrl

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
  const tweetText =
    tweetEl.querySelector('[data-testid="tweetText"]')?.textContent ??
    tweetEl.textContent ?? ''

  // 0. Highest priority: #ScoopBet_mkt_{id} hashtag from our bot.
  //    Gives an exact Probable market ID with zero ambiguity,
  //    even when X strips plain URLs from posts.
  const hashtagMatch = SCOOP_HASHTAG_REGEX.exec(tweetText)
  if (hashtagMatch) {
    // Underscores in the hashtag are hyphens in the real slug
    const marketId = hashtagMatch[1].replace(/_/g, '-')
    return {
      platform: 'probable',
      marketId,
      url: `https://probable.markets/event/${marketId}`,
      sourceTweetElement: tweetEl,
    }
  }

  // 1. Check anchor hrefs — they carry the resolved URL
  const anchors = Array.from(tweetEl.querySelectorAll<HTMLAnchorElement>('a[href]'))
  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute('href') || ''
    const found = parseMarketMentions(href)
    if (found.length) return { ...found[0], sourceTweetElement: tweetEl }
  }

  // 2. Fall back to visible tweet text (spoken forms / bare domains)
  const found = parseMarketMentions(tweetText)
  if (found.length) return { ...found[0], sourceTweetElement: tweetEl }

  return null
}
