import React, { useState } from 'react'
import { useStore } from '../store'
import type { Outcome } from '../../types/market'
import { getAdapter } from '../../platforms'
import type { ProbableAdapter } from '../../platforms/ProbableAdapter'
import { connectWallet, ProxySigner, proxyRequest } from '../../wallet/wallet'
import { checkEoaUsdtBalance, checkEoaApprovals, grantEoaApproval } from '../../wallet/approvals'
import { useCtfBalance } from '../../hooks/useCtfBalance'

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
  const pct = price !== undefined ? Math.round(price * 100) : null

  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all border active:translate-y-px ${
        isSelected
          ? 'bg-black border-black text-white'
          : 'bg-white border-gray-300 text-black hover:border-gray-500 hover:bg-gray-50'
      }`}
    >
      {outcome}
      {pct !== null && (
        <span className="ml-1.5 font-semibold tabular-nums">{pct}¢</span>
      )}
    </button>
  )
}

export function OrderForm() {
  const [
    tradeMode, setTradeMode,
  ] = useState<'buy' | 'sell'>('buy')

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
    setWallet,
  } = useStore()

  const ctfBalance = useCtfBalance(wallet.address, market?.clobTokenIds)
  const heldShares  = selectedOutcome === 'YES' ? ctfBalance.yes : ctfBalance.no
  const canSell     = Boolean(heldShares && parseFloat(heldShares) > 0)

  const isConnected = Boolean(wallet.address)
  const isProbable  = detectedMarket?.platform === 'probable'
  const isSell      = tradeMode === 'sell'

  const canSubmit =
    isConnected &&
    detectedMarket !== null &&
    amount !== '' &&
    parseFloat(amount) > 0 &&
    order.status === 'idle'

  // BUY uses bestAsk (maker pays), SELL uses bestBid (maker receives)
  const yesMid = market?.probability ?? 0.5
  const noMid  = 1 - yesMid
  const yesAsk = orderBook?.yes?.bestAsk
  const noAsk  = orderBook?.no?.bestAsk
  const yesBid = orderBook?.yes?.bestBid
  const noBid  = orderBook?.no?.bestBid

  const yesBuyPrice  = (yesAsk != null && yesAsk > 0 && yesAsk < 1) ? yesAsk : yesMid
  const noBuyPrice   = (noAsk  != null && noAsk  > 0 && noAsk  < 1) ? noAsk  : noMid
  const yesSellPrice = (yesBid != null && yesBid > 0 && yesBid < 1) ? yesBid : yesMid
  const noSellPrice  = (noBid  != null && noBid  > 0 && noBid  < 1) ? noBid  : noMid

  const yesPrice = isSell ? yesSellPrice : yesBuyPrice
  const noPrice  = isSell ? noSellPrice  : noBuyPrice
  const currentPrice = selectedOutcome === 'YES' ? yesPrice : noPrice

  // For BUY: est shares received. For SELL: est USDT received.
  const estimatedValue =
    amount && parseFloat(amount) > 0 && currentPrice > 0
      ? isSell
        ? (parseFloat(amount) * currentPrice).toFixed(2)   // shares * price = USDT
        : (parseFloat(amount) / currentPrice).toFixed(2)   // USDT / price = shares
      : null

  const handleSubmit = async () => {
    if (!detectedMarket || !wallet.address) return

    resetOrder()
    setOrder({ status: 'building' })

    try {
      // Guard: must be on BSC mainnet for Probable orders
      if (isProbable && !paperTrading) {
        const chainHex = (await proxyRequest('eth_chainId', [])) as string
        const chainId = parseInt(chainHex, 16)
        if (chainId !== 56) {
          throw new Error(
            `Wrong network: MetaMask is on chain ${chainId}. Please switch to BSC Mainnet (chain 56) before placing an order.`
          )
        }
      }
      const adapter = getAdapter(detectedMarket.platform)

      const tradeInput = {
        marketId: detectedMarket.marketId,
        platform: detectedMarket.platform,
        outcome: selectedOutcome,
        price: currentPrice,
        // For SELL: amount is shares to sell (passed through directly to buildOrder).
        // For BUY:  amount is USDT to spend.
        // No pre-conversion here — avoids float round-trip precision loss.
        amount,
        expiration: 0,
        makerAddress: wallet.address ?? '',
        side: isSell ? 1 : 0,
      }

      const unsignedOrder = adapter.buildOrder(tradeInput)

      // For Probable BUY orders (signatureType=0 EOA-direct flow):
      // 1. verify EOA has enough USDT
      // 2. if EOA allowance for CTF Exchange is insufficient, auto-approve MaxUint256
      if (detectedMarket.platform === 'probable' && !paperTrading) {
        const extra       = unsignedOrder.extra as Record<string, unknown>
        const sideNum     = extra?.side as number   // 0 = BUY, 1 = SELL
        const makerAmtWei = BigInt(String(extra?.makerAmount ?? '0'))

        const fmtUsdt = (wei: bigint) => {
          const whole = wei / 10n ** 18n
          const frac  = (wei % 10n ** 18n) * 100n / 10n ** 18n
          return `${whole}.${frac.toString().padStart(2, '0')}`
        }

        if (sideNum === 0 && makerAmtWei > 0n) {
          // BUY: check EOA has enough USDT
          const eoaBalance = await checkEoaUsdtBalance(wallet.address!)

          if (eoaBalance < makerAmtWei) {
            throw new Error(
              `Insufficient USDT. Need ${fmtUsdt(makerAmtWei)} USDT, have ${fmtUsdt(eoaBalance)} USDT.`
            )
          }
        }
        // SELL (sideNum === 1): no USDT needed — user spends CTF tokens

        // Check all 3 EOA approvals (USDT→CTFToken, USDT→Exchange, CTFTokens→Exchange)
        const eoaApprovals = await checkEoaApprovals(wallet.address!)
        if (!eoaApprovals.allApproved) {
          setOrder({ status: 'approving' })
          const signer = new ProxySigner(wallet.address!)
          await grantEoaApproval(signer, (msg) => setOrder({ status: 'approving', error: msg }))
          setWallet({ eoaAllowanceOk: true })
        }
      }

      // For Probable: attach the correct clobTokenId
      if (detectedMarket.platform === 'probable' && market?.clobTokenIds) {
        const tokenIndex = selectedOutcome === 'YES' ? 0 : 1
        const tokenId = market.clobTokenIds[tokenIndex]
        if (tokenId && unsignedOrder.extra) {
          (unsignedOrder.extra as Record<string, unknown>).tokenId = tokenId
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

      // ── DEBUG: log everything needed to call the API manually ──────────────
      if (detectedMarket.platform === 'probable' && wallet.apiKey) {
        const _extra = unsignedOrder.extra as Record<string, unknown>
        console.group('[Scoop 🔍 Order Debug]')
        console.log('EOA address  :', wallet.address)
        console.log('tokenId      :', _extra?.tokenId ?? '⚠️ not set')
        console.log('prob_api_key :', wallet.apiKey.key)
        console.log('prob_passphrase:', wallet.apiKey.passphrase)
        console.log('prob_secret  :', wallet.apiKey.secret, '(for HMAC — keep private)')
        console.log('Signed order :', JSON.parse(JSON.stringify(signedOrder)))
        console.log(
          'curl (template):',
          `curl "https://api.probable.markets/public/api/v1/orders/56/<ORDER_ID>?tokenId=${_extra?.tokenId ?? 'TOKEN_ID'}" \\` +
          `\n  -H "prob_address: ${wallet.address}" \\` +
          `\n  -H "prob_api_key: ${wallet.apiKey.key}" \\` +
          `\n  -H "prob_passphrase: ${wallet.apiKey.passphrase}" \\` +
          `\n  -H "prob_timestamp: <UNIX_TS>" \\` +
          `\n  -H "prob_signature: <HMAC_SIG>"`
        )
        console.groupEnd()
      }
      // ────────────────────────────────────────────────────────────────────────

      const response = await adapter.submitOrder(signedOrder, signer)
      if (!response.success) {
        setOrder({ response, status: 'error', error: response.message })
        return
      }

      // Order accepted — fetch status after a brief delay to report fill vs open.
      setOrder({ response, status: 'success' })
      const _extra2 = unsignedOrder.extra as Record<string, unknown>
      console.log(
        `[Scoop ✅ Order accepted] orderId=${response.orderId}  tokenId=${_extra2?.tokenId ?? '?'}` +
        `\n  → To query manually: GET /public/api/v1/orders/56/${response.orderId}?tokenId=${_extra2?.tokenId ?? 'TOKEN_ID'}`
      )
      if (
        detectedMarket.platform === 'probable' &&
        response.orderId &&
        wallet.apiKey
      ) {
        const extra    = unsignedOrder.extra as Record<string, unknown>
        const tokenId  = String(extra?.tokenId ?? '')
        if (tokenId) {
          setTimeout(async () => {
            try {
              const pa = adapter as import('../../platforms/ProbableAdapter').ProbableAdapter
              const orderStatus = await pa.getOrderStatus(
                response.orderId!, tokenId, wallet.apiKey!, wallet.address!
              )
              if (!orderStatus) return
              let msg: string
              if (orderStatus.status === 'FILLED') {
                const price = orderStatus.avgPrice ? ` @ $${Number(orderStatus.avgPrice).toFixed(2)}` : ''
                msg = `✓ Filled! ${orderStatus.executedQty} shares${price}`
              } else if (orderStatus.status === 'PARTIALLY_FILLED') {
                msg = `✓ Partially filled: ${orderStatus.executedQty}/${orderStatus.origQty} shares — order #${response.orderId} still open`
              } else {
                msg = `✓ Order #${response.orderId} open — waiting for match (${orderStatus.origQty} shares)`
              }
              setOrder({ response: { ...response, message: msg } })
            } catch { /* status check is best-effort */ }
          }, 2500)
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setOrder({ status: 'error', error: message })
    }
  }

  return (
    <div className="space-y-4">
      {/* BUY / SELL toggle — only shown for Probable (CLOB supports both sides) */}
      {isProbable && (
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => { setTradeMode('buy'); setAmount('') }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              !isSell ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => { setTradeMode('sell'); setAmount('') }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              isSell ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            Sell
          </button>
        </div>
      )}

      {/* Outcome selector */}
      <div>
        <label className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-2 block">
          Prediction
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
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-widest">
            {isSell ? 'Shares to sell' : 'Amount'}
          </label>
          {isSell && heldShares && (
            <span className="text-xs text-gray-400">
              Held: <span className="text-black font-medium font-mono">{heldShares}</span>
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-white border border-gray-300 rounded-lg py-2.5 px-3 text-black placeholder-gray-300 focus:outline-none focus:border-black text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {isSell ? 'shares' : 'USDT'}
          </span>
        </div>

        {/* Quick amounts */}
        {isSell && heldShares ? (
          // SELL: quick-sell fractions of held shares
          <div className="flex gap-1.5 mt-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => setAmount(((parseFloat(heldShares) * pct) / 100).toFixed(4))}
                className="text-xs px-3 py-1.5 rounded-md font-medium bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-400 transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        ) : (
          // BUY: quick USDT amounts
          <div className="flex gap-1.5 mt-2">
            {[10, 25, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className="text-xs px-3 py-1.5 rounded-md font-medium bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-400 transition-colors"
              >
                ${v}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Order summary */}
      {estimatedValue && (
        <div className="text-xs flex justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
          <span className="text-gray-400">{isSell ? 'Est. receive' : 'Est. shares'}</span>
          <span className="text-black font-medium tabular-nums">
            {isSell ? `${estimatedValue} USDT` : estimatedValue}
          </span>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`w-full py-2.5 rounded-lg font-medium text-sm border transition-all active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed ${
          paperTrading
            ? 'bg-white border-black text-black hover:bg-gray-50'
            : 'bg-black border-black text-white hover:bg-gray-900'
        }`}
      >
        {order.status === 'building'   && 'Building order'}
        {order.status === 'approving'  && 'Setting up approvals'}
        {order.status === 'depositing' && 'Depositing'}
        {order.status === 'signing'    && 'Sign in MetaMask'}
        {order.status === 'submitting' && (paperTrading ? 'Simulating' : 'Submitting')}
        {order.status === 'idle'       && (paperTrading
          ? `Paper — ${isSell ? 'Sell' : selectedOutcome} ${isSell ? `${amount || '0'} shares` : `$${amount || '0'}`}`
          : `${isSell ? 'Sell' : selectedOutcome} ${isSell ? `${amount || '0'} shares` : `$${amount || '0'}`}`)}
        {order.status === 'success'    && (paperTrading ? 'Paper trade simulated' : (order.response?.message ?? 'Order placed'))}
        {order.status === 'error'      && 'Retry'}
      </button>
    </div>
  )
}
