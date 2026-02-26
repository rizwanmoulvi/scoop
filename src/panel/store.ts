import { create } from 'zustand'
import type { DetectedMarket, Market, OrderBook } from '../types/market'
import type { Outcome } from '../types/market'
import type { OrderState } from '../types/order'
import type { ApprovalStatus } from '../wallet/approvals'

// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface ApiCredentials {
  key: string
  secret: string
  passphrase: string
}

export interface WalletState {
  address: string | null
  chainId: number | null
  isConnecting: boolean
  error: string | null
  /** Cached L2 API credentials (valid for this session) */
  apiKey: ApiCredentials | null
  /** BSC token approval state (populated after wallet connect) */
  approvals: ApprovalStatus | null
  /** True while checkApprovals() is running */
  isCheckingApprovals: boolean
  /** True while grantApprovals() is running */
  isApprovingTokens: boolean
  /** Status text shown during approval flow */
  approvalStep: string
  /** Proxy wallet (Gnosis Safe) address for this EOA — null if not yet deployed */
  proxyAddress: string | null
  /** True while createProxyWallet() is running */
  isCreatingProxy: boolean
  /** Status text shown during proxy creation flow */
  proxyStep: string
  /** Human-readable USDT balance in proxy wallet (e.g. "12.50"), null if not yet checked */
  proxyUsdtBalance: string | null
}

export interface AppStore {
  // ─── Wallet ───────────────────────────────────────────────────────────────
  wallet: WalletState
  setWallet: (wallet: Partial<WalletState>) => void
  resetWallet: () => void
  setApiKey: (apiKey: ApiCredentials | null) => void
  setApprovals: (approvals: ApprovalStatus | null) => void

  // ─── Active Market ────────────────────────────────────────────────────────
  detectedMarket: DetectedMarket | null
  market: Market | null
  orderBook: OrderBook | null
  isLoadingMarket: boolean
  marketError: string | null
  setDetectedMarket: (m: DetectedMarket | null) => void
  setMarket: (m: Market | null) => void
  setOrderBook: (ob: OrderBook | null) => void
  setLoadingMarket: (v: boolean) => void
  setMarketError: (e: string | null) => void

  // ─── Trade Inputs ─────────────────────────────────────────────────────────
  selectedOutcome: Outcome
  amount: string
  setSelectedOutcome: (o: Outcome) => void
  setAmount: (a: string) => void

  // ─── Order State ──────────────────────────────────────────────────────────
  order: OrderState
  setOrder: (o: Partial<OrderState>) => void
  resetOrder: () => void

  // ─── Paper Trading ────────────────────────────────────────────────────────
  /** When true, orders are signed but never sent to the API */
  paperTrading: boolean
  setPaperTrading: (v: boolean) => void
}

const DEFAULT_WALLET: WalletState = {
  address: null,
  chainId: null,
  isConnecting: false,
  error: null,
  apiKey: null,
  approvals: null,
  isCheckingApprovals: false,
  isApprovingTokens: false,
  approvalStep: '',
  proxyAddress: null,
  isCreatingProxy: false,
  proxyStep: '',
  proxyUsdtBalance: null,
}

const DEFAULT_ORDER: OrderState = {
  status: 'idle',
}

export const useStore = create<AppStore>((set) => ({
  // ─── Wallet ───────────────────────────────────────────────────────────────
  wallet: DEFAULT_WALLET,
  setWallet: (wallet) =>
    set((s) => ({ wallet: { ...s.wallet, ...wallet } })),
  resetWallet: () => set({ wallet: DEFAULT_WALLET }),
  setApiKey: (apiKey) =>
    set((s) => ({ wallet: { ...s.wallet, apiKey } })),
  setApprovals: (approvals) =>
    set((s) => ({ wallet: { ...s.wallet, approvals } })),

  // ─── Active Market ────────────────────────────────────────────────────────
  detectedMarket: null,
  market: null,
  orderBook: null,
  isLoadingMarket: false,
  marketError: null,
  setDetectedMarket: (detectedMarket) => set({ detectedMarket }),
  setMarket: (market) => set({ market }),
  setOrderBook: (orderBook) => set({ orderBook }),
  setLoadingMarket: (isLoadingMarket) => set({ isLoadingMarket }),
  setMarketError: (marketError) => set({ marketError }),

  // ─── Trade Inputs ─────────────────────────────────────────────────────────
  selectedOutcome: 'YES',
  amount: '',
  setSelectedOutcome: (selectedOutcome) => set({ selectedOutcome }),
  setAmount: (amount) => set({ amount }),

  // ─── Order State ──────────────────────────────────────────────────────────
  order: DEFAULT_ORDER,
  setOrder: (o) => set((s) => ({ order: { ...s.order, ...o } })),
  resetOrder: () => set({ order: DEFAULT_ORDER }),

  // ─── Paper Trading ────────────────────────────────────────────────────────
  paperTrading: false,
  setPaperTrading: (paperTrading) => set({ paperTrading }),
}))
