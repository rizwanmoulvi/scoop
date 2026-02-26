/**
 * apiFetch — CORS-safe fetch for the extension panel.
 *
 * Chrome extensions cannot directly fetch cross-origin URLs from popup/panel
 * pages because the remote server doesn't set `Access-Control-Allow-Origin: *`
 * for chrome-extension:// origins.
 *
 * The background service worker is NOT subject to CORS — it can fetch any URL.
 * So we route all external fetches through the background via a message:
 *
 *   panel  →  chrome.runtime.sendMessage(API_FETCH)  →  background  →  fetch()
 *
 * Outside the extension (bot, tests, Node.js) we fall back to regular fetch().
 */

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface ApiFetchResponse {
  ok: boolean
  status: number
  data: unknown
}

/**
 * Returns true when running inside a Chrome extension context (panel/popup).
 */
function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.sendMessage === 'function' &&
    // Node.js / bot environment — chrome is not defined
    typeof window !== 'undefined'
  )
}

/**
 * Fetch a URL, routing through the background service worker when inside the
 * Chrome extension to avoid CORS errors.
 *
 * Returns the parsed JSON body.  Throws on network or HTTP errors.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  if (isExtensionContext()) {
    // Route through background service worker (no CORS restriction there)
    const response = await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      payload: { url, ...options },
    }) as { ok: boolean; status: number; data: unknown; error?: string }

    if (response?.error) {
      throw new Error(`API_FETCH error: ${response.error}`)
    }
    if (!response?.ok) {
      const detail = response?.data ? ` — ${JSON.stringify(response.data)}` : ''
      throw new Error(`HTTP ${response?.status ?? '?'}: ${url}${detail}`)
    }

    return response.data as T
  }

  // Direct fetch — used by bot (Node.js) and tests
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`)
  }

  return res.json() as Promise<T>
}
