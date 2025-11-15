# ETERNAL BLISS — FULLY ON‑CHAIN P2P RPG GAME
### Built on a **Universal On‑Chain State‑Machine Framework** (Algorand TestNet)

[![Play Now](https://img.shields.io/badge/Play%20Now-GitHub%20Pages-success)](https://ch4itu.github.io/EternalBliss/)
[![Smart Contract](https://img.shields.io/badge/Contract-749599252-blue)](https://lora.algokit.io/testnet/application/749599252)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 📄 Project Overview

**Eternal Bliss** is a fully on-chain peer-to-peer RPG where **gameplay, player state, PvP battles, and matchmaking** are stored directly on the Algorand blockchain. The game showcases a **Universal State Machine Contract** that can power not just games, but also supply chain tracking, AI agent coordination, educational credentials, and content publishing.

### Purpose
Solve the **"Sunset Issue"** — most apps die when servers shut down. By putting core game state on-chain using Algorand's box storage, the game continues working **without us**. Players own their data, and anyone can build new UIs on the same verifiable state.

### Key Features
- ✅ **Serverless Architecture** — Pure HTML/JS client + public RPC nodes
- ✅ **Real-time PvP Battles** — Turn-based combat with wagering system
- ✅ **Blockchain Matchmaking** — Spam-proof waiting list stored on-chain
- ✅ **MBR Optimized** — Pay only for data growth, not full MBR on updates
- ✅ **Mobile & Desktop** — Responsive UI with touch controls
- ✅ **Secure Wallet** — Masked mnemonic input with show/hide toggle

---

## 🔗 Deployed Links

### 🌐 Live Frontend
**NFD:**

https://chaitanya.algo.xyz

**GitHub Pages:** https://ch4itu.github.io/EternalBliss/

**IPFS/Filecoin (thanks to Lighthouse):**
https://gateway.lighthouse.storage/ipfs/bafybeidnhxhrgrbquqz4wchvbylrlocnoicxaq4sivlrqbaizxc5cb3ixu/

**Arweave (thanks to ArDrive):**
https://z4wx2lzurwmlwjr23r4znyobq7vuavrfqwbyzagdabpb3ni7rewa.arweave.net/zy19LzSNmLsmOtx5luHBh-tAViWFg4yAwwBeHbUfiSw/

### 📜 Smart Contract (TestNet)
- **App ID:** `749599252`
- **Lora DApp Lab:** https://lora.algokit.io/testnet/application/749599252
- **Contract Type:** Universal State Machine (Entities + Processes)
- **Language:** Algorand Python (AlgoPy)
- **Storage:** Box storage with `e:` and `p:` prefixes

### 🔍 Verify Contract
1. Visit https://lora.algokit.io/testnet/application/749599252
2. Check **ABI Methods:** `save_entity`, `load_entity`, `start_process`, `update_process`, etc.
3. View **Box Storage:** See live player data and battle states
4. Inspect **Transactions:** Real gameplay happening on-chain

---

## ⚙️ Setup & Installation

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari)
- Algorand TestNet wallet with some ALGO
- 25-word Algorand mnemonic phrase

### Option 1: Play Online (Easiest)
Just visit — no installation needed!
**https://ch4itu.github.io/EternalBliss/** 

or

**https://gateway.lighthouse.storage/ipfs/bafybeidnhxhrgrbquqz4wchvbylrlocnoicxaq4sivlrqbaizxc5cb3ixu/**

or

**https://z4wx2lzurwmlwjr23r4znyobq7vuavrfqwbyzagdabpb3ni7rewa.arweave.net/zy19LzSNmLsmOtx5luHBh-tAViWFg4yAwwBeHbUfiSw/**

### Option 2: Run Locally
```bash
# Clone the repository
git clone https://github.com/ch4itu/EternalBliss.git
cd EternalBliss

# Open in browser (no build step required!)
open index.html

# OR use a local server:
python -m http.server 8000
# Visit http://localhost:8000
```

### First-Time Setup
1. **Get TestNet ALGO**
   - Visit https://bank.testnet.algorand.network/
   - Request free TestNet ALGO (you'll need ~0.1 ALGO for MBR)

2. **Connect Wallet**
   - Enter your 25-word Algorand mnemonic in the game
   - Mnemonic is masked by default (click 👁️ to show/hide)
   - First connection auto-registers your player (~50,000 microAlgos)

3. **Play**
   - Explore the world, battle enemies, level up
   - Challenge other players to PvP battles
   - All progress saved on-chain automatically

### Project Structure
```
EB-NH/
├── index.html          # Main game UI
├── world.js            # Game mechanics & rendering
├── blockchain.js       # Algorand SDK integration
├── pvp.js              # PvP battle logic
├── styles.css          # Game styling
├── constants.js        # Shared constants
├── contracts/
│   └── contract.py     # UniversalStateMachine smart contract
└── README.md           # This file
```

---

## 🧠 Architecture & Components

### Smart Contract: UniversalStateMachine

The contract provides two core primitives that work for any domain:

#### 1️⃣ **Entities** — Single-Owner Data Storage
```python
# Store: Player profiles, documents, credentials, blog posts
save_entity(entity_id: string, entity_data: string, mbr_payment: txn) -> string
load_entity(entity_id: string) -> string  # readonly
delete_entity(entity_id: string) -> string

# Box Format: e:<entity_id> → owner(32 bytes) + JSON data
# Access: Only owner can update
# MBR: Pay only for data GROWTH, 0 cost if same size
```

**Game Usage:**
- Player state: `e:<wallet_address>` → {hp, mp, level, inventory, position}
- Waiting list: `e:w:<wallet_address>` → {name, level, stats, wager}

#### 2️⃣ **Processes** — Two-Party Turn-Based Coordination
```python
# Store: PvP battles, negotiations, supply chain handoffs
start_process(process_id: string, other_party: address, initial_state: string, mbr_payment: txn) -> string
update_process(process_id: string, new_state: string, mbr_payment: txn) -> string
load_process(process_id: string) -> string  # readonly
delete_process(process_id: string) -> string

# Box Format: p:<process_id> → participant1(32) + participant2(32) + turn(8) + JSON data
# Access: Turn-based (player1 → player2 → player1...)
# MBR: Pay only for data GROWTH, 0 cost if same size
```

**Game Usage:**
- PvP battles: `p:<battle_id>` → {player1, player2, hp, mp, turnNumber, wager, status}

### Client Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (Static HTML/JS)                      │
│  ┌──────────────┐  ┌──────────────┐            │
│  │  world.js    │  │  pvp.js      │            │
│  │  (Game UI)   │  │  (PvP Logic) │            │
│  └──────────────┘  └──────────────┘            │
│         │                   │                   │
│         └───────────────────┘                   │
│                     │                           │
│         ┌───────────▼──────────┐                │
│         │   blockchain.js      │                │
│         │   (AlgoSDK Wrapper)  │                │
│         └──────────────────────┘                │
└─────────────────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │  Algorand Public RPC  │
         │  (algonode.cloud)     │
         └───────────────────────┘
                     │
         ┌───────────▼───────────┐
         │  Smart Contract       │
         │  App ID: 749599252    │
         │  (Box Storage)        │
         └───────────────────────┘
```

### Key Design Decisions

1. **No Backend Servers**
   - Frontend talks directly to public Algorand RPC nodes
   - AtomicTransactionComposer for all blockchain operations
   - Zero hosting costs, works forever

2. **Box Storage Only**
   - Deprecated transaction notes (except chat)
   - All persistent state in boxes for reliability
   - Efficient MBR: only pay for growth

3. **Optimized Performance**
   - Battle turn polling: 2 seconds
   - Matchmaking polling: 5 seconds
   - Client-side state caching with timestamp validation
   - Auto-save every 10 minutes + on significant events

4. **MBR Optimization Strategy**
   ```javascript
   // Check existing box size before paying MBR
   const existingBox = await algod.getApplicationBoxByName(appId, boxKey);
   const sizeDiff = Math.max(0, newSize - existingBox.length);
   const mbrAmount = sizeDiff * 400; // Usually 0!
   ```

   **Results:**
   - Position updates: **0 microAlgos** (same size)
   - Battle turns: **0-1,600 microAlgos** (usually 0)
   - Waiting list rejoin: **0 microAlgos** (same data)
   - Savings: **40,000-120,000 microAlgos per update** vs. naive approach

---

## 🎮 Gameplay Features

### PvE (Player vs Environment)
- Explore procedurally generated world (forests, water, mountains, dungeons)
- Battle random encounters (FUD Slime, Gas Fee Rat) scaled to your level
- Gain XP, level up, increase HP/MP/attack/defense/magic stats
- Collect gold, health potions, mana potions, keys
- Find boats for water traversal, pickaxes for mining
- NPC shops for buying items
- Teleport system (25 gold per use)

### PvP (Player vs Player)
- **Instant Matchmaking:** See available opponents in ~5 seconds
- **Wager System:** Bet boats, keys, pickaxe, gold before battle
- **Turn-Based Combat:** Attack, magic bolt, flee options
- **Real-Time Updates:** Opponent moves detected in ~2 seconds
- **Resignation Handling:** Clean exit if either player quits
- **Winner Takes All:** Wager automatically transferred on victory
- **On-Chain Verification:** All battles stored in contract box storage

### Progression System
- Level up formula: XP required = floor(previous * 1.4)
- Stat increases on level up (randomized ranges):
  - HP: +15-25, MP: +8-13
  - Attack: +2-5, Defense: +1-3, Magic: +3-7
- Stats persist on-chain forever (no server required)
- Battle victories tracked (enemies defeated counter)
- Gold and inventory maintained across sessions

---

## 📝 OnChain Blog

A fully decentralized blog powered by the same Universal State Machine contract:

- **Live Demo:** [blog.html](./blog.html) - Write posts stored forever on Algorand
- **Architecture:** Entity storage with `blog:<author>:<timestamp>` keys
- **Features:**
  - ✅ Create posts (title + content) on blockchain
  - ✅ View all posts from all users
  - ✅ Delete own posts (author verification)
  - ✅ Permanent storage with box storage
  - ✅ ~0.002-0.007 ALGO per post
- **Documentation:** See [BLOG_README.md](./BLOG_README.md) for details

This demonstrates how the same smart contract can power completely different applications - from games to blogs - using the same entity/process primitives.

---

## 🧩 Universal Framework Use Cases

The same contract powers multiple domains by changing the `entity_id` and logic:

### 🎮 Gaming (Current Implementation)
- **Entities:** Player profiles, waiting list entries
- **Processes:** PvP battles with turn-based combat
- **State:** HP, MP, inventory, position, level, XP

### 📦 Supply Chain Tracking
- **Entities:** Shipment records, product manifests
- **Processes:** Handoff workflows (CREATE → PICKUP → TRANSIT → DELIVERED)
- **State:** Location, timestamp, handler signatures

### 🤖 AI Agent Coordination
- **Entities:** Task definitions, agent profiles
- **Processes:** Multi-agent workflows (QUEUED → ASSIGNED → WORKING → DONE)
- **State:** Task parameters, results, agent assignments

### 🎓 Educational Credentials
- **Entities:** Learner profiles, course completions
- **Processes:** Assessment workflows (SUBMITTED → GRADED → CERTIFIED)
- **State:** Scores, completion dates, verifiable credentials

### 📝 Content Publishing
- **Entities:** Blog posts, comments, articles
- **Processes:** Editorial workflows (DRAFT → REVIEW → PUBLISHED)
- **State:** Content, metadata, author info

> **Key Insight:** Same 10 ABI methods, different domain logic. The contract is truly universal.

---

## 📡 Complete Contract ABI

### Entity Methods
```python
save_entity(entity_id: string, entity_data: string, mbr_payment: txn) -> string
load_entity(entity_id: string) -> string  # readonly
delete_entity(entity_id: string) -> string
transfer_entity(entity_id: string, new_owner: address) -> string
get_entity_owner(entity_id: string) -> address  # readonly
```

### Process Methods
```python
start_process(process_id: string, other_party: address, initial_state: string, mbr_payment: txn) -> string
update_process(process_id: string, new_state: string, mbr_payment: txn) -> string
load_process(process_id: string) -> string  # readonly
delete_process(process_id: string) -> string
get_process_info(process_id: string) -> (address, address, uint64)  # readonly
```

### Admin Methods
```python
pause() -> string
unpause() -> string
set_admin(new_admin: address) -> string
withdraw_excess(amount: uint64) -> string
get_admin() -> address  # readonly
is_paused() -> bool  # readonly
```

### MBR Formula
```python
# Entity MBR = 2500 + 400 * (2 + key_length + 32 + data_length)
# Process MBR = 2500 + 400 * (2 + key_length + 72 + data_length)

# Contract validates payment and only charges for growth!
if new_data_length > old_data_length:
    delta_mbr = 400 * (new_data_length - old_data_length)
    # Charge only delta_mbr
else:
    # No charge if data shrinks or stays same
```

---


## 🗺️ Roadmap

### ✅ Completed
- [x] Universal state machine contract (entities + processes)
- [x] Box storage with MBR optimization
- [x] PvP battles with wagering system
- [x] Blockchain-based matchmaking
- [x] Mobile responsive UI
- [x] Mnemonic security (masking)
- [x] Battle stats persistence
- [x] Fast turn updates (2s polling)

### 🚧 In Progress
- [ ] Pera Wallet & Defly Wallet integration
- [ ] Client-side encryption for sensitive data
- [ ] Enhanced error recovery for network issues

### 📅 Planned
- [ ] Pagination/index boxes for large datasets
- [ ] PvP reputation & rating system
- [ ] Multi-player party system (>2 participants)
- [ ] JavaScript SDK package (npm installable)
- [ ] PWA support for offline gameplay
- [ ] Domain templates (supply chain, AI, edu)
- [ ] Comprehensive test suite & security audits
- [ ] MainNet deployment (when ready)

---

## 🔐 Security Considerations

### Current Implementation
- ✅ **Ownership Verification:** Entities enforce owner-only updates
- ✅ **Turn Enforcement:** Processes require correct turn to update
- ✅ **MBR Protection:** Contract validates all payment amounts
- ✅ **Data Validation:** Max sizes enforced (64 byte keys, 4096 byte data)
- ✅ **Mnemonic Security:** Input masked by default, toggle to reveal
- ✅ **No Server Trust:** Direct RPC communication, no intermediaries

### Privacy Notes
- ⚠️ **Public Data:** All box data is readable by anyone on-chain
- 🔄 **Future Enhancement:** Client-side encryption planned (XChaCha20-Poly1305)
- 🔄 **Selective Privacy:** Choose what to encrypt vs. keep public

### Best Practices
1. Use **TestNet only** for demos and testing
2. **Never share** your mnemonic phrase with anyone
3. Monitor MBR costs (optimized to ~0 for most updates)
4. Design access policies before storing sensitive data
5. Keep browser updated for latest security patches

---

## 📜 License

MIT License - see [LICENSE](LICENSE) file for details.

You are free to:
- ✅ Use commercially
- ✅ Modify the code
- ✅ Distribute
- ✅ Use privately

---

## 🙏 Acknowledgments

### Algorand Ecosystem
- **Algorand Foundation** — Blockchain platform, AlgoSDK, documentation
- **AlgoPy Team** — Smart contract development framework
- **Lora DApp Lab** — Contract exploration and testing tools

### Development Tools
- **Lighthouse** — IPFS deployment and hosting
- **ArDrive** — Arweave deployment and hosting
- **GitHub Pages** — Static site hosting
- **AlgoNode** — Public RPC infrastructure

### AI Assistance
Special thanks to AI assistants (ChatGPT, Claude, Gemini, Grok) for:
- Universal state machine contract architecture
- PvP battle system with turn-based mechanics
- MBR optimization strategies and implementation
- Mobile controls and responsive UI design
- Security features (mnemonic masking, error handling)
- Performance optimizations and debugging
- Documentation and README structure
- Architecture patterns and best practices

