

---

# 📄 PRODUCT REQUIREMENT DOCUMENT (PRD)

# Project Name

**Scoop – Inline Prediction Trading Extension**

---

# 1. Product Vision

Build a Chrome browser extension that detects prediction market links inside posts on Twitter and injects an inline **“Bet” button**.

When clicked, a sidebar opens where users can:

* View market details
* Select YES / NO
* Enter amount
* Connect MetaMask
* Sign EIP-712 order
* Submit to platform API
* View transaction status

The extension integrates with:

* Probable
* Predict.fun
* Opinion

Primary fully working integration: **ONE platform (Probable recommended)**
Other platforms: architecture-ready, partial integration acceptable for MVP.

---

# 2. Problem Statement

Users debate predictions on social platforms but cannot directly trade on those opinions.

We enable:

> “Trade the tweet.”

---

# 3. Goals (Hackathon Scope)

### Must Have

* Detect market links inside tweets
* Inject inline Bet button
* Sidebar opens
* Connect MetaMask
* Sign EIP-712 order
* Submit order to selected platform
* Show success response

### Nice to Have

* Display live orderbook
* Show market probability
* Multi-platform routing

---

# 4. Non-Goals (Do NOT Build)

* Full liquidity aggregation
* Order routing across platforms
* Backend server
* Custodial wallet system
* Full settlement logic

---

# 5. Target Users

* Crypto-native Twitter users
* Prediction traders
* Web3 enthusiasts
* BNB hackathon judges

---

# 6. High-Level Architecture

## System Diagram

```
Twitter (X)
   ↓
Content Script
   ↓
Inject Bet Button
   ↓
Chrome Extension Sidebar (React App)
   ↓
Platform Adapter Layer
   ↓
Wallet (MetaMask)
   ↓
Platform API (CLOB)
```

---

# 7. Technical Architecture

## 7.1 Chrome Extension (Manifest v3)

### Components

### A. Content Script

* Runs on twitter.com
* Uses MutationObserver
* Detects links:

  * probable.markets
  * predict.fun
  * opinion.trade
* Extracts market ID
* Injects Bet button inline

---

### B. Sidebar (React App)

Responsible for:

* Wallet connection
* Market data fetching
* Order building
* EIP-712 signing
* API submission

---

### C. Background Service Worker

Handles:

* Message passing
* State persistence
* Network switching
* Platform routing

---

# 8. Tech Stack

## Frontend (Extension UI)

* React 18
* TypeScript
* Vite
* TailwindCSS
* Zustand (state management)
* Ethers.js v6

## Blockchain

* Ethers.js
* EIP-712 signing
* ERC20 approval flow
* MetaMask wallet

## Browser Extension

* Chrome Manifest v3
* Content scripts
* Background service worker
* chrome.runtime messaging

## Dev Tools

* Node.js 18+
* pnpm or npm
* ESLint
* Prettier

---

# 9. Platform Integration Details

All selected platforms use CLOB-style architecture.

This means:

* Orders are signed using EIP-712
* Matching occurs off-chain
* Settlement occurs on-chain

---

## 9.1 Probable Integration (Primary)

Platform: Probable

Architecture:

* Off-chain orderbook
* On-chain settlement
* EIP-712 signed orders

Integration Steps:

1. Fetch market by ID
2. Fetch orderbook
3. Construct order object:

   * marketId
   * outcome
   * price
   * amount
   * expiration
4. Sign using:

   ```ts
   signer.signTypedData(domain, types, value)
   ```
5. Submit to:
   POST /orders endpoint

Agent must inspect network calls in browser to replicate schema.

---

## 9.2 Predict.fun

Platform: Predict.fun

