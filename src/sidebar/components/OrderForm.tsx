import React from 'react'
import { useStore } from '../store'
import type { Outcome } from '../../types/market'
import { getAdapter } from '../../platforms'
import { connectWallet } from '../../wallet/wallet'
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
      className={`flex-1 py-2.5 px-4 rounded-lg font-semibold text-sm transition-all border-2 ${
        isYes
          ? isSelected
            ? 'bg-yes border-yes text-white'
            : 'bg-transparent border-yes/40 text-yes hover:bg-yes/10'
          : isSelected
          ? 'bg-no border-no text-white'
          : 'bg-transparent border-no/40 text-no hover:bg-no/10'
      }`}
    >
      {outcome}
      {pct !== null && (
        <span className="ml-1.5 text-xs opacity-80">{pct}¢</span>
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
    setSelectedOutcome,
    setAmount,
    setOrder,
    resetOrder,
  } = useStore()

  const isConnected = Boolean(wallet.address)
  const canSubmit =
    isConnected &&
    detectedMarket !== null &&
    amount !== '' &&
    parseFloat(amount) > 0 &&
    order.status === 'idle'

  const yesPrice = orderBook?.yes?.bestAsk ?? market?.probability ?? 0.5
  const noPrice = orderBook?.no?.bestAsk ?? (1 - (market?.probability ?? 0.5))

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

      // Build order
      const tradeInput = {
        marketId: detectedMarket.marketId,
        platform: detectedMarket.platform,
        outcome: selectedOutcome,
        price: currentPrice,
        amount,
        expiration: buildExpiration(3600),
        makerAddress: wallet.address,
      }

      const unsignedOrder = adapter.buildOrder(tradeInput)

      // Get signer
      setOrder({ status: 'signing' })
      const { signer } = await connectWallet()

      // Sign
      const signedOrder = await adapter.signOrder(unsignedOrder, signer)
      setOrder({ signedOrder, status: 'submitting' })

      // Submit
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
        <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
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
        <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2.5 px-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
            USDC
          </span>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-1.5 mt-2">
          {[10, 25, 50, 100].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Order summary */}
      {estimatedShares && (
        <div className="text-xs text-gray-400 flex justify-between bg-gray-800/60 rounded-lg px-3 py-2">
          <span>Est. shares</span>
          <span className="text-white font-medium">{estimatedShares}</span>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-brand-600 hover:bg-brand-700 text-white"
      >
        {order.status === 'building' && 'Building order…'}
        {order.status === 'signing' && 'Sign in MetaMask…'}
        {order.status === 'submitting' && 'Submitting…'}
        {order.status === 'idle' &&
          `Confirm ${selectedOutcome} · $${amount || '0'}`}
        {order.status === 'success' && '✓ Order Placed!'}
        {order.status === 'error' && 'Retry'}
      </button>
    </div>
  )
}
