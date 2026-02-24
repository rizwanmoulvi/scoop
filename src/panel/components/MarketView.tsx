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
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>YES {yesPct}%</span>
        <span>NO {noPct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-700 overflow-hidden flex">
        <div
          className="h-full bg-yes transition-all duration-300"
          style={{ width: `${yesPct}%` }}
        />
        <div
          className="h-full bg-no transition-all duration-300"
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
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-700 rounded w-1/2" />
        <div className="h-2 bg-gray-700 rounded" />
      </div>
    )
  }

  if (marketError) {
    return (
      <div className="p-3 bg-red-900/30 border border-red-700/40 rounded-lg">
        <p className="text-red-400 text-sm">{marketError}</p>
        {detectedMarket && (
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline mt-1 block"
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
        <div className="p-3 bg-gray-800/60 border border-gray-700/40 rounded-lg space-y-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider">
            {PLATFORM_LABELS[detectedMarket.platform]}
          </p>
          {isPlatformOnly ? (
            <p className="text-sm text-gray-400">
              Platform mentioned — no specific market link detected.
            </p>
          ) : (
            <p className="text-sm text-gray-300 font-mono truncate">{detectedMarket.marketId}</p>
          )}
          <a
            href={detectedMarket.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline"
          >
            Browse markets on {PLATFORM_LABELS[detectedMarket.platform]} ↗
          </a>
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-3">
      {/* Platform badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700/40 font-medium">
          {PLATFORM_LABELS[market.platform] ?? market.platform}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            market.status === 'open'
              ? 'bg-green-900/40 text-green-400 border border-green-700/30'
              : 'bg-gray-700/40 text-gray-400 border border-gray-600/30'
          }`}
        >
          {market.status}
        </span>
      </div>

      {/* Title */}
      <h2 className="text-sm font-semibold text-white leading-snug">{market.title}</h2>

      {/* Probability */}
      <ProbabilityBar probability={market.probability} />

      {/* Volume */}
      {market.volume && market.volume !== '0' && (
        <p className="text-xs text-gray-500">
          Volume: <span className="text-gray-300">{market.volume} USDC</span>
        </p>
      )}

      {/* Resolution date */}
      {market.resolutionDate && (
        <p className="text-xs text-gray-500">
          Resolves:{' '}
          <span className="text-gray-300">
            {new Date(market.resolutionDate).toLocaleDateString()}
          </span>
        </p>
      )}

      {/* External link */}
      <a
        href={market.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-400 hover:underline"
      >
        View on {PLATFORM_LABELS[market.platform]} ↗
      </a>
    </div>
  )
}
