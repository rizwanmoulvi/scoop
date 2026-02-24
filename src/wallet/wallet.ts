import { ethers, type Signer, type BrowserProvider } from 'ethers'

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
  signer: Signer
  address: string
  chainId: number
}

/**
 * Returns true if MetaMask (or compatible wallet) is available.
 */
export function isWalletAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined'
}

/**
 * Request wallet connection via MetaMask.
 * Returns the connected wallet details.
 */
export async function connectWallet(): Promise<ConnectedWallet> {
  if (!isWalletAvailable()) {
    throw new Error('MetaMask is not installed. Please install it from metamask.io')
  }

  const provider = new ethers.BrowserProvider(window.ethereum!)
  await provider.send('eth_requestAccounts', [])

  const signer = await provider.getSigner()
  const address = await signer.getAddress()
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)

  return { provider, signer, address, chainId }
}

/**
 * Get the currently connected accounts without requesting a new connection.
 */
export async function getConnectedAccounts(): Promise<string[]> {
  if (!isWalletAvailable()) return []

  try {
    const accounts = (await window.ethereum!.request({
      method: 'eth_accounts',
    })) as string[]
    return accounts
  } catch {
    return []
  }
}

/**
 * Register listeners for account and chain changes.
 */
export function watchWalletEvents(
  onAccountsChanged: (accounts: string[]) => void,
  onChainChanged: (chainId: number) => void
): () => void {
  if (!isWalletAvailable()) return () => {}

  const handleAccountsChanged = (...args: unknown[]) => {
    onAccountsChanged(args[0] as string[])
  }

  const handleChainChanged = (...args: unknown[]) => {
    const hexChainId = args[0] as string
    onChainChanged(parseInt(hexChainId, 16))
  }

  window.ethereum!.on('accountsChanged', handleAccountsChanged)
  window.ethereum!.on('chainChanged', handleChainChanged)

  return () => {
    window.ethereum!.removeListener('accountsChanged', handleAccountsChanged)
    window.ethereum!.removeListener('chainChanged', handleChainChanged)
  }
}

/**
 * Shorten an Ethereum address for display: 0x1234...5678
 */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
