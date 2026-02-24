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
      className={`rounded-lg border p-3 text-sm space-y-2 ${
        isSuccess
          ? 'bg-green-900/30 border-green-700/40'
          : isError
          ? 'bg-red-900/30 border-red-700/40'
          : 'bg-blue-900/20 border-blue-700/30'
      }`}
    >
      {/* Status line */}
      <div className="flex items-center gap-2">
        {isPending && (
          <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {isSuccess && <span className="text-green-400 text-base">✓</span>}
        {isError && <span className="text-red-400 text-base">✗</span>}
        <span
          className={`font-medium ${
            isSuccess ? 'text-green-300' : isError ? 'text-red-300' : 'text-blue-300'
          }`}
        >
          {order.status === 'building' && 'Building order…'}
          {order.status === 'approving' && 'Approving token…'}
          {order.status === 'signing' && 'Waiting for MetaMask signature…'}
          {order.status === 'submitting' && 'Submitting to platform…'}
          {order.status === 'success' && 'Order accepted!'}
          {order.status === 'error' && 'Order failed'}
        </span>
      </div>

      {/* Order ID */}
      {orderId && (
        <p className="text-xs text-gray-400">
          Order ID: <span className="font-mono text-gray-300">{orderId}</span>
        </p>
      )}

      {/* Tx hash with explorer link */}
      {txHash && (
        <p className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
          Tx:{' '}
          {explorerBase ? (
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue-400 hover:underline break-all"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
          ) : (
            <span className="font-mono text-gray-300 break-all">{txHash}</span>
          )}
        </p>
      )}

      {/* Error message */}
      {isError && order.error && (
        <p className="text-xs text-red-400">{order.error}</p>
      )}

      {/* Action buttons */}
      {(isSuccess || isError) && (
        <button
          onClick={resetOrder}
          className="text-xs underline text-gray-400 hover:text-gray-200 mt-1"
        >
          {isSuccess ? 'Place another order' : 'Try again'}
        </button>
      )}
    </div>
  )
}
