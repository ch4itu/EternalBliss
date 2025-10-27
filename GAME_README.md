# 🌟 Eternal Bliss – A Fully On-Chain P2P RPG on Algorand

https://ch4itu.github.io/EternalBliss/

## 📖 Overview

Eternal Bliss is a **fully on-chain P2P RPG** built natively on the Algorand blockchain.  
Everything – your hero, assets, stats, battles, progress, economy, maps, and even chat – is stored and executed directly on-chain.

**No servers.  
No external databases.  
No hidden sync layers.  
The blockchain itself is the game engine, data server, sync server and source of truth.
Connections through RPCs.**

Unlike many blockchain games that have **sunsetted** and erased all player progress and assets, Eternal Bliss is designed so that **nothing can vanish**. Heroes, items, maps, and stories remain permanent on Algorand – independent of developers or companies.

Eternal Bliss demonstrates that decentralized games can be **fun, fair, permanent, and player-owned**.

---
## 🎮 Game Overview (What you can do right now)

**Core loop**
- **Explore offline** in a single‑page HTML/JS client; no wallet required until you save.
- **Connect wallet** only to persist or load state; everything writes to the contract (no servers).

**On‑chain save/restore**
- Persist **level, HP/MP, location (x,y,zone), inventory**, and other attributes as a JSON blob in **App Box** storage.
- Read back the same entity to restore your last known position and stats across sessions and devices.

**PvP (scaffold)**
- **Challenge broadcast** as a chain transaction; peers can accept on‑chain.
- **Escrow module** planned (hold gold/items; distribute rewards; dispute flow).

**World chat**
- Simple global chat via on‑chain writes (migrating from txn notes → encrypted Box payloads).

**No servers**
- Frontend is static **HTML/JS/CSS**, talking directly to **public RPC** via **AtomicTransactionComposer**.
- This is the same universal pattern we reuse for blogs, supply‑chain, AI tasks, and edtech.

**Controls & UX (suggested defaults)**
- **W/A/S/D or arrow keys** to move; **E/Enter** to interact; **I** for inventory; **M** for map.
- **Save** from the menu (connect wallet if needed); **Load** auto‑fetches the last saved snapshot.

**Deployed (TestNet)**
- **Application ID:** 748592697
- **Demo options:**  
  - **Lora DApp Lab** (ABI calls): call `save_entity` / `save_player` + read back.  
  - **Static site:** use the project’s `index.html` or published demo to move, save, and restore.

---

## 🎮 Gameplay Loop

- **Create Hero** → Opt-in mints your Hero NFT and initializes stats.  
- **Explore** → Move across forests, villages, mountains, lakes, and more (browser-rendered map).  
- **Battle** → Fight enemies, earn gold & XP using transparent on-chain formulas:  
  - Gold = `enemyLevel * 10 + 15`  
  - XP = `enemyLevel * 15 + 20`  
- **Navigate** → Use boats to cross water bodies (15 moves per boat) or pickaxes to clear mountains (10 uses per pickaxe).
- **PvP Combat** → Challenge other players to real-time battles with wagering system (boats, keys, pickaxe, gold).
- **Progress** → Spend gold on items, trade with peers using atomic transfers.  
- **Offline Play** → The game can be played completely offline; local state is stored, then synced back to Algorand in one efficient transaction.  
- **Immortality** → Your Hero NFT is forever etched on-chain – your story can't be lost.  

---

## 🪙 On-Chain Assets

- **Hero NFT** → unique character identity.  
- **Gold ASA** → fungible currency earned in battles.  
- **Inventory** → Boats, Keys, Hammers. 
- **Player Stats** → stored in smart contract local state:  
  - HP, MP, XP, Level, Location, Battles Won.  
- **Maps** → The game map itself is stored on-chain. Player-created maps can also be uploaded on-chain using the Mapmaker.  
- **PvP Challenges** → Challenge broadcasts stored on Algorand blockchain with wager details.
- **Trustless Trading** (planned) → powered by Algorand atomic transfers.  

---

## ⚡ Why Algorand?

- ⏱️ Instant finality (<3s) → smooth, responsive battles and PvP challenges.  
- 💸 Fixed 0.001 ALGO fee → scalable micro-interactions.  
- 🌱 Pure Proof-of-Stake (PPoS) → secure and eco-friendly.  
- 🐍 Algorand Python contracts → readable, auditable, and efficient.  
- 🔗 Box Storage → storing game data.  

