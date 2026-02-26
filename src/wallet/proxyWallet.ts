/**
 * Probable proxy wallet helpers (BSC / Gnosis Safe).
 *
 * Every Probable.markets trader needs a proxy wallet — a minimal Gnosis Safe
 * deployed by the Proxy Wallet Factory. The factory address is deterministic:
 * the same EOA always gets the same proxy wallet address.
 *
 * Address usage (per developer.probable.markets docs):
 *   - Authentication headers (prob_address): EOA address
 *   - Order `maker` field:  proxy wallet address
 *   - Order `signer` field: EOA address (signs the order)
 *   - Order `owner` field:  proxy wallet address
 *
 * Token approvals must be granted BY the proxy wallet (not the EOA), because
 * the exchange checks balances and allowances on the proxy address.
 */
import { ethers } from 'ethers'
import { proxyRequest } from './wallet'
import type { WalletSigner } from '../platforms/PredictionPlatform'

// ─── Constants ────────────────────────────────────────────────────────────────

export const PROXY_WALLET_FACTORY = '0xB99159aBF0bF59a512970586F38292f8b9029924'
const ZERO           = '0x0000000000000000000000000000000000000000'
const BSC_CHAIN_ID   = 56

// Gnosis Safe EIP-712 domain typehash (no name/version — just chainId + verifyingContract)
const DOMAIN_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes('EIP712Domain(uint256 chainId,address verifyingContract)')
)

// SafeTx typehash — standard Gnosis Safe
const SAFE_TX_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
  )
)

const abiCoder = ethers.AbiCoder.defaultAbiCoder()

// ─── ABI interfaces ───────────────────────────────────────────────────────────

const factoryIface = new ethers.Interface([
  'function computeProxyAddress(address user) view returns (address)',
  'function createProxy(address paymentToken, uint256 payment, address paymentReceiver, tuple(uint8 v, bytes32 r, bytes32 s) createSig)',
])

const safeIface = new ethers.Interface([
  'function nonce() view returns (uint256)',
  'function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) returns (bool)',
])

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function ethCall(to: string, data: string): Promise<string> {
  return (await proxyRequest('eth_call', [{ to, data }, 'latest'])) as string
}

// Public BSC RPC endpoints used only for read-only polling (faster than MetaMask bridge)
const BSC_RPC_ENDPOINTS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed1.defibit.io',
]

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const rpc = BSC_RPC_ENDPOINTS[Math.floor(Math.random() * BSC_RPC_ENDPOINTS.length)]
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const data = await res.json() as { result?: unknown; error?: { message?: string } }
  if (data.error) throw new Error(data.error.message ?? 'RPC error')
  return data.result
}

async function waitForReceipt(
  txHash: string,
  onProgress?: (msg: string) => void,
  maxAttempts = 40,
  delayMs = 3000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, delayMs))
    const elapsed = Math.round(((i + 1) * delayMs) / 1000)
    onProgress?.(`Waiting for confirmation… ${elapsed}s — check BSCScan: bscscan.com/tx/${txHash.slice(0, 10)}…`)
    try {
      const receipt = (await rpcCall('eth_getTransactionReceipt', [txHash])) as {
        status?: string
      } | null
      if (receipt?.status === '0x1') return
      if (receipt?.status === '0x0') throw new Error('Transaction reverted — check BSCScan for details: bscscan.com/tx/' + txHash)
    } catch (e: unknown) {
      // Ignore transient RPC fetch errors and keep polling
      if (e instanceof Error && e.message.startsWith('Transaction reverted')) throw e
    }
  }
  throw new Error(`Transaction not confirmed after 2 minutes — check BSCScan: bscscan.com/tx/${txHash}`)
}

/** Normalize v to 27/28 */
function normalizeV(v: number): number {
  return v < 27 ? v + 27 : v
}

/** Split a 65-byte hex signature into { v, r, s } */
function splitSig(hexSig: string): { v: number; r: string; s: string } {
  const bytes = ethers.getBytes(hexSig)
  return {
    r: ethers.hexlify(bytes.slice(0, 32)),
    s: ethers.hexlify(bytes.slice(32, 64)),
    v: normalizeV(bytes[64]),
  }
}

// ─── Proxy wallet ─────────────────────────────────────────────────────────────

/**
 * Compute the deterministic proxy wallet address for a given EOA.
 * Does NOT require any transaction — view call only.
 */
export async function computeProxyAddress(eoaAddress: string): Promise<string> {
  const calldata = factoryIface.encodeFunctionData('computeProxyAddress', [eoaAddress])
  const result   = await ethCall(PROXY_WALLET_FACTORY, calldata)
  return factoryIface.decodeFunctionResult('computeProxyAddress', result)[0] as string
}

/**
 * Returns true if the proxy wallet contract is already deployed.
 * Tries MetaMask RPC first (most up-to-date), falls back to direct BSC RPC.
 */
export async function proxyWalletExists(proxyAddress: string): Promise<boolean> {
  try {
    const code = (await proxyRequest('eth_getCode', [proxyAddress, 'latest'])) as string
    return typeof code === 'string' && code !== '0x' && code.length > 2
  } catch {
    const code = (await rpcCall('eth_getCode', [proxyAddress, 'latest'])) as string
    return typeof code === 'string' && code !== '0x' && code.length > 2
  }
}

