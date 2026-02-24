import React from 'react'
import { useStore } from '../store'
import { connectWallet, shortenAddress, watchWalletEvents } from '../../wallet/wallet'
import { switchNetwork, PLATFORM_CHAINS } from '../../wallet/network'

export function WalletConnect() {
  const { wallet, setWallet, detectedMarket } = useStore()

  // Watch for wallet events on mount
  React.useEffect(() => {
    const cleanup = watchWalletEvents(
      (accounts) => {
        if (accounts.length === 0) {
          setWallet({ address: null })
        } else {
          setWallet({ address: accounts[0] })
        }
      },
      (chainId) => {
        setWallet({ chainId })
      }
    )
    return cleanup
  }, [setWallet])

  const handleConnect = async () => {
    setWallet({ isConnecting: true, error: null })
    try {
      const connected = await connectWallet()

      // Switch to the required chain for this platform
      if (detectedMarket) {
        const requiredChain = PLATFORM_CHAINS[detectedMarket.platform]
        if (requiredChain && connected.chainId !== requiredChain) {
          await switchNetwork(requiredChain)
          setWallet({ address: connected.address, chainId: requiredChain, isConnecting: false })
          return
        }
      }

      setWallet({ address: connected.address, chainId: connected.chainId, isConnecting: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setWallet({ error: message, isConnecting: false })
    }
  }

  if (wallet.address) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-900/30 border border-green-700/40 rounded-lg text-sm">
        <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
        <span className="text-green-300 font-medium">{shortenAddress(wallet.address)}</span>
        {wallet.chainId && (
          <span className="ml-auto text-xs text-gray-500">Chain {wallet.chainId}</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleConnect}
        disabled={wallet.isConnecting}
        className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-brand-600 hover:bg-brand-700 active:bg-brand-700 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {wallet.isConnecting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Connecting…
          </span>
        ) : (
          '🦊 Connect MetaMask'
        )}
      </button>

      {wallet.error && (
        <p className="text-xs text-red-400 text-center px-2">{wallet.error}</p>
      )}
    </div>
  )
}