---

## 🛠️ Architecture

- **Frontend**: `index.html`, `styles.css` and `js`  
  - Browser-only client.  
  - No external dependencies (no APIs, CDNs, or servers).  
  - **The full code bundle (HTML/CSS/JS) will be stored on-chain** in boxes.  
- **Smart Contract**: `contract.py`  
  - Written in PyTeal.  
  - Manages hero creation, battles, XP/gold formulas, inventory, and NFT minting.  
- **Offline Mode**: Local progress stored in browser storage, later synced on-chain.  
- **Multiplayer & Chat**:  
  - Peer-to-peer play enabled via Algorand transactions.  
  - Global chat stored in Algorand note fields – permanent, verifiable, censorship-resistant.  
- **PvP System**:
  - Real-time player vs player combat with blockchain-verified challenges.
  - Coordinate-based matchmaking (5-tile range).
  - Wagering system with winner-takes-all rewards.
  - Challenge broadcasts stored on-chain for transparency.
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

### Player vs Player Combat (PvP)
- **Ready for PvP**: Click the "Ready for PvP" button to broadcast your challenge to all players for 3 minutes
- **Wager System**: Stake boats, keys, pickaxe uses, and gold – winner takes all (2x the wager)
- **Coordinate-Based Matching**: Must be within 5 tiles of opponent to challenge
- **Real-Time Notifications**: Get notified when someone accepts your challenge
- **5-Action Combat**:
  - ⚔️ **Attack** - Free, normal damage with 15% critical hit chance
  - ✨ **Magic** - 15 MP, ignores armor, powerful spell damage
  - 🛡️ **Defend** - Free, +5 DEF temporarily for defensive play
  - 💚 **Heal** - Uses 1 health potion to restore HP mid-battle
  - 🔥 **Ultimate** - 25 MP, massive 1.8x ATK damage for finishers
- **Challenge List**: View all active PvP challenges with distance indicators and navigation arrows
- **Blockchain Verified**: All challenges and outcomes recorded on Algorand
- **Fair Rewards**: Winner gets 2x wager + bonus XP (opponent level × 50)
- **Smart Matchmaking**: Distance-based system ensures strategic positioning matters

### Visual Enhancements
- **Avatar System**: Emoji-based character representations with level tiers (Novice, Veteran, Expert, Master, Legendary)
- **Terrain Variety**: Grass, water, mountains, forests, roads, sand, and more
- **Building Types**: Inns (rest/heal), Shops (buy items), Temples (free healing), Castles (quests)
- **Particle Effects**: Visual feedback for item collection, battles, level-ups, PvP challenges, and interactions
- **Mobile Support**: Responsive D-pad controls for touch devices with haptic feedback

### Safety Features
- **Water Rescue**: Prevents players from getting stuck on water tiles
- **PvP Notifications**: 30-second response timer with auto-decline for incoming challenges
- **Auto-save**: Progress automatically syncs to Algorand blockchain
- **Offline Compatibility**: Play without connection, sync when ready

---

## 🎮 How to Play

### Controls
- **Movement**: `WASD` or `Arrow Keys` to move your character
- **Interact**: `Space` or `Enter` to interact with NPCs, buildings, and enemies
- **Close Dialogs**: `ESC` to close modals and dialogs
- **Mobile**: Use the on-screen D-pad for touch controls (hidden on desktop)

### Getting Started
1. **Connect Wallet**: Enter your 25-word Algorand mnemonic phrase (use a test wallet!)
2. **Explore the World**: Move around using WASD or arrow keys
3. **Talk to NPCs**: Press Space near villagers, merchants, and priests
4. **Visit Buildings**: Enter inns, shops, temples, and castles

### Navigation
- **Water**: Purchase boats (50 gold) from shops. Each boat gives 15 moves across water. Auto-rescue activates if you run out of moves while on water (penalty: -20 HP, -10 gold)
- **Mountains**: Buy pickaxes (75 gold) to clear mountains. Each pickaxe has 10 uses
- **Doors**: Collect keys to unlock special areas

### Combat (PvE)
- Click on enemies or walk into them to start battle
- **Attack**: Physical damage (based on ATK stat)
- **Magic**: Spell damage - costs 12 MP (based on MAG stat)
- **Heal**: Use health potions during battle
- **Flee**: 75% chance to escape

