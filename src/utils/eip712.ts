/**
 * EIP-712 utilities shared across platform adapters.
 */
import type { Signer } from 'ethers'

export interface EIP712Domain {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

export type EIP712Types = Record<string, Array<{ name: string; type: string }>>

/**
 * Sign structured data using EIP-712 (eth_signTypedData_v4).
 */
export async function signTypedData(
  signer: Signer,
  domain: EIP712Domain,
  types: EIP712Types,
  value: Record<string, unknown>
): Promise<string> {
  return signer.signTypedData(domain, types, value)
}

/**
 * Compute the 32-byte expiration timestamp (current time + ttlSeconds).
 */
export function buildExpiration(ttlSeconds = 3600): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds
}
