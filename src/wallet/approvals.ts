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
 *   USDT:         0x55d398326f99059fF775485246999027B3197955 (BSC-Peg USDT)
 *   CTF Token:    0x364d05055614B506e2b9A287E4ac34167204cA83
 *   CTF Exchange: 0xF99F5367ce708c66F0860B77B4331301A5597c86
 */
import { proxyRequest } from './wallet'
import { executeFromProxy } from './proxyWallet'
import type { WalletSigner } from '../platforms/PredictionPlatform'

// ─── Contract addresses (BSC mainnet) ────────────────────────────────────────

// Addresses from developer.probable.markets/api/orderbook-complete-guide
const USDT_ADDRESS         = '0x55d398326f99059fF775485246999027B3197955' // BSC-Peg USDT
const CTF_TOKEN_ADDRESS    = '0x364d05055614B506e2b9A287E4ac34167204cA83' // CTF Token (ERC-1155)
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

// ─── USDT balance + deposit helpers ──────────────────────────────────────────

/** balanceOf(address) = 0x70a08231 */
function encodeBalanceOfCall(account: string): string {
  return '0x70a08231' + padAddr(account)
}

/** transfer(address to, uint256 amount) = 0xa9059cbb */
function encodeTransferData(to: string, amountWei: bigint): string {
  return '0xa9059cbb' + padAddr(to) + amountWei.toString(16).padStart(64, '0')
}

/**
 * Check the proxy wallet's USDT balance.
 * Returns raw bigint with 18 decimals (divide by 1e18 for human-readable).
 */
export async function checkProxyUsdtBalance(proxyAddress: string): Promise<bigint> {
  const data = encodeBalanceOfCall(proxyAddress)
  try {
    const result = await proxyRequest('eth_call', [{ to: USDT_ADDRESS, data }, 'latest'])
    return decodeUint256(result as string)
  } catch {
    return 0n
  }
}

/**
 * Check the EOA's USDT balance.
 * Returns raw bigint with 18 decimals.
 */
export async function checkEoaUsdtBalance(eoaAddress: string): Promise<bigint> {
  const data = encodeBalanceOfCall(eoaAddress)
  try {
    const result = await proxyRequest('eth_call', [{ to: USDT_ADDRESS, data }, 'latest'])
    return decodeUint256(result as string)
  } catch {
    return 0n
  }
}

/**
 * Transfer USDT from the EOA to the proxy wallet.
 * amountWei is a raw 18-decimal bigint.
 */
export async function depositUsdtToProxy(
  signer: WalletSigner,
  proxyAddress: string,
  amountWei: bigint,
  onProgress?: (msg: string) => void
): Promise<void> {
  const eoaAddress = await signer.getAddress()
  const data = encodeTransferData(proxyAddress, amountWei)

  onProgress?.('Sending USDT deposit — approve in MetaMask…')
  const txHash = (await proxyRequest('eth_sendTransaction', [{
    from: eoaAddress,
    to: USDT_ADDRESS,
    data,
    gas: '0x186A0', // 100,000 gas
  }])) as string

  // Poll MetaMask for receipt (supports eth_getTransactionReceipt)
  for (let i = 0; i < 40; i++) {
    await new Promise<void>((r) => setTimeout(r, 3000))
    const elapsed = Math.round(((i + 1) * 3) )
    onProgress?.(`Waiting for confirmation… ${elapsed}s — bscscan.com/tx/${txHash.slice(0, 10)}…`)
    try {
      const receipt = (await proxyRequest('eth_getTransactionReceipt', [txHash])) as {
        status?: string
      } | null
      if (receipt?.status === '0x1') return
      if (receipt?.status === '0x0') {
        throw new Error('Transaction reverted — check BSCScan: bscscan.com/tx/' + txHash)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('Transaction reverted')) throw e
      // Ignore transient RPC errors and keep polling
    }
  }
  throw new Error(`Deposit not confirmed after 2 minutes — check BSCScan: bscscan.com/tx/${txHash}`)
}

// ─── EOA-direct approval helpers (signatureType=0 flow) ───────────────────────

export interface EoaApprovalStatus {
  needsUSDTForCTFToken: boolean
  needsUSDTForExchange: boolean
  needsCTFForExchange:  boolean
  allApproved: boolean
}

// Treat any allowance >= 2^128 as "effectively unlimited" (set-once pattern).
const EOA_THRESHOLD = BigInt('0x100000000000000000000000000000000')

/**
 * Check all three EOA approval states required for EOA-direct trading:
 *   1. USDT → CTF Token contract  (required for position crediting)
 *   2. USDT → CTF Exchange        (required for BUY orders)
 *   3. CTF Tokens → CTF Exchange  (required for SELL orders + position crediting)
 */
