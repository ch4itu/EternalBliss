# 🌟 Eternal Bliss — A Fully On-Chain P2P RPG on Algorand

https://ch4itu.github.io/EternalBliss/

## 📖 Overview

Eternal Bliss is a **fully on-chain P2P RPG** built natively on the Algorand blockchain.  
Everything — your hero, stats, battles, progress, economy, maps, and even chat — is stored and executed directly on-chain.

**No servers.  
No external databases.  
No hidden sync layers.  
The blockchain itself is the game engine and source of truth.
Connections through RPCs.**

Unlike many blockchain games that have **sunsetted** and erased all player progress and assets, Eternal Bliss is designed so that **nothing can vanish**. Heroes, items, maps, and stories remain permanent on Algorand — independent of developers or companies.

Eternal Bliss demonstrates that decentralized games can be **fun, fair, permanent, and player-owned**.

---

## 🎮 Gameplay Loop

- **Create Hero** → Opt-in mints your Hero NFT and initializes stats.  
- **Explore** → Move across forests, villages, mountains, lakes, and more (browser-rendered map).  
- **Battle** → Fight enemies, earn gold & XP using transparent on-chain formulas:  
  - Gold = `enemyLevel * 10 + 15`  
  - XP = `enemyLevel * 15 + 20`  
- **Navigate** → Use boats to cross water bodies (15 moves per boat) or pickaxes to clear mountains (10 uses per pickaxe).
- **Progress** → Spend gold on items, trade with peers using atomic transfers.  
- **Offline Play** → The game can be played completely offline; local state is stored, then synced back to Algorand in one efficient transaction.  
- **Immortality** → Your Hero NFT is forever etched on-chain — your story can't be lost.  

---

## 🪙 On-Chain Assets

- **Hero NFT** → unique character identity.  
- **Gold ASA** → fungible currency earned in battles.  
- **Player Stats** → stored in smart contract local state:  
  - HP, MP, XP, Level, Location, Battles Won.  
- **Maps** → The game map itself is stored on-chain. Player-created maps can also be uploaded on-chain using the Mapmaker.  
- **Trustless Trading** → powered by Algorand atomic transfers.  

---

## ⚡ Why Algorand?

- ⏱️ Instant finality (<3s) → smooth, responsive battles.  
- 💸 Fixed 0.001 ALGO fee → scalable micro-interactions.  
- 🌱 Pure Proof-of-Stake (PPoS) → secure and eco-friendly.  
- 🐍 PyTeal contracts → readable, auditable, and efficient.  
- 🔗 ASAs + Atomic Transfers → bug-free and secure economy.  

---

## 🛠️ Architecture

- **Frontend**: `index.html`, `styles.css`, `script.js`  
  - Browser-only client.  
  - No external dependencies (no APIs, CDNs, or servers).  
  - **The full code bundle (HTML/CSS/JS) is stored on-chain** and can be accessed by referencing a transaction ID (via Algorand note field or ARC-69/ARC-3 style storage).  
- **Smart Contract**: `algorand-rpg-smart-contract.py`  
  - Written in PyTeal.  
  - Manages hero creation, battles, XP/gold formulas, inventory, and NFT minting.  
- **Offline Mode**: Local progress stored in browser storage, later synced on-chain.  
- **Multiplayer & Chat**:  
  - Peer-to-peer play enabled via Algorand transactions.  
  - Global chat stored in Algorand note fields — permanent, verifiable, censorship-resistant.  
- **Mapmaker**:  
  - `mapmaker.html` + tools for creating terrains, NPCs, enemies, castles, and temples.  
  - Export/import maps to extend the world and create new adventures.  
  - **Maps can be stored on-chain**, and user-created maps can be uploaded to become part of the permanent world.  

---

## 🎒 Game Features

### Navigation & Exploration
- **Boat System**: Purchase boats (50 gold) to cross water bodies. Each boat provides 15 water tiles of movement. When moves run out while on water, an automatic rescue system teleports you to the nearest land with a small penalty (-20 HP, -10 gold).
- **Pickaxe System**: Buy pickaxes (75 gold) to clear mountain obstacles. Each pickaxe has 10 uses and permanently converts mountain tiles to grass, creating new pathways.
- **Dynamic Map Import**: Load preset maps (Starter Village, Large City, Dungeon, Forest Temple, Desert Oasis, Mountain Fortress, Swamp Ruins, Coastal Port) or create custom maps using the integrated Mapmaker.

### Inventory Management
- **Consumable Items**: Health potions (15 gold), Mana potions (10 gold)
- **Tools**: Boats (reusable with move limits), Pickaxes (durability-based), Keys (unlock doors)
- **Real-time UI**: Track boat sailing moves, pickaxe durability, and all inventory items

### Visual Enhancements
- **Avatar System**: Emoji-based character representations with level tiers (Novice, Veteran, Expert, Master, Legendary)
- **Terrain Variety**: Grass, water, mountains, forests, roads, sand, and more
- **Building Types**: Inns (rest/heal), Shops (buy items), Temples (free healing), Castles (quests)
- **Particle Effects**: Visual feedback for item collection, battles, level-ups, and interactions

### Safety Features
- **Water Rescue**: Prevents players from getting stuck on water tiles
- **Auto-save**: Progress automatically syncs to Algorand blockchain
- **Offline Compatibility**: Play without connection, sync when ready

---

## 🔒 The Sunset Problem

Most "on-chain" games today are only partially decentralized. They shut down servers, stop maintaining contracts, or remove frontends — and player assets effectively disappear.

**Eternal Bliss is different.**  
- Heroes and stats are written directly on Algorand.  
- Items, gold, and maps are ASAs or note-field data, secured at Layer-1.  
- The game client is static HTML/JS, portable and forkable by anyone.  

Even if the original team steps away, the world of Eternal Bliss will **never sunset**. Players can always rebuild the frontend and continue their journey, because the game itself lives on the blockchain.  

---

## 🗺️ Roadmap

- ✅ Core smart contract deployed on TestNet.  
- ✅ Boat navigation system with auto-rescue.
- ✅ Pickaxe tool with durability system.
- ✅ Dynamic map importer with 8 preset worlds.
- ✅ Enhanced avatar and visual systems.
- 🔨 Frontend enhancements (UI, animations, multiplayer polish) — IN PROGRESS.  
- 🛒 In-game marketplace (ASA-based trading) — SOON.  
- 🌍 Mainnet launch + community-driven expansion — SOON.  

---

## ⚠️ Security

Eternal Bliss is a **prototype demo for hackathons**.  
- Always use throwaway wallets.  
- Do not import keys that hold real funds.  

---

## 🚀 How to Run

1. Clone this repository.  
2. Open `index.html` in your browser.  
3. Connect via mnemonic/private key (demo input).  
4. Play, explore, battle — offline or online.  
5. Purchase boats and pickaxes from shops to navigate terrain.
6. Sync progress to Algorand TestNet when ready.  
7. Use `mapmaker.html` to design or extend maps and plug them into the main game.  

---

✨ Eternal Bliss isn't just a game. It's a **proof-of-concept** that shows what happens when the blockchain itself **hosts the entire world**:  
- play offline,  
- sync on-chain,  
- chat peer-to-peer,  
- store maps on-chain,  
- access the full client via a transaction ID,  
- navigate with consumable tools (boats, pickaxes),
- import community-created worlds,
- keep progress forever,  
- **never sunset**.  

## HEAVILY BORROWED FROM CHATGPT/CLAUDE/GEMINI/GROK