### PvP Combat
**Broadcasting Your Challenge:**
1. Click "⚔️ Ready for PvP" button in the multiplayer section
2. Set your wager (boats, keys, pickaxe uses, gold)
3. Minimum wager: 10 gold OR any items
4. Challenge broadcasts for 3 minutes to all players
5. Wait for opponents to accept your challenge

**Accepting Challenges:**
1. View "🎯 Active PvP Challenges" list
2. See opponent's level, distance, and wager
3. Must be within 5 tiles to challenge
4. Use "📍 Navigate" if too far away
5. Click "⚔️ Challenge!" to start battle
6. Match their wager to participate

**During PvP Battle:**
- Choose from 5 strategic actions each turn
- Watch HP bars update in real-time
- Use healing and defend strategically
- First to reach 0 HP loses
- Winner takes 2x the wager + bonus XP

**Challenge Notifications:**
- Receive animated notification when challenged
- Modal appears with Accept/Decline options
- 30-second timer to respond
- Auto-declines if no response
- Particle effects and haptic feedback

**Resignation:**
- Players can resign mid-battle, but will lose their stake

### Buildings
- **Inns**: Rest for 20 gold → full HP & MP restore
- **Shops**: Buy health potions (15g), mana potions (10g), boats (50g), pickaxes (75g)
- **Temples**: Free full healing anytime
- **Castles**: Accept quests for gold and XP rewards

### Progression
- Defeat enemies to earn gold and experience
- Level up increases HP, MP, ATK, DEF, and MAG
- Collect treasures scattered across the map
- Win PvP battles for massive rewards
- Track stats in the left panel

### Algorand Features
- **Save Progress**: Click "Save to Algorand" to store hero data on-chain
- **Sync Data**: Click "Sync from Algorand" to load saved progress
- **Mint NFT**: Create a permanent Hero NFT
- **Multiplayer**: See other players in real-time
- **PvP Challenges**: Challenge other players with blockchain-verified wagers
- **Chat**: Send blockchain-stored messages

### Maps
- Click the 🗺️ button (bottom-right) to import new worlds
- Choose from 8 preset maps or create custom maps
- Each map has unique NPCs, enemies, and challenges

### Tips
- Always stock health potions before exploring
- Remember temple locations for free healing
- Buy boats before water exploration
- Pickaxes create permanent paths
- Start with small PvP wagers (10-25 gold)
- Position strategically near opponents for PvP
- Use defend action before opponent's strong attacks
- Save ultimate attack for critical moments
- Bring health potions to PvP battles
- Save progress regularly to blockchain
- Click the ❓ button for in-game help

---

## 🔒 The Sunset Problem

Most "on-chain" games today are only partially decentralized. They shut down servers, stop maintaining contracts, or remove frontends – and player assets effectively disappear.

**Eternal Bliss is different.**  
- Heroes and stats are written directly on Algorand.  
- Items, gold, and maps are ASAs or note-field data, secured at Layer-1.  
- PvP challenges and outcomes are permanently recorded on-chain.
- The game client is static HTML/JS, portable and forkable by anyone.  

Even if the original team steps away, the world of Eternal Bliss will **never sunset**. Players can always rebuild the frontend and continue their journey, because the game itself lives on the blockchain.  

---

## 🗺️ Roadmap

- ✅ Core smart contract deployed on TestNet.  
- ✅ Boat navigation system with auto-rescue.
- ✅ Pickaxe tool with durability system.
- ✅ Dynamic map importer with 8 preset worlds.
- ✅ Enhanced avatar and visual systems.
- ✅ Mobile D-pad controls with haptic feedback.
- ✅ **PvP Battle System** - Real-time player vs player combat.
- ✅ **Wager System** - Stake items and gold, winner takes all.
- ✅ **Challenge Broadcasting** - Blockchain-based matchmaking.
- ✅ **PvP Notifications** - Real-time challenge acceptance alerts.
- ✅ **5-Action Combat** - Strategic turn-based PvP battles.
- ✅ In-game help system and comprehensive documentation.
- 🔨 Frontend enhancements (UI polish, animations, fog of war) – IN PROGRESS.  
- 🔨 **PvP Leaderboards** - Rankings and season rewards – COMING SOON.
- 🔨 **Tournament System** - Organized PvP brackets – COMING SOON.
- 🛒 In-game marketplace (ASA-based trading) – SOON.  
- 🌍 Mainnet launch + community-driven expansion – SOON.  

