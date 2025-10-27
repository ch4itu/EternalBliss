# ETERNAL BLISS — FULLY ON‑CHAIN P2P RPG GAME
### Built on a **Universal On‑Chain State‑Machine Framework** (Algorand TestNet)

Eternal Bliss is a **peer‑to‑peer RPG** where **gameplay, player state, PvP signals, and chat** are all designed to be **on‑chain**.  
The same contract and client pattern form a **domain‑agnostic framework** you can reuse for **supply‑chain tracking, AI‑agent coordination, and education credentials or even simple blogs**.

> TL;DR — The game is the flagship **proof‑of‑concept** for a reusable, sunset‑proof state‑machine framework.

---

## ❗ Problem We Solve — *“The Sunset Issue”*
Most apps and games **die when servers or sponsors disappear** as most of the data is centralized. That causes:
- **Lost progress/data** or unverifiable history.
- **Centralized trust & single points of failure** (ops, auth, storage, sync servers).
- **Lock‑in**: data and logic stuck behind private APIs.
- **High ops burden** just to keep basic features online.

**Our answer:** put the *minimum viable substrate* **on‑chain** — entities, transitions, and audit trail — so the experience **keeps working without us**, clients stay thin, and anyone can rebuild richer UX on the same verifiable state using **Algorand Box Storage**.

---

## 🎮 Game Overview (What you can do right now)
- **Offline Exploration**; **On‑Chain Save/Restore** of `level, HP/MP, location, inventory`.
- **P2P Challenges (PvP scaffold)**; **World Chat (On‑Chain)**; **No Servers** (HTML/JS + public RPC).
- **Deployed (TestNet)** App ID: **748592697** — demo via **Lora DApp Lab**.

---

## 🧩 The Universal Framework (Used by the Game)

Everything is a **state machine**:

- **Entity** → uniquely identified object (e.g., `player:addr`, `battle:id`, `post:id`, `shipment:uuid`, `task:id`).  
- **State** → JSON payload (bytes) stored in **App Boxes** under keys: `b:<type>:<id>`.
- **Transition** → ARC‑4 method call that mutates/creates the entity (e.g., `save_entity`, `transition`, domain helpers).
- **Clients** → use **AtomicTransactionComposer** against **public RPC** (no servers).

### Industries / Use‑Cases this Reaches
- **Gaming** — players, battles, items, chat, map state (flagship POC).
- **Supply Chain** — shipments & hand‑offs: `CREATE → PICKUP → IN_TRANSIT → DELIVERED`.
- **AI Agent Coordination** — tasks & workflows: `QUEUED → ASSIGNED → WORKING → DONE` with agent‑signed actions.
- **EdTech** — learner progress, modules, and **on‑chain credentials**.
- **Personal Blog / Publishing** — posts/comments as entities, permanent, verifiable, censorship‑resistant.

> Swap the `type` and define transitions — the same contract powers all of the above.

---

## 🧱 Contract & Client Architecture
- **Smart Contract (Algorand Python / ARC‑4)**: Boxes `b:<type>:<id>`, generic ABI (`save_entity`, `load_entity`) + helpers, optional index boxes. Everything built using AlgoSDK.
- **Client (Static HTML/JS)**: wallet + **AtomicTransactionComposer**; UIs for **Game** & **Blog** included.

---

## 🔐 Security & Privacy (Active Work)
- Prefer **Box storage with client‑side encryption** (e.g., XChaCha20‑Poly1305); avoid public txn notes.  
- **Integrity**: signed payloads; optional on‑chain signature checks.  
- Per‑entity access policies: public / shared / private.

---

## 🧪 How to Demo (Quick Paths)
- **Game**: Clone the repository and use index.html or go to https://ch4itu.github.io/EternalBliss/. Please check GAME_README.md.
- **Blog**: `blog.html` + `blog.js` → publish/read posts via same ABI.
- **Lora App Lab**: Lora App Lab → App ID `748592697` → `save_entity` / `save_player` → read back.

---

## 🗺️ Roadmap (near‑term)
Encrypted box schema • Pagination/index boxes • PvP escrow + dispute • Tiny JS SDK + domain templates • Better wallet UX • Tests/docs/audits.

---

## ⚠️ Notes
Use **TestNet** for demos; mind Box **MBR/size**; design access policies before storing sensitive data.


## HEAVILY BORROWED FROM CHATGPT/CLAUDE/GEMINI/GROK

Special thanks to AI assistants for helping develop:
- Core game mechanics and blockchain integration
- PvP battle system with wagering
- Mobile controls and touch optimization
- Challenge notification system
- UI/UX enhancements and documentation
