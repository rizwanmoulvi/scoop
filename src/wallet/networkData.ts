/**
 * Pure network configuration data — no wallet dependencies.
 * Imported by both wallet.ts (proxy) and walletDirect.ts (page context).
 */

export interface NetworkConfig {
  chainId: number
  name: string
  rpcUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  blockExplorerUrl: string
}

export const SUPPORTED_NETWORKS: Record<number, NetworkConfig> = {
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed1.binance.org/',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrl: 'https://bscscan.com',
  },
  97: {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
    nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
    blockExplorerUrl: 'https://testnet.bscscan.com',
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com/',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockExplorerUrl: 'https://polygonscan.com',
  },
}

/** Required chain per platform */
export const PLATFORM_CHAINS: Record<string, number> = {
  probable: 56,
  predict_fun: 137,
  opinion: 56,
}
