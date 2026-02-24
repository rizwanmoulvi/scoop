/**
 * Scoop Content Script
 *
 * Runs on twitter.com / x.com.
 * Observes DOM mutations to detect prediction market mentions inside tweets
 * and injects an inline "Bet" button into the tweet's action bar
 * (alongside Like / Retweet / Reply / Share).
 *
 * Detection covers:
 *  - Full URLs:      https://probable.markets/abc123
 *  - Bare domains:   probable.markets/abc123
 *  - Spoken forms:   probabledotmarket  /  probable dot markets
 */
import type { DetectedMarket } from '../types/market'
import { detectMarketInTweet } from './domObserver'
import { injectBetButton, injectStyles } from './injectButton'

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * CSS selectors for tweet article containers on Twitter/X.
 * Multiple selectors for resilience against layout changes.
 */
const TWEET_SELECTOR = 'article[data-testid="tweet"]'

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Scan a root element for tweet articles and inject Bet buttons
 * for any prediction market mentions found.
 */
function scanForMarkets(root: Element | Document = document): void {
  const tweets = Array.from(root.querySelectorAll<Element>(TWEET_SELECTOR))

  // Also handle the case where root itself is a tweet article
  if (root instanceof Element && root.matches(TWEET_SELECTOR)) {
    tweets.unshift(root)
  }

  for (const tweet of tweets) {
    const market = detectMarketInTweet(tweet)
    if (market) {
      injectBetButton(tweet, market, handleBetClick)
    }
  }
}

/**
 * Called when a user clicks a Bet button.
 * Sends a message to the background SW to open/focus the sidebar.
 */
function handleBetClick(market: DetectedMarket): void {
  console.log('[Scoop] Bet clicked:', market)

  chrome.runtime.sendMessage({
    type: 'OPEN_SIDEBAR',
    payload: market,
  })
}

// ─── MutationObserver ────────────────────────────────────────────────────────

let observer: MutationObserver | null = null

function startObserver(): void {
  if (observer) return

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) {
          scanForMarkets(node)
        }
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  console.log('[Scoop] MutationObserver started')
}

// ─── Init ────────────────────────────────────────────────────────────────────

function init(): void {
  injectStyles()
  scanForMarkets(document)
  startObserver()
  console.log('[Scoop] Content script initialized')
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
