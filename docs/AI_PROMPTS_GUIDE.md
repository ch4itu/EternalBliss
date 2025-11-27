# Build Your Own Blockchain App (No Coding Required!)

### A Guide for Dreamers, Thinkers, and Everyone Who'd Rather Not Touch Code

---

## Welcome, Future Builder!

So you've got an amazing app idea but:
- Code looks like ancient hieroglyphics?
- You'd rather explain your idea than write it?
- You believe in working smarter, not harder?

**You're in the right place.**

This guide contains ready-to-use prompts you can give to AI assistants (Claude, ChatGPT, Gemini, Grok, or your favorite AI friend) to build real, working blockchain apps on our Universal State Machine Framework.

Just copy, paste, and let AI do the heavy lifting.

---

## How This Works

1. **Pick a prompt** that matches your app idea
2. **Copy it** to your favorite AI assistant
3. **Answer any follow-up questions** the AI asks
4. **Get working code** you can deploy

The AI will generate JavaScript code that connects to our already-deployed smart contract on Algorand. No need to understand the code — just run it!

---

## The Magic Words

Every prompt includes these key details about our framework:

```
Smart Contract App ID: 750081112 (Algorand TestNet)
RPC Endpoint: https://testnet-api.algonode.cloud
Two primitives:
  - Entities: Store data you own (profiles, posts, records)
  - Processes: Two-person workflows (trades, battles, approvals)
```

---

## Ready-to-Use Prompts

### 1. Personal Profile / Portfolio App

> **Copy this prompt:**
>
> I want to build a decentralized profile/portfolio app where users can store their bio, skills, and links permanently on blockchain. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use the `save_entity` method to store profile data
> - Entity ID format: `profile:<wallet_address>`
> - Box key format: `e:` + entity_id (as UTF-8 bytes)
> - MBR formula: 2500 + (400 × (key_length + 32 + data_length)) microALGO
> - Data stored as JSON string
>
> Please create:
> 1. A simple HTML page with a form for name, bio, skills, and social links
> 2. JavaScript to connect wallet (using mnemonic input)
> 3. Save and load functions that interact with the blockchain
> 4. Make it look clean and modern
>
> The profile should persist forever on-chain even if my website goes down.

---

### 2. Decentralized Blog / Journal

> **Copy this prompt:**
>
> I want to create a censorship-resistant blog where my posts live forever on blockchain. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `save_entity` for posts, `load_entity` to read, `delete_entity` to remove
> - Entity ID format: `blog:<author_address>:<timestamp>`
> - Box key: `e:` prefix + entity_id as bytes
> - MBR: 2500 + (400 × total_bytes) microALGO
> - Store as JSON: {title, content, tags, createdAt}
>
> Please create:
> 1. HTML page with post editor (title, content with markdown support, tags)
> 2. Post listing page showing all my posts
> 3. Individual post view
> 4. Delete functionality (only author can delete)
> 5. Calculate and show the cost in ALGO before posting
>
> Posts should be permanent and readable by anyone, but only I can edit/delete mine.

---

### 3. Trading / Swap App

> **Copy this prompt:**
>
> I want to build a peer-to-peer trading app where two users can propose and accept trades. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to create trade offer
> - Use `update_process` to accept/modify
> - Use `resign_process` to finalize
> - Process ID format: `trade:<proposer_short>:<timestamp>`
> - Box key: `p:` prefix + process_id
> - Process header is 81 bytes (participants, turn, finalized flag, timeout)
> - Timeout: set to 28800 rounds (~24 hours)
>
> Trade state JSON structure:
> ```json
> {
>   "status": "proposed|accepted|completed|cancelled",
>   "proposer": {"address": "...", "offering": {...}, "confirmed": false},
>   "receiver": {"address": "...", "offering": {...}, "confirmed": false}
> }
> ```
>
> Please create:
> 1. Form to propose a trade (select items/amounts, enter receiver address)
> 2. View incoming trade proposals
> 3. Accept/reject trade buttons
> 4. Confirmation step (both must confirm to complete)
> 5. Show trade status and history

---

### 4. Approval / Voting System

