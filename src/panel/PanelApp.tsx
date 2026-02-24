/**
 * PanelApp — root component for the popup window.
 *
 * Reads the active market from chrome.storage.session (written by the background
 * worker when a Bet button is clicked) and renders the full Panel UI.
 */
import React, { useEffect, useState } from 'react'
import { Panel } from './Panel'
import type { DetectedMarket } from '../types/market'

export function PanelApp() {
  const [market, setMarket] = useState<DetectedMarket | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 1. Read market stored when the Bet button was clicked
    chrome.storage.session.get(['activeMarket'], (result) => {
      if (result.activeMarket) setMarket(result.activeMarket as DetectedMarket)
      setLoading(false)
    })

    // 2. Also react if market is updated while popup is open
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes.activeMarket?.newValue) {
        setMarket(changes.activeMarket.newValue as DetectedMarket)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0f1117]">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!market) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0f1117] text-center px-6 gap-4">
        <div className="text-4xl">🎯</div>
        <p className="text-sm text-gray-400">
          No market detected. Click a <strong className="text-gray-200">Bet</strong> button on Twitter/X first.
        </p>
      </div>
    )
  }

  return (
    <Panel
      market={market}
      onClose={() => window.close()}
    />
  )
}