export async function checkEoaApprovals(eoaAddress: string): Promise<EoaApprovalStatus> {
  try {
    const [usdtForCtfRes, usdtForExRes, ctfForExRes] = await Promise.all([
      proxyRequest('eth_call', [
        { to: USDT_ADDRESS, data: encodeAllowanceCall(eoaAddress, CTF_TOKEN_ADDRESS) }, 'latest',
      ]),
      proxyRequest('eth_call', [
        { to: USDT_ADDRESS, data: encodeAllowanceCall(eoaAddress, CTF_EXCHANGE_ADDRESS) }, 'latest',
      ]),
      proxyRequest('eth_call', [
        { to: CTF_TOKEN_ADDRESS, data: encodeIsApprovedForAllCall(eoaAddress, CTF_EXCHANGE_ADDRESS) }, 'latest',
      ]),
    ])
    const needsUSDTForCTFToken = decodeUint256(usdtForCtfRes as string) < EOA_THRESHOLD
    const needsUSDTForExchange = decodeUint256(usdtForExRes  as string) < EOA_THRESHOLD
    const needsCTFForExchange  = !decodeBool(ctfForExRes as string)
    return {
      needsUSDTForCTFToken,
      needsUSDTForExchange,
      needsCTFForExchange,
      allApproved: !needsUSDTForCTFToken && !needsUSDTForExchange && !needsCTFForExchange,
    }
  } catch {
    return { needsUSDTForCTFToken: true, needsUSDTForExchange: true, needsCTFForExchange: true, allApproved: false }
  }
}

/**
 * Legacy single-value check — returns true if USDT→Exchange allowance is sufficient.
 * @deprecated Use checkEoaApprovals for the full 3-approval check.
 */
export async function checkEoaAllowanceForExchange(eoaAddress: string): Promise<bigint> {
  const data = encodeAllowanceCall(eoaAddress, CTF_EXCHANGE_ADDRESS)
  try {
    const result = await proxyRequest('eth_call', [{ to: USDT_ADDRESS, data }, 'latest'])
    return decodeUint256(result as string)
  } catch {
    return 0n
  }
}

/** Send a transaction and poll for receipt. Throws on revert or timeout. */
async function sendTxAndWait(
  label: string,
  eoaAddress: string,
  to: string,
  data: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.(`${label} — confirm in MetaMask…`)
  const txHash = (await proxyRequest('eth_sendTransaction', [{
    from: eoaAddress,
    to,
    data,
    gas: '0x186A0', // 100,000 gas
  }])) as string

  for (let i = 0; i < 40; i++) {
    await new Promise<void>((r) => setTimeout(r, 3000))
    const elapsed = (i + 1) * 3
    onProgress?.(`${label}: confirming… ${elapsed}s`)
    try {
      const receipt = (await proxyRequest('eth_getTransactionReceipt', [txHash])) as {
        status?: string
      } | null
      if (receipt?.status === '0x1') return
      if (receipt?.status === '0x0') {
        throw new Error(`${label} reverted — bscscan.com/tx/${txHash}`)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('reverted')) throw e
    }
  }
  throw new Error(`${label} not confirmed after 2 minutes — bscscan.com/tx/${txHash}`)
}

/**
 * Grant all three EOA approvals required for trading (one MetaMask tx per missing approval):
 *   1. USDT → CTF Token contract
 *   2. USDT → CTF Exchange
 *   3. CTF Tokens → CTF Exchange (setApprovalForAll)
 * Skips any approval that is already in place.
 */
export async function grantEoaApproval(
  signer: WalletSigner,
  onProgress?: (msg: string) => void
): Promise<void> {
  const eoaAddress = await signer.getAddress()
  const status = await checkEoaApprovals(eoaAddress)

  if (status.allApproved) {
    onProgress?.('All approvals already in place.')
    return
  }

  if (status.needsUSDTForCTFToken) {
    await sendTxAndWait(
      'Approving USDT for CTF Token (1/3)',
      eoaAddress, USDT_ADDRESS,
      encodeApproveData(CTF_TOKEN_ADDRESS),
      onProgress
    )
  }
  if (status.needsUSDTForExchange) {
    await sendTxAndWait(
      `Approving USDT for Exchange (${status.needsUSDTForCTFToken ? '2' : '1'}/3)`,
      eoaAddress, USDT_ADDRESS,
      encodeApproveData(CTF_EXCHANGE_ADDRESS),
      onProgress
    )
  }
  if (status.needsCTFForExchange) {
    await sendTxAndWait(
      'Approving CTF Tokens for Exchange (3/3)',
      eoaAddress, CTF_TOKEN_ADDRESS,
      encodeSetApprovalForAllData(CTF_EXCHANGE_ADDRESS),
      onProgress
    )
  }
}

/**
 * Withdraw all USDT from the proxy wallet (Gnosis Safe) back to the EOA.
 * Uses Safe's execTransaction via executeFromProxy.
 */
export async function withdrawFromProxy(
  signer: WalletSigner,
  proxyAddress: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  // First check how much USDT the proxy holds
  const balance = await checkProxyUsdtBalance(proxyAddress)
  if (balance === 0n) {
    onProgress?.('Proxy wallet has no USDT to withdraw.')
    return
  }
  const eoaAddress = await signer.getAddress()
  const transferData = encodeTransferData(eoaAddress, balance)

  onProgress?.(`Withdrawing USDT from proxy — confirm in MetaMask…`)
  // executeFromProxy fires a Safe execTransaction, internally handles confirmation
  await executeFromProxy(signer, proxyAddress, USDT_ADDRESS, transferData, onProgress)
  onProgress?.('Withdrawal complete.')
}