> **Copy this prompt:**
>
> I want to build a simple approval system where someone submits a request and another person approves or rejects it. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to submit request (requester → approver)
> - Use `update_process` to record decision
> - Use `resign_process` after decision is made
> - Process ID: `approval:<type>:<timestamp>`
> - Timeout: 201600 rounds (~1 week)
>
> State structure:
> ```json
> {
>   "status": "pending|approved|rejected",
>   "type": "expense|leave|access",
>   "request": {"title": "...", "description": "...", "amount": 0},
>   "decision": {"approved": true, "comment": "...", "decidedAt": 0}
> }
> ```
>
> Please create:
> 1. Submit request form (type, title, description, amount if applicable)
> 2. Pending requests dashboard for approvers
> 3. Approve/Reject buttons with comment field
> 4. Request history showing status
> 5. Email-style notification when status changes (or just highlight new items)

---

### 5. Simple Game with Leaderboard

> **Copy this prompt:**
>
> I want to create a simple browser game where high scores are stored permanently on blockchain. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `save_entity` to store player scores
> - Entity ID: `score:<game_name>:<player_address>`
> - Store: {playerName, highScore, gamesPlayed, lastPlayed}
>
> Please create:
> 1. A simple clicking/tapping game (click as fast as you can in 10 seconds)
> 2. Score submission to blockchain after each game
> 3. Personal best tracking
> 4. Leaderboard showing top scores (you can hardcode known player addresses for demo, or explain how to discover them)
> 5. Make it fun and colorful!
>
> Scores should be permanent and verifiable by anyone.

---

### 6. Certificate / Credential Issuer

> **Copy this prompt:**
>
> I want to build a system where I can issue verifiable certificates/credentials that anyone can verify. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to issue (issuer → recipient)
> - Issuer can `update_process` to revoke
> - Process ID: `cert:<type>:<timestamp>`
> - No timeout (credentials are permanent)
>
> State structure:
> ```json
> {
>   "type": "course|achievement|membership",
>   "title": "Certificate of Completion",
>   "description": "Successfully completed...",
>   "issuer": {"address": "...", "name": "..."},
>   "recipient": {"address": "...", "name": "..."},
>   "issuedAt": 1234567890,
>   "revoked": false,
>   "revokedReason": null
> }
> ```
>
> Please create:
> 1. Issue certificate form (recipient address, title, description)
> 2. My issued certificates list (for issuers)
> 3. My received certificates list (for recipients)
> 4. Public verification page (enter certificate ID, see if valid)
> 5. Revoke option for issuers
> 6. Nice certificate display with blockchain proof link

---

### 7. Collaborative To-Do / Task List

