# Universal State Machine Framework - Developer Guide

A complete guide to building decentralized, sunset-proof applications on Algorand.

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Core Concepts](#core-concepts)
5. [Step-by-Step Integration](#step-by-step-integration)
6. [MBR (Minimum Balance Requirement)](#mbr-minimum-balance-requirement)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)
9. [Deployment](#deployment)

---

## Introduction

The Universal State Machine is a generic smart contract framework that provides two fundamental primitives for building any decentralized application:

| Primitive | Description | Use Cases |
|-----------|-------------|-----------|
| **Entity** | Single-owner stateful data storage | User profiles, posts, records, inventory |
| **Process** | Two-party turn-based workflows | Battles, trades, approvals, negotiations |

### Why Use This Framework?

- **Sunset-Proof**: Your data lives forever on 750+ Algorand nodes
- **No Servers**: Static frontend + public RPC = zero infrastructure costs
- **Universal**: One contract powers games, blogs, supply chains, AI agents
- **Cost-Optimized**: Pay only for data growth, not full MBR on updates
- **Fully Decentralized**: No admin keys, no shutdown vector

---

## Prerequisites

### Required Knowledge
- Basic JavaScript/TypeScript
- Understanding of blockchain transactions
- Familiarity with async/await patterns

### Required Tools
```bash
# For frontend development
npm install algosdk

# For contract deployment (optional)
pip install puyapy py-algorand-sdk
```

### Algorand Wallet
You'll need an Algorand wallet with TestNet ALGO:
- Get TestNet ALGO from the [Algorand Dispenser](https://dispenser.testnet.aws.algodev.network/)
- Minimum recommended: 1 ALGO for testing

---

## Quick Start

### 1. Connect to the Deployed Contract

```javascript
import algosdk from 'algosdk';

// TestNet deployment
const APP_ID = 750081112;
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';

// Initialize client
const algodClient = new algosdk.Algodv2('', ALGOD_SERVER, 443);

// Contract ABI (minimal version)
const CONTRACT_ABI = {
    name: "UniversalStateMachine",
    methods: [
        {
            name: "save_entity",
            args: [
                { type: "string", name: "entity_id" },
                { type: "string", name: "entity_data" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_entity",
            args: [{ type: "string", name: "entity_id" }],
            returns: { type: "string" }
        },
        {
            name: "delete_entity",
            args: [{ type: "string", name: "entity_id" }],
            returns: { type: "void" }
        },
        {
            name: "start_process",
            args: [
                { type: "string", name: "process_id" },
                { type: "address", name: "other_party" },
                { type: "string", name: "initial_state" },
                { type: "uint64", name: "timeout_rounds" }
            ],
            returns: { type: "string" }
        },
        {
            name: "update_process",
            args: [
                { type: "string", name: "process_id" },
                { type: "string", name: "new_state" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_process",
            args: [{ type: "string", name: "process_id" }],
            returns: { type: "string" }
        },
        {
            name: "resign_process",
            args: [{ type: "string", name: "process_id" }],
            returns: { type: "void" }
        },
        {
            name: "get_process_info",
            args: [{ type: "string", name: "process_id" }],
            returns: { type: "(address,address,uint64,bool,uint64)" }
        },
        {
            name: "delete_process",
            args: [{ type: "string", name: "process_id" }],
            returns: { type: "void" }
        }
    ]
};

const abiContract = new algosdk.ABIContract(CONTRACT_ABI);
```

### 2. Save Your First Entity

```javascript
async function saveEntity(account, entityId, data) {
    const params = await algodClient.getTransactionParams().do();
    const dataJson = JSON.stringify(data);
    const dataSize = new TextEncoder().encode(dataJson).length;

    // Create box key
    const boxKey = new TextEncoder().encode(`e:${entityId}`);

    // Calculate MBR
    const mbrAmount = 2500 + (400 * (boxKey.length + 32 + dataSize));

    // Create payment for MBR
    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: algosdk.getApplicationAddress(APP_ID),
        amount: mbrAmount,
        suggestedParams: params
    });

    // Build atomic transaction
    const atc = new algosdk.AtomicTransactionComposer();

    atc.addTransaction({
        txn: paymentTxn,
        signer: algosdk.makeBasicAccountTransactionSigner(account)
    });

    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('save_entity'),
        methodArgs: [entityId, dataJson],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    const result = await atc.execute(algodClient, 4);
    return result.txIDs[0];
}

// Usage
const myData = {
    name: "Alice",
    score: 100,
    achievements: ["first_login", "tutorial_complete"]
};

await saveEntity(account, account.addr, myData);
```

### 3. Load an Entity

```javascript
async function loadEntity(entityId) {
    const boxKey = new TextEncoder().encode(`e:${entityId}`);

    try {
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();
        // Box value: owner(32 bytes) + JSON data
        const dataBytes = box.value.slice(32);
        const dataJson = new TextDecoder().decode(dataBytes);
        return JSON.parse(dataJson);
    } catch (error) {
        if (error.message.includes('box not found')) {
            return null;
        }
        throw error;
    }
}

// Usage
const userData = await loadEntity(account.addr);
console.log(userData); // { name: "Alice", score: 100, ... }
```

---

## Core Concepts

### Entities

Entities are single-owner data containers. Think of them as user-owned documents.

```
Box Storage Layout:
┌────────────────────────────────────────────┐
│ Key: "e:" + entity_id                      │
├────────────────────────────────────────────┤
│ Value: owner_address(32) + json_data(N)    │
└────────────────────────────────────────────┘
```

**Key Properties:**
- Only the owner can update or delete
- Maximum 62 bytes for entity_id
- Maximum 32KB for data
- MBR refunded on deletion

### Processes

Processes are two-party workflows with turn-based state management.

```
Box Storage Layout:
┌─────────────────────────────────────────────────────────────┐
│ Key: "p:" + process_id                                      │
├─────────────────────────────────────────────────────────────┤
│ Value: p1(32) + p2(32) + turn(8) + final(1) + timeout(8)   │
│        + json_state(N)                                      │
└─────────────────────────────────────────────────────────────┘
```

**Key Properties:**
- Two participants (p1 = creator, p2 = other party)
- Turn counter increments on each update
- Either party can update (turn-based enforcement is app-logic)
- Optional timeout in rounds (~3 seconds per round)
- Finalization flag prevents further updates
- Both parties can delete after finalized/timeout

---

## Step-by-Step Integration

### Step 1: Set Up Your Project

```javascript
// config.js
export const CONFIG = {
    APP_ID: 750081112,
    ALGOD_SERVER: 'https://testnet-api.algonode.cloud',
    ALGOD_PORT: 443,
    ALGOD_TOKEN: ''
};
```

### Step 2: Create Helper Functions

```javascript
// helpers.js

// Create entity box key
export function createEntityBoxKey(entityId) {
    const prefix = new TextEncoder().encode('e:');
    const idBytes = new TextEncoder().encode(entityId);
    const boxKey = new Uint8Array(prefix.length + idBytes.length);
    boxKey.set(prefix, 0);
    boxKey.set(idBytes, prefix.length);
    return boxKey;
}

// Create process box key
export function createProcessBoxKey(processId) {
    const prefix = new TextEncoder().encode('p:');
    const idBytes = new TextEncoder().encode(processId);
    const boxKey = new Uint8Array(prefix.length + idBytes.length);
    boxKey.set(prefix, 0);
    boxKey.set(idBytes, prefix.length);
    return boxKey;
}

// Calculate MBR for entities
export function calculateEntityMBR(dataSize, keyLength) {
    const valueSize = 32 + dataSize; // owner + data
    return 2500 + (400 * (keyLength + valueSize));
}

// Calculate MBR for processes
export function calculateProcessMBR(stateSize, keyLength) {
    const valueSize = 81 + stateSize; // header(81) + state
    return 2500 + (400 * (keyLength + valueSize));
}

// Calculate optimal MBR (only pay for growth)
export async function calculateOptimalMBR(algod, appId, boxKey, newSize, isProcess = false) {
    try {
        const existingBox = await algod.getApplicationBoxByName(appId, boxKey).do();
        const oldSize = existingBox.value.length;
        const headerSize = isProcess ? 81 : 32;
        const newValueSize = headerSize + newSize;
        const sizeDiff = Math.max(0, newValueSize - oldSize);
        return sizeDiff * 400; // Only pay for growth
    } catch {
        // Box doesn't exist, pay full MBR
        const keyLength = boxKey.length;
        return isProcess
            ? calculateProcessMBR(newSize, keyLength)
            : calculateEntityMBR(newSize, keyLength);
    }
}
```

### Step 3: Implement Entity Operations

```javascript
// entities.js
import { CONFIG } from './config.js';
import { createEntityBoxKey, calculateOptimalMBR } from './helpers.js';

export class EntityManager {
    constructor(algodClient, abiContract) {
        this.algod = algodClient;
        this.contract = abiContract;
        this.appId = CONFIG.APP_ID;
    }

    async save(account, entityId, data) {
        const params = await this.algod.getTransactionParams().do();
        const dataJson = JSON.stringify(data);
        const dataSize = new TextEncoder().encode(dataJson).length;
        const boxKey = createEntityBoxKey(entityId);

        const mbrAmount = await calculateOptimalMBR(
            this.algod, this.appId, boxKey, dataSize, false
        );

        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.addr,
            to: algosdk.getApplicationAddress(this.appId),
            amount: mbrAmount,
            suggestedParams: params
        });

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addTransaction({
            txn: paymentTxn,
            signer: algosdk.makeBasicAccountTransactionSigner(account)
        });

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('save_entity'),
            methodArgs: [entityId, dataJson],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async load(entityId) {
        const boxKey = createEntityBoxKey(entityId);

        try {
            const box = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();
            const dataBytes = box.value.slice(32);
            return JSON.parse(new TextDecoder().decode(dataBytes));
        } catch (error) {
            if (error.message.includes('box not found')) {
                return null;
            }
            throw error;
        }
    }

    async delete(account, entityId) {
        const params = await this.algod.getTransactionParams().do();
        const boxKey = createEntityBoxKey(entityId);

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('delete_entity'),
            methodArgs: [entityId],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }
}
```

### Step 4: Implement Process Operations

```javascript
// processes.js
import { CONFIG } from './config.js';
import { createProcessBoxKey, calculateOptimalMBR, calculateProcessMBR } from './helpers.js';

export class ProcessManager {
    constructor(algodClient, abiContract) {
        this.algod = algodClient;
        this.contract = abiContract;
        this.appId = CONFIG.APP_ID;
    }

    async start(account, processId, otherParty, initialState, timeoutRounds = 0) {
        const params = await this.algod.getTransactionParams().do();
        const stateJson = JSON.stringify(initialState);
        const stateSize = new TextEncoder().encode(stateJson).length;
        const boxKey = createProcessBoxKey(processId);

        const mbrAmount = calculateProcessMBR(stateSize, boxKey.length);

        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.addr,
            to: algosdk.getApplicationAddress(this.appId),
            amount: mbrAmount,
            suggestedParams: params
        });

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addTransaction({
            txn: paymentTxn,
            signer: algosdk.makeBasicAccountTransactionSigner(account)
        });

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('start_process'),
            methodArgs: [processId, otherParty, stateJson, timeoutRounds],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async update(account, processId, newState) {
        const params = await this.algod.getTransactionParams().do();
        const stateJson = JSON.stringify(newState);
        const stateSize = new TextEncoder().encode(stateJson).length;
        const boxKey = createProcessBoxKey(processId);

        const mbrAmount = await calculateOptimalMBR(
            this.algod, this.appId, boxKey, stateSize, true
        );

        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.addr,
            to: algosdk.getApplicationAddress(this.appId),
            amount: mbrAmount,
            suggestedParams: params
        });

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addTransaction({
            txn: paymentTxn,
            signer: algosdk.makeBasicAccountTransactionSigner(account)
        });

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('update_process'),
            methodArgs: [processId, stateJson],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async load(processId) {
        const boxKey = createProcessBoxKey(processId);

        try {
            const box = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();
            // Skip header (81 bytes) to get state
            const stateBytes = box.value.slice(81);
            return JSON.parse(new TextDecoder().decode(stateBytes));
        } catch (error) {
            if (error.message.includes('box not found')) {
                return null;
            }
            throw error;
        }
    }

    async getInfo(processId) {
        const boxKey = createProcessBoxKey(processId);

        try {
            const box = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();
            const value = box.value;

            return {
                participant1: algosdk.encodeAddress(value.slice(0, 32)),
                participant2: algosdk.encodeAddress(value.slice(32, 64)),
                turnNumber: new DataView(value.buffer, 64, 8).getBigUint64(0, false),
                isFinalized: value[72] !== 0,
                timeoutRound: new DataView(value.buffer, 73, 8).getBigUint64(0, false)
            };
        } catch (error) {
            if (error.message.includes('box not found')) {
                return null;
            }
            throw error;
        }
    }

    async resign(account, processId) {
        const params = await this.algod.getTransactionParams().do();
        const boxKey = createProcessBoxKey(processId);

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('resign_process'),
            methodArgs: [processId],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async delete(account, processId) {
        const params = await this.algod.getTransactionParams().do();
        const boxKey = createProcessBoxKey(processId);

        const atc = new algosdk.AtomicTransactionComposer();

        atc.addMethodCall({
            appID: this.appId,
            method: this.contract.getMethodByName('delete_process'),
            methodArgs: [processId],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }
}
```

---

## MBR (Minimum Balance Requirement)

### Understanding MBR

Algorand uses MBR to prevent spam. When you create a box, you must send ALGO to cover storage costs.

**Formula:**
```
MBR = 2,500 + (400 × total_bytes) microALGO
```

Where `total_bytes = key_length + value_length`

### Entity MBR Calculation

```javascript
// Entity value = owner(32) + data
const keyLength = 2 + entityId.length;  // "e:" + id
const valueLength = 32 + dataBytes.length;
const mbr = 2500 + (400 * (keyLength + valueLength));
```

**Example:**
- Entity ID: 58-char address
- Data: 500 bytes
- Key: 2 + 58 = 60 bytes
- Value: 32 + 500 = 532 bytes
- MBR: 2,500 + 400 × (60 + 532) = **239,300 microALGO** (~0.24 ALGO)

### Process MBR Calculation

```javascript
// Process value = header(81) + state
// Header: p1(32) + p2(32) + turn(8) + final(1) + timeout(8)
const keyLength = 2 + processId.length;  // "p:" + id
const valueLength = 81 + stateBytes.length;
const mbr = 2500 + (400 * (keyLength + valueLength));
```

### Optimized Updates (Pay Only for Growth)

```javascript
async function calculateOptimalMBR(algod, appId, boxKey, newDataSize, isProcess) {
    try {
        const existing = await algod.getApplicationBoxByName(appId, boxKey).do();
        const headerSize = isProcess ? 81 : 32;
        const newValueSize = headerSize + newDataSize;
        const sizeDiff = Math.max(0, newValueSize - existing.value.length);
        return sizeDiff * 400;  // Only pay for growth!
    } catch {
        // Box doesn't exist, calculate full MBR
        const keyLength = boxKey.length;
        const valueLength = (isProcess ? 81 : 32) + newDataSize;
        return 2500 + (400 * (keyLength + valueLength));
    }
}
```

**Savings Example:**
- Initial save: 500 bytes → ~240,000 microALGO
- Update to 510 bytes → 10 × 400 = **4,000 microALGO** (98% savings!)

---

## Error Handling

### Common Errors and Solutions

```javascript
try {
    await entityManager.save(account, entityId, data);
} catch (error) {
    if (error.message.includes('Only owner can update')) {
        // You don't own this entity
        console.error('Permission denied: not the owner');
    } else if (error.message.includes('Entity does not exist')) {
        // Trying to load/delete non-existent entity
        console.error('Entity not found');
    } else if (error.message.includes('below min') || error.message.includes('balance')) {
        // Insufficient ALGO for MBR
        console.error('Insufficient balance for MBR');
    } else if (error.message.includes('Entity ID too long')) {
        // ID > 62 bytes
        console.error('Entity ID must be ≤62 bytes');
    } else if (error.message.includes('exceeds 32KB')) {
        // Data too large
        console.error('Data must be ≤32KB');
    } else if (error.message.includes('Process already exists')) {
        // Duplicate process ID
        console.error('Process ID already in use');
    } else if (error.message.includes('Cannot update finalized')) {
        // Process is finalized
        console.error('Process has been finalized');
    } else if (error.message.includes('Process timed out')) {
        // Process timeout exceeded
        console.error('Process has timed out');
    } else {
        throw error;  // Re-throw unknown errors
    }
}
```

---

## Best Practices

### 1. Use Meaningful Entity IDs

```javascript
// Good: Descriptive, namespaced
const entityId = `user:${account.addr}`;
const entityId = `post:${account.addr}:${timestamp}`;
const entityId = `inventory:${account.addr}`;

// Bad: Cryptic or collision-prone
const entityId = crypto.randomUUID();  // Hard to discover
const entityId = "data";  // Will collide
```

### 2. Structure Your JSON Data

```javascript
// Good: Versioned, typed
const data = {
    version: 1,
    type: "player_profile",
    name: "Alice",
    level: 10,
    createdAt: Date.now(),
    updatedAt: Date.now()
};

// Bad: Unstructured
const data = { n: "Alice", l: 10 };  // Unclear field names
```

### 3. Batch Related Operations

```javascript
// If you need to update multiple related entities,
// consider combining them into a single entity to reduce transactions
const gameState = {
    player: { ... },
    inventory: { ... },
    achievements: [ ... ],
    settings: { ... }
};
await entityManager.save(account, account.addr, gameState);
```

### 4. Handle Race Conditions in Processes

```javascript
// Always check turn number before updating
const info = await processManager.getInfo(processId);
const state = await processManager.load(processId);

if (info.turnNumber !== expectedTurn) {
    // State has changed, reload and retry
    return await reloadAndRetry();
}

// Safe to update
await processManager.update(account, processId, newState);
```

### 5. Set Appropriate Timeouts

```javascript
// Algorand produces ~1 block every 3 seconds
// timeout_rounds: 0 = no timeout

// Quick interaction (5 minutes)
const timeout = 100;  // ~100 × 3s = 5 minutes

// Standard game (1 hour)
const timeout = 1200;  // ~1 hour

// Long workflow (24 hours)
const timeout = 28800;  // ~24 hours
```

---

## Deployment

### Deploy Your Own Contract

If you want to deploy your own instance:

```bash
# 1. Clone the repository
git clone https://github.com/ch4itu/EternalBliss.git
cd EternalBliss/contract

# 2. Set up Python environment
python -m venv venv
source venv/bin/activate
pip install puyapy py-algorand-sdk

# 3. Compile the contract
puyapy contract.py

# 4. Deploy
python deploy.py
# Follow prompts to enter mnemonic and select network
```

### Deploy Your Frontend

Your frontend is just static files! Deploy anywhere:

```bash
# GitHub Pages
git push origin main
# Enable Pages in repository settings

# IPFS (via Lighthouse)
npm install -g @lighthouse-web3/sdk
lighthouse-web3 upload ./dist

# Arweave
npm install -g arkb
arkb deploy ./dist
```

---

## Next Steps

- **[API Reference](./API_REFERENCE.md)** - Complete method documentation
- **[Examples](./EXAMPLES.md)** - Ready-to-use templates for common use cases
- **[EternalBliss Game](https://ch4itu.github.io/EternalBliss/)** - See the framework in action

---

## Support

- **GitHub Issues**: [EternalBliss Issues](https://github.com/ch4itu/EternalBliss/issues)
- **Algorand Discord**: [discord.gg/algorand](https://discord.gg/algorand)

---

*Built with the Universal State Machine Framework - Sunset-proof by design.*
