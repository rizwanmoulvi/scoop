import React from 'react'
import { useStore } from '../store'

const PLATFORM_LABELS: Record<string, string> = {
  probable: 'Probable',
  predict_fun: 'Predict.fun',
  opinion: 'Opinion',
}

function ProbabilityBar({ probability }: { probability: number }) {
  const yesPct = Math.round(probability * 100)
  const noPct = 100 - yesPct

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-extrabold">
        <span className="text-yes">YES {yesPct}%</span>
        <span className="text-no">NO {noPct}%</span>
      </div>
      <div className="h-4 rounded-full bg-gray-200 border-2 border-ink/10 overflow-hidden flex shadow-inner">
        <div
          className="h-full bg-yes transition-all duration-500 rounded-l-full"
          style={{ width: `${yesPct}%` }}
        />
        <div
          className="h-full bg-no transition-all duration-500 rounded-r-full"
          style={{ width: `${noPct}%` }}
        />
      </div>
    </div>
  )
}

export function MarketView() {
  const { market, isLoadingMarket, marketError, detectedMarket } = useStore()

  if (isLoadingMarket) {
    return (
      <div className="bg-white border-2 border-brand-100 rounded-2xl p-4 space-y-3 animate-pulse shadow-card">
        <div className="h-4 bg-brand-100 rounded-xl w-3/4" />
        <div className="h-3 bg-brand-100 rounded-xl w-1/2" />
        <div className="h-4 bg-brand-100 rounded-full" />
      </div>
    )
  }

  if (marketError) {
    return (
      <div className="p-4 bg-red-50 border-2 border-red-400 rounded-2xl shadow-card">
        <p className="text-red-600 text-sm font-bold">{marketError}</p>
        {detectedMarket && (
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:underline mt-2 block font-bold"
          >
            Open on {PLATFORM_LABELS[detectedMarket.platform]} ↗
          </a>
        )}
      </div>
    )
  }

  if (!market) {
    if (detectedMarket) {
      const isPlatformOnly = detectedMarket.marketId === '_platform'
      return (
        <div className="p-4 bg-white border-2 border-brand-200 rounded-2xl shadow-card space-y-2">
          <p className="text-xs font-extrabold text-ink-muted uppercase tracking-widest">
            {PLATFORM_LABELS[detectedMarket.platform]}
          </p>
          {isPlatformOnly ? (
            <p className="text-sm text-ink-light font-semibold">
              Platform mentioned — no specific market link detected.
            </p>
          ) : (
            <p className="text-sm text-ink font-mono truncate">{detectedMarket.marketId}</p>
          )}
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:underline font-bold"
          >
            Browse markets on {PLATFORM_LABELS[detectedMarket.platform]} ↗
          </a>
        </div>
      )
    }
    return null
  }

  return (
    <div className="bg-white border-2 border-brand-200 rounded-2xl p-4 space-y-3 shadow-card">
      {/* Platform badge + status */}
      <div className="flex items-center gap-2">
        <span className="text-xs px-2.5 py-1 rounded-full bg-brand-600 text-white font-extrabold shadow-btn">
          {PLATFORM_LABELS[market.platform] ?? market.platform}
        </span>
        <span
          className={`text-xs px-2.5 py-1 rounded-full font-extrabold border-2 ${
            market.status === 'open'
              ? 'bg-green-100 text-green-700 border-green-400'
              : 'bg-gray-100 text-gray-500 border-gray-300'
          }`}
        >
          {market.status === 'open' ? '🟢 Live' : '🔒 Closed'}
        </span>
      </div>

      {/* Title */}
      <h2 className="text-sm font-extrabold text-ink leading-snug">{market.title}</h2>

      {/* Probability */}
      <ProbabilityBar probability={market.probability} />

      {/* Volume */}
      {market.volume && market.volume !== '0' && (
        <p className="text-xs text-ink-muted font-semibold">
          Volume: <span className="text-ink font-extrabold">{market.volume} USDC</span>
        </p>
      )}

      {/* Resolution date */}
      {market.resolutionDate && (
        <p className="text-xs text-ink-muted font-semibold">
          Resolves:{' '}
          <span className="text-ink font-extrabold">
            {new Date(market.resolutionDate).toLocaleDateString()}
          </span>
        </p>
      )}

      {/* External link */}
      <a
        href={market.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs font-extrabold text-brand-600 hover:text-brand-700 hover:underline"
      >
        View on {PLATFORM_LABELS[market.platform]} ↗
      </a>
    </div>
  )
}
