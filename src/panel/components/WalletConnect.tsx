import React from 'react'
import { useStore } from '../store'
import { connectWallet, shortenAddress, watchWalletEvents, ProxySigner } from '../../wallet/wallet'
import { switchNetwork, PLATFORM_CHAINS } from '../../wallet/network'
import { checkApprovals, grantApprovals } from '../../wallet/approvals'
import { computeProxyAddress, proxyWalletExists, createProxyWallet } from '../../wallet/proxyWallet'

const BSC_CHAIN_ID = 56

export function WalletConnect() {
  const { wallet, setWallet, detectedMarket, paperTrading } = useStore()

  // Watch for wallet events on mount
  React.useEffect(() => {
    const cleanup = watchWalletEvents(
      (accounts) => {
        if (accounts.length === 0) {
          setWallet({ address: null, approvals: null, apiKey: null, proxyAddress: null })
        } else {
          // New account — clear proxy/approvals so re-check triggers
          setWallet({ address: accounts[0], proxyAddress: null, approvals: null, apiKey: null })
        }
      },
      (chainId) => {
        setWallet({ chainId })
      }
    )
    return cleanup
  }, [setWallet])

  // ── Approval check (runs after proxy is confirmed) ──────────────────────────

  const refreshApprovals = React.useCallback(
    async (proxyAddress: string) => {
      setWallet({ isCheckingApprovals: true })
      try {
        const status = await checkApprovals(proxyAddress)
        setWallet({ approvals: status, isCheckingApprovals: false })
      } catch (err: unknown) {
        console.warn('[Scoop] approval check failed:', err)
        setWallet({ isCheckingApprovals: false })
      }
    },
    [setWallet]
  )

  // ── Proxy wallet detection ──────────────────────────────────────────────────

  const refreshProxy = React.useCallback(
    async (eoaAddress: string) => {
      try {
        const proxyAddr = await computeProxyAddress(eoaAddress)
        const exists = await proxyWalletExists(proxyAddr)
        if (exists) {
          setWallet({ proxyAddress: proxyAddr })
          await refreshApprovals(proxyAddr)
        } else {
          setWallet({ proxyAddress: null })
        }
      } catch (err: unknown) {
        console.warn('[Scoop] proxy wallet check failed:', err)
      }
    },
    [setWallet, refreshApprovals]
  )
  // ── Auto-check proxy + approvals when address+chain are resolved ─────────────
  // Use a ref to track the last (address, chainId) pair we already kicked off a
  // check for, so we don't loop infinitely when proxyAddress stays null.
  const lastCheckedRef = React.useRef<string>('')

  React.useEffect(() => {
    if (!wallet.address || wallet.chainId !== BSC_CHAIN_ID) return
    const key = `${wallet.address}-${wallet.chainId}`
    if (lastCheckedRef.current === key) return   // already checked this combo
    lastCheckedRef.current = key
    refreshProxy(wallet.address)
  }, [wallet.address, wallet.chainId, refreshProxy])
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
        if (requiredChain === BSC_CHAIN_ID) await refreshProxy(connected.address)
        return
      }

      setWallet({ address: connected.address, chainId: connected.chainId, isConnecting: false })
      if (connected.chainId === BSC_CHAIN_ID) await refreshProxy(connected.address)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setWallet({ error: message, isConnecting: false })
    }
  }

  // ── Create proxy wallet ─────────────────────────────────────────────────────

  const handleCreateProxy = async () => {
    if (!wallet.address) return
    setWallet({ isCreatingProxy: true, error: null, proxyStep: 'Starting…' })
    try {
      const signer = new ProxySigner(wallet.address)
      const proxyAddr = await createProxyWallet(signer, (msg) => {
        setWallet({ proxyStep: msg })
      })
      setWallet({ proxyAddress: proxyAddr, proxyStep: 'Checking approvals…' })
      await refreshApprovals(proxyAddr)
      setWallet({ isCreatingProxy: false, proxyStep: '' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create proxy wallet'
      setWallet({ isCreatingProxy: false, error: message, proxyStep: '' })
    }
  }

  // ── Approve tokens ──────────────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!wallet.address || !wallet.proxyAddress || !wallet.approvals) return
    setWallet({ isApprovingTokens: true, error: null, approvalStep: 'Starting…' })
    try {
      const signer = new ProxySigner(wallet.address)
      await grantApprovals(signer, wallet.proxyAddress, wallet.approvals, (msg) => {
        setWallet({ approvalStep: msg })
      })
      setWallet({ approvalStep: 'Verifying…' })
      await refreshApprovals(wallet.proxyAddress)
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
  const hasProxy   = Boolean(wallet.proxyAddress)

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

      {/* Checking proxy / approvals */}
      {isProbable && onBSC && wallet.isCheckingApprovals && !paperTrading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-2 border-brand-200 rounded-2xl text-xs font-bold text-brand-600">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {hasProxy ? 'Checking token approvals…' : 'Detecting proxy wallet…'}
        </div>
      )}

      {/* No proxy wallet — creation needed */}
      {isProbable && onBSC && !wallet.isCheckingApprovals && !wallet.isCreatingProxy && !hasProxy && !paperTrading && (
        <div className="space-y-1.5">
          <div className="px-3 py-2 bg-yellow-50 border-2 border-yellow-400 rounded-2xl text-xs font-bold text-yellow-700">
            📳 A one-time proxy wallet is required by Probable to place orders.
          </div>
          <button
            onClick={handleCreateProxy}
            className="w-full py-2.5 px-4 rounded-2xl font-extrabold text-sm bg-brand-600 hover:bg-brand-700 active:translate-y-0.5 text-white border-2 border-brand-700 shadow-btn transition-all"
          >
            🔐 Create Proxy Wallet
          </button>
        </div>
      )}

      {/* Creating proxy wallet in progress */}
      {isProbable && onBSC && wallet.isCreatingProxy && !paperTrading && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border-2 border-brand-300 rounded-2xl text-xs font-bold text-brand-700">
          <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="leading-snug">{wallet.proxyStep || 'Creating proxy wallet…'}</span>
        </div>
      )}

      {/* Approvals needed (only shown once proxy exists) */}
      {isProbable && onBSC && hasProxy && approvals && !approvals.allApproved && !wallet.isApprovingTokens && !paperTrading && (
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
      {isProbable && onBSC && hasProxy && (approvals?.allApproved || paperTrading) && (
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
