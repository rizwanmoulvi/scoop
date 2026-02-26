/**
 * Scoop Background Service Worker
 *
 * Responsibilities:
 *  - OPEN_PANEL: store the clicked market in session storage and open a popup
 *    window (like a bank OTP window) that hosts the full betting UI.
 *  - WALLET_REQUEST: proxy JSON-RPC wallet calls from the popup back to the
 *    content script that has access to window.ethereum (via postMessage bridge).
 */
import type { DetectedMarket } from '../types/market'

type AnyMessage = {
  type: string
  payload?: unknown
  method?: string
  params?: unknown[]
}

// Track the active Twitter tab so we know where to forward wallet requests.
let activeTabId: number | null = null

// Popup window id — reuse if already open
let popupWindowId: number | null = null

// ─── Popup ────────────────────────────────────────────────────────────────────

const PANEL_URL = chrome.runtime.getURL('src/panel/index.html')
const POPUP_WIDTH = 420
const POPUP_HEIGHT = 680

async function openPopup(): Promise<void> {
  // If popup is already open, focus it
  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true })
      return
    } catch {
      // Window was closed externally
      popupWindowId = null
    }
  }

  const win = await chrome.windows.create({
    url: PANEL_URL,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true,
  })

  popupWindowId = win.id ?? null
}

// Clean up when the popup is manually closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) popupWindowId = null
})

// ─── Message Handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: AnyMessage, sender, sendResponse) => {
    switch (message.type) {
      // Content script notifies us a Bet button was clicked
      case 'OPEN_PANEL': {
        activeTabId = sender.tab?.id ?? activeTabId
        // Store market so the popup can read it from session storage
        chrome.storage.session.set({ activeMarket: message.payload as DetectedMarket }, () => {
          openPopup()
            .then(() => sendResponse({ ok: true }))
            .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }))
        })
        return true // async
      }

      // Popup panel requests a wallet JSON-RPC call; forward to the Twitter tab
      case 'WALLET_REQUEST': {
        if (activeTabId === null) {
          sendResponse({ error: 'No active Twitter tab. Click a Bet button first.' })
          return false
        }
        const walletMsg = message as { type: string; method?: string; params?: unknown[] }
        chrome.tabs.sendMessage(
          activeTabId,
          { type: 'WALLET_REQUEST', method: walletMsg.method, params: walletMsg.params },
          (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message })
            } else {
              sendResponse(response)
            }
          }
        )
        return true // async
      }

      // Panel requests an external API fetch. The background worker is not
      // subject to CORS, so we proxy all cross-origin requests through here.
      case 'API_FETCH': {
        const { url, method = 'GET', headers = {}, body } = message.payload as {
          url: string; method?: string; headers?: Record<string, string>; body?: string
        }

        console.log(`[Scoop BG] API_FETCH ${method} ${url}`)
        fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body })
          .then(async (res) => {
            // Try JSON first; fall back to text so error bodies aren't lost
            let data: unknown = null
            const text = await res.text().catch(() => '')
            try { data = text ? JSON.parse(text) : null } catch { data = text || null }
            if (!res.ok) console.warn(`[Scoop BG] API_FETCH ${res.status} ${url}`, data)
            sendResponse({ ok: res.ok, status: res.status, data })
          })
          .catch((err: unknown) => {
            console.error(`[Scoop BG] API_FETCH failed ${url}`, err)
            sendResponse({ ok: false, status: 0, error: String(err) })
          })

        return true // async
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' })
        return false
    }
  }
)

// ─── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log(`[Scoop BG] Extension ${reason}`)
})

console.log('[Scoop BG] Background service worker started')
