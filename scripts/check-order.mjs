/**
 * Query a Probable Markets order by ID + check CTF token balance.
 * Fill in the 4 values from the [Scoop 🔍 Order Debug] console group,
 * then run:  node scripts/check-order.mjs
 */
import crypto from 'crypto'

// ── Fill these from the browser console ──────────────────────────────────────
const EOA_ADDRESS  = '0x106ff865177a1291fae0dada4a28e083b8d0b58d'
const API_KEY      = ''   // prob_api_key  from console
const API_SECRET   = ''   // prob_secret   from console
const PASSPHRASE   = ''   // prob_passphrase from console

const ORDER_ID     = '17710'
const TOKEN_ID     = '84862885472420082881595839912266645393318600108766608134661198571939703818046'
// ─────────────────────────────────────────────────────────────────────────────

const CHAIN_ID        = 56
const BASE_URL        = 'https://api.probable.markets'
const CTF_TOKEN_ADDR  = '0x364d05055614B506e2b9A287E4ac34167204cA83'
const BSC_RPC         = 'https://bsc-dataseed1.binance.org'

// ── 1. Check CTF token balance (no auth needed) ──────────────────────────────
async function checkCtfBalance() {
  // ERC-1155 balanceOf(address account, uint256 id) selector = 0x00fdd58e
  const addr   = EOA_ADDRESS.slice(2).toLowerCase().padStart(64, '0')
  // tokenId as 32-byte hex
  const tid    = BigInt(TOKEN_ID).toString(16).padStart(64, '0')
  const data   = '0x00fdd58e' + addr + tid

  const res  = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: CTF_TOKEN_ADDR, data }, 'latest'] }),
  })
  const json = await res.json()
  const raw  = json.result
  if (!raw || raw === '0x') return null
  const wei  = BigInt(raw)
  const whole = wei / 10n ** 18n
  const frac  = (wei % 10n ** 18n) * 10000n / 10n ** 18n
  return `${whole}.${frac.toString().padStart(4, '0')} shares (${wei.toString()} wei)`
}

console.log('\n── CTF Token Balance ────────────────────────────────')
const balance = await checkCtfBalance()
console.log('EOA   :', EOA_ADDRESS)
console.log('tokenId (short):', TOKEN_ID.slice(0, 20) + '...')
console.log('Balance:', balance ?? '0 (or RPC error)')

// ── 2. Check order status (requires credentials) ─────────────────────────────
if (!API_KEY || !API_SECRET || !PASSPHRASE) {
  console.log('\n⚠️  Fill in API_KEY, API_SECRET, PASSPHRASE to also check order status.')
  process.exit(0)
}

const path      = `/public/api/v1/orders/${CHAIN_ID}/${ORDER_ID}`
const query     = `?tokenId=${TOKEN_ID}`
const timestamp = Math.floor(Date.now() / 1000)
const message   = `${timestamp}GET${path}${query}`
const signature = crypto.createHmac('sha256', API_SECRET).update(message).digest('base64')

console.log('\n── Order Status ─────────────────────────────────────')
console.log(`GET ${BASE_URL}${path}${query}\n`)

const res = await fetch(`${BASE_URL}${path}${query}`, {
  headers: {
    'prob_address':      EOA_ADDRESS,
    'prob_signature':    signature,
    'prob_timestamp':    String(timestamp),
    'prob_api_key':      API_KEY,
    'prob_passphrase':   PASSPHRASE,
    'prob_account_type': 'eoa',
  },
})
const body = await res.json()
console.log(`HTTP ${res.status}`)

// Pretty-print with volume in millions and correct token label
if (res.ok && body) {
  const fmt = { ...body }

  // Convert any volume / size fields from raw to M USDT
  const volumeFields = ['volume', 'volumeNum', 'total', 'totalVolume', 'makerAmount', 'takerAmount']
  for (const field of volumeFields) {
    if (fmt[field] !== undefined && fmt[field] !== null) {
      const raw = parseFloat(fmt[field])
      if (!isNaN(raw) && raw > 1000) {
        fmt[field + '_fmt'] = `${(raw / 1_000_000).toFixed(2)}M USDT`
      }
    }
  }

  // Replace any stray "USDC" strings in the raw body text
  const cleaned = JSON.stringify(fmt, null, 2).replace(/"USDC"/g, '"USDT"')
  console.log(cleaned)
} else {
  console.log(JSON.stringify(body, null, 2))
}