> **Copy this prompt:**
>
> I want to build a shared to-do list where two people can add and complete tasks together. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to create shared list
> - Use `update_process` to add/complete tasks
> - Process ID: `todo:<creator_short>:<timestamp>`
> - Timeout: 0 (no timeout, list persists forever)
>
> State structure:
> ```json
> {
>   "name": "Our Grocery List",
>   "tasks": [
>     {"id": 1, "text": "Buy milk", "done": false, "addedBy": "addr..."},
>     {"id": 2, "text": "Get bread", "done": true, "completedBy": "addr..."}
>   ],
>   "lastUpdated": 1234567890
> }
> ```
>
> Please create:
> 1. Create new shared list (enter partner's address)
> 2. Add task input
> 3. Task list with checkboxes
> 4. Show who added/completed each task
> 5. Both users can add tasks and mark complete
> 6. Real-time-ish updates (poll every few seconds)

---

### 8. Secret Message / Dead Man's Switch

> **Copy this prompt:**
>
> I want to create an app where I can store an encrypted message that only the recipient can read, or that reveals after a timeout. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` for time-locked messages
> - Timeout feature: message becomes "readable" after timeout
> - Process ID: `secret:<sender_short>:<timestamp>`
>
> State structure:
> ```json
> {
>   "type": "private|timelocked",
>   "encryptedMessage": "...",
>   "hint": "The password is our anniversary",
>   "revealAfter": 1234567890,
>   "revealed": false
> }
> ```
>
> Please create:
> 1. Compose secret message form
> 2. Option: private (only recipient) or time-locked (reveals after date)
> 3. Simple password-based encryption (use Web Crypto API)
> 4. Message inbox for recipients
> 5. Countdown timer for time-locked messages
> 6. Reveal mechanism
>
> Note: For true security, implement client-side encryption. The blockchain stores encrypted data.

---

### 9. Betting / Prediction Between Friends

> **Copy this prompt:**
>
> I want to create a simple betting app where two friends can make a prediction bet (like "Team A will win") and settle it later. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to create bet
> - Use `update_process` to accept bet and later declare winner
> - Use `resign_process` to finalize
> - Process ID: `bet:<creator_short>:<timestamp>`
> - Timeout: 604800 rounds (~1 month)
>
> State structure:
> ```json
> {
>   "status": "proposed|active|resolved|disputed",
>   "prediction": "Team A wins the championship",
>   "stakes": "Loser buys dinner",
>   "creator": {"address": "...", "position": "yes"},
>   "opponent": {"address": "...", "position": "no"},
>   "result": null,
>   "declaredBy": null
> }
> ```
>
> Please create:
> 1. Create bet form (prediction, stakes description, opponent address)
> 2. Accept bet interface for opponent
> 3. After event: either party can declare result
> 4. If both agree, bet resolves
> 5. Show bet history and outcomes
> 6. Fun UI with friendly competition vibes

---

### 10. AI Agent Task Manager

> **Copy this prompt:**
>
> I want to build a simple system where I can create tasks for AI agents and track their completion. Use the Universal State Machine on Algorand (App ID: 750081112, TestNet).
>
> Technical details:
> - Use algosdk JavaScript library
> - Connect to: https://testnet-api.algonode.cloud
> - Use `start_process` to create task (coordinator → agent)
> - Use `update_process` for status updates
> - Process ID: `task:<type>:<timestamp>`
> - Timeout: 7200 rounds (~6 hours)
>
> State structure:
> ```json
> {
>   "status": "queued|assigned|working|review|completed",
>   "task": {
>     "type": "analysis|generation|research",
>     "description": "Analyze this data...",
>     "input": {}
>   },
>   "assignment": {"agentId": "...", "assignedAt": 0},
>   "result": {"output": {}, "confidence": 0.95}
> }
> ```
>
> Please create:
> 1. Create task form (type, description, input data)
> 2. Task queue showing pending tasks
> 3. Agent view to claim and work on tasks
> 4. Submit result interface
> 5. Review and approve results
> 6. Task history with all status transitions

---

## Customization Tips

When using these prompts, you can ask the AI to:

- **"Make it mobile-friendly"** — Responsive design for phones
- **"Add dark mode"** — Easy on the eyes
- **"Use [specific colors]"** — Match your brand
- **"Add animations"** — Make it feel alive
- **"Simplify the UI"** — Fewer buttons, cleaner look
- **"Add error messages"** — Help users understand what went wrong
- **"Show loading states"** — So users know something is happening
- **"Add sound effects"** — For games and notifications

---

## Follow-Up Prompts

After getting your initial code, you can refine it:

> "Can you add a loading spinner while waiting for blockchain confirmation?"

> "The design is too plain. Can you make it more colorful and modern?"

> "Can you add input validation so users can't submit empty forms?"

> "How do I deploy this to GitHub Pages for free?"

> "Can you add a 'Connect Wallet' button instead of mnemonic input?"

> "Make the mobile version better with larger touch targets"

---

## Troubleshooting Prompts

If something doesn't work:

> "I'm getting this error: [paste error]. How do I fix it?"

> "The transaction is failing. Can you add better error handling and show me what's wrong?"

> "The data isn't loading. Can you add console.log statements to debug?"

> "The MBR calculation seems wrong. Can you double-check the formula?"

---

## The Secret Sauce

All these apps work because of one simple idea:

**Your data lives on 750+ computers worldwide (Algorand validators), not on any single server.**

This means:
- No company can delete your data
- No server crash can lose your information
- Anyone can build a new app on the same data
- Your creations are truly yours

---

## Getting TestNet ALGO

Before you can save anything, you need free TestNet ALGO:

1. Go to https://bank.testnet.algorand.network/
2. Enter your wallet address
3. Get free test ALGO (it has no real value, just for testing)
4. You're ready to build!

---

## One More Thing...

After your AI assistant generates the code:

1. Save it as an HTML file
2. Open it in your browser
3. It just works! (No servers, no setup, no npm install nonsense)

That's the beauty of this framework — pure simplicity.

---

## Need Help?

- **Too technical?** Just ask your AI: *"Explain this like I'm 5"*
- **Want changes?** Tell your AI: *"Make it simpler"* or *"Add this feature"*
- **Something broken?** Paste the error and ask: *"What's wrong and how do I fix it?"*

---

## Go Build Something Amazing!

You have an idea. AI has the coding skills. The blockchain has eternal storage.

What will you create?

---

*Built with the Universal State Machine Framework — Where ideas become permanent.*

*No coding skills harmed in the making of this guide.*