Docs:
[https://docs.predict.fun](https://docs.predict.fun)

Architecture:

* CLOB
* Gnosis Conditional Tokens
* On-chain settlement

May provide SDK.

If SDK exists:
Use it.

Otherwise:
Reverse engineer typed data schema from DevTools.

---

## 9.3 Opinion.trade

Platform: Opinion

Architecture:

* Hybrid CLOB
* Signed structured orders
* On-chain resolution

Same signing pattern as above.

---

# 10. Wallet Flow

## Step 1: Connect Wallet

```ts
const provider = new ethers.BrowserProvider(window.ethereum)
const signer = await provider.getSigner()
```

---

## Step 2: Network Switch

```ts
wallet_switchEthereumChain
```

---

## Step 3: Token Approval (If needed)

ERC20 approve exchange contract.

---

## Step 4: Sign EIP-712 Order

```ts
await signer.signTypedData(domain, types, value)
```

---

## Step 5: Submit Order

POST to platform API.

---

# 11. Platform Adapter Layer (Critical)

Define interface:

```ts
interface PredictionPlatform {
  getMarket(id: string): Promise<Market>
  getOrderBook(id: string): Promise<OrderBook>
  buildOrder(params: TradeInput): Order
  signOrder(order: Order, signer: Signer): Promise<SignedOrder>
  submitOrder(order: SignedOrder): Promise<ApiResponse>
}
```

Implement:

```
ProbableAdapter.ts
PredictFunAdapter.ts
OpinionAdapter.ts
```

This makes project production-grade.

---

# 12. Project Structure

```
/social-opinion-extension

  /public
    manifest.json

  /src
    /content
      contentScript.ts
      domObserver.ts
      injectButton.ts

    /background
      background.ts
      messageRouter.ts

    /sidebar
      main.tsx
      App.tsx
      components/
        MarketView.tsx
        OrderForm.tsx
        WalletConnect.tsx

    /platforms
      PredictionPlatform.ts
      ProbableAdapter.ts
      PredictFunAdapter.ts
      OpinionAdapter.ts

    /wallet
      wallet.ts
      network.ts

    /types
      market.ts
      order.ts

    /utils
      api.ts
      eip712.ts

  package.json
  tsconfig.json
  vite.config.ts
```

---

# 13. Market Detection Logic

Content script:

1. Observe DOM changes
2. Parse tweet text
3. Regex detect:

```
/(probable\.markets|predict\.fun|opinion\.trade)\/\S+/
```

4. Extract market ID
5. Inject:

```
<button>Bet</button>
```

Styled similar to Twitter action buttons.

---

# 14. Security Requirements

* No private key storage
* No backend secrets
* No API key storage
* Only signed messages
* Validate domain in EIP-712

---

# 15. UI Requirements

Sidebar must include:

* Market title
* Current probability
* YES / NO selector
* Price display
* Amount input
* Connect Wallet button
* Confirm button
* Status indicator
* Tx hash display

---

# 16. UX Flow (Final Demo Flow)

1. Tweet contains:
   probable.markets/123
2. Bet button appears
3. Click Bet
4. Sidebar opens
5. Connect Wallet
6. Choose YES
7. Enter 50 USDC
8. Click Confirm
9. MetaMask popup appears
10. Order signed
11. API response success
12. Show order accepted

---

# 17. Resources

### Platform URLs

* [https://probable.markets](https://probable.markets)
* [https://docs.predict.fun](https://docs.predict.fun)
* [https://app.opinion.trade](https://app.opinion.trade)

### EIP-712

[https://eips.ethereum.org/EIPS/eip-712](https://eips.ethereum.org/EIPS/eip-712)

### Ethers.js Docs

[https://docs.ethers.org/v6/](https://docs.ethers.org/v6/)

### Chrome Extension Docs

[https://developer.chrome.com/docs/extensions/](https://developer.chrome.com/docs/extensions/)

---

# 18. Success Criteria

Project is complete if:

* Extension installs
* Detects markets
* Injects button
* Wallet connects
* Order signs successfully
* Platform API accepts order
* Transaction hash visible

---

# 19. Stretch Goals

* Multi-platform selector
* Probability comparison
* Show live orderbook
* Social share of trade
* Market creation from tweet

---

# 20. Hackathon Positioning

This product:

* Bridges social media + prediction markets
* Introduces inline financial actions
* Makes trading native to discussion
* Is modular and scalable
* Is production architecture ready


