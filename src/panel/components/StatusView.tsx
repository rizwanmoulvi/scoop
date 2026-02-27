import React from 'react'
import { useStore } from '../store'

export function StatusView() {
  const { order, resetOrder, detectedMarket } = useStore()

  if (order.status === 'idle') return null

  const isSuccess = order.status === 'success'
  const isError   = order.status === 'error'
  const isPending = !isSuccess && !isError

  const txHash   = order.response?.txHash
  const orderId  = order.response?.orderId

  const explorerBaseUrls: Record<string, string> = {
    probable:    'https://bscscan.com/tx/',
    predict_fun: 'https://polygonscan.com/tx/',
    opinion:     'https://bscscan.com/tx/',
  }

  const explorerBase = detectedMarket ? (explorerBaseUrls[detectedMarket.platform] ?? '') : ''

  return (
    <div className={`rounded-lg border p-4 text-sm space-y-2 ${
      isSuccess ? 'bg-white border-black'
      : isError  ? 'bg-white border-gray-400'
      :            'bg-white border-gray-200'
    }`}>
      {/* Status line */}
      <div className="flex items-center gap-2">
        {isPending && (
          <svg className="animate-spin h-4 w-4 text-black shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {isSuccess && <span className="text-black font-medium shrink-0">&#10003;</span>}
        {isError   && <span className="text-black font-medium shrink-0">&#10005;</span>}
        <span className="font-medium text-black">
          {order.status === 'building'   && 'Building order'}
          {order.status === 'approving'  && 'Setting up approvals'}
          {order.status === 'signing'    && 'Waiting for MetaMask signature'}
          {order.status === 'submitting' && 'Submitting'}
          {order.status === 'success'    && 'Order accepted'}
          {order.status === 'error'      && 'Order failed'}
        </span>
      </div>

      {/* Status message (filled/open etc) */}
      {isSuccess && order.response?.message && (
        <p className="text-xs text-gray-600 pl-6">{order.response.message}</p>
      )}

      {/* Order ID */}
      {orderId && (
        <p className="text-xs text-gray-400 pl-6">
          Order <span className="font-mono text-black">{orderId}</span>
        </p>
      )}

      {/* Tx hash */}
      {txHash && (
        <p className="text-xs text-gray-400 pl-6">
          Tx{' '}
          {explorerBase ? (
            <a
              href={`${explorerBase}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-black underline"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
          ) : (
            <span className="font-mono text-black">{txHash}</span>
          )}
        </p>
      )}

      {/* Error message */}
      {isError && order.error && (
        <p className="text-xs text-black pl-6">{order.error}</p>
      )}

      {/* Action */}
      {(isSuccess || isError) && (
        <button
          onClick={resetOrder}
          className="text-xs text-gray-400 hover:text-black underline mt-1 pl-6"
        >
          {isSuccess ? 'Place another order' : 'Try again'}
        </button>
      )}
    </div>
  )
}

