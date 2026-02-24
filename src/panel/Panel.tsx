import React, { useEffect } from 'react'
import { useStore } from './store'
import { WalletConnect } from './components/WalletConnect'
import { MarketView } from './components/MarketView'
import { OrderForm } from './components/OrderForm'
import { StatusView } from './components/StatusView'
import { getAdapter } from '../platforms'
import type { DetectedMarket } from '../types/market'

interface PanelProps {
  market: DetectedMarket
  onClose: () => void
}

/**
 * Load the detected market and fetch its details from the platform API.
 */
function useMarketLoader(detected: DetectedMarket) {
  const {
    setDetectedMarket,
    setMarket,
    setOrderBook,
    setLoadingMarket,
    setMarketError,
  } = useStore()

  useEffect(() => {
    setDetectedMarket(detected)

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

    const adapter = getAdapter(detected.platform)

    Promise.allSettled([
      adapter.getMarket(detected.marketId),
      adapter.getOrderBook(detected.marketId),
    ]).then(([marketResult, orderBookResult]) => {
      if (marketResult.status === 'fulfilled') setMarket(marketResult.value)
      else setMarketError(`Could not load market: ${marketResult.reason?.message ?? 'Unknown error'}`)

      if (orderBookResult.status === 'fulfilled') setOrderBook(orderBookResult.value)
      // orderbook failure is non-fatal
    }).catch((err: unknown) => {
      setMarketError(err instanceof Error ? err.message : 'Failed to load market')
    }).finally(() => {
      setLoadingMarket(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected.marketId, detected.platform])
}

export function Panel({ market, onClose }: PanelProps) {
  useMarketLoader(market)

  const { detectedMarket, order, wallet } = useStore()
  const hasRealMarket = detectedMarket && detectedMarket.marketId !== '_platform'
  const showOrderForm = hasRealMarket && wallet.address && order.status !== 'success'

  return (
    <div
      id="scoop-panel-inner"
      className="flex flex-col h-full bg-[#0f1117] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-lg">🎯</span>
        <h1 className="text-sm font-bold text-white tracking-tight">Scoop</h1>
        <span className="ml-auto text-xs text-gray-600">v0.1</span>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="ml-2 text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scrollbar-thin">
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

        {/* Order form — only when wallet connected */}
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
      </main>
    </div>
  )
}
