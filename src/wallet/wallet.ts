/**
 * Wallet module — sidebar proxy version.
 *
 * Extension sidebar pages (chrome-extension://...) are sandboxed; MetaMask does
 * NOT inject window.ethereum into them. Only the content script, running inside
 * the real Twitter page, has access to window.ethereum.
 *
 * Solution: every JSON-RPC call is sent via chrome.runtime.sendMessage to the
 * background service worker, which forwards it to the active-tab content script,
 * which executes window.ethereum.request(...) and sends the result back.
 */
import type { WalletSigner } from '../platforms/PredictionPlatform'

// ─── Low-level proxy ─────────────────────────────────────────────────────────

/**
 * Send a JSON-RPC request through the content-script proxy.
 * Background worker forwards the message to the active tab.
 */
export function proxyRequest(method: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'WALLET_REQUEST', method, params },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (response?.error) reject(new Error(response.error))
        else resolve(response?.result)
      }
    )
  })
}

// ─── WalletSigner proxy ───────────────────────────────────────────────────────

/**
 * Minimal signer that proxies signTypedData (EIP-712) through the content script.
 * Compatible with PredictionPlatform.WalletSigner.
 */
export class ProxySigner implements WalletSigner {
  constructor(public readonly address: string) {}

  async getAddress(): Promise<string> {
    return this.address
  }

  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ): Promise<string> {
    // Build EIP712Domain types dynamically — only include fields that are
    // actually present in the domain object.  ClobAuthDomain has no
    // verifyingContract; the CTF Exchange domain does.  MetaMask rejects
    // typed-data where EIP712Domain lists a field that is absent from the value.
    const ALL_DOMAIN_FIELDS = [
      { name: 'name',              type: 'string'  },
      { name: 'version',           type: 'string'  },
      { name: 'chainId',           type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]
    const EIP712Domain = ALL_DOMAIN_FIELDS.filter(f => domain[f.name] !== undefined)

    // eth_signTypedData_v4 payload (EIP-712 JSON format)
    const typedData = {
      types: {
        EIP712Domain,
        ...types,
      },
      primaryType: Object.keys(types)[0],
      domain,
      message: value,
    }

    // BigInt cannot be JSON-serialised; convert to decimal strings
    const json = JSON.stringify(typedData, (_key, val) =>
      typeof val === 'bigint' ? val.toString() : val
    )

    return proxyRequest('eth_signTypedData_v4', [this.address, json]) as Promise<string>
  }
}

// ─── High-level helpers ───────────────────────────────────────────────────────

export interface ConnectedWallet {
  signer: WalletSigner
  address: string
  chainId: number
}

/**
 * Request wallet connection.
 * Returns connected wallet info with a ProxySigner.
 */
export async function connectWallet(): Promise<ConnectedWallet> {
  const accounts = (await proxyRequest('eth_requestAccounts', [])) as string[]
  if (!accounts || accounts.length === 0) throw new Error('No accounts returned')

  const address = accounts[0]

  const chainIdHex = (await proxyRequest('eth_chainId', [])) as string
  const chainId = parseInt(chainIdHex, 16)

  return { signer: new ProxySigner(address), address, chainId }
}

/**
 * Get currently connected accounts without a permission prompt.
 */
export async function getConnectedAccounts(): Promise<string[]> {
  try {
    return (await proxyRequest('eth_accounts', [])) as string[]
  } catch {
    return []
  }
}

/**
 * Shorten an Ethereum address for display: 0x1234...5678
 */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Watch for account / chain changes.
 * NOTE: event subscriptions (eth_subscribe) don't work through the proxy.
 * Instead we poll on a short interval.
 */
export function watchWalletEvents(
  onAccountsChanged: (accounts: string[]) => void,
  onChainChanged: (chainId: number) => void
): () => void {
  let lastAddress = ''
  let lastChain = 0

  const id = setInterval(async () => {
    try {
      const accounts = (await proxyRequest('eth_accounts', [])) as string[]
      const addr = accounts[0] ?? ''
      if (addr !== lastAddress) {
        lastAddress = addr
        onAccountsChanged(accounts)
      }

      const hexChain = (await proxyRequest('eth_chainId', [])) as string
      const chain = parseInt(hexChain, 16)
      if (chain !== lastChain && lastChain !== 0) {
        lastChain = chain
        onChainChanged(chain)
      } else {
        lastChain = chain
      }
    } catch {
      // silently ignore if proxy not reachable
    }
  }, 2000)

  return () => clearInterval(id)
}
