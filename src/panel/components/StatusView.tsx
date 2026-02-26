import React from 'react'
import { useStore } from '../store'

export function StatusView() {
  const { order, resetOrder, detectedMarket } = useStore()

  if (order.status === 'idle') return null

  const isSuccess = order.status === 'success'
  const isError = order.status === 'error'
  const isPending = !isSuccess && !isError

  const txHash = order.response?.txHash
  const orderId = order.response?.orderId

  const explorerBaseUrls: Record<string, string> = {
    probable: 'https://bscscan.com/tx/',
    predict_fun: 'https://polygonscan.com/tx/',
    opinion: 'https://bscscan.com/tx/',
  }

  const explorerBase = detectedMarket ? explorerBaseUrls[detectedMarket.platform] ?? '' : ''

  return (
    <div
      className={`rounded-2xl border-2 p-4 text-sm space-y-2 shadow-card ${
        isSuccess
          ? 'bg-green-50 border-green-400'
          : isError
          ? 'bg-red-50 border-red-400'
          : 'bg-blue-50 border-brand-300'
      }`}
    >
      {/* Status line */}
      <div className="flex items-center gap-2">
        {isPending && (
          <svg className="animate-spin h-5 w-5 text-brand-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {isSuccess && <span className="text-green-600 text-lg font-black">✓</span>}
        {isError && <span className="text-red-500 text-lg font-black">✗</span>}
        <span
          className={`font-extrabold ${
            isSuccess ? 'text-green-700' : isError ? 'text-red-600' : 'text-brand-600'
          }`}
        >
          {order.status === 'building' && 'Building order…'}
          {order.status === 'approving' && 'Approving token…'}
          {order.status === 'signing' && 'Waiting for MetaMask signature…'}
          {order.status === 'submitting' && 'Submitting to platform…'}
          {order.status === 'success' && '🎉 Order accepted!'}
          {order.status === 'error' && 'Order failed'}
        </span>
      </div>

      {/* Order ID */}
      {orderId && (
        <p className="text-xs font-bold text-ink-muted">
          Order ID: <span className="font-mono text-ink">{orderId}</span>
        </p>
      )}

      {/* Tx hash with explorer link */}
      {txHash && (
        <p className="text-xs font-bold text-ink-muted flex items-center gap-1 flex-wrap">
          Tx:{' '}
          {explorerBase ? (
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-brand-600 hover:underline break-all font-extrabold"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
          ) : (
            <span className="font-mono text-ink break-all">{txHash}</span>
          )}
        </p>
      )}

      {/* Error message */}
      {isError && order.error && (
        <p className="text-xs font-bold text-red-600">{order.error}</p>
      )}

      {/* Action buttons */}
      {(isSuccess || isError) && (
        <button
          onClick={resetOrder}
          className="text-xs font-extrabold text-brand-600 hover:underline mt-1"
        >
          {isSuccess ? 'Place another order' : 'Try again'}
        </button>
      )}
    </div>
  )
}
