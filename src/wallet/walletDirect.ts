/**
 * Direct wallet access — used only from content-script context (page world).
 * The content script runs inside the Twitter page, so window.ethereum is
 * injected by MetaMask and accessible directly.
 */
import { ethers, type Signer, type BrowserProvider } from 'ethers'
import type { WalletSigner } from '../platforms/PredictionPlatform'
import { SUPPORTED_NETWORKS } from './networkData'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
      isMetaMask?: boolean
    }
  }
}

export interface ConnectedWallet {
  provider: BrowserProvider
  signer: Signer & WalletSigner
  address: string
  chainId: number
}

function getProvider(): BrowserProvider {
  if (!window.ethereum) throw new Error('MetaMask not found')
  return new ethers.BrowserProvider(window.ethereum)
}

export async function connectWallet(): Promise<ConnectedWallet> {
  const provider = getProvider()
  await provider.send('eth_requestAccounts', [])
  const signer = await provider.getSigner()
  const address = await signer.getAddress()
  const network = await provider.getNetwork()
  return { provider, signer, address, chainId: Number(network.chainId) }
}

export async function getConnectedAccounts(): Promise<string[]> {
  if (!window.ethereum) return []
  try {
    return (await window.ethereum.request({ method: 'eth_accounts' })) as string[]
  } catch {
    return []
  }
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export async function switchNetwork(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error('MetaMask not found')
  const hex = '0x' + chainId.toString(16)
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string }
    if (err.code === 4902 || err.message?.includes('4902') || err.message?.includes('Unrecognized chain')) {
      const network = SUPPORTED_NETWORKS[chainId]
      if (!network) throw new Error(`Unsupported chain: ${chainId}`)
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: network.name,
          rpcUrls: [network.rpcUrl],
          nativeCurrency: network.nativeCurrency,
          blockExplorerUrls: [network.blockExplorerUrl],
        }],
      })
    } else {
      throw e
    }
  }
}

export function watchWalletEvents(
  onAccountsChanged: (accounts: string[]) => void,
  onChainChanged: (chainId: number) => void
): () => void {
  if (!window.ethereum) return () => {}

  const handleAccounts = (...args: unknown[]) => onAccountsChanged(args[0] as string[])
  const handleChain = (...args: unknown[]) => onChainChanged(parseInt(args[0] as string, 16))

  window.ethereum.on('accountsChanged', handleAccounts)
  window.ethereum.on('chainChanged', handleChain)

  return () => {
    window.ethereum!.removeListener('accountsChanged', handleAccounts)
    window.ethereum!.removeListener('chainChanged', handleChain)
  }
}
