/**
 * Scoop Ethereum Bridge — runs in MAIN world.
 *
 * The ISOLATED world content script cannot access window.ethereum (MetaMask
 * lives in the page's JS context, not the extension sandbox).  This tiny
 * script runs in MAIN world, where window.ethereum is available.
 *
 * Protocol:
 *   Isolated → Main  : window.postMessage({ __scoop: true, id, method, params })
 *   Main → Isolated  : window.postMessage({ __scoop_res: true, id, result?, error? })
 *
 * The nonce-based id prevents collisions between concurrent requests.
 */

window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  const msg = event.data
  if (!msg || msg.__scoop !== true) return

  const { id, method, params } = msg as {
    id: string
    method: string
    params: unknown[]
    __scoop: true
  }

  const ethereum = (window as unknown as {
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
  }).ethereum

  if (!ethereum) {
    window.postMessage({ __scoop_res: true, id, error: 'MetaMask not installed' }, '*')
    return
  }

  try {
    const result = await ethereum.request({ method, params: params ?? [] })
    window.postMessage({ __scoop_res: true, id, result }, '*')
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    window.postMessage({ __scoop_res: true, id, error }, '*')
  }
})

console.log('[Scoop Bridge] Ethereum bridge ready')
