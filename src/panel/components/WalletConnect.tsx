import React from 'react'
import { useStore } from '../store'
import { connectWallet, shortenAddress, watchWalletEvents, ProxySigner } from '../../wallet/wallet'
import { switchNetwork, PLATFORM_CHAINS } from '../../wallet/network'
import { checkProxyUsdtBalance, checkEoaApprovals, grantEoaApproval, withdrawFromProxy } from '../../wallet/approvals'
import { detectProxyWallet } from '../../wallet/proxyWallet'

const BSC_CHAIN_ID = 56

export function WalletConnect() {
  const { wallet, setWallet, detectedMarket, paperTrading } = useStore()

  // Watch for wallet events on mount
  React.useEffect(() => {
    const cleanup = watchWalletEvents(
      (accounts) => {
        if (accounts.length === 0) {
          setWallet({ address: null, approvals: null, apiKey: null, proxyAddress: null, eoaAllowanceOk: null })
        } else {
          // New account — clear state so re-check triggers
          setWallet({ address: accounts[0], proxyAddress: null, approvals: null, apiKey: null, eoaAllowanceOk: null })
        }
      },
      (chainId) => {
        setWallet({ chainId })
      }
    )
    return cleanup
  }, [setWallet])

  // ── EOA allowance check (signatureType=0 flow) ──────────────────────────────────────────

  const refreshEoaStatus = React.useCallback(
    async (eoaAddress: string) => {
      setWallet({ isCheckingApprovals: true })
      try {
        const status = await checkEoaApprovals(eoaAddress)
        setWallet({ eoaAllowanceOk: status.allApproved, isCheckingApprovals: false })
      } catch (err: unknown) {
        console.warn('[Scoop] EOA approval check failed:', err)
        setWallet({ eoaAllowanceOk: false, isCheckingApprovals: false })
      }
    },
    [setWallet]
  )

  // ── Proxy wallet detection (for withdraw-from-proxy UI) ─────────────────────

  const refreshProxy = React.useCallback(
    async (eoaAddress: string) => {
      setWallet({ error: null })
      try {
        const proxyAddr = await detectProxyWallet(eoaAddress)
        if (proxyAddr) {
          console.log('[Scoop] proxy wallet found:', proxyAddr)
          setWallet({ proxyAddress: proxyAddr })
          // Check proxy USDT balance (for withdraw-from-proxy UI)
          const bal = await checkProxyUsdtBalance(proxyAddr)
          if (bal > 0n) {
            const whole = bal / 10n ** 18n
            const frac  = (bal % 10n ** 18n) * 100n / 10n ** 18n
            setWallet({ proxyUsdtBalance: `${whole}.${frac.toString().padStart(2, '0')}` })
          }
        } else {
          console.log('[Scoop] no proxy wallet found for', eoaAddress)
          setWallet({ proxyAddress: null })
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[Scoop] proxy wallet check failed:', msg)
      }
    },
    [setWallet]
  )
  // ── Auto-check EOA allowance + proxy when address+chain are resolved ─────────
  const lastCheckedRef = React.useRef<string>('')

  React.useEffect(() => {
    if (!wallet.address || wallet.chainId !== BSC_CHAIN_ID) return
    const key = `${wallet.address}-${wallet.chainId}`
    if (lastCheckedRef.current === key) return
    lastCheckedRef.current = key
    void refreshProxy(wallet.address)
    void refreshEoaStatus(wallet.address)
  }, [wallet.address, wallet.chainId, refreshProxy, refreshEoaStatus])
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
        if (requiredChain === BSC_CHAIN_ID) {
          await refreshProxy(connected.address)
          await refreshEoaStatus(connected.address)
        }
        return
      }

      setWallet({ address: connected.address, chainId: connected.chainId, isConnecting: false })
      if (connected.chainId === BSC_CHAIN_ID) {
        await refreshProxy(connected.address)
        await refreshEoaStatus(connected.address)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setWallet({ error: message, isConnecting: false })
    }
  }

  // ── Approve USDT for CTF Exchange (EOA-direct, one-time setup) ─────────────

  const handleEoaApprove = async () => {
    if (!wallet.address) return
    setWallet({ isApprovingEoa: true, error: null, eoaApprovalStep: 'Starting…' })
    try {
      const signer = new ProxySigner(wallet.address)
      await grantEoaApproval(signer, (msg) => setWallet({ eoaApprovalStep: msg }))
      setWallet({ eoaAllowanceOk: true, isApprovingEoa: false, eoaApprovalStep: '' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Approval failed'
      setWallet({ isApprovingEoa: false, error: message, eoaApprovalStep: '' })
    }
  }

  // ── Withdraw USDT from proxy wallet back to EOA ─────────────────────────────

  const handleWithdrawFromProxy = async () => {
    if (!wallet.address || !wallet.proxyAddress) return
    setWallet({ isWithdrawingFromProxy: true, error: null, withdrawStep: 'Starting…' })
    try {
      const signer = new ProxySigner(wallet.address)
      await withdrawFromProxy(signer, wallet.proxyAddress, (msg) => setWallet({ withdrawStep: msg }))
      setWallet({ proxyUsdtBalance: null, isWithdrawingFromProxy: false, withdrawStep: '' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed'
      setWallet({ isWithdrawingFromProxy: false, error: message, withdrawStep: '' })
    }
  }

  // ── Proxy USDT balance (for withdraw-from-proxy UI) ────────────────────────

  const refreshProxyUsdtBalance = React.useCallback(async () => {
    if (!wallet.proxyAddress) return
    const bal = await checkProxyUsdtBalance(wallet.proxyAddress)
    if (bal > 0n) {
      const whole = bal / 10n ** 18n
      const frac  = (bal % 10n ** 18n) * 100n / 10n ** 18n
      setWallet({ proxyUsdtBalance: `${whole}.${frac.toString().padStart(2, '0')}` })
    } else {
      setWallet({ proxyUsdtBalance: null })
    }
  }, [wallet.proxyAddress, setWallet])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!wallet.address) {
    return (
      <div className="space-y-2">
        <button
          onClick={handleConnect}
          disabled={wallet.isConnecting}
          className="w-full py-2.5 px-4 rounded-lg font-medium text-sm bg-black hover:bg-gray-900 active:translate-y-px text-white border border-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {wallet.isConnecting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Connecting
            </span>
          ) : (
            'Connect MetaMask'
          )}
        </button>
        {wallet.error && (
          <p className="text-xs text-black px-1">{wallet.error}</p>
        )}
      </div>
    )
  }

  const isProbable = detectedMarket?.platform === 'probable'
  const onBSC      = wallet.chainId === BSC_CHAIN_ID

  return (
    <div className="space-y-2">
      {/* Address + chain */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg">
        <span className="w-2 h-2 rounded-full bg-black shrink-0" />
        <span className="text-black font-mono text-xs">{shortenAddress(wallet.address)}</span>
        {wallet.chainId && (
          <span className="ml-auto text-xs text-gray-400 tabular-nums">
            {onBSC ? 'BSC' : `Chain ${wallet.chainId}`}
          </span>
        )}
      </div>

      {/* Wrong network */}
      {isProbable && !onBSC && (
        <div className="px-3 py-2 bg-white border border-black rounded-lg text-xs text-black">
          Switch to BSC (Chain 56) to trade on Probable
        </div>
      )}

      {/* Checking approvals */}
      {isProbable && onBSC && wallet.isCheckingApprovals && !paperTrading && (
        <div className="flex items-center gap-2 px-1 text-xs text-gray-500">
          <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Checking approvals
        </div>
      )}

      {/* Approval needed */}
      {isProbable && onBSC && !wallet.isCheckingApprovals && wallet.eoaAllowanceOk === false && !wallet.isApprovingEoa && !paperTrading && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 px-1">One-time setup: approve 3 contracts to enable trading.</p>
          <button
            onClick={handleEoaApprove}
            className="w-full py-2 px-4 rounded-lg font-medium text-sm bg-black hover:bg-gray-900 active:translate-y-px text-white border border-black transition-all"
          >
            Set up approvals (1–3 transactions)
          </button>
        </div>
      )}

      {/* Approving in progress */}
      {isProbable && onBSC && wallet.isApprovingEoa && !paperTrading && (
        <div className="flex items-center gap-2 px-1 text-xs text-gray-600">
          <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>{wallet.eoaApprovalStep || 'Approving'}</span>
        </div>
      )}

      {/* Approved / ready to trade */}
      {isProbable && onBSC && (wallet.eoaAllowanceOk === true || paperTrading) && !wallet.isApprovingEoa && (
        <p className="text-xs text-gray-500 px-1">
          {paperTrading ? 'Paper mode — approvals not needed' : 'Approved — ready to trade'}
        </p>
      )}

      {/* USDT stuck in proxy wallet */}
      {isProbable && onBSC && wallet.proxyAddress && wallet.proxyUsdtBalance && !wallet.isWithdrawingFromProxy && !paperTrading && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-600">
            <span>USDT in proxy wallet</span>
            <span className="font-mono text-black">
              {wallet.proxyUsdtBalance}
              <button onClick={refreshProxyUsdtBalance} className="ml-2 text-gray-400 hover:text-black">↺</button>
            </span>
          </div>
          <button
            onClick={handleWithdrawFromProxy}
            className="w-full py-2 px-4 rounded-lg font-medium text-xs bg-white hover:bg-gray-50 text-black border border-gray-300 hover:border-gray-500 transition-all"
          >
            Withdraw USDT from proxy wallet
          </button>
        </div>
      )}

      {/* Withdrawing in progress */}
      {isProbable && onBSC && wallet.isWithdrawingFromProxy && !paperTrading && (
        <div className="flex items-center gap-2 px-1 text-xs text-gray-600">
          <svg className="animate-spin h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>{wallet.withdrawStep || 'Withdrawing'}</span>
        </div>
      )}

      {/* Error */}
      {wallet.error && (
        <p className="text-xs text-black px-1">{wallet.error}</p>
      )}
    </div>
  )
}