/**
 * Create the proxy wallet for the EOA.
 *
 * Signs via eth_signTypedData_v4 (EIP-712). MetaMask computes
 * keccak256("\x19\x01" || domainSeparator || structHash) internally and
 * signs the raw digest — exactly what the factory's ecrecover expects.
 *
 * Domain: { chainId: 56, verifyingContract: FACTORY } — no name/version.
 * Type:   CreateProxy(address user, address paymentToken, uint256 payment, address paymentReceiver)
 */
export async function createProxyWallet(
  signer: WalletSigner,
  onProgress?: (msg: string) => void
): Promise<string> {
  const eoaAddress = await signer.getAddress()

  onProgress?.('Computing proxy wallet address…')
  const proxyAddress = await computeProxyAddress(eoaAddress)

  if (await proxyWalletExists(proxyAddress)) {
    return proxyAddress
  }

  onProgress?.('Sign the proxy wallet creation in MetaMask…')
  const signature = await signer.signTypedData(
    { chainId: BSC_CHAIN_ID, verifyingContract: PROXY_WALLET_FACTORY },
    {
      CreateProxy: [
        { name: 'user',            type: 'address' },
        { name: 'paymentToken',    type: 'address' },
        { name: 'payment',         type: 'uint256' },
        { name: 'paymentReceiver', type: 'address' },
      ],
    },
    { user: eoaAddress, paymentToken: ZERO, payment: 0n, paymentReceiver: ZERO }
  )

  const { v, r, s } = splitSig(signature)

  onProgress?.('Creating proxy wallet — confirm in MetaMask…')
  const calldata = factoryIface.encodeFunctionData('createProxy', [ZERO, 0n, ZERO, { v, r, s }])
  const txHash   = (await proxyRequest('eth_sendTransaction', [{
    from: eoaAddress,
    to:   PROXY_WALLET_FACTORY,
    data: calldata,
    gas:  '0x47E00',  // 294,400 — enough for Safe proxy deployment on BSC
  }])) as string

  onProgress?.('Sent — waiting for BSC confirmation…')
  await waitForReceipt(txHash, onProgress)

  // Transaction confirmed with status 0x1 — the proxy is deployed.
  // We trust the receipt; don't re-check eth_getCode (public RPC nodes lag).
  return proxyAddress
}

// ─── Safe transaction execution ───────────────────────────────────────────────

/**
 * Compute the Gnosis Safe domain separator for a deployed proxy wallet.
 */
function safeDomainSeparator(proxyAddress: string): string {
  return ethers.keccak256(
    abiCoder.encode(
      ['bytes32', 'uint256', 'address'],
      [DOMAIN_TYPEHASH, BSC_CHAIN_ID, proxyAddress]
    )
  )
}

/**
 * Get the current Safe nonce (monotonically increasing, used to prevent replay).
 */
export async function safeNonce(proxyAddress: string): Promise<bigint> {
  const calldata = safeIface.encodeFunctionData('nonce', [])
  const result   = await ethCall(proxyAddress, calldata)
  return BigInt(result)
}

/**
 * Execute a single call FROM the proxy wallet (Gnosis Safe) as the EOA owner.
 *
 * Uses EIP-712 typed data signing for the SafeTx — MetaMask shows a clean,
 * structured "Sign SafeTx" modal (no scary "This request may be dangerous" warnings).
 *
 * The Safe signature format for `execTransaction` is: r + s + v (65 bytes).
 * Threshold-1 Safes accept a single ECDSA signature from the owner.
 */
export async function executeFromProxy(
  signer: WalletSigner,
  proxyAddress: string,
  to: string,
  data: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const eoaAddress = await signer.getAddress()
  const nonce      = await safeNonce(proxyAddress)

  // ── Sign the SafeTx with EIP-712 ──────────────────────────────────────────
  const signature = await signer.signTypedData(
    { chainId: BSC_CHAIN_ID, verifyingContract: proxyAddress },
    {
      SafeTx: [
        { name: 'to',              type: 'address' },
        { name: 'value',           type: 'uint256' },
        { name: 'data',            type: 'bytes'   },
        { name: 'operation',       type: 'uint8'   },
        { name: 'safeTxGas',       type: 'uint256' },
        { name: 'baseGas',         type: 'uint256' },
        { name: 'gasPrice',        type: 'uint256' },
        { name: 'gasToken',        type: 'address' },
        { name: 'refundReceiver',  type: 'address' },
        { name: 'nonce',           type: 'uint256' },
      ],
    },
    {
      to,
      value:          0n,
      data,
      operation:      0,
      safeTxGas:      0n,
      baseGas:        0n,
      gasPrice:       0n,
      gasToken:       ZERO,
      refundReceiver: ZERO,
      nonce,
    }
  )

  // Re-assemble the 65-byte signature with normalised v (Gnosis Safe expects 27/28)
  const { v, r, s } = splitSig(signature)
  const sigBytes = ethers.concat([r, s, new Uint8Array([v])])

  // ── Call execTransaction on the proxy wallet ──────────────────────────────
  const calldata = safeIface.encodeFunctionData('execTransaction', [
    to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, sigBytes,
  ])

  onProgress?.('Sending transaction from proxy wallet — confirm in MetaMask…')
  const txHash = (await proxyRequest('eth_sendTransaction', [{
    from: eoaAddress,
    to:   proxyAddress,
    data: calldata,
    gas:  '0x1D4C0',  // 120,000 — enough for Safe execTransaction on BSC
  }])) as string

  onProgress?.('Sent — waiting for BSC confirmation…')
  await waitForReceipt(txHash, onProgress)
}

// Export SAFE_TX_TYPEHASH for use in tests / diagnostics
export { SAFE_TX_TYPEHASH, safeDomainSeparator }
