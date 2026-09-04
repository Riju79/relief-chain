# ReliefChain — Backend Blockchain Connection Layer

This is the backend integration module connecting **ReliefChain** directly to the **Sui Testnet** via the **Tatum Gateway RPC** using the modern `@mysten/sui` TypeScript SDK.

---

## 🛠 Tech Stack & Specifications

* **Blockchain Network:** Sui Testnet
* **Sui TypeScript SDK:** `@mysten/sui` (Official modern SDK - client, transactions, and cryptography exports)
* **RPC Gateway:** Tatum Gateway (`https://sui-testnet.gateway.tatum.io`)
* **Module System:** ES Modules (ESM) with import/export syntax
* **Language:** TypeScript 5.x+ (NodeNext resolution)

---

## 📂 File Structure

```
c:/reliefchain/
├── .env                         # Environment configurations (API key & RPC URL)
├── tsconfig.json                # Modern TS compiler rules for native ES Modules
├── README_BACKEND.md            # You are here
└── src/
    ├── config/
    │   └── suiClient.ts         # Singleton client configuration with Tatum headers
    ├── services/
    │   └── blockchainService.ts # Core API wrappers (balances, txs, owned objects)
    ├── utils/
    │   └── healthCheck.ts       # RPC ping and connectivity health check utils
    ├── index.ts                 # Package exports and automatic startup ping
    └── testConnection.ts        # Executable connection validation sandbox
```

---

## ⚙️ Environment Configuration (`.env`)

A `.env` file has been created at the root level of your workspace with the following settings:

```env
SUI_RPC_URL=https://sui-testnet.gateway.tatum.io
TATUM_API_KEY=t-6a140233ac1249b94ca19bd2-0406e37327b248658be3ef78
NETWORK=testnet
```

> [!IMPORTANT]
> Keep the `TATUM_API_KEY` secure. Never commit the `.env` file to a public repository.

---

## 🚀 How to Run and Test

You can run the connection test instantly using `tsx` (which supports native ESM execution for TS without manual build steps).

### 1. Execute Sandbox Connection Test
To execute the live verification script, run:
```bash
npx tsx src/testConnection.ts
```

This will automatically:
1. Initialize the **SuiJsonRpcClient** using the Tatum gateway and authorization headers.
2. Run a connectivity **Health Check** to ping the network.
3. Retrieve the **Latest Checkpoint Sequence Number** from the blockchain.
4. Retrieve and parse **Balances** (formatted in SUI and raw MIST) for a sample Sui Testnet address.
5. Print a structural sample of owned objects mapping on-chain.

### 2. Manual TypeScript Build Compilation
To compile the TypeScript project into native ES Modules in the `dist` folder:
```bash
npx tsc
```

---

## 🔒 Error Handling Features

* **HTTP Status Checks:** Detects and wraps Tatum-specific errors like **HTTP 401 (Unauthorized Key)** and **HTTP 429 (Rate Limits Exceeded)** into descriptive, structured success-fail objects.
* **Structured Response Contracts:** All service functions return clean, uniform types matching `{ success: true, ... }` or `{ success: false, error: string }` avoiding unhandled promise rejections.
