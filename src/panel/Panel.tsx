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

    // Chain: getMarket first, then pass clobTokenIds directly to getOrderBook.
    // Running them in parallel means getOrderBook has no clobTokenIds yet and
    // must re-fetch the market internally — avoid that double-fetch.
    adapter.getMarket(detected.marketId)
      .then(async (marketData) => {
        setMarket(marketData)
        try {
          const ob = await adapter.getOrderBook(detected.marketId, marketData.clobTokenIds)
          setOrderBook(ob)
        } catch {
          // Orderbook failure is non-fatal — market prices fall back to midpoint probability
        }
      })
      .catch((err: unknown) => {
        setMarketError(`Could not load market: ${err instanceof Error ? err.message : 'Unknown error'}`)
      })
      .finally(() => {
        setLoadingMarket(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected.marketId, detected.platform])
}

export function Panel({ market, onClose }: PanelProps) {
  useMarketLoader(market)

  const { detectedMarket, order, wallet, paperTrading, setPaperTrading } = useStore()
  const hasRealMarket = detectedMarket && detectedMarket.marketId !== '_platform'
  const showOrderForm = hasRealMarket && wallet.address && order.status !== 'success'

  return (
    <div
      id="scoop-panel-inner"
      className="flex flex-col h-full bg-white text-black"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        <h1 className="text-sm font-semibold text-black tracking-tight">Scoop</h1>
        <span className="text-xs text-gray-400 font-normal">beta</span>
        {/* Paper trading toggle */}
        <button
          onClick={() => setPaperTrading(!paperTrading)}
          title={paperTrading ? 'Disable paper trading' : 'Enable paper trading (no real money)'}
          className={`ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
            paperTrading
              ? 'bg-black border-black text-white'
              : 'bg-white border-gray-300 text-gray-500 hover:border-gray-500'
          }`}
        >
          {paperTrading ? 'Paper on' : 'Paper'}
        </button>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-black text-xs transition-colors"
        >
          ✕
        </button>
      </header>

      {/* Paper trading banner */}
      {paperTrading && (
        <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
          <span className="text-xs text-gray-600">Paper trading — orders are signed but never submitted</span>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scrollbar-thin bg-gray-50">
        {/* Market info */}
        <section>
          <MarketView />
        </section>

        {/* Wallet */}
        <section>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-2">Wallet</p>
          <WalletConnect />
        </section>

        {/* Order form — only when wallet connected */}
        {showOrderForm && (
          <section>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-2">Place Order</p>
            <OrderForm />
          </section>
        )}

        {/* Status */}
        {order.status !== 'idle' && (
          <section>
            <StatusView />
          </section>
        )}
      </main>
    </div>
  )
}
