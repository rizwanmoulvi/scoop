import React from 'react'
import { useStore } from '../store'
import type { Outcome } from '../../types/market'
import { getAdapter } from '../../platforms'
import type { ProbableAdapter } from '../../platforms/ProbableAdapter'
import { connectWallet, ProxySigner, proxyRequest } from '../../wallet/wallet'
import { checkEoaUsdtBalance, checkEoaApprovals, grantEoaApproval } from '../../wallet/approvals'

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
    setWallet,
  } = useStore()

  const isConnected = Boolean(wallet.address)
  const isProbable  = detectedMarket?.platform === 'probable'

  const canSubmit =
    isConnected &&
    detectedMarket !== null &&
    amount !== '' &&
    parseFloat(amount) > 0 &&
    order.status === 'idle'

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
        amount,
        expiration: 0,
        // For Probable: EOA is both maker and signer (signatureType=0)
        makerAddress: wallet.address ?? '',
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
          const eoaBalance = await checkEoaUsdtBalance(wallet.address!)

          if (eoaBalance < makerAmtWei) {
            throw new Error(
              `Insufficient USDT. Need ${fmtUsdt(makerAmtWei)} USDT, have ${fmtUsdt(eoaBalance)} USDT.`
            )
          }
        }

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
        {order.status === 'approving'  && 'Approving USDT…'}
        {order.status === 'depositing' && 'Depositing USDT…'}
        {order.status === 'signing'    && 'Sign in MetaMask…'}
        {order.status === 'submitting' && (paperTrading ? 'Simulating…' : 'Submitting…')}
        {order.status === 'idle'       && (paperTrading
          ? `📝 Paper ${selectedOutcome} · $${amount || '0'}`
          : `Confirm ${selectedOutcome} · $${amount || '0'}`)}
        {order.status === 'success'    && (paperTrading ? '✓ Paper Trade Simulated!' : (order.response?.message ?? '✓ Order Placed!'))}
        {order.status === 'error'      && 'Retry'}
      </button>
    </div>
  )
}
