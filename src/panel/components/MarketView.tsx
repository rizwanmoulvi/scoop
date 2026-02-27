import React from 'react'
import { useStore } from '../store'

const PLATFORM_LABELS: Record<string, string> = {
  probable:    'Probable',
  predict_fun: 'Predict.fun',
  opinion:     'Opinion',
}

function ProbabilityBar({ probability }: { probability: number }) {
  const yesPct = Math.round(probability * 100)
  const noPct  = 100 - yesPct

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-medium text-gray-500">
        <span>YES <span className="text-black font-semibold">{yesPct}%</span></span>
        <span>NO <span className="text-black font-semibold">{noPct}%</span></span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex">
        <div
          className="h-full bg-black transition-all duration-500"
          style={{ width: `${yesPct}%` }}
        />
        <div
          className="h-full bg-gray-300 transition-all duration-500"
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
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 animate-pulse">
        <div className="h-3.5 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
        <div className="h-2 bg-gray-100 rounded-full" />
      </div>
    )
  }

  if (marketError) {
    return (
      <div className="p-4 bg-white border border-gray-300 rounded-lg">
        <p className="text-black text-sm">{marketError}</p>
        {detectedMarket && (
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-black underline mt-2 block"
          >
            Open on {PLATFORM_LABELS[detectedMarket.platform]}
          </a>
        )}
      </div>
    )
  }

  if (!market) {
    if (detectedMarket) {
      const isPlatformOnly = detectedMarket.marketId === '_platform'
      return (
        <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">
            {PLATFORM_LABELS[detectedMarket.platform]}
          </p>
          {isPlatformOnly ? (
            <p className="text-sm text-gray-500">No specific market detected.</p>
          ) : (
            <p className="text-sm text-black font-mono truncate">{detectedMarket.marketId}</p>
          )}
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-black underline"
          >
            Browse markets on {PLATFORM_LABELS[detectedMarket.platform]}
          </a>
        </div>
      )
    }
    return null
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      {/* Platform + status */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">
          {PLATFORM_LABELS[market.platform] ?? market.platform}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
          market.status === 'open'
            ? 'border-black text-black'
            : 'border-gray-300 text-gray-400'
        }`}>
          {market.status === 'open' ? 'Live' : 'Closed'}
        </span>
      </div>

      {/* Title */}
      <h2 className="text-sm font-medium text-black leading-snug">{market.title}</h2>

      {/* Probability */}
      <ProbabilityBar probability={market.probability} />

      {/* Volume */}
      {market.volume && market.volume !== '0' && (
        <p className="text-xs text-gray-400">
          Volume <span className="text-black">{market.volume} USDC</span>
        </p>
      )}

      {/* Resolution date */}
      {market.resolutionDate && (
        <p className="text-xs text-gray-400">
          Resolves <span className="text-black">{new Date(market.resolutionDate).toLocaleDateString()}</span>
        </p>
      )}

      {/* Link */}
      <a
        href={market.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-gray-400 hover:text-black underline"
      >
        View on {PLATFORM_LABELS[market.platform]}
      </a>
    </div>
  )
}

