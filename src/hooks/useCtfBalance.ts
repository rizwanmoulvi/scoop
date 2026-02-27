import { useState, useEffect, useRef } from 'react'

const CTF_TOKEN_ADDR = '0x364d05055614B506e2b9A287E4ac34167204cA83'
const BSC_RPC        = 'https://bsc-dataseed1.binance.org'
// Refresh every 30 s while the panel is open
const POLL_INTERVAL  = 30_000

export interface CtfBalance {
  /** Human-readable, e.g. "4.6700" — null if zero or error */
  yes: string | null
  no:  string | null
}

async function fetchBalance(eoaAddress: string, tokenId: string): Promise<string | null> {
  try {
    const addr = eoaAddress.slice(2).toLowerCase().padStart(64, '0')
    const tid  = BigInt(tokenId).toString(16).padStart(64, '0')
    const data = '0x00fdd58e' + addr + tid

    const res  = await fetch(BSC_RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method:  'eth_call',
        params:  [{ to: CTF_TOKEN_ADDR, data }, 'latest'],
      }),
    })
    const json = await res.json()
    const raw  = json?.result
    if (!raw || raw === '0x') return null

    const wei = BigInt(raw)
    if (wei === 0n) return null

    const whole = wei / 10n ** 18n
    const frac  = (wei % 10n ** 18n) * 10000n / 10n ** 18n
    return `${whole}.${frac.toString().padStart(4, '0')}`
  } catch {
    return null
  }
}

export function useCtfBalance(
  eoaAddress: string | null,
  clobTokenIds?: string[],
): CtfBalance {
  const [balance, setBalance] = useState<CtfBalance>({ yes: null, no: null })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!eoaAddress || !clobTokenIds?.length) {
      setBalance({ yes: null, no: null })
      return
    }

    const [yesId, noId] = clobTokenIds

    async function refresh() {
      const [yes, no] = await Promise.all([
        yesId ? fetchBalance(eoaAddress!, yesId) : Promise.resolve(null),
        noId  ? fetchBalance(eoaAddress!, noId)  : Promise.resolve(null),
      ])
      setBalance({ yes, no })
    }

    refresh()
    timerRef.current = setInterval(refresh, POLL_INTERVAL)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [eoaAddress, clobTokenIds?.join(',')])

  return balance
}
