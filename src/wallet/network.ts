import { proxyRequest } from './wallet'
import { SUPPORTED_NETWORKS, PLATFORM_CHAINS, type NetworkConfig } from './networkData'

export type { NetworkConfig }
export { SUPPORTED_NETWORKS, PLATFORM_CHAINS }

/**
 * Switch the wallet to a specific chain. Adds the chain if not yet known.
 */
export async function switchNetwork(chainId: number): Promise<void> {
  const hexChainId = '0x' + chainId.toString(16)

  try {
    await proxyRequest('wallet_switchEthereumChain', [{ chainId: hexChainId }])
  } catch (switchError: unknown) {
    const err = switchError as { code?: number; message?: string }
    // 4902 = chain not added yet
    if (err.code === 4902 || err.message?.includes('4902') || err.message?.includes('Unrecognized chain')) {
      const network = SUPPORTED_NETWORKS[chainId]
      if (!network) throw new Error(`Unsupported chain: ${chainId}`)

      await proxyRequest('wallet_addEthereumChain', [
        {
          chainId: hexChainId,
          chainName: network.name,
          rpcUrls: [network.rpcUrl],
          nativeCurrency: network.nativeCurrency,
          blockExplorerUrls: [network.blockExplorerUrl],
        },
      ])
    } else {
      throw switchError
    }
  }
}
