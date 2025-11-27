# Universal State Machine - Example Templates

Ready-to-use code templates for common use cases.

---

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [User Profiles](#example-1-user-profiles)
3. [Decentralized Blog](#example-2-decentralized-blog)
4. [Turn-Based Game (PvP)](#example-3-turn-based-game-pvp)
5. [Trading/Exchange](#example-4-tradingexchange)
6. [Approval Workflow](#example-5-approval-workflow)
7. [AI Agent Coordination](#example-6-ai-agent-coordination)
8. [Supply Chain Tracking](#example-7-supply-chain-tracking)
9. [Credential Verification](#example-8-credential-verification)
10. [Multi-Signature Vault](#example-9-multi-signature-vault)

---

## Basic Setup

All examples use this common setup:

```javascript
import algosdk from 'algosdk';

// Configuration
const CONFIG = {
    APP_ID: 750081112,
    ALGOD_SERVER: 'https://testnet-api.algonode.cloud',
    ALGOD_PORT: 443
};

// Initialize client
const algodClient = new algosdk.Algodv2('', CONFIG.ALGOD_SERVER, CONFIG.ALGOD_PORT);

// Contract ABI
const CONTRACT_ABI = {
    name: "UniversalStateMachine",
    methods: [
        { name: "save_entity", args: [{ type: "string", name: "entity_id" }, { type: "string", name: "entity_data" }], returns: { type: "string" } },
        { name: "load_entity", args: [{ type: "string", name: "entity_id" }], returns: { type: "string" } },
        { name: "delete_entity", args: [{ type: "string", name: "entity_id" }], returns: { type: "void" } },
        { name: "start_process", args: [{ type: "string", name: "process_id" }, { type: "address", name: "other_party" }, { type: "string", name: "initial_state" }, { type: "uint64", name: "timeout_rounds" }], returns: { type: "string" } },
        { name: "update_process", args: [{ type: "string", name: "process_id" }, { type: "string", name: "new_state" }], returns: { type: "string" } },
        { name: "load_process", args: [{ type: "string", name: "process_id" }], returns: { type: "string" } },
        { name: "resign_process", args: [{ type: "string", name: "process_id" }], returns: { type: "void" } },
        { name: "get_process_info", args: [{ type: "string", name: "process_id" }], returns: { type: "(address,address,uint64,bool,uint64)" } },
        { name: "delete_process", args: [{ type: "string", name: "process_id" }], returns: { type: "void" } }
    ]
};

const abiContract = new algosdk.ABIContract(CONTRACT_ABI);

// Helper: Create box keys
function entityBoxKey(id) {
    return new TextEncoder().encode(`e:${id}`);
}

function processBoxKey(id) {
    return new TextEncoder().encode(`p:${id}`);
}

// Helper: Calculate MBR
function calculateMBR(dataSize, isProcess = false, keyLength = 60) {
    const headerSize = isProcess ? 81 : 32;
    return 2500 + (400 * (keyLength + headerSize + dataSize));
}

// Helper: Execute with payment
async function executeWithPayment(account, method, args, boxKey, mbrAmount) {
    const params = await algodClient.getTransactionParams().do();

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: algosdk.getApplicationAddress(CONFIG.APP_ID),
        amount: mbrAmount,
        suggestedParams: params
    });

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addTransaction({ txn: paymentTxn, signer: algosdk.makeBasicAccountTransactionSigner(account) });
    atc.addMethodCall({
        appID: CONFIG.APP_ID,
        method: abiContract.getMethodByName(method),
        methodArgs: args,
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: CONFIG.APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}

// Helper: Execute without payment (for deletes, resigns)
async function executeNoPayment(account, method, args, boxKey) {
    const params = await algodClient.getTransactionParams().do();

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
        appID: CONFIG.APP_ID,
        method: abiContract.getMethodByName(method),
        methodArgs: args,
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: CONFIG.APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}

// Helper: Load entity data
async function loadEntity(entityId) {
    const boxKey = entityBoxKey(entityId);
    try {
        const box = await algodClient.getApplicationBoxByName(CONFIG.APP_ID, boxKey).do();
        return JSON.parse(new TextDecoder().decode(box.value.slice(32)));
    } catch {
        return null;
    }
}

// Helper: Load process state
async function loadProcess(processId) {
    const boxKey = processBoxKey(processId);
    try {
        const box = await algodClient.getApplicationBoxByName(CONFIG.APP_ID, boxKey).do();
        return JSON.parse(new TextDecoder().decode(box.value.slice(81)));
    } catch {
        return null;
    }
}
```

---

## Example 1: User Profiles

A simple user profile system with on-chain storage.

### Data Schema

```javascript
const userProfileSchema = {
    version: 1,
    username: "string",
    bio: "string",
    avatar: "string (URL or IPFS hash)",
    social: {
        twitter: "string",
        github: "string",
        website: "string"
    },
    preferences: {
        theme: "light|dark",
        notifications: "boolean"
    },
    createdAt: "timestamp",
    updatedAt: "timestamp"
};
```

### Implementation

```javascript
class UserProfileService {
    constructor(account) {
        this.account = account;
        this.entityId = `profile:${account.addr}`;
    }

    async createProfile(username, bio = '') {
        const profile = {
            version: 1,
            username,
            bio,
            avatar: '',
            social: { twitter: '', github: '', website: '' },
            preferences: { theme: 'dark', notifications: true },
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        const dataJson = JSON.stringify(profile);
        const boxKey = entityBoxKey(this.entityId);
        const mbr = calculateMBR(dataJson.length, false, boxKey.length);

        await executeWithPayment(
            this.account,
            'save_entity',
            [this.entityId, dataJson],
            boxKey,
            mbr
        );

        return profile;
    }

    async updateProfile(updates) {
        const current = await this.getProfile();
        if (!current) throw new Error('Profile not found');

        const updated = {
            ...current,
            ...updates,
            updatedAt: Date.now()
        };

        const dataJson = JSON.stringify(updated);
        const boxKey = entityBoxKey(this.entityId);

        // Optimized: only pay for size growth
        const existing = await algodClient.getApplicationBoxByName(CONFIG.APP_ID, boxKey).do();
        const sizeDiff = Math.max(0, dataJson.length - (existing.value.length - 32));
        const mbr = sizeDiff * 400;

        await executeWithPayment(
            this.account,
            'save_entity',
            [this.entityId, dataJson],
            boxKey,
            mbr
        );

        return updated;
    }

    async getProfile() {
        return await loadEntity(this.entityId);
    }

    async deleteProfile() {
        const boxKey = entityBoxKey(this.entityId);
        await executeNoPayment(this.account, 'delete_entity', [this.entityId], boxKey);
    }

    // Load any user's profile by address
    static async getProfileByAddress(address) {
        return await loadEntity(`profile:${address}`);
    }
}

// Usage
const profile = new UserProfileService(myAccount);
await profile.createProfile('alice', 'Blockchain enthusiast');
await profile.updateProfile({ bio: 'Building on Algorand!' });
const data = await profile.getProfile();
```

---

## Example 2: Decentralized Blog

A censorship-resistant blog where posts live forever on-chain.

### Data Schema

```javascript
const blogPostSchema = {
    version: 1,
    title: "string",
    content: "string (markdown supported)",
    author: "address",
    authorName: "string",
    tags: ["string"],
    createdAt: "timestamp",
    updatedAt: "timestamp"
};
```

### Implementation

```javascript
class BlogService {
    constructor(account, authorName = 'Anonymous') {
        this.account = account;
        this.authorName = authorName;
    }

    generatePostId() {
        return `blog:${this.account.addr}:${Date.now()}`;
    }

    async createPost(title, content, tags = []) {
        const postId = this.generatePostId();

        const post = {
            version: 1,
            title,
            content,
            author: this.account.addr,
            authorName: this.authorName,
            tags,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        const dataJson = JSON.stringify(post);
        const boxKey = entityBoxKey(postId);
        const mbr = calculateMBR(dataJson.length, false, boxKey.length);

        await executeWithPayment(
            this.account,
            'save_entity',
            [postId, dataJson],
            boxKey,
            mbr
        );

        return { postId, post };
    }

    async updatePost(postId, updates) {
        const current = await loadEntity(postId);
        if (!current) throw new Error('Post not found');
        if (current.author !== this.account.addr) throw new Error('Not the author');

        const updated = {
            ...current,
            ...updates,
            updatedAt: Date.now()
        };

        const dataJson = JSON.stringify(updated);
        const boxKey = entityBoxKey(postId);

        const existing = await algodClient.getApplicationBoxByName(CONFIG.APP_ID, boxKey).do();
        const sizeDiff = Math.max(0, dataJson.length - (existing.value.length - 32));
        const mbr = sizeDiff * 400;

        await executeWithPayment(
            this.account,
            'save_entity',
            [postId, dataJson],
            boxKey,
            mbr
        );

        return updated;
    }

    async deletePost(postId) {
        const boxKey = entityBoxKey(postId);
        await executeNoPayment(this.account, 'delete_entity', [postId], boxKey);
    }

    async getPost(postId) {
        return await loadEntity(postId);
    }

    // Discover posts by listing boxes (requires indexer or known IDs)
    async getMyPosts(knownPostIds) {
        const posts = [];
        for (const postId of knownPostIds) {
            const post = await loadEntity(postId);
            if (post && post.author === this.account.addr) {
                posts.push({ postId, ...post });
            }
        }
        return posts.sort((a, b) => b.createdAt - a.createdAt);
    }
}

// Usage
const blog = new BlogService(myAccount, 'Alice');

const { postId, post } = await blog.createPost(
    'My First Decentralized Post',
    '# Hello World\n\nThis post lives forever on Algorand!',
    ['algorand', 'web3', 'decentralized']
);

await blog.updatePost(postId, { content: '# Updated Content\n\nNow with more content!' });
```

---

## Example 3: Turn-Based Game (PvP)

A turn-based battle system between two players.

### Data Schema

```javascript
const battleStateSchema = {
    version: 1,
    status: "waiting|active|finished",
    turn: "number",
    currentPlayer: "address",
    player1: {
        address: "string",
        hp: "number",
        maxHp: "number",
        attack: "number",
        defense: "number"
    },
    player2: {
        address: "string",
        hp: "number",
        maxHp: "number",
        attack: "number",
        defense: "number"
    },
    lastAction: {
        type: "attack|defend|special",
        damage: "number",
        by: "address"
    },
    winner: "address|null",
    wager: {
        gold: "number",
        items: ["string"]
    },
    log: ["string"],
    createdAt: "timestamp"
};
```

### Implementation

```javascript
class BattleService {
    constructor(account) {
        this.account = account;
    }

    generateBattleId(opponent) {
        const sorted = [this.account.addr, opponent].sort();
        return `battle:${sorted[0].slice(0, 8)}-${sorted[1].slice(0, 8)}-${Date.now()}`;
    }

    async challengePlayer(opponentAddress, playerStats, wager = {}) {
        const battleId = this.generateBattleId(opponentAddress);

        const initialState = {
            version: 1,
            status: 'waiting',
            turn: 0,
            currentPlayer: this.account.addr,
            player1: {
                address: this.account.addr,
                hp: playerStats.hp || 100,
                maxHp: playerStats.maxHp || 100,
                attack: playerStats.attack || 10,
                defense: playerStats.defense || 10
            },
            player2: {
                address: opponentAddress,
                hp: 100,
                maxHp: 100,
                attack: 10,
                defense: 10
            },
            lastAction: null,
            winner: null,
            wager: {
                gold: wager.gold || 0,
                items: wager.items || []
            },
            log: [`${this.account.addr.slice(0, 8)} initiated battle`],
            createdAt: Date.now()
        };

        const stateJson = JSON.stringify(initialState);
        const boxKey = processBoxKey(battleId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [battleId, opponentAddress, stateJson, 600],  // 30 min timeout
            boxKey,
            mbr
        );

        return { battleId, state: initialState };
    }

    async acceptBattle(battleId, playerStats) {
        const state = await loadProcess(battleId);
        if (!state) throw new Error('Battle not found');
        if (state.status !== 'waiting') throw new Error('Battle already started');

        state.status = 'active';
        state.player2 = {
            ...state.player2,
            hp: playerStats.hp || 100,
            maxHp: playerStats.maxHp || 100,
            attack: playerStats.attack || 10,
            defense: playerStats.defense || 10
        };
        state.log.push(`${this.account.addr.slice(0, 8)} accepted battle`);

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(battleId);
        const mbr = 0;  // Usually no size increase

        await executeWithPayment(
            this.account,
            'update_process',
            [battleId, stateJson],
            boxKey,
            mbr
        );

        return state;
    }

    async attack(battleId) {
        const state = await loadProcess(battleId);
        if (!state) throw new Error('Battle not found');
        if (state.status !== 'active') throw new Error('Battle not active');
        if (state.currentPlayer !== this.account.addr) throw new Error('Not your turn');

        const isPlayer1 = state.player1.address === this.account.addr;
        const attacker = isPlayer1 ? state.player1 : state.player2;
        const defender = isPlayer1 ? state.player2 : state.player1;

        // Simple damage calculation
        const baseDamage = attacker.attack;
        const reduction = defender.defense / 2;
        const damage = Math.max(1, Math.floor(baseDamage - reduction + (Math.random() * 5)));

        defender.hp = Math.max(0, defender.hp - damage);

        state.lastAction = {
            type: 'attack',
            damage,
            by: this.account.addr
        };
        state.log.push(`${this.account.addr.slice(0, 8)} dealt ${damage} damage`);
        state.turn++;
        state.currentPlayer = defender.address;

        // Check for winner
        if (defender.hp <= 0) {
            state.status = 'finished';
            state.winner = attacker.address;
            state.log.push(`${attacker.address.slice(0, 8)} wins!`);
        }

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(battleId);

        await executeWithPayment(
            this.account,
            'update_process',
            [battleId, stateJson],
            boxKey,
            0
        );

        return state;
    }

    async forfeit(battleId) {
        const state = await loadProcess(battleId);
        if (!state) throw new Error('Battle not found');

        const isPlayer1 = state.player1.address === this.account.addr;
        state.status = 'finished';
        state.winner = isPlayer1 ? state.player2.address : state.player1.address;
        state.log.push(`${this.account.addr.slice(0, 8)} forfeited`);

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(battleId);

        await executeWithPayment(
            this.account,
            'update_process',
            [battleId, stateJson],
            boxKey,
            0
        );

        // Finalize the process
        await executeNoPayment(this.account, 'resign_process', [battleId], boxKey);

        return state;
    }

    async getBattleState(battleId) {
        return await loadProcess(battleId);
    }
}

// Usage
const battle = new BattleService(myAccount);

// Player 1 challenges
const { battleId } = await battle.challengePlayer(
    opponentAddress,
    { hp: 100, attack: 15, defense: 8 },
    { gold: 50 }
);

// Player 2 accepts (different account)
const battle2 = new BattleService(opponentAccount);
await battle2.acceptBattle(battleId, { hp: 120, attack: 12, defense: 10 });

// Take turns
await battle.attack(battleId);   // Player 1
await battle2.attack(battleId);  // Player 2
```

---

## Example 4: Trading/Exchange

Peer-to-peer trading with escrow-like state management.

### Data Schema

```javascript
const tradeStateSchema = {
    version: 1,
    status: "proposed|accepted|completed|cancelled",
    proposer: {
        address: "string",
        offering: { gold: "number", items: ["string"] },
        confirmed: "boolean"
    },
    receiver: {
        address: "string",
        offering: { gold: "number", items: ["string"] },
        confirmed: "boolean"
    },
    createdAt: "timestamp",
    expiresAt: "timestamp"
};
```

### Implementation

```javascript
class TradingService {
    constructor(account) {
        this.account = account;
    }

    async proposeTrade(receiverAddress, myOffer, theirOffer) {
        const tradeId = `trade:${this.account.addr.slice(0, 8)}-${Date.now()}`;

        const state = {
            version: 1,
            status: 'proposed',
            proposer: {
                address: this.account.addr,
                offering: myOffer,
                confirmed: false
            },
            receiver: {
                address: receiverAddress,
                offering: theirOffer,
                confirmed: false
            },
            createdAt: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)  // 24 hours
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(tradeId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [tradeId, receiverAddress, stateJson, 28800],  // 24 hour timeout
            boxKey,
            mbr
        );

        return { tradeId, state };
    }

    async acceptTrade(tradeId) {
        const state = await loadProcess(tradeId);
        if (!state) throw new Error('Trade not found');
        if (state.receiver.address !== this.account.addr) throw new Error('Not the receiver');
        if (state.status !== 'proposed') throw new Error('Trade not in proposed state');

        state.status = 'accepted';

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(tradeId);

        await executeWithPayment(
            this.account,
            'update_process',
            [tradeId, stateJson],
            boxKey,
            0
        );

        return state;
    }

    async confirmTrade(tradeId) {
        const state = await loadProcess(tradeId);
        if (!state) throw new Error('Trade not found');
        if (state.status !== 'accepted') throw new Error('Trade not accepted');

        const isProposer = state.proposer.address === this.account.addr;
        if (isProposer) {
            state.proposer.confirmed = true;
        } else {
            state.receiver.confirmed = true;
        }

        // Both confirmed = complete the trade
        if (state.proposer.confirmed && state.receiver.confirmed) {
            state.status = 'completed';
        }

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(tradeId);

        await executeWithPayment(
            this.account,
            'update_process',
            [tradeId, stateJson],
            boxKey,
            0
        );

        // If completed, finalize
        if (state.status === 'completed') {
            await executeNoPayment(this.account, 'resign_process', [tradeId], boxKey);
        }

        return state;
    }

    async cancelTrade(tradeId) {
        const state = await loadProcess(tradeId);
        if (!state) throw new Error('Trade not found');

        state.status = 'cancelled';

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(tradeId);

        await executeWithPayment(
            this.account,
            'update_process',
            [tradeId, stateJson],
            boxKey,
            0
        );

        await executeNoPayment(this.account, 'resign_process', [tradeId], boxKey);

        return state;
    }
}

// Usage
const trading = new TradingService(myAccount);

const { tradeId } = await trading.proposeTrade(
    otherAddress,
    { gold: 100, items: ['sword'] },
    { gold: 0, items: ['shield', 'potion'] }
);

// Other party accepts
const trading2 = new TradingService(otherAccount);
await trading2.acceptTrade(tradeId);

// Both confirm
await trading.confirmTrade(tradeId);
await trading2.confirmTrade(tradeId);  // Trade completes
```

---

## Example 5: Approval Workflow

Multi-step approval process (e.g., expense approval, document signing).

### Data Schema

```javascript
const approvalStateSchema = {
    version: 1,
    type: "expense|document|access",
    status: "pending|approved|rejected",
    requester: "address",
    approver: "address",
    request: {
        title: "string",
        description: "string",
        amount: "number (optional)",
        attachmentHash: "string (IPFS hash)"
    },
    response: {
        decision: "approved|rejected",
        comment: "string",
        decidedAt: "timestamp"
    },
    createdAt: "timestamp"
};
```

### Implementation

```javascript
class ApprovalService {
    constructor(account) {
        this.account = account;
    }

    async submitRequest(approverAddress, requestType, requestData) {
        const requestId = `approval:${requestType}:${Date.now()}`;

        const state = {
            version: 1,
            type: requestType,
            status: 'pending',
            requester: this.account.addr,
            approver: approverAddress,
            request: {
                title: requestData.title,
                description: requestData.description,
                amount: requestData.amount || null,
                attachmentHash: requestData.attachmentHash || null
            },
            response: null,
            createdAt: Date.now()
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(requestId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [requestId, approverAddress, stateJson, 201600],  // 1 week timeout
            boxKey,
            mbr
        );

        return { requestId, state };
    }

    async approve(requestId, comment = '') {
        return await this._decide(requestId, 'approved', comment);
    }

    async reject(requestId, comment = '') {
        return await this._decide(requestId, 'rejected', comment);
    }

    async _decide(requestId, decision, comment) {
        const state = await loadProcess(requestId);
        if (!state) throw new Error('Request not found');
        if (state.approver !== this.account.addr) throw new Error('Not the approver');
        if (state.status !== 'pending') throw new Error('Already decided');

        state.status = decision;
        state.response = {
            decision,
            comment,
            decidedAt: Date.now()
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(requestId);

        await executeWithPayment(
            this.account,
            'update_process',
            [requestId, stateJson],
            boxKey,
            0
        );

        await executeNoPayment(this.account, 'resign_process', [requestId], boxKey);

        return state;
    }

    async getRequest(requestId) {
        return await loadProcess(requestId);
    }
}

// Usage
const requester = new ApprovalService(employeeAccount);
const { requestId } = await requester.submitRequest(
    managerAddress,
    'expense',
    {
        title: 'Conference Travel',
        description: 'Flight and hotel for Decipher conference',
        amount: 1500
    }
);

// Manager approves
const approver = new ApprovalService(managerAccount);
await approver.approve(requestId, 'Approved - have a great trip!');
```

---

## Example 6: AI Agent Coordination

Coordinate multiple AI agents working on tasks.

### Data Schema

```javascript
const taskStateSchema = {
    version: 1,
    status: "queued|assigned|working|review|completed|failed",
    task: {
        id: "string",
        type: "analysis|generation|classification",
        input: "object",
        priority: "low|medium|high"
    },
    assignment: {
        agentId: "address",
        assignedAt: "timestamp"
    },
    result: {
        output: "object",
        confidence: "number (0-1)",
        processingTime: "number (ms)"
    },
    reviewer: "address",
    reviewResult: {
        approved: "boolean",
        feedback: "string"
    },
    createdAt: "timestamp"
};
```

### Implementation

```javascript
class AICoordinationService {
    constructor(account, role = 'coordinator') {
        this.account = account;
        this.role = role;  // coordinator, agent, or reviewer
    }

    // Coordinator creates task
    async createTask(agentAddress, taskData) {
        const taskId = `task:${taskData.type}:${Date.now()}`;

        const state = {
            version: 1,
            status: 'queued',
            task: {
                id: taskId,
                type: taskData.type,
                input: taskData.input,
                priority: taskData.priority || 'medium'
            },
            assignment: null,
            result: null,
            reviewer: null,
            reviewResult: null,
            createdAt: Date.now()
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(taskId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [taskId, agentAddress, stateJson, 7200],  // 6 hour timeout
            boxKey,
            mbr
        );

        return { taskId, state };
    }

    // Agent claims and starts task
    async claimTask(taskId) {
        const state = await loadProcess(taskId);
        if (!state) throw new Error('Task not found');
        if (state.status !== 'queued') throw new Error('Task not available');

        state.status = 'assigned';
        state.assignment = {
            agentId: this.account.addr,
            assignedAt: Date.now()
        };

        return await this._updateTask(taskId, state);
    }

    // Agent starts working
    async startWorking(taskId) {
        const state = await loadProcess(taskId);
        if (!state) throw new Error('Task not found');
        if (state.assignment?.agentId !== this.account.addr) throw new Error('Not assigned to you');

        state.status = 'working';
        return await this._updateTask(taskId, state);
    }

    // Agent submits result
    async submitResult(taskId, result) {
        const state = await loadProcess(taskId);
        if (!state) throw new Error('Task not found');
        if (state.assignment?.agentId !== this.account.addr) throw new Error('Not your task');

        state.status = 'review';
        state.result = {
            output: result.output,
            confidence: result.confidence,
            processingTime: Date.now() - state.assignment.assignedAt
        };

        return await this._updateTask(taskId, state);
    }

    // Coordinator reviews result
    async reviewResult(taskId, approved, feedback = '') {
        const state = await loadProcess(taskId);
        if (!state) throw new Error('Task not found');
        if (state.status !== 'review') throw new Error('Not in review');

        state.status = approved ? 'completed' : 'failed';
        state.reviewer = this.account.addr;
        state.reviewResult = {
            approved,
            feedback
        };

        const result = await this._updateTask(taskId, state);

        // Finalize completed/failed tasks
        const boxKey = processBoxKey(taskId);
        await executeNoPayment(this.account, 'resign_process', [taskId], boxKey);

        return result;
    }

    async _updateTask(taskId, state) {
        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(taskId);

        await executeWithPayment(
            this.account,
            'update_process',
            [taskId, stateJson],
            boxKey,
            0
        );

        return state;
    }
}

// Usage
const coordinator = new AICoordinationService(coordinatorAccount, 'coordinator');
const agent = new AICoordinationService(agentAccount, 'agent');

// Create task
const { taskId } = await coordinator.createTask(agentAccount.addr, {
    type: 'analysis',
    input: { text: 'Analyze sentiment of this review...' },
    priority: 'high'
});

// Agent workflow
await agent.claimTask(taskId);
await agent.startWorking(taskId);
await agent.submitResult(taskId, {
    output: { sentiment: 'positive', score: 0.87 },
    confidence: 0.92
});

// Coordinator review
await coordinator.reviewResult(taskId, true, 'Good analysis!');
```

---

## Example 7: Supply Chain Tracking

Track shipments through multiple stages.

### Implementation

```javascript
class SupplyChainService {
    constructor(account, role) {
        this.account = account;
        this.role = role;  // shipper, carrier, receiver
    }

    async createShipment(receiverAddress, shipmentData) {
        const shipmentId = `ship:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const state = {
            version: 1,
            status: 'created',
            shipment: {
                id: shipmentId,
                description: shipmentData.description,
                items: shipmentData.items,
                weight: shipmentData.weight,
                dimensions: shipmentData.dimensions
            },
            shipper: this.account.addr,
            receiver: receiverAddress,
            carrier: null,
            tracking: [
                {
                    status: 'created',
                    location: shipmentData.origin,
                    timestamp: Date.now(),
                    by: this.account.addr
                }
            ],
            createdAt: Date.now()
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(shipmentId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [shipmentId, receiverAddress, stateJson, 201600],
            boxKey,
            mbr
        );

        return { shipmentId, state };
    }

    async updateTracking(shipmentId, status, location, notes = '') {
        const state = await loadProcess(shipmentId);
        if (!state) throw new Error('Shipment not found');

        state.status = status;
        state.tracking.push({
            status,
            location,
            notes,
            timestamp: Date.now(),
            by: this.account.addr
        });

        if (status === 'delivered') {
            const boxKey = processBoxKey(shipmentId);
            await executeWithPayment(this.account, 'update_process', [shipmentId, JSON.stringify(state)], boxKey, 0);
            await executeNoPayment(this.account, 'resign_process', [shipmentId], boxKey);
        } else {
            const boxKey = processBoxKey(shipmentId);
            await executeWithPayment(this.account, 'update_process', [shipmentId, JSON.stringify(state)], boxKey, 0);
        }

        return state;
    }
}

// Usage
const shipper = new SupplyChainService(shipperAccount, 'shipper');
const { shipmentId } = await shipper.createShipment(receiverAddress, {
    description: 'Electronics package',
    items: ['laptop', 'charger'],
    origin: 'New York, NY'
});

await shipper.updateTracking(shipmentId, 'picked_up', 'New York, NY');
await shipper.updateTracking(shipmentId, 'in_transit', 'Chicago, IL');
await shipper.updateTracking(shipmentId, 'out_for_delivery', 'Los Angeles, CA');
await shipper.updateTracking(shipmentId, 'delivered', 'Los Angeles, CA', 'Left at front door');
```

---

## Example 8: Credential Verification

Issue and verify educational/professional credentials.

### Implementation

```javascript
class CredentialService {
    constructor(account, role) {
        this.account = account;
        this.role = role;  // issuer or holder
    }

    async issueCredential(holderAddress, credentialData) {
        const credentialId = `cred:${credentialData.type}:${Date.now()}`;

        const state = {
            version: 1,
            status: 'issued',
            credential: {
                type: credentialData.type,
                title: credentialData.title,
                description: credentialData.description,
                issuedAt: Date.now(),
                expiresAt: credentialData.expiresAt || null
            },
            issuer: {
                address: this.account.addr,
                name: credentialData.issuerName,
                verified: true
            },
            holder: {
                address: holderAddress,
                name: credentialData.holderName
            },
            revoked: false,
            revokedAt: null,
            revokedReason: null
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(credentialId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [credentialId, holderAddress, stateJson, 0],  // No timeout
            boxKey,
            mbr
        );

        return { credentialId, state };
    }

    async revokeCredential(credentialId, reason) {
        const state = await loadProcess(credentialId);
        if (!state) throw new Error('Credential not found');
        if (state.issuer.address !== this.account.addr) throw new Error('Not the issuer');

        state.status = 'revoked';
        state.revoked = true;
        state.revokedAt = Date.now();
        state.revokedReason = reason;

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(credentialId);

        await executeWithPayment(this.account, 'update_process', [credentialId, stateJson], boxKey, 0);
        await executeNoPayment(this.account, 'resign_process', [credentialId], boxKey);

        return state;
    }

    static async verifyCredential(credentialId) {
        const state = await loadProcess(credentialId);
        if (!state) return { valid: false, reason: 'Credential not found' };
        if (state.revoked) return { valid: false, reason: state.revokedReason };
        if (state.credential.expiresAt && Date.now() > state.credential.expiresAt) {
            return { valid: false, reason: 'Credential expired' };
        }
        return { valid: true, credential: state };
    }
}

// Usage
const university = new CredentialService(universityAccount, 'issuer');

const { credentialId } = await university.issueCredential(studentAddress, {
    type: 'degree',
    title: 'Bachelor of Science in Computer Science',
    description: 'Graduated with honors',
    issuerName: 'State University',
    holderName: 'Alice Smith'
});

// Anyone can verify
const verification = await CredentialService.verifyCredential(credentialId);
console.log(verification.valid);  // true
```

---

## Example 9: Multi-Signature Vault

Two-party approval for high-value operations.

### Implementation

```javascript
class MultiSigVault {
    constructor(account) {
        this.account = account;
    }

    async proposeAction(coSignerAddress, action) {
        const proposalId = `vault:${action.type}:${Date.now()}`;

        const state = {
            version: 1,
            status: 'pending',
            action: {
                type: action.type,
                params: action.params,
                description: action.description
            },
            proposer: {
                address: this.account.addr,
                signed: true,
                signedAt: Date.now()
            },
            coSigner: {
                address: coSignerAddress,
                signed: false,
                signedAt: null
            },
            executed: false,
            executedAt: null,
            createdAt: Date.now()
        };

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(proposalId);
        const mbr = calculateMBR(stateJson.length, true, boxKey.length);

        await executeWithPayment(
            this.account,
            'start_process',
            [proposalId, coSignerAddress, stateJson, 7200],
            boxKey,
            mbr
        );

        return { proposalId, state };
    }

    async signProposal(proposalId) {
        const state = await loadProcess(proposalId);
        if (!state) throw new Error('Proposal not found');
        if (state.coSigner.address !== this.account.addr) throw new Error('Not the co-signer');
        if (state.coSigner.signed) throw new Error('Already signed');

        state.coSigner.signed = true;
        state.coSigner.signedAt = Date.now();

        // Both signed = ready to execute
        if (state.proposer.signed && state.coSigner.signed) {
            state.status = 'approved';
        }

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(proposalId);

        await executeWithPayment(this.account, 'update_process', [proposalId, stateJson], boxKey, 0);

        return state;
    }

    async executeProposal(proposalId) {
        const state = await loadProcess(proposalId);
        if (!state) throw new Error('Proposal not found');
        if (state.status !== 'approved') throw new Error('Not approved');

        // Execute the action (application-specific logic here)
        state.status = 'executed';
        state.executed = true;
        state.executedAt = Date.now();

        const stateJson = JSON.stringify(state);
        const boxKey = processBoxKey(proposalId);

        await executeWithPayment(this.account, 'update_process', [proposalId, stateJson], boxKey, 0);
        await executeNoPayment(this.account, 'resign_process', [proposalId], boxKey);

        return state;
    }
}

// Usage
const alice = new MultiSigVault(aliceAccount);
const bob = new MultiSigVault(bobAccount);

const { proposalId } = await alice.proposeAction(bobAccount.addr, {
    type: 'withdraw',
    params: { amount: 1000, recipient: treasuryAddress },
    description: 'Q4 operational expenses'
});

await bob.signProposal(proposalId);
await alice.executeProposal(proposalId);
```

---

## Tips for Building Your Own

1. **Design Your Schema First**: Define clear data structures before coding
2. **Use Unique IDs**: Include timestamps or random strings to prevent collisions
3. **Handle State Transitions**: Validate status before allowing updates
4. **Optimize MBR**: Use the growth-only calculation for updates
5. **Set Appropriate Timeouts**: Match timeout to your use case
6. **Consider Discovery**: Think about how users will find their data
7. **Test on TestNet**: Always test thoroughly before mainnet

---

## Need Help?

- **Developer Guide**: [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
- **API Reference**: [API_REFERENCE.md](./API_REFERENCE.md)
- **Live Example**: [EternalBliss Game](https://ch4itu.github.io/EternalBliss/)

---

*Universal State Machine Framework - Build anything, sunset-proof.*
