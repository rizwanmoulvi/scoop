import React, { useEffect } from 'react'
import { useStore } from './store'
import { WalletConnect } from './components/WalletConnect'
import { MarketView } from './components/MarketView'
import { OrderForm } from './components/OrderForm'
import { StatusView } from './components/StatusView'
import { getAdapter } from '../platforms'
import type { DetectedMarket } from '../types/market'

/**
 * Load the active market from background storage and fetch market data.
 */
function useActiveMarket() {
  const {
    setDetectedMarket,
    setMarket,
    setOrderBook,
    setLoadingMarket,
    setMarketError,
  } = useStore()

  useEffect(() => {
    const loadMarket = async (detected: DetectedMarket) => {
      setDetectedMarket(detected)

      // '_platform' means the tweet mentioned the platform name (e.g. "probabledotmarket")
      // but contained no specific market ID — nothing to fetch.
      if (detected.marketId === '_platform') {
        setMarket(null)
        setOrderBook(null)
        setLoadingMarket(false)
        setMarketError(null)
        return
      }

      setLoadingMarket(true)
      setMarketError(null)
      setMarket(null)
      setOrderBook(null)

      try {
        const adapter = getAdapter(detected.platform)
        const [market, orderBook] = await Promise.allSettled([
          adapter.getMarket(detected.marketId),
          adapter.getOrderBook(detected.marketId),
        ])

        if (market.status === 'fulfilled') setMarket(market.value)
        else setMarketError(`Could not load market: ${market.reason?.message ?? 'Unknown error'}`)

        if (orderBook.status === 'fulfilled') setOrderBook(orderBook.value)
        // Orderbook failure is non-fatal – we can still trade with best-guess price
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load market'
        setMarketError(msg)
      } finally {
        setLoadingMarket(false)
      }
    }

    // Retrieve the active market pushed by the content script
    chrome.storage.session.get(['activeMarket'], (result) => {
      if (result.activeMarket) {
        loadMarket(result.activeMarket as DetectedMarket)
      }
    })

    // Also listen for real-time updates while sidebar is open
    const handler = (changes: chrome.storage.StorageChange, area: string) => {
      if (area === 'session' && changes.activeMarket?.newValue) {
        loadMarket(changes.activeMarket.newValue as DetectedMarket)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [setDetectedMarket, setLoadingMarket, setMarket, setMarketError, setOrderBook])
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-4">
      <div className="text-4xl"></div>
      <div>
        <h2 className="text-base font-semibold text-white mb-1">No market selected</h2>
        <p className="text-sm text-gray-400">
          Navigate to Twitter/X and click a <strong className="text-gray-300">Bet</strong> button
          next to a prediction market link.
        </p>
      </div>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App() {
  useActiveMarket()

  const { detectedMarket, order, wallet } = useStore()
  const showEmptyState = !detectedMarket
  const hasRealMarket = detectedMarket && detectedMarket.marketId !== '_platform'
  const showOrderForm = hasRealMarket && wallet.address && order.status !== 'success'

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-lg"></span>
        <h1 className="text-sm font-bold text-white tracking-tight">Scoop</h1>
        <span className="ml-auto text-xs text-gray-600">v0.1</span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-5">
        {showEmptyState ? (
          <EmptyState />
        ) : (
          <>
            {/* Market info */}
            <section>
              <MarketView />
            </section>

            <div className="border-t border-gray-800" />

            {/* Wallet */}
            <section>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Wallet</p>
              <WalletConnect />
            </section>

            {/* Order form – only when wallet connected */}
            {showOrderForm && (
              <>
                <div className="border-t border-gray-800" />
                <section>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Place Order</p>
                  <OrderForm />
                </section>
              </>
            )}

            {/* Status */}
            {order.status !== 'idle' && (
              <>
                <div className="border-t border-gray-800" />
                <section>
                  <StatusView />
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
