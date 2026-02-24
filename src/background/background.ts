/**
 * Scoop Background Service Worker
 *
 * Responsibilities:
 * - Handle messages from content script and sidebar
 * - Persist active market selection across sidebar open/close
 * - Open/focus the Chrome side panel when a Bet button is clicked
 * - Route messages between content script and sidebar
 */
import type { DetectedMarket } from '../types/market'
import type { BackgroundMessage } from './messageRouter'

// ─── State ───────────────────────────────────────────────────────────────────

/** Currently detected/active market (persisted in session storage) */
let activeMarket: DetectedMarket | null = null

// ─── Side Panel ──────────────────────────────────────────────────────────────

/**
 * Set the panel path globally once so every subsequent open() call
 * doesn't need to call setOptions (which adds async overhead and can
 * cause Chrome to drop the user-gesture context before open() fires).
 */
function initSidePanel(): void {
  chrome.sidePanel
    .setOptions({ path: 'src/sidebar/index.html', enabled: true })
    .catch((e) => console.error('[Scoop BG] setOptions failed:', e))
}

/**
 * Open the side panel.
 * chrome.sidePanel.open() requires windowId (not tabId).
 */
async function openSidePanel(windowId: number): Promise<void> {
  await chrome.sidePanel.open({ windowId })
}

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'OPEN_SIDEBAR': {
        const market = message.payload
        activeMarket = market
        chrome.storage.session.set({ activeMarket: market })

        // windowId is required by chrome.sidePanel.open() — tabId alone won't work
        const windowId = sender.tab?.windowId
        if (windowId !== undefined) {
          openSidePanel(windowId)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => {
              console.error('[Scoop BG] sidePanel.open failed:', err)
              sendResponse({ ok: false, error: String(err) })
            })
          return true // keep channel open for async response
        }

        sendResponse({ ok: true })
        break
      }

      case 'GET_ACTIVE_MARKET': {
        sendResponse({ ok: true, market: activeMarket })
        break
      }

      case 'SET_ACTIVE_MARKET': {
        activeMarket = message.payload
        chrome.storage.session.set({ activeMarket })
        sendResponse({ ok: true })
        break
      }

      case 'CLEAR_ACTIVE_MARKET': {
        activeMarket = null
        chrome.storage.session.remove('activeMarket')
        sendResponse({ ok: true })
        break
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' })
    }

    // Return true to indicate async response (required for chrome.runtime.onMessage)
    return true
  }
)

// ─── Extension Action Click ──────────────────────────────────────────────────

/** Clicking the extension icon also opens the side panel */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId === undefined) return
  await openSidePanel(tab.windowId)
})

// ─── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[Scoop BG] Extension ${reason}`)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
  initSidePanel()
})

// Set panel path on every service worker start (not just first install)
initSidePanel()

console.log('[Scoop BG] Background service worker started')
