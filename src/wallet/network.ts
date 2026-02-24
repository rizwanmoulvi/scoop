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

/**
 * Switch the wallet to a specific chain. Adds the chain if not yet known.
 */
export async function switchNetwork(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error('No wallet found')

  const hexChainId = '0x' + chainId.toString(16)

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    })
  } catch (switchError: unknown) {
    const err = switchError as { code?: number }
    // 4902 = chain not added yet
    if (err.code === 4902) {
      const network = SUPPORTED_NETWORKS[chainId]
      if (!network) throw new Error(`Unsupported chain: ${chainId}`)

      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hexChainId,
            chainName: network.name,
            rpcUrls: [network.rpcUrl],
            nativeCurrency: network.nativeCurrency,
            blockExplorerUrls: [network.blockExplorerUrl],
          },
        ],
      })
    } else {
      throw switchError
    }
  }
}
