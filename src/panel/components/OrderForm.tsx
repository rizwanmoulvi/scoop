import React from 'react'
import { useStore } from '../store'
import type { Outcome } from '../../types/market'
import { getAdapter } from '../../platforms'
import type { ProbableAdapter } from '../../platforms/ProbableAdapter'
import { connectWallet, ProxySigner } from '../../wallet/wallet'
import { buildExpiration } from '../../utils/eip712'

function OutcomeButton({
  outcome,
  isSelected,
  price,
  onClick,
}: {
  outcome: Outcome
  isSelected: boolean
  price?: number
  onClick: () => void
}) {
  const isYes = outcome === 'YES'
  const pct = price !== undefined ? Math.round(price * 100) : null

  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 px-4 rounded-2xl font-extrabold text-sm transition-all border-2 shadow-btn active:translate-y-0.5 ${
        isYes
          ? isSelected
            ? 'bg-yes border-yes text-white shadow-[3px_3px_0px_0px_rgba(0,60,160,0.30)]'
            : 'bg-blue-50 border-yes/50 text-yes hover:bg-blue-100'
          : isSelected
          ? 'bg-no border-no text-white shadow-[3px_3px_0px_0px_rgba(180,60,0,0.30)]'
          : 'bg-orange-50 border-no/50 text-no hover:bg-orange-100'
      }`}
    >
      {outcome}
      {pct !== null && (
        <span className="ml-1.5 text-base font-black">{pct}¢</span>
      )}
    </button>
  )
}

export function OrderForm() {
  const {
    wallet,
    detectedMarket,
    market,
    orderBook,
    selectedOutcome,
    amount,
    order,
    paperTrading,
    setSelectedOutcome,
    setAmount,
    setOrder,
    resetOrder,
    setApiKey,
  } = useStore()

  const isConnected = Boolean(wallet.address)
  const isProbable  = detectedMarket?.platform === 'probable'
  // In paper trading mode, approvals + proxy are not required
  const approvalsOk = !isProbable || paperTrading || Boolean(wallet.approvals?.allApproved)
  const proxyOk     = !isProbable || paperTrading || Boolean(wallet.proxyAddress)

  const canSubmit =
    isConnected &&
    detectedMarket !== null &&
    amount !== '' &&
    parseFloat(amount) > 0 &&
    order.status === 'idle' &&
    approvalsOk &&
    proxyOk

  // Use bestAsk from orderbook if valid (>0 and <1), otherwise fall back to midpoint probability.
  const yesMid = market?.probability ?? 0.5
  const noMid  = 1 - yesMid
  const yesAsk = orderBook?.yes?.bestAsk
  const noAsk  = orderBook?.no?.bestAsk
  const yesPrice = (yesAsk != null && yesAsk > 0 && yesAsk < 1) ? yesAsk : yesMid
  const noPrice  = (noAsk  != null && noAsk  > 0 && noAsk  < 1) ? noAsk  : noMid

  const currentPrice = selectedOutcome === 'YES' ? yesPrice : noPrice
  const estimatedShares =
    amount && parseFloat(amount) > 0 && currentPrice > 0
      ? (parseFloat(amount) / currentPrice).toFixed(2)
      : null

  const handleSubmit = async () => {
    if (!detectedMarket || !wallet.address) return

    resetOrder()
    setOrder({ status: 'building' })

    try {
      const adapter = getAdapter(detectedMarket.platform)

      const tradeInput = {
        marketId: detectedMarket.marketId,
        platform: detectedMarket.platform,
        outcome: selectedOutcome,
        price: currentPrice,
        amount,
        expiration: buildExpiration(3600),
        // For Probable: proxy wallet is the on-chain maker; EOA is the signer
        makerAddress: (isProbable && wallet.proxyAddress) ? wallet.proxyAddress : (wallet.address ?? ''),
      }

      const unsignedOrder = adapter.buildOrder(tradeInput)

      // For Probable: attach the correct clobTokenId for the chosen outcome
      // so the adapter can include it in the EIP-712 message.
      if (detectedMarket.platform === 'probable' && market?.clobTokenIds) {
        const tokenIndex = selectedOutcome === 'YES' ? 0 : 1
        const tokenId = market.clobTokenIds[tokenIndex]
        if (tokenId && unsignedOrder.extra) {
          (unsignedOrder.extra as Record<string, unknown>).tokenId = tokenId
        }
        // Inject proxy wallet address so submitOrder can use it for maker/owner
        if (wallet.proxyAddress && unsignedOrder.extra) {
          (unsignedOrder.extra as Record<string, unknown>).proxyAddress = wallet.proxyAddress
        }
      }

      // Use stored address to build signer (avoids re-prompting MetaMask).
      setOrder({ status: 'signing' })
      const signer = wallet.address
        ? new ProxySigner(wallet.address)
        : (await connectWallet()).signer

      // For Probable: obtain L1 API credentials (cached after first sign).
      if (detectedMarket.platform === 'probable') {
        let creds = wallet.apiKey
        if (!creds) {
          const probableAdapter = adapter as ProbableAdapter
          creds = await probableAdapter.getApiKey(signer)
          setApiKey(creds)
        }
        const extra = unsignedOrder.extra as Record<string, unknown>
        extra.apiKey        = creds.key
        extra.apiSecret     = creds.secret
        extra.apiPassphrase = creds.passphrase
      }

      const signedOrder = await adapter.signOrder(unsignedOrder, signer)
      setOrder({ signedOrder, status: 'submitting' })

      // Paper trading: skip the real API call, simulate success
      if (paperTrading) {
        const paperId = `PAPER-${Date.now()}`
        console.info(
          '[Scoop 📝 Paper Trade] Signed order payload (NOT submitted):',
          JSON.stringify(signedOrder, null, 2)
        )
        await new Promise((r) => setTimeout(r, 600)) // brief fake delay
        setOrder({
          response: { success: true, orderId: paperId, message: `Paper trade simulated (${paperId})` },
          status: 'success',
        })
        return
      }

      const response = await adapter.submitOrder(signedOrder, signer)
      setOrder({ response, status: response.success ? 'success' : 'error', error: response.message })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setOrder({ status: 'error', error: message })
    }
  }

  return (
    <div className="space-y-4">
      {/* Outcome selector */}
      <div>
        <label className="text-xs font-extrabold text-ink-muted uppercase tracking-widest mb-2 block">
          Your prediction
        </label>
        <div className="flex gap-2">
          <OutcomeButton
            outcome="YES"
            isSelected={selectedOutcome === 'YES'}
            price={yesPrice}
            onClick={() => setSelectedOutcome('YES')}
          />
          <OutcomeButton
            outcome="NO"
            isSelected={selectedOutcome === 'NO'}
            price={noPrice}
            onClick={() => setSelectedOutcome('NO')}
          />
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="text-xs font-extrabold text-ink-muted uppercase tracking-widest mb-2 block">
          Amount (USDC)
        </label>
        <div className="relative">
          <input
            type="number"
            min="1"
            step="1"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-white border-2 border-brand-200 rounded-2xl py-2.5 px-3 text-ink placeholder-ink-muted/50 focus:outline-none focus:border-brand-500 text-sm font-bold shadow-inner"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-extrabold text-brand-400">
            USDC
          </span>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-1.5 mt-2">
          {[10, 25, 50, 100].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="text-xs px-3 py-1.5 rounded-xl font-extrabold bg-brand-50 hover:bg-brand-100 text-brand-600 border-2 border-brand-200 transition-colors shadow-btn"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Order summary */}
      {estimatedShares && (
        <div className="text-xs font-bold flex justify-between bg-brand-50 border-2 border-brand-100 rounded-2xl px-3 py-2.5">
          <span className="text-ink-muted">Est. shares</span>
          <span className="text-ink font-extrabold">{estimatedShares}</span>
        </div>
      )}

      {/* Approvals gate for Probable */}
      {isProbable && !approvalsOk && (
        <div className="px-3 py-2 bg-yellow-50 border-2 border-yellow-400 rounded-2xl text-xs font-bold text-yellow-700">
          ⚠️ Approve tokens above before placing an order
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`w-full py-3 rounded-2xl font-extrabold text-sm border-2 shadow-btn-orange transition-all active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed ${
          paperTrading
            ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-900'
            : 'bg-orange-500 hover:bg-orange-600 border-orange-600 text-white'
        }`}
      >
        {order.status === 'building'   && 'Building order…'}
        {order.status === 'signing'    && 'Sign in MetaMask…'}
        {order.status === 'submitting' && (paperTrading ? 'Simulating…' : 'Submitting…')}
        {order.status === 'idle'       && (paperTrading
          ? `📝 Paper ${selectedOutcome} · $${amount || '0'}`
          : `Confirm ${selectedOutcome} · $${amount || '0'}`)}
        {order.status === 'success'    && (paperTrading ? '✓ Paper Trade Simulated!' : '✓ Order Placed!')}
        {order.status === 'error'      && 'Retry'}
      </button>
    </div>
  )
}
