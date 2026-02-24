/**
 * Scoop Content Script — runs in ISOLATED world (default).
 *
 * Isolated world gives access to chrome.runtime APIs.
 * window.ethereum is NOT available here; the separate ethereumBridge.ts
 * (MAIN world) handles that and communicates via window.postMessage.
 *
 * Responsibilities:
 *  1. Detect prediction market mentions in tweets and inject Bet buttons.
 *  2. On Bet click → send OPEN_PANEL to background (opens popup window).
 *  3. Handle WALLET_REQUEST from background →
 *       postMessage to MAIN world bridge → get result → reply to background.
 */
import type { DetectedMarket } from '../types/market'
import { detectMarketInTweet } from './domObserver'
import { injectBetButton, injectStyles } from './injectButton'

// ─── Wallet Proxy via postMessage Bridge ─────────────────────────────────────

/**
 * Forward a JSON-RPC wallet call to the MAIN world bridge and await the result.
 * Each call gets a unique id to match the async response.
 */
function callBridge(method: string, params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `scoop-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.__scoop_res !== true || data.id !== id) return

      window.removeEventListener('message', handler)
      if (data.error) reject(new Error(data.error))
      else resolve(data.result)
    }

    window.addEventListener('message', handler)
    window.postMessage({ __scoop: true, id, method, params }, '*')
  })
}

// Listen for WALLET_REQUEST messages from the background service worker
// and proxy them to the MAIN world ethereum bridge.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'WALLET_REQUEST') return false

  callBridge(message.method, message.params ?? [])
    .then((result) => sendResponse({ result }))
    .catch((err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }))

  return true // keep channel open for async response
})

// ─── Market Detection ─────────────────────────────────────────────────────────

const TWEET_SELECTOR = 'article[data-testid="tweet"]'

function scanForMarkets(root: Element | Document = document): void {
  const tweets = Array.from(root.querySelectorAll<Element>(TWEET_SELECTOR))
  if (root instanceof Element && root.matches(TWEET_SELECTOR)) tweets.unshift(root)

  for (const tweet of tweets) {
    const market = detectMarketInTweet(tweet)
    if (market) injectBetButton(tweet, market, handleBetClick)
  }
}

function handleBetClick(market: DetectedMarket): void {
  console.log('[Scoop] Bet clicked:', market)
  // Ask the background worker to open the popup window and store the market
  chrome.runtime.sendMessage({ type: 'OPEN_PANEL', payload: market })
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

let observer: MutationObserver | null = null

function startObserver(): void {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) scanForMarkets(node)
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  console.log('[Scoop] MutationObserver started')
}

// ─── Init ─────────────────────────────────────────────────────────────────────

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
