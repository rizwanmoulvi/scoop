import { create } from 'zustand'
import type { DetectedMarket, Market, OrderBook } from '../types/market'
import type { Outcome } from '../types/market'
import type { OrderState } from '../types/order'

export interface WalletState {
  address: string | null
  chainId: number | null
  isConnecting: boolean
  error: string | null
}

export interface AppStore {
  // ─── Wallet ───────────────────────────────────────────────────────────────
  wallet: WalletState
  setWallet: (wallet: Partial<WalletState>) => void
  resetWallet: () => void

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
}

const DEFAULT_WALLET: WalletState = {
  address: null,
  chainId: null,
  isConnecting: false,
  error: null,
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
}))
