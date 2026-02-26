/**
 * BSC token approval helpers for Probable.markets trading.
 *
 * Before placing orders the user's EOA wallet must grant three on-chain
 * allowances on BSC mainnet (chainId 56):
 *
 *   1. USDT → CTF Token contract  (for splitting/merging positions)
 *   2. USDT → CTF Exchange        (for trading)
 *   3. CTF Tokens → CTF Exchange  (ERC-1155 setApprovalForAll)
 *
 * We route every eth_call / eth_sendTransaction through the MetaMask proxy
 * (proxyRequest) so no separate RPC endpoint is needed.
 */
import { proxyRequest } from './wallet'

// ─── Contract addresses (BSC mainnet) ────────────────────────────────────────

const USDT_ADDRESS         = '0x55d398326f99059fF775485246999027B3197955'
const CTF_TOKEN_ADDRESS    = '0x364d05055614B506e2b9A287E4ac34167204cA83'
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

/** approve(address spender, uint256 amount=MaxUint256) → 0x095ea7b3 */
function encodeApproveCall(spender: string): string {
  return '0x095ea7b3' + padAddr(spender) + MAX_UINT256_HEX
}

/** setApprovalForAll(address operator, bool approved=true) → 0xa22cb465 */
function encodeSetApprovalForAllCall(operator: string): string {
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
 * Check the three approval states without sending any transactions.
 * Uses MetaMask eth_call → goes through BSC RPC for reads.
 */
export async function checkApprovals(userAddress: string): Promise<ApprovalStatus> {
  const [usdtForCTF, usdtForExchange, ctfApproved] = await Promise.all([
    proxyRequest('eth_call', [
      { to: USDT_ADDRESS, data: encodeAllowanceCall(userAddress, CTF_TOKEN_ADDRESS) },
      'latest',
    ]),
    proxyRequest('eth_call', [
      { to: USDT_ADDRESS, data: encodeAllowanceCall(userAddress, CTF_EXCHANGE_ADDRESS) },
      'latest',
    ]),
    proxyRequest('eth_call', [
      { to: CTF_TOKEN_ADDRESS, data: encodeIsApprovedForAllCall(userAddress, CTF_EXCHANGE_ADDRESS) },
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
 * Poll for a transaction receipt until the tx is confirmed or fails.
 * Throws if the tx reverts or times out.
 */
async function waitForReceipt(
  txHash: string,
  maxAttempts = 40,
  delayMs = 3000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise<void>((r) => setTimeout(r, delayMs))
    const receipt = (await proxyRequest('eth_getTransactionReceipt', [txHash])) as {
      status?: string
    } | null

    if (receipt?.status === '0x1') return          // confirmed ✓
    if (receipt?.status === '0x0') throw new Error('Approval transaction reverted on-chain')
    // null receipt → still pending, keep polling
  }
  throw new Error('Approval transaction confirmation timed out after 2 minutes')
}

/**
 * Send the missing approval transactions in sequence.
 * Each transaction requires user confirmation in MetaMask.
 *
 * @param onProgress  Optional callback for UI status messages.
 */
export async function grantApprovals(
  userAddress: string,
  status: ApprovalStatus,
  onProgress?: (message: string) => void
): Promise<void> {
  if (status.needsUSDTForCTF) {
    onProgress?.('Step 1/3 — Approve USDT for CTF Token contract…')
    const txHash = (await proxyRequest('eth_sendTransaction', [
      { from: userAddress, to: USDT_ADDRESS, data: encodeApproveCall(CTF_TOKEN_ADDRESS) },
    ])) as string
    onProgress?.('Step 1/3 — Waiting for confirmation…')
    await waitForReceipt(txHash)
    onProgress?.('Step 1/3 — Done ✓')
  }

  if (status.needsUSDTForExchange) {
    onProgress?.('Step 2/3 — Approve USDT for CTF Exchange…')
    const txHash = (await proxyRequest('eth_sendTransaction', [
      { from: userAddress, to: USDT_ADDRESS, data: encodeApproveCall(CTF_EXCHANGE_ADDRESS) },
    ])) as string
    onProgress?.('Step 2/3 — Waiting for confirmation…')
    await waitForReceipt(txHash)
    onProgress?.('Step 2/3 — Done ✓')
  }

  if (status.needsCTFForExchange) {
    onProgress?.('Step 3/3 — Approve CTF Tokens for Exchange…')
    const txHash = (await proxyRequest('eth_sendTransaction', [
      {
        from: userAddress,
        to: CTF_TOKEN_ADDRESS,
        data: encodeSetApprovalForAllCall(CTF_EXCHANGE_ADDRESS),
      },
    ])) as string
    onProgress?.('Step 3/3 — Waiting for confirmation…')
    await waitForReceipt(txHash)
    onProgress?.('Step 3/3 — Done ✓')
  }
}