---

## ⚠️ Security

Eternal Bliss is a **prototype demo for hackathons**.  
- Always use throwaway wallets.  
- Do not import keys that hold real funds.
- PvP wagers are real on TestNet - only wager what you can afford to lose.

---

## 🚀 How to Run

1. Clone this repository.  
2. Open `index.html` in your browser.  
3. Connect via mnemonic/private key (demo input).  
4. Play, explore, battle – offline or online.  
5. Purchase boats and pickaxes from shops to navigate terrain.
6. Click "Ready for PvP" to challenge other players to combat.
7. Sync progress to Algorand TestNet when ready.  
8. Use `mapmaker.html` to design or extend maps and plug them into the main game.  
9. Click the ❓ help button in-game for detailed gameplay instructions.

---

## 🎯 What Makes Eternal Bliss Unique

### True Blockchain Gaming
- **No Servers**: Everything runs on Algorand blockchain
- **Permanent Progress**: Your hero and achievements never disappear
- **Transparent Mechanics**: All formulas and logic visible on-chain
- **Player Ownership**: You truly own your NFT hero and assets

### Innovative PvP System
- **Blockchain-Verified Challenges**: All PvP matches recorded on-chain
- **Fair Matchmaking**: Distance-based system prevents griefing
- **Strategic Depth**: 5 unique combat actions for varied tactics
- **Real Stakes**: Wager actual items and gold with winner-takes-all
- **Real-Time Notifications**: Know instantly when challenged

### Performance & Mobile
- **Optimized Rendering**: Chunking system for smooth gameplay
- **Mobile-First**: Touch controls with haptic feedback
- **Offline Support**: Play without connection, sync later
- **Cross-Platform**: Works on desktop and mobile browsers

### Community-Driven
- **Open Source**: Fork and improve the game
- **Custom Maps**: Create and share your own worlds
- **Player Markets**: Trade items peer-to-peer
- **Decentralized Chat**: Permanent, censorship-resistant messaging

---

✨ Eternal Bliss isn't just a game. It's a **proof-of-concept** that shows what happens when the blockchain itself **hosts the entire world**:  
- play offline,  
- sync on-chain,  
- challenge players to PvP with real stakes,
- receive real-time notifications via blockchain,
- chat peer-to-peer,  
- store maps on-chain,  
- access the full client via a transaction ID,  
- navigate with consumable tools (boats, pickaxes),
- import community-created worlds,
- keep progress forever,  
- **never sunset**.  

---

## 📊 Technical Achievements

- ✅ **Full On-Chain Storage**: Hero data, stats, maps, chat all on Algorand
- ✅ **PvP Broadcasting**: Challenge system using Algorand note fields
- ✅ **Real-Time Multiplayer**: See other players without servers
- ✅ **Blockchain Notifications**: Challenge alerts via on-chain monitoring
- ✅ **Wagering System**: Secure winner-takes-all with blockchain verification
- ✅ **Mobile Optimization**: Touch controls and responsive design
- ✅ **Chunked Rendering**: Performance optimization for large maps
- ✅ **Offline Mode**: Play disconnected, sync when ready

---

## 🏆 PvP Statistics & Balance

### Combat Actions
- **Attack**: Base damage + 15% crit chance (1.5x damage)
- **Magic**: MAG-based damage, 15 MP cost, ignores armor
- **Defend**: +5 DEF for one turn, strategic timing crucial
- **Heal**: Restores 35-60 HP, requires health potion
- **Ultimate**: 1.8x ATK + bonus damage, 25 MP cost

### Wager Guidelines by Level
- **Lv 1-5**: 10-25 gold, 0-1 boats/keys
- **Lv 6-10**: 25-50 gold, 1-2 boats/keys, 0-5 pickaxe
- **Lv 11-15**: 50-100 gold, 2-3 boats/keys, 5-10 pickaxe
- **Lv 16+**: 100+ gold, 3+ boats/keys, 10+ pickaxe

### Victory Rewards
- Winner gets: 2x wager (both players' stakes)
- Bonus XP: Opponent level × 50
- Example: Beat level 15 → +750 XP

### Challenge System
- Broadcast duration: 3 minutes
- Match range: 5 tiles
- Check frequency: Every 15 seconds
- Notification response: 30 seconds
- Minimum wager: 10 gold OR any items

---