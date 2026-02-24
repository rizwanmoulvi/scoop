/**
 * overlay.tsx
 *
 * Injects a Shadow DOM overlay into Twitter's page and mounts
 * the Scoop panel inside it.  Because the content script runs
 * in the MAIN world (with window.ethereum accessible) we can
 * talk to MetaMask directly — no proxy needed.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Panel } from '../panel/Panel'
import type { DetectedMarket } from '../types/market'

// Import compiled Tailwind CSS as a string so we can inject it
// into the shadow root (keeps Twitter styles isolated).
import panelCSS from '../panel/panel.css?inline'

const HOST_ID = 'scoop-shadow-host'

let shadowRoot: ShadowRoot | null = null
let reactRoot: Root | null = null
let currentMarket: DetectedMarket | null = null

function getOrCreateHost(): { host: HTMLDivElement; shadow: ShadowRoot } {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null

  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID

    // Position the host as a fixed drawer on the right of the screen.
    // These styles live in the light-DOM so Twitter cannot override them
    // via cascading (shadow DOM isolates the content inside).
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '360px',
      height: '100vh',
      zIndex: '2147483647',
      border: 'none',
      margin: '0',
      padding: '0',
      overflow: 'hidden',
      pointerEvents: 'none', // will be set to 'auto' when visible
    })

    document.body.appendChild(host)

    const shadow = host.attachShadow({ mode: 'open' })

    // Inject compiled Tailwind / panel styles into the shadow root
    const style = document.createElement('style')
    style.textContent = panelCSS
    shadow.appendChild(style)

    // Panel container that fills the host
    const container = document.createElement('div')
    container.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;'
    shadow.appendChild(container)

    shadowRoot = shadow
    reactRoot = createRoot(container)
  } else {
    shadowRoot = host.shadowRoot!
  }

  return { host, shadow: shadowRoot }
}

export function showOverlay(market: DetectedMarket): void {
  currentMarket = market
  const { host } = getOrCreateHost()

  host.style.pointerEvents = 'auto'
  host.style.transform = 'translateX(0)'
  host.style.transition = 'transform 0.25s ease'

  if (!reactRoot) return

  reactRoot.render(
    <React.StrictMode>
      <Panel market={market} onClose={hideOverlay} />
    </React.StrictMode>
  )
}

export function hideOverlay(): void {
  const host = document.getElementById(HOST_ID) as HTMLDivElement | null
  if (!host) return

  host.style.pointerEvents = 'none'
  host.style.transform = 'translateX(100%)'

  // Don't unmount React — keep state for a fast re-open
}

export function updateOverlayMarket(market: DetectedMarket): void {
  if (currentMarket?.marketId === market.marketId) return
  currentMarket = market

  if (!reactRoot) return
  reactRoot.render(
    <React.StrictMode>
      <Panel market={market} onClose={hideOverlay} />
    </React.StrictMode>
  )
}
