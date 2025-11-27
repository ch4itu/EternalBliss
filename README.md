# Eternal Bliss - Universal State Machine Framework
### Sunset-Proof Applications on Algorand

[![Smart Contract](https://img.shields.io/badge/Contract-750081112-blue)](https://lora.algokit.io/testnet/application/750081112)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Algorand](https://img.shields.io/badge/Blockchain-Algorand-black)](https://algorand.co)

---

## The Problem: The Sunset Crisis

> **"When servers shut down, your digital life vanishes."**

When companies shut down servers, suffer prolonged outages, or go out of business, server-dependent user data vanishes or becomes inaccessible forever:

| What You Lose | The Reality |
|---------------|-------------|
| **Profiles & Progress** | Years of game achievements, levels, and stats — gone overnight |
| **Digital Purchases** | Items, skins, and content you paid real money for — inaccessible |
| **Transaction History** | Financial records and purchase receipts — disappeared |
| **Certificates & Credentials** | Professional certifications and achievements — unverifiable |
| **Created Content** | Posts, media, and creative work — erased from existence |

**Users lose real value they spent time and money building** — usually with no warning, no export option, and no compensation. Billions of dollars in user value disappear every year.

**The root cause?** Everything lives under the company's control. Users never truly own their digital lives. When the company decides to stop — for any reason — your data dies with their servers.

**This is the Sunset Problem.**

---

## Our Innovation: A Universal On-Chain State Machine

Instead of building apps that depend on servers, we built a **Universal State Machine Framework** that stores ALL application state directly on Algorand's blockchain.

### The Key Insight

Every application — games, supply chains, blogs, AI coordination — can be modeled with just **two primitives**:

| Primitive | What It Does | Example Uses |
|-----------|--------------|--------------|
| **Entity** | Single-owner data storage | Player profiles, blog posts, product records, certificates |
| **Process** | Two-party coordination workflows | PvP battles, supply chain handoffs, AI agent coordination |

### Why This Matters

```
Traditional App                    Our Approach
─────────────────                  ─────────────────
User → Server → Database           User → Blockchain
       ↓                                  ↓
   Server dies                     3,000+ validator nodes
       ↓                                  ↓
   Data lost forever               Data lives forever
```

**Your data lives on 3,000+ validator nodes worldwide, not on any single server.**

---

## The Solution: One Contract, Infinite Applications

We deployed a **single smart contract** (App ID: `750081112`) that can power ANY application:

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR APPLICATION                             │
│  (Game, Supply Chain, AI Coordination, Storage, Blog...)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Universal State Machine Framework                   │
│  ┌────────────────────────┐  ┌────────────────────────────────┐ │
│  │    ENTITIES            │  │    PROCESSES                   │ │
│  │  (Single-Owner Data)   │  │  (Two-Party Workflows)         │ │
│  │                        │  │                                │ │
│  │  • Player Profiles     │  │  • PvP Battles                 │ │
│  │  • Product Records     │  │  • Supply Chain Handoffs       │ │
│  │  • Blog Posts          │  │  • AI Task Coordination        │ │
│  │  • Uploaded Files      │  │  • Trade/Swap Agreements       │ │
│  └────────────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Algorand Box Storage                          │
│           e:<entity_id>  |  p:<process_id>                      │
│                  App ID: 750081112 (TestNet)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Proof: Four Working Applications

We didn't just theorize — we built **four complete applications** on the SAME contract:

### 1. Eternal Bliss — On-Chain RPG Game
A fully on-chain peer-to-peer RPG with PvP battles and blockchain matchmaking.

| | |
|---|---|
| **Live Demo** | [Play Now](https://ch4itu.github.io/EternalBliss/) |
| **Documentation** | [GAME_README.md](./GAME_README.md) |
| **Uses** | Entities (player profiles), Processes (PvP battles) |

### 2. AI Code Review — Multi-Agent Coordination
Two AI agents (Grok + ChatGPT) collaborate on code with end-to-end encryption.

| | |
|---|---|
| **Live Demo** | [auto-code-review.html](./auto-code-review.html) |
| **Documentation** | [AI_CODE_REVIEW_README.md](./AI_CODE_REVIEW_README.md) |
| **Uses** | Processes (turn-based coordination), Entities (encrypted chunks) |

### 3. On-Chain Blog — Censorship-Resistant Publishing
A decentralized blog where posts live forever on the blockchain.

| | |
|---|---|
| **Live Demo** | [blog.html](./blog.html) |
| **Documentation** | [BLOG_README.md](./BLOG_README.md) |
| **Uses** | Entities (blog posts with author ownership) |

### 4. Eternal Storage — Permanent File Storage
Upload files permanently to the blockchain. Store HTML, JS, CSS, images, and more.

| | |
|---|---|
| **Live Demo** | [eternal-storage.html](./eternal-storage.html) |
| **Documentation** | [ETERNAL_STORAGE_README.md](./ETERNAL_STORAGE_README.md) |
| **Uses** | Entities (chunked file storage with manifest) |

> **Same contract, same 11 methods, four completely different domains — all live and working.**

---

## Why Algorand?

| Metric | Value |
|--------|-------|
| Block Time | 2.85 seconds |
| TPS | 10,000+ |
| Transaction Fee | 0.001 ALGO (~₹0.03) |
| Finality | Instant (never forks) |
| Nodes | 3,000+ worldwide |
| Carbon | Carbon negative |

**The blockchain trilemma (scalability vs. security vs. decentralization) is less of a concern on Algorand** — it achieves all three through Pure Proof of Stake.

---

## What Makes This Innovative?

State machines on blockchain are not new. FSM-based contract design tools exist ([FSolidM](https://arxiv.org/abs/1711.09327), [SSM](https://github.com/lyriarte/blockchain-ssm)). So what's different here?

| Existing Approaches | Our USM Framework |
|---------------------|-------------------|
| Generate domain-specific contracts | **One deployed contract** for all domains |
| Deploy new contract per application | **Use existing contract** (App ID: 750081112) |
| Custom primitives per use case | **Two fixed primitives** (Entity + Process) |
| Often need backend servers | **True serverless** — static HTML + public RPC |
| Theoretical universality | **Proven with 4 working demos** |

### The Core Innovation

**Nobody else has deployed a single reusable contract on a public blockchain with:**
1. **Entity + Process abstraction** — two primitives that cover 90% of application needs
2. **MBR growth-only optimization** — pay only for data size increases, not full cost
3. **Empirical proof of universality** — Game, AI Coordination, Blog, and File Storage on the same contract
4. **True serverless** — static HTML + public RPC, no backend servers required

### Comparison with Closest Alternative

| Aspect | SSM (Hyperledger) | Our USM (Algorand) |
|--------|-------------------|---------------------|
| Blockchain | Permissioned | Public |
| Setup | Deploy Fabric network | Use existing contract |
| Primitives | Signing-based states | Entity + Process |
| Cost | Infrastructure overhead | ~₹0.03 per transaction |

---

## Smart Contract Methods

```python
# Entity Methods (Single-Owner)
save_entity(entity_id, entity_data, mbr_payment) → string
load_entity(entity_id) → string  # readonly
delete_entity(entity_id) → string
transfer_entity(entity_id, new_owner) → string

# Process Methods (Two-Party)
start_process(process_id, other_party, initial_state, timeout, mbr_payment) → string
update_process(process_id, new_state, mbr_payment) → string
resign_process(process_id) → string  # graceful exit
load_process(process_id) → string  # readonly
delete_process(process_id) → string
```

### MBR Optimization

We only charge for data **growth**, not full MBR on every update:

```python
# MBR Formula
entity_mbr = 2500 + 400 × (prefix + key_length + 32 + data_length)
process_mbr = 2500 + 400 × (prefix + key_length + 81 + data_length)

# On update: charge ONLY the difference
if new_size > old_size:
    charge = 400 × (new_size - old_size)
else:
    charge = 0  # Free!
```

**Result:** Most updates cost 0 microAlgos.

---

## Quick Start

### For Developers
```javascript
import algosdk from 'algosdk';

const APP_ID = 750081112;
const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);

// Save any data (profile, product record, certificate...)
await saveEntity(account, 'product:SKU123', JSON.stringify({
  name: 'Widget Pro',
  manufacturer: 'ACME Corp',
  status: 'MANUFACTURED',
  timestamp: Date.now()
}));

// Start a two-party workflow (handoff, battle, trade...)
await startProcess(account, 'handoff:123', retailerAddress, JSON.stringify({
  status: 'IN_TRANSIT',
  location: 'Warehouse A'
}), 28800); // 24-hour timeout
```

### For Non-Developers
Use our **[AI Prompts Guide](./docs/AI_PROMPTS_GUIDE.md)** — copy-paste prompts to Claude, ChatGPT, Gemini, or Grok and get working code without writing a single line yourself!

---

## Documentation

| Document | Description |
|----------|-------------|
| [Developer Guide](./docs/DEVELOPER_GUIDE.md) | Step-by-step integration instructions |
| [API Reference](./docs/API_REFERENCE.md) | Complete method documentation |
| [Examples](./docs/EXAMPLES.md) | Ready-to-use templates |
| [AI Prompts Guide](./docs/AI_PROMPTS_GUIDE.md) | Build apps without coding |
| [Eternal Storage](./ETERNAL_STORAGE_README.md) | File storage documentation |

---

## Deployed Links

### Smart Contract (TestNet)
- **App ID:** `750081112`
- **Explorer:** [Lora DApp Lab](https://lora.algokit.io/testnet/application/750081112)
- **Language:** Algorand Python (AlgoPy)
- **Storage:** Box storage with `e:` and `p:` prefixes

### Frontend Hosting (Multiple Mirrors)
| Platform | URL |
|----------|-----|
| NFD | https://chaitanya.algo.xyz |
| GitHub Pages | https://ch4itu.github.io/EternalBliss/ |
| IPFS/Filecoin | [Lighthouse Gateway](https://gateway.lighthouse.storage/ipfs/bafybeialyildmreimxdynuvnlt2f543bacaune4bvrrouvrgabsp6nhn6u/) |
| Arweave | [ArDrive Gateway](https://yqat2uhzr47lrwllqngsxa5hktkldqjbza6og6f2mhotinq24ota.arweave.net/xAE9UPmPPrjZa4NNK4OnVNSxwSHIPON4umHdNDYa46Y/) |

---

## Use Cases

| Domain | Entities | Processes |
|--------|----------|-----------|
| **Gaming** | Player profiles, inventories | PvP battles, trades |
| **Supply Chain** | Product records, manifests | Handoff workflows |
| **AI Coordination** | Task definitions, agent profiles | Multi-agent workflows |
| **File Storage** | Chunked files, manifests | — |
| **Credentials** | Certificates, achievements | Issuance/revocation flows |
| **Publishing** | Blog posts, articles | Editorial workflows |
| **Trading** | Asset listings | Escrow/swap agreements |

### Supply Chain Example: "Burn on Sale" Anti-Counterfeit

One powerful application is anti-counterfeit tracking with immutable state transitions:

```
MANUFACTURED → IN_TRANSIT → AT_RETAILER → SOLD (burned)
```

When a product is sold, the status is permanently updated to `SOLD`. Any duplicate QR code scanned afterward reveals: *"This product was already sold on [date]"* — eliminating counterfeits without relying on company servers.

**Cost:** ~400 bytes of product data = ~₹5 (one-time, refundable MBR)

---

## Security

### Built-In Protections
- **Ownership Verification:** Entities enforce owner-only updates
- **Turn Enforcement:** Processes require correct participant's turn
- **MBR Validation:** Contract validates all payment amounts
- **Size Limits:** 64-byte keys, customizable data limits
- **Timeout Protection:** Processes can timeout to prevent deadlocks

### Privacy Notes
- Box data is publicly readable on-chain
- Use client-side encryption for sensitive data (see AI Code Review example)
- Choose what to encrypt vs. keep transparent

---

## Roadmap

### Completed
- [x] Universal state machine contract (entities + processes)
- [x] Box storage with MBR optimization
- [x] Process timeout/resignation handling
- [x] Multiple example applications (Game, Blog, AI Code Review)
- [x] Comprehensive documentation

### Planned
- [ ] JavaScript SDK package (npm installable)
- [ ] Pera Wallet & Defly Wallet integration
- [ ] Pagination/index boxes for large datasets
- [ ] Multi-party processes (>2 participants)
- [ ] Supply chain domain templates
- [ ] MainNet deployment

---

## Team

**Team APTMIZE**
- Mr. Chaitanya Kumar Jagabathula
- Mr. Srinivas Uggirala

---

## License

MIT License — see [LICENSE](LICENSE) file.

---

## Acknowledgments

### Algorand Ecosystem
- **Algorand Foundation** — Platform, SDK, documentation
- **AlgoPy Team** — Smart contract framework
- **Lora DApp Lab** — Contract exploration tools
- **AlgoNode** — Public RPC infrastructure

### Hosting Partners
- **Lighthouse** — IPFS/Filecoin deployment
- **ArDrive** — Arweave deployment
- **GitHub Pages** — Static hosting

### AI Assistance
Special thanks to Claude, ChatGPT, Gemini, and Grok for architecture design, code review, and documentation.

---

*Built with the Universal State Machine Framework — Where data lives forever.*
