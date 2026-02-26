import React from 'react'
import { useStore } from '../store'
import { connectWallet, shortenAddress, watchWalletEvents } from '../../wallet/wallet'
import { switchNetwork, PLATFORM_CHAINS } from '../../wallet/network'
import { checkApprovals, grantApprovals } from '../../wallet/approvals'

const BSC_CHAIN_ID = 56

export function WalletConnect() {
  const { wallet, setWallet, detectedMarket, paperTrading } = useStore()

  // Watch for wallet events on mount
  React.useEffect(() => {
    const cleanup = watchWalletEvents(
      (accounts) => {
        if (accounts.length === 0) {
          setWallet({ address: null, approvals: null, apiKey: null })
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

  // ── Approval check ──────────────────────────────────────────────────────────

  const refreshApprovals = React.useCallback(
    async (address: string) => {
      setWallet({ isCheckingApprovals: true })
      try {
        const status = await checkApprovals(address)
        setWallet({ approvals: status, isCheckingApprovals: false })
      } catch (err: unknown) {
        console.warn('[Scoop] approval check failed:', err)
        setWallet({ isCheckingApprovals: false })
      }
    },
    [setWallet]
  )

  // ── Connect ─────────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setWallet({ isConnecting: true, error: null })
    try {
      const connected = await connectWallet()

      const requiredChain = detectedMarket
        ? (PLATFORM_CHAINS[detectedMarket.platform] ?? null)
        : null

      if (requiredChain && connected.chainId !== requiredChain) {
        await switchNetwork(requiredChain)
        setWallet({ address: connected.address, chainId: requiredChain, isConnecting: false })
        if (requiredChain === BSC_CHAIN_ID) await refreshApprovals(connected.address)
        return
      }

      setWallet({ address: connected.address, chainId: connected.chainId, isConnecting: false })
      if (connected.chainId === BSC_CHAIN_ID) await refreshApprovals(connected.address)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setWallet({ error: message, isConnecting: false })
    }
  }

  // ── Approve tokens ──────────────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!wallet.address || !wallet.approvals) return
    setWallet({ isApprovingTokens: true, error: null, approvalStep: 'Starting…' })
    try {
      await grantApprovals(wallet.address, wallet.approvals, (msg) => {
        setWallet({ approvalStep: msg })
      })
      setWallet({ approvalStep: 'Verifying…' })
      await refreshApprovals(wallet.address)
      setWallet({ isApprovingTokens: false, approvalStep: '' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Approval failed'
      setWallet({ isApprovingTokens: false, error: message, approvalStep: '' })
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!wallet.address) {
    return (
      <div className="space-y-2">
        <button
          onClick={handleConnect}
          disabled={wallet.isConnecting}
          className="w-full py-3 px-4 rounded-2xl font-extrabold text-sm bg-orange-500 hover:bg-orange-600 active:translate-y-0.5 text-white border-2 border-orange-600 shadow-btn-orange transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
          <p className="text-xs text-red-500 font-bold text-center px-2">{wallet.error}</p>
        )}
      </div>
    )
  }

  const isProbable = detectedMarket?.platform === 'probable'
  const onBSC      = wallet.chainId === BSC_CHAIN_ID
  const approvals  = wallet.approvals

  return (
    <div className="space-y-2">
      {/* Address + chain */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border-2 border-green-400 rounded-2xl shadow-card">
        <span className="w-3 h-3 rounded-full bg-green-500 shrink-0 border-2 border-green-300" />
        <span className="text-green-700 font-extrabold text-sm">{shortenAddress(wallet.address)}</span>
        {wallet.chainId && (
          <span className="ml-auto text-xs font-bold text-green-500 bg-green-100 px-2 py-0.5 rounded-full">
            {onBSC ? 'BSC ✓' : `Chain ${wallet.chainId}`}
          </span>
        )}
      </div>

      {/* Wrong network */}
      {isProbable && !onBSC && (
        <div className="px-3 py-2 bg-red-50 border-2 border-red-400 rounded-2xl text-xs font-bold text-red-600">
          ⚠️ Switch to BSC (Chain 56) to trade on Probable
        </div>
      )}

      {/* Checking approvals */}
      {isProbable && onBSC && wallet.isCheckingApprovals && !paperTrading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-2 border-brand-200 rounded-2xl text-xs font-bold text-brand-600">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Checking token approvals…
        </div>
      )}

      {/* Approvals needed */}
      {isProbable && onBSC && approvals && !approvals.allApproved && !wallet.isApprovingTokens && !paperTrading && (
        <div className="space-y-1.5">
          <div className="px-3 py-2 bg-yellow-50 border-2 border-yellow-400 rounded-2xl text-xs font-bold text-yellow-700">
            ⚠️ One-time token approvals required:
            <ul className="mt-1 space-y-0.5 font-semibold">
              {approvals.needsUSDTForCTF      && <li>• USDT → CTF Token contract</li>}
              {approvals.needsUSDTForExchange && <li>• USDT → CTF Exchange</li>}
              {approvals.needsCTFForExchange  && <li>• CTF Tokens → Exchange</li>}
            </ul>
          </div>
          <button
            onClick={handleApprove}
            className="w-full py-2.5 px-4 rounded-2xl font-extrabold text-sm bg-brand-600 hover:bg-brand-700 active:translate-y-0.5 text-white border-2 border-brand-700 shadow-btn transition-all"
          >
            ✅ Approve Tokens (one-time setup)
          </button>
        </div>
      )}

      {/* Approving in progress */}
      {isProbable && onBSC && wallet.isApprovingTokens && !paperTrading && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border-2 border-brand-300 rounded-2xl text-xs font-bold text-brand-700">
          <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="leading-snug">{wallet.approvalStep || 'Approving…'}</span>
        </div>
      )}

      {/* All approved */}
      {isProbable && onBSC && (approvals?.allApproved || paperTrading) && (
        <div className="px-3 py-2 bg-green-50 border-2 border-green-300 rounded-2xl text-xs font-bold text-green-700">
          {paperTrading
            ? '📝 Paper mode — approvals not needed'
            : '✅ Token approvals in place — ready to trade'}
        </div>
      )}

      {/* Error */}
      {wallet.error && (
        <p className="text-xs text-red-500 font-bold text-center px-2">{wallet.error}</p>
      )}
    </div>
  )
}
