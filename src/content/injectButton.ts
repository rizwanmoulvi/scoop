import type { DetectedMarket } from '../types/market'

const INJECTED_ATTR = 'data-scoop-injected'
const SCOOP_BTN_CLASS = 'scoop-bet-button'

/**
 * Twitter's action bar lives in a [role="group"] inside each tweet article.
 * We select it so our button lands alongside Like / Retweet / Reply / Share.
 */
const ACTION_BAR_SELECTOR = '[role="group"]'

// ─── Button Factory ───────────────────────────────────────────────────────────

/**
 * Build a button that visually matches Twitter's action buttons (icon + label).
 * Twitter's action buttons are structured as:
 *   <button><div><div>{svg}</div><span>{label}</span></div></button>
 * We mirror that shape so layout and hover rings behave identically.
 */
function createBetButton(market: DetectedMarket): HTMLButtonElement {
  const platformLabel: Record<string, string> = {
    probable: 'Probable',
    predict_fun: 'Predict.fun',
    opinion: 'Opinion',
  }

  const btn = document.createElement('button')
  btn.className = SCOOP_BTN_CLASS
  btn.setAttribute('data-market-id', market.marketId)
  btn.setAttribute('data-platform', market.platform)
  btn.setAttribute('data-market-url', market.url)
  btn.setAttribute('aria-label', `Bet on ${platformLabel[market.platform] ?? market.platform} market`)
  btn.setAttribute('role', 'button')
  btn.type = 'button'

  btn.innerHTML = `
    <div class="${SCOOP_BTN_CLASS}__inner">
      <div class="${SCOOP_BTN_CLASS}__icon-wrap" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="${SCOOP_BTN_CLASS}__svg">
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
          <line x1="12" y1="2"  x2="12" y2="6"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="2"  y1="12" x2="6"  y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="${SCOOP_BTN_CLASS}__label">Bet</span>
    </div>
  `

  return btn
}

// ─── Injection ────────────────────────────────────────────────────────────────

/**
 * Inject a Bet button into the tweet's action bar ([role="group"]).
 * One button per tweet — guarded by INJECTED_ATTR on the article element.
 */
export function injectBetButton(
  tweetArticle: Element,
  market: DetectedMarket,
  onClick: (market: DetectedMarket) => void
): HTMLButtonElement | null {
  // Guard: only inject once per tweet
  if (tweetArticle.getAttribute(INJECTED_ATTR) === 'true') return null

  // Find the action bar within this tweet
  const actionBar = tweetArticle.querySelector(ACTION_BAR_SELECTOR)
  if (!actionBar) return null

  const btn = createBetButton(market)

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick(market)
  })

  // Append after the last action (Share button)
  actionBar.appendChild(btn)
  tweetArticle.setAttribute(INJECTED_ATTR, 'true')

  return btn
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Inject Scoop stylesheet once.
 * Mimics Twitter's action button DOM shape, sizing, and hover ring.
 */
export function injectStyles(): void {
  if (document.getElementById('scoop-styles')) return

  const style = document.createElement('style')
  style.id = 'scoop-styles'
  style.textContent = `
    /* Outer button shell — reset to match Twitter's action buttons */
    .${SCOOP_BTN_CLASS} {
      display: inline-flex;
      align-items: center;
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      cursor: pointer;
      color: rgb(83, 100, 113);
      outline: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }

    /* Inner flex row: icon bubble + label */
    .${SCOOP_BTN_CLASS}__inner {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 2px;
    }

    /* Circular hover ring — identical to Twitter's action hover */
    .${SCOOP_BTN_CLASS}__icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      transition: background 0.2s, color 0.2s;
      color: inherit;
    }

    .${SCOOP_BTN_CLASS}:hover .${SCOOP_BTN_CLASS}__icon-wrap {
      background: rgba(29, 155, 240, 0.12);
      color: rgb(29, 155, 240);
    }

    .${SCOOP_BTN_CLASS}:active .${SCOOP_BTN_CLASS}__icon-wrap {
      background: rgba(29, 155, 240, 0.22);
    }

    /* SVG icon — 18.75px matches Twitter's action SVGs */
    .${SCOOP_BTN_CLASS}__svg {
      width: 18.75px;
      height: 18.75px;
      fill: none;
      color: inherit;
    }

    /* Label — mirrors Twitter's count span */
    .${SCOOP_BTN_CLASS}__label {
      font-size: 13px;
      font-weight: 400;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1;
      color: inherit;
      transition: color 0.2s;
    }

    .${SCOOP_BTN_CLASS}:hover .${SCOOP_BTN_CLASS}__label {
      color: rgb(29, 155, 240);
    }
  `
  document.head.appendChild(style)
}
