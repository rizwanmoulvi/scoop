

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


--------------------------------------------------

"1 USDT
$1.00

From

maskicon
scoop-2

Wallet 1

To

0x23774...da383

Estimated changes

You send

- 1


USDT

$1.00

Network

BNB Chain logo
BNB Chain

Request from

x.com

Interacting with


USDT

Network fee

< $0.01

BNB logo
BNB


Speed

Market

~1 sec"

"Signature request
Review request details before you confirm.

Network

BNB Chain logo
BNB Chain

Request from

x.com



Message

Primary type:

ClobAuth

Address:

maskicon
scoop-2

Wallet 1

Timestamp:

1772183804

Nonce:

0

Message:

This message attests that I control the given wallet"


"Signature request
Review request details before you confirm.

Network

BNB Chain logo
BNB Chain

Request from

x.com

Interacting with

0xF99F5...97c86



Message

Primary type:

Order

Salt:

1770618186995

Maker:

0x23774...da383

Signer:

maskicon
scoop-2

Wallet 1

Taker:

0x00000...00000

TokenId:

84862885472420082881595839912266645393318600108766608134661198571939703818046

MakerAmount:

999600000000000000

TakerAmount:

1190000000000000000

Expiration:

0

Nonce:

0

FeeRateBps:

175

Side:

0

SignatureType:

1"


log "[Scoop] expected proxy address: 0x237742997B2A456acC98B25c69023b4D742da383
proxyWallet.ts:304 [Scoop] eth_getCode via direct RPC: 0x6080604052600073ff
proxyWallet.ts:306 [Scoop] eth_getCode via MetaMask: 0x6080604052600073ff
WalletConnect.tsx:55 [Scoop] proxy wallet found: 0x237742997B2A456acC98B25c69023b4D742da383
wallet.ts:104 [Scoop] eth_signTypedData_v4 payload: {"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"}],"ClobAuth":[{"name":"address","type":"address"},{"name":"timestamp","type":"string"},{"name":"nonce","type":"uint256"},{"name":"message","type":"string"}]},"primaryType":"ClobAuth","domain":{"name":"ClobAuthDomain","version":"1","chainId":56},"message":{"address":"0x48461f405be183dd95cf0025de1c3d9bb3541fd4","timestamp":"1772183804","nonce":0,"message":"This message attests that I control the given wallet"}}
background.ts:104 [Scoop BG] API_FETCH POST https://api.probable.markets/public/api/v1/auth/api-key/56
ProbableAdapter.ts:405 [Scoop] signOrder EIP-712 value: Object
wallet.ts:104 [Scoop] eth_signTypedData_v4 payload: {"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Order":[{"name":"salt","type":"uint256"},{"name":"maker","type":"address"},{"name":"signer","type":"address"},{"name":"taker","type":"address"},{"name":"tokenId","type":"uint256"},{"name":"makerAmount","type":"uint256"},{"name":"takerAmount","type":"uint256"},{"name":"expiration","type":"uint256"},{"name":"nonce","type":"uint256"},{"name":"feeRateBps","type":"uint256"},{"name":"side","type":"uint8"},{"name":"signatureType","type":"uint8"}]},"primaryType":"Order","domain":{"name":"Probable CTF Exchange","version":"1","chainId":56,"verifyingContract":"0xF99F5367ce708c66F0860B77B4331301A5597c86"},"message":{"salt":"1770618186995","maker":"0x237742997B2A456acC98B25c69023b4D742da383","signer":"0x48461f405be183dd95cf0025de1c3d9bb3541fd4","taker":"0x0000000000000000000000000000000000000000","tokenId":"84862885472420082881595839912266645393318600108766608134661198571939703818046","makerAmount":"999600000000000000","takerAmount":"1190000000000000000","expiration":"0","nonce":"0","feeRateBps":"175","side":0,"signatureType":1}}
ProbableAdapter.ts:576 [Scoop] submitOrder body: {
  "deferExec": true,
  "order": {
    "salt": "1770618186995",
    "maker": "0x237742997B2A456acC98B25c69023b4D742da383",
    "signer": "0x48461f405be183dd95cf0025de1c3d9bb3541fd4",
    "taker": "0x0000000000000000000000000000000000000000",
    "tokenId": "84862885472420082881595839912266645393318600108766608134661198571939703818046",
    "makerAmount": "999600000000000000",
    "takerAmount": "1190000000000000000",
    "side": "BUY",
    "expiration": "0",
    "nonce": "0",
    "feeRateBps": "175",
    "signatureType": 1,
    "signature": "0xd18a169ac2c72ba44841b058bf1ffe2375a51635301f23743daaf60475960e435da6cbedc7d614334a6adb6769dc45603ca629c24de07db45eca33b12b8f81121c"
  },
  "owner": "0x237742997B2A456acC98B25c69023b4D742da383",
  "orderType": "GTC"
}
background.ts:104 [Scoop BG] API_FETCH POST https://api.probable.markets/public/api/v1/order/56
background.ts:111 [Scoop BG] API_FETCH 400 https://api.probable.markets/public/api/v1/order/56 Object
(anonymous) @ background.ts:111"


"✗
Order failed
HTTP 400: https://api.probable.markets/public/api/v1/order/56 — {"error":{"code":"PAS-4205","description":"The provided order is invalid.","message":"Order validation failed on chain"}}"





---------------------------
enable trading "Signature request
Review request details before you confirm.

Network

BNB Chain logo
BNB Chain

Request from

probable.markets



Message

Primary type:

ClobAuth

Address:

maskicon
scoop-3

Wallet 1

Timestamp:

1772191999

Nonce:

0

Message:

This message attests that I control the given wallet"