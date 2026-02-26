/**
 * BSC token approval helpers for Probable.markets trading.
 *
 * Before placing orders the PROXY WALLET (Gnosis Safe) must have three on-chain
 * allowances granted on BSC mainnet (chainId 56):
 *
 *   1. USDT → CTF Token contract  (for splitting/merging positions)
 *   2. USDT → CTF Exchange        (for trading)
 *   3. CTF Tokens → CTF Exchange  (ERC-1155 setApprovalForAll)
 *
 * IMPORTANT: The proxy wallet is the actual trader — all approvals come FROM
 * the proxy wallet address, NOT the EOA. We execute them via Safe's
 * execTransaction (see proxyWallet.ts executeFromProxy).
 *
 * Contract addresses (BSC mainnet, from developer.probable.markets):
 *   USDT:         0x364d05055614B506e2b9A287E4ac34167204cA83
 *   CTF Token:    0xc53a8b3bF7934fe94305Ed7f84a2ea8ce1028a12
 *   CTF Exchange: 0xF99F5367ce708c66F0860B77B4331301A5597c86
 */
import { proxyRequest } from './wallet'
import { executeFromProxy } from './proxyWallet'
import type { WalletSigner } from '../platforms/PredictionPlatform'

// ─── Contract addresses (BSC mainnet) ────────────────────────────────────────

const USDT_ADDRESS         = '0x364d05055614B506e2b9A287E4ac34167204cA83'
const CTF_TOKEN_ADDRESS    = '0xc53a8b3bF7934fe94305Ed7f84a2ea8ce1028a12'
const CTF_EXCHANGE_ADDRESS = '0xF99F5367ce708c66F0860B77B4331301A5597c86'

// Allowances >= 2^255 are treated as "effectively unlimited" (standard DeFi pattern).
const APPROVAL_THRESHOLD = BigInt('0x8000000000000000000000000000000000000000000000000000000000000000')

// MaxUint256 as 64-char hex (no 0x prefix) — used in approve() calldata.
const MAX_UINT256_HEX = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

// ─── ABI encoding helpers ─────────────────────────────────────────────────────

/** Left-pad an Ethereum address to a 32-byte (64-char) ABI word. */
function padAddr(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0')
}

/** allowance(address owner, address spender) → 0xdd62ed3e */
function encodeAllowanceCall(owner: string, spender: string): string {
  return '0xdd62ed3e' + padAddr(owner) + padAddr(spender)
}

/** isApprovedForAll(address owner, address operator) → 0xe985e9c5 */
function encodeIsApprovedForAllCall(owner: string, operator: string): string {
  return '0xe985e9c5' + padAddr(owner) + padAddr(operator)
}

/** approve(address spender, uint256 amount=MaxUint256) calldata — used in Safe tx */
function encodeApproveData(spender: string): string {
  return '0x095ea7b3' + padAddr(spender) + MAX_UINT256_HEX
}

/** setApprovalForAll(address operator, bool approved=true) calldata — used in Safe tx */
function encodeSetApprovalForAllData(operator: string): string {
  return '0xa22cb465' +
    padAddr(operator) +
    '0000000000000000000000000000000000000000000000000000000000000001'
}

// ─── ABI decoding helpers ─────────────────────────────────────────────────────

function decodeUint256(hex: unknown): bigint {
  if (!hex || typeof hex !== 'string' || hex.length <= 2) return 0n
  try { return BigInt(hex) } catch { return 0n }
}

function decodeBool(hex: unknown): boolean {
  if (!hex || typeof hex !== 'string' || hex.length < 2) return false
  // Result is a 32-byte word; true = ends in 1.
  return hex.replace('0x', '').slice(-1) === '1'
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ApprovalStatus {
  needsUSDTForCTF: boolean
  needsUSDTForExchange: boolean
  needsCTFForExchange: boolean
  /** true only when all three approvals are in place */
  allApproved: boolean
}

/**
 * Check the three approval states on the PROXY WALLET address.
 * Read-only — no MetaMask confirmation needed.
 */
export async function checkApprovals(proxyAddress: string): Promise<ApprovalStatus> {
  const [usdtForCTF, usdtForExchange, ctfApproved] = await Promise.all([
    proxyRequest('eth_call', [
      { to: USDT_ADDRESS, data: encodeAllowanceCall(proxyAddress, CTF_TOKEN_ADDRESS) },
      'latest',
    ]),
    proxyRequest('eth_call', [
      { to: USDT_ADDRESS, data: encodeAllowanceCall(proxyAddress, CTF_EXCHANGE_ADDRESS) },
      'latest',
    ]),
    proxyRequest('eth_call', [
      { to: CTF_TOKEN_ADDRESS, data: encodeIsApprovedForAllCall(proxyAddress, CTF_EXCHANGE_ADDRESS) },
      'latest',
    ]),
  ])

  const needsUSDTForCTF      = decodeUint256(usdtForCTF)   < APPROVAL_THRESHOLD
  const needsUSDTForExchange = decodeUint256(usdtForExchange) < APPROVAL_THRESHOLD
  const needsCTFForExchange  = !decodeBool(ctfApproved)

  return {
    needsUSDTForCTF,
    needsUSDTForExchange,
    needsCTFForExchange,
    allApproved: !needsUSDTForCTF && !needsUSDTForExchange && !needsCTFForExchange,
  }
}

/**
 * Grant missing approvals by executing Safe transactions FROM the proxy wallet.
 *
 * Each approval is executed as a Gnosis Safe transaction signed by the EOA.
 * MetaMask shows a clean EIP-712 "Sign SafeTx" modal for each.
 *
 * @param signer       WalletSigner wrapping the EOA.
 * @param proxyAddress The proxy wallet (Gnosis Safe) address.
 * @param status       Result of a previous checkApprovals() call.
 * @param onProgress   Optional callback for UI status messages.
 */
export async function grantApprovals(
  signer: WalletSigner,
  proxyAddress: string,
  status: ApprovalStatus,
  onProgress?: (message: string) => void
): Promise<void> {
  if (status.needsUSDTForCTF) {
    onProgress?.('Step 1/3 — Approve USDT for CTF Token contract…')
    await executeFromProxy(
      signer, proxyAddress, USDT_ADDRESS,
      encodeApproveData(CTF_TOKEN_ADDRESS),
      (msg) => onProgress?.(`Step 1/3 — ${msg}`)
    )
    onProgress?.('Step 1/3 — Done ✓')
  }

  if (status.needsUSDTForExchange) {
    onProgress?.('Step 2/3 — Approve USDT for CTF Exchange…')
    await executeFromProxy(
      signer, proxyAddress, USDT_ADDRESS,
      encodeApproveData(CTF_EXCHANGE_ADDRESS),
      (msg) => onProgress?.(`Step 2/3 — ${msg}`)
    )
    onProgress?.('Step 2/3 — Done ✓')
  }

  if (status.needsCTFForExchange) {
    onProgress?.('Step 3/3 — Approve CTF Tokens for Exchange…')
    await executeFromProxy(
      signer, proxyAddress, CTF_TOKEN_ADDRESS,
      encodeSetApprovalForAllData(CTF_EXCHANGE_ADDRESS),
      (msg) => onProgress?.(`Step 3/3 — ${msg}`)
    )
    onProgress?.('Step 3/3 — Done ✓')
  }
}
