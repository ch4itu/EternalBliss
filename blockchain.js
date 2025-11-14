// ALGORAND BLOCKCHAIN VARIABLES

const POSITION_UPDATE_COOLDOWN = 60000; // 60 seconds minimum between updates (reduced RPC calls)
const PLAYER_STATE_CACHE_MAX_AGE = 15000; // 15 seconds before forcing a fresh read
let lastPositionUpdateTime = 0;
let isProcessingPositionUpdate = false;
let cachedPlayerState = null;
let cachedPlayerStateTimestamp = 0;

let algodClient = null;
let indexerClient = null;
let contract = null;
let account = null;

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const INDEXER_SERVER = 'https://testnet-idx.algonode.cloud';
const ALGOD_PORT = '';
const ALGOD_TOKEN = '';

// UPDATED: Universal State Machine contract (generic entity/process storage)
let APP_ID = 749599252;

function calculateMBR(stateDataSize, isProcess = false, keyLength = null) {
    // CRITICAL: Match contract's exact MBR formula!
    // Contract formula: 2500 + 400 * total_bytes (NOT blocks!)
    //
    // For entities: total_bytes = prefix(2) + key + owner(32) + data
    // For processes: total_bytes = prefix(2) + key + p1(32) + p2(32) + turn(8) + data
    //
    // IMPORTANT: ARC4 strings include a 2-byte length prefix!
    // entity_data.bytes and initial_state.bytes in contract include this prefix

    if (isProcess) {
        // Process box: "p:" (2) + ARC4_key + participant1(32) + participant2(32) + turn(8) + data
        // Default key: battle ID ~50 chars = 2 (ARC4 length) + 50 = 52 bytes
        // data is ARC4 encoded: 2 (length prefix) + actual data bytes
        const keySize = keyLength || 52;
        const arc4DataSize = 2 + stateDataSize;  // Add 2-byte ARC4 length prefix
        const total_bytes = 2 + keySize + 32 + 32 + 8 + arc4DataSize;
        return 2500 + (400 * total_bytes);
    } else {
        // Entity box: "e:" (2) + ARC4_key + owner(32) + data
        // Default key: player address 58 chars = 2 (ARC4 length) + 58 = 60 bytes
        // Or "w:ADDRESS" = 2 + 60 = 62 bytes (waiting list, fits 64 byte limit)
        // data is ARC4 encoded: 2 (length prefix) + actual data bytes
        const keySize = keyLength || 60;
        const arc4DataSize = 2 + stateDataSize;  // Add 2-byte ARC4 length prefix
        const total_bytes = 2 + keySize + 32 + arc4DataSize;
        return 2500 + (400 * total_bytes);
    }
}

// Calculate optimal MBR for entity updates (only pay for growth)
async function calculateOptimalEntityMBR(algod, appId, boxKey, newDataSize, keyLength) {
    try {
        const existingBox = await algod.getApplicationBoxByName(appId, boxKey).do();
        const existingValueSize = existingBox.value.length; // owner(32) + ARC4_data
        const newValueSize = 32 + 2 + newDataSize; // owner(32) + ARC4(data)

        // Total box size = key + value
        const oldTotalSize = 2 + keyLength + existingValueSize;
        const newTotalSize = 2 + keyLength + newValueSize;

        // Only pay for size increase, if any
        const sizeDiff = Math.max(0, newTotalSize - oldTotalSize);
        const mbrAmount = sizeDiff * 400;
        console.log(`📦 Entity box exists, MBR for size increase: ${mbrAmount} (value: ${existingValueSize} → ${newValueSize} bytes, diff: ${newValueSize - existingValueSize})`);
        return mbrAmount;
    } catch (error) {
        // Box doesn't exist, pay full MBR
        const mbrAmount = calculateMBR(newDataSize, false, keyLength);
        console.log(`📦 Creating new entity box, full MBR: ${mbrAmount}`);
        return mbrAmount;
    }
}

// Calculate optimal MBR for process updates (only pay for growth)
async function calculateOptimalProcessMBR(algod, appId, boxKey, newDataSize, keyLength) {
    try {
        const existingBox = await algod.getApplicationBoxByName(appId, boxKey).do();
        const existingValueSize = existingBox.value.length; // p1(32) + p2(32) + turn(8) + ARC4_data
        const newValueSize = 32 + 32 + 8 + 2 + newDataSize; // p1(32) + p2(32) + turn(8) + ARC4(data)

        // Total box size = key + value
        const oldTotalSize = 2 + keyLength + existingValueSize;
        const newTotalSize = 2 + keyLength + newValueSize;

        // Only pay for size increase, if any
        const sizeDiff = Math.max(0, newTotalSize - oldTotalSize);
        const mbrAmount = sizeDiff * 400;
        console.log(`📦 Process box exists, MBR for size increase: ${mbrAmount} (value: ${existingValueSize} → ${newValueSize} bytes, diff: ${newValueSize - existingValueSize})`);
        return mbrAmount;
    } catch (error) {
        // Box doesn't exist, pay full MBR
        const mbrAmount = calculateMBR(newDataSize, true, keyLength);
        console.log(`📦 Creating new process box, full MBR: ${mbrAmount}`);
        return mbrAmount;
    }
}

function clonePlayerState(state) {
    if (!state) return null;
    try {
        return JSON.parse(JSON.stringify(state));
    } catch (error) {
        console.warn('Failed to clone player state - falling back to shallow copy:', error);
        return { ...state };
    }
}

function markPlayerStateDirty(reason = '') {
    try {
        if (typeof gameState === 'object' && gameState?.player) {
            gameState.player.unsavedChangesAt = Date.now();
            if (reason) {
                gameState.player.lastDirtyReason = reason;
            }
        }
    } catch (error) {
        console.warn('Failed to mark player state dirty:', error);
    }
}

function clearPlayerStateDirty() {
    try {
        if (typeof gameState === 'object' && gameState?.player) {
            gameState.player.unsavedChangesAt = 0;
            delete gameState.player.lastDirtyReason;
        }
    } catch (error) {
        console.warn('Failed to clear player state dirty flag:', error);
    }
}

function refreshPlayerStateCache(state) {
    const nextTimestamp = Number(state?.timestamp || 0);
    const currentTimestamp = Number(cachedPlayerState?.timestamp || 0);

    if (state && cachedPlayerState && currentTimestamp) {
        if (!nextTimestamp || nextTimestamp < currentTimestamp) {
            console.warn('⚠️ Skipping stale cache update', { nextTimestamp, currentTimestamp });
            return;
        }
    }

    cachedPlayerState = clonePlayerState(state);
    cachedPlayerStateTimestamp = state ? Date.now() : 0;
}

function cloneSuggestedParams(params) {
    return {
        ...params,
        genesisHash: params.genesisHash,
        genesisID: params.genesisID,
        consensusVersion: params.consensusVersion,
        firstRound: params.firstRound,
        lastRound: params.lastRound,
        fee: params.fee,
        minFee: params.minFee,
        flatFee: params.flatFee
    };
}

function createMBRPaymentTransaction(sender, appId, amount, suggestedParams) {
    const params = cloneSuggestedParams(suggestedParams);
    params.flatFee = true;
    params.fee = algosdk.ALGORAND_MIN_TX_FEE;

    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: sender,
        to: algosdk.getApplicationAddress(appId),
        amount,
        suggestedParams: params
    });
}

function createTransactionWithSigner(txn, account) {
    return {
        txn,
        signer: algosdk.makeBasicAccountTransactionSigner(account)
    };
}

// v4.0 Contract uses JSON-based storage instead of bit-packing
// No unpacking functions needed - data is stored as JSON strings in boxes

// Embedded ABI contract definition (generic UniversalStateMachine)
// Full contract: UniversalStateMachine (App ID: 749599252)
// Complete ABI available in: contracts/out/UniversalStateMachine.arc56.json
const CONTRACT_ABI = {
    name: "UniversalStateMachine",
    methods: [
        {
            name: "save_entity",
            args: [
                { type: "string", name: "entity_id" },
                { type: "string", name: "entity_data" },
                { type: "pay", name: "mbr_payment" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_entity",
            args: [
                { type: "string", name: "entity_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_entity_owner",
            args: [
                { type: "string", name: "entity_id" }
            ],
            returns: { type: "address" }
        },
        {
            name: "delete_entity",
            args: [
                { type: "string", name: "entity_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "start_process",
            args: [
                { type: "string", name: "process_id" },
                { type: "address", name: "other_party" },
                { type: "string", name: "initial_state" },
                { type: "pay", name: "mbr_payment" }
            ],
            returns: { type: "string" }
        },
        {
            name: "update_process",
            args: [
                { type: "string", name: "process_id" },
                { type: "string", name: "new_state" },
                { type: "pay", name: "mbr_payment" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_process",
            args: [
                { type: "string", name: "process_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_process_info",
            args: [
                { type: "string", name: "process_id" }
            ],
            returns: { type: "(address,address,uint64)" }
        },
        {
            name: "delete_process",
            args: [
                { type: "string", name: "process_id" }
            ],
            returns: { type: "string" }
        }
    ]
};

let abiContract = null;

function initContractABI() {
    try {
        abiContract = new algosdk.ABIContract(CONTRACT_ABI);
        console.log('✅ Contract ABI initialized');
    } catch (error) {
        console.error('Failed to initialize contract ABI:', error);
    }
}

// Helper function to create box keys matching contract's format
function createPlayerBoxKey(playerId) {
    // Contract uses: BoxMap(Bytes, Bytes, key_prefix=b"e:")[player_id.bytes]
    // where player_id.bytes is ARC4 encoded string: [length_high, length_low, ...string_bytes]
    const addressBytes = new TextEncoder().encode(playerId);
    const addressLength = addressBytes.length;

    // ARC4 string encoding: 2-byte length prefix + string bytes
    const arc4Encoded = new Uint8Array(2 + addressLength);
    arc4Encoded[0] = (addressLength >> 8) & 0xFF;
    arc4Encoded[1] = addressLength & 0xFF;
    arc4Encoded.set(addressBytes, 2);

    // Full box key: "e:" + arc4_encoded_player_id
    const boxKey = new Uint8Array(2 + arc4Encoded.length);
    boxKey.set(new TextEncoder().encode('e:'), 0);
    boxKey.set(arc4Encoded, 2);

    return boxKey;
}

function createBattleBoxKey(battleId) {
    // Contract uses: BoxMap(Bytes, Bytes, key_prefix=b"p:")[battle_id.bytes]
    const battleBytes = new TextEncoder().encode(battleId);
    const battleLength = battleBytes.length;

    // ARC4 string encoding
    const arc4Encoded = new Uint8Array(2 + battleLength);
    arc4Encoded[0] = (battleLength >> 8) & 0xFF;
    arc4Encoded[1] = battleLength & 0xFF;
    arc4Encoded.set(battleBytes, 2);

    // Full box key: "p:" + arc4_encoded_battle_id
    const boxKey = new Uint8Array(2 + arc4Encoded.length);
    boxKey.set(new TextEncoder().encode('p:'), 0);
    boxKey.set(arc4Encoded, 2);

    return boxKey;
}

// Decode box payloads that store JSON strings. Some legacy saves were
// msgpack-encoded, while new saves are UTF-8 JSON bytes. We normalize both.
function extractBalancedJson(text) {
    if (!text) return null;

    const startBrace = text.indexOf('{');
    const startBracket = text.indexOf('[');

    let start = -1;
    let openingChar = null;

    if (startBrace !== -1 && startBracket !== -1) {
        start = Math.min(startBrace, startBracket);
        openingChar = text[start];
    } else if (startBrace !== -1) {
        start = startBrace;
        openingChar = '{';
    } else if (startBracket !== -1) {
        start = startBracket;
        openingChar = '[';
    }

    if (start === -1) {
        return null;
    }

    const closingChar = openingChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            escapeNext = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === openingChar) {
            depth += 1;
        } else if (char === closingChar) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return text.slice(start);
}

function tryParseJsonish(candidate) {
    if (!candidate) return null;

    const trimmed = candidate.trim();
    if (!trimmed) return null;

    try {
        return JSON.parse(trimmed);
    } catch (primaryError) {
        // Attempt to normalize common legacy formats (single quotes, Python booleans)
        const normalized = trimmed
            .replace(/\bTrue\b/g, 'true')
            .replace(/\bFalse\b/g, 'false')
            .replace(/\bNone\b/g, 'null');

        if (normalized !== trimmed) {
            try {
                return JSON.parse(normalized);
            } catch (secondaryError) {
                console.warn('Normalized JSON parse failed:', secondaryError);
            }
        }

        console.warn('JSON parse failed for candidate:', primaryError);
        return null;
    }
}

const DEFAULT_INVENTORY = {
    healthPotions: 0,
    manaPotions: 0,
    keys: 0,
    boats: 0,
    pickaxe: 0
};

const DEFAULT_STATS = {
    enemiesDefeated: 0,
    treasuresFound: 0,
    townsVisited: 0
};

const DEFAULT_COORDINATE = 0;

function createDefaultPlayerState() {
    return {
        name: 'Hero',
        level: 1,
        xp: 0,
        xpToNext: 100,
        gold: 0,
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        attack: 10,
        defense: 10,
        magic: 10,
        x: DEFAULT_COORDINATE,
        y: DEFAULT_COORDINATE,
        timestamp: 0,
        pvpReady: false,
        inventory: { ...DEFAULT_INVENTORY },
        stats: { ...DEFAULT_STATS }
    };
}

const DEFAULT_PLAYER_STATE = createDefaultPlayerState();

function buildPlayerStatePayload(sourceState) {
    const safeState = sourceState || (typeof gameState !== 'undefined' ? gameState : {});
    const player = safeState.player || {};
    const inventory = safeState.inventory || {};
    const stats = safeState.stats || {};
    const pvp = safeState.pvp || {};

    const baseline = (() => {
        const cached = cachedPlayerState ? clonePlayerState(cachedPlayerState) : null;
        const defaults = createDefaultPlayerState();
        if (!cached) {
            return defaults;
        }

        return {
            ...defaults,
            ...cached,
            inventory: {
                ...defaults.inventory,
                ...(cached.inventory || {})
            },
            stats: {
                ...defaults.stats,
                ...(cached.stats || {})
            }
        };
    })();

    const pickValue = (...candidates) => {
        for (const candidate of candidates) {
            if (candidate === undefined || candidate === null) continue;
            if (typeof candidate === 'number' && Number.isNaN(candidate)) continue;
            if (typeof candidate === 'string' && candidate.trim() === '') continue;
            return candidate;
        }
        return undefined;
    };

    const coerceCount = (value, fallback = 0, minimum = 0) => {
        const source = pickValue(value, fallback);
        const num = Number(source);
        if (!Number.isFinite(num)) return Math.max(minimum, Math.floor(Number(fallback) || 0));
        return Math.max(minimum, Math.floor(num));
    };

    return {
        name: typeof player.name === 'string' && player.name.trim()
            ? player.name
            : pickValue(baseline.name, 'Hero'),
        level: coerceCount(player.level, baseline.level, 1),
        xp: coerceCount(player.xp, baseline.xp, 0),
        xpToNext: coerceCount(player.xpToNext, baseline.xpToNext, 1),
        gold: coerceCount(pickValue(inventory.gold, player.gold), baseline.gold, 0),
        hp: coerceCount(player.hp, baseline.hp, 0),
        maxHp: coerceCount(player.maxHp, baseline.maxHp, 1),
        mp: coerceCount(player.mp, baseline.mp, 0),
        maxMp: coerceCount(player.maxMp, baseline.maxMp, 1),
        attack: coerceCount(player.attack, baseline.attack, 1),
        defense: coerceCount(player.defense, baseline.defense, 1),
        magic: coerceCount(player.magic, baseline.magic, 1),
        x: coerceCount(player.x, baseline.x, 0),
        y: coerceCount(player.y, baseline.y, 0),
        inventory: {
            healthPotions: coerceCount(inventory.healthPotions, baseline.inventory.healthPotions, 0),
            manaPotions: coerceCount(inventory.manaPotions, baseline.inventory.manaPotions, 0),
            keys: coerceCount(inventory.keys, baseline.inventory.keys, 0),
            boats: coerceCount(inventory.boats, baseline.inventory.boats, 0),
            pickaxe: coerceCount(inventory.pickaxe, baseline.inventory.pickaxe, 0)
        },
        stats: {
            enemiesDefeated: coerceCount(stats.enemiesDefeated, baseline.stats.enemiesDefeated, 0),
            treasuresFound: coerceCount(stats.treasuresFound, baseline.stats.treasuresFound, 0),
            townsVisited: coerceCount(stats.townsVisited, baseline.stats.townsVisited, 0)
        },
        pvpReady: Boolean(pickValue(player.pvpReady, pvp.isReady, baseline.pvpReady, false)),
        timestamp: Date.now()
    };
}

function normalizePlayerState(rawState) {
    const base = rawState && typeof rawState === 'object' ? rawState : {};
    const normalized = createDefaultPlayerState();

    const coerceNumber = (value, fallback) => {
        if (value === null || value === undefined) return fallback;
        const asNumber = Number(value);
        return Number.isFinite(asNumber) ? asNumber : fallback;
    };

    // Copy over primitive fields with safe coercion
    normalized.name = typeof base.name === 'string' && base.name.trim() ? base.name : normalized.name;
    normalized.level = coerceNumber(base.level, normalized.level);
    normalized.xp = coerceNumber(base.xp, normalized.xp);
    normalized.xpToNext = coerceNumber(base.xpToNext, normalized.xpToNext);
    normalized.gold = coerceNumber(base.gold, normalized.gold);
    normalized.hp = coerceNumber(base.hp, normalized.hp);
    normalized.maxHp = coerceNumber(base.maxHp, normalized.maxHp);
    normalized.mp = coerceNumber(base.mp, normalized.mp);
    normalized.maxMp = coerceNumber(base.maxMp, normalized.maxMp);
    normalized.attack = coerceNumber(base.attack, normalized.attack);
    normalized.defense = coerceNumber(base.defense, normalized.defense);
    normalized.magic = coerceNumber(base.magic, normalized.magic);
    normalized.x = coerceNumber(base.x, normalized.x);
    normalized.y = coerceNumber(base.y, normalized.y);
    normalized.timestamp = coerceNumber(base.timestamp, normalized.timestamp);
    normalized.pvpReady = Boolean(base.pvpReady);

    const inventory = base.inventory && typeof base.inventory === 'object' ? base.inventory : {};
    const stats = base.stats && typeof base.stats === 'object' ? base.stats : {};

    normalized.inventory = { ...normalized.inventory, ...inventory };
    normalized.stats = { ...normalized.stats, ...stats };

    return normalized;
}

function decodeBase64Value(value) {
    if (!value) {
        return new Uint8Array();
    }

    if (value instanceof Uint8Array) {
        return value;
    }

    // Browser environments expose atob, Node exposes Buffer.
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(value, 'base64'));
    }

    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function decodeBoxState(jsonBytes) {
    if (!jsonBytes || jsonBytes.length === 0) {
        return null;
    }

    // Trim any trailing null bytes that may exist from older deployments
    let end = jsonBytes.length;
    while (end > 0 && jsonBytes[end - 1] === 0) {
        end -= 1;
    }

    const trimmedBytes = end === jsonBytes.length ? jsonBytes : jsonBytes.slice(0, end);
    if (trimmedBytes.length === 0) {
        return null;
    }

    const candidateStrings = [];

    // Decode as plain UTF-8 text first – the contract stores UTF-8 JSON today
    try {
        const decoder = new TextDecoder();
        const decodedString = decoder.decode(trimmedBytes).replace(/\u0000+/g, '').trim();
        if (decodedString) {
            const directCandidate = extractBalancedJson(decodedString);
            if (directCandidate) {
                candidateStrings.push(directCandidate);
            } else {
                candidateStrings.push(decodedString);
            }
        }
    } catch (textError) {
        console.warn('Failed to decode box payload as UTF-8 string:', textError);
    }

    // Some legacy payloads are ABI encoded strings (length prefix + utf8 bytes)
    if (candidateStrings.length === 0 && algosdk?.ABIType && typeof algosdk.ABIType.from === 'function') {
        try {
            const stringType = algosdk.ABIType.from('string');
            const decoded = stringType.decode(trimmedBytes);
            if (typeof decoded === 'string' && decoded.trim()) {
                candidateStrings.push(decoded.trim());
            }
        } catch (abiError) {
            // Ignore - not encoded as ABI string
        }
    }

    for (const candidate of candidateStrings) {
        try {
            const parsed = tryParseJsonish(candidate);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch (candidateError) {
            console.warn('JSON candidate parse error:', candidateError);
        }
    }

    // Final attempt: msgpack decode for very old saves
    if (algosdk?.decodeObj) {
        try {
            const decoded = algosdk.decodeObj(trimmedBytes);

            if (typeof decoded === 'string') {
                const candidate = extractBalancedJson(decoded) || decoded;
                return tryParseJsonish(candidate);
            }

            if (decoded && typeof decoded === 'object') {
                return decoded;
            }
        } catch (msgpackError) {
            console.warn('Failed to decode box payload as msgpack:', msgpackError);
        }
    }

    return null;
}

class EternalBlissContract {
    constructor(algodClient, indexerClient, appId) {
        this.algod = algodClient;
        this.indexer = indexerClient;
        this.appId = appId;
    }

    async checkOpponentPvPStatus(opponentAddress) {
        if (!this.appId) return null;

        try {
            const playerState = await this.getPlayerState(opponentAddress);
            return playerState ? playerState.pvpReady : null;
        } catch (error) {
            console.error('Failed to check opponent PvP status:', error);
            return null;
        }
    }

    // Register player using generic save_entity method
    async registerPlayer(account, playerName) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        // Create initial player state as JSON
        const initialState = {
            name: playerName || 'Hero',
            level: 1,
            xp: 0,
            xpToNext: 100,
            gold: 100,
            hp: 100,
            maxHp: 100,
            mp: 50,
            maxMp: 50,
            attack: 15,
            defense: 10,
            magic: 20,
            x: 75,
            y: 75,
            inventory: {
                healthPotions: 3,
                manaPotions: 2,
                keys: 0,
                boats: 0,
                pickaxe: 0
            },
            stats: {
                enemiesDefeated: 0,
                treasuresFound: 0,
                townsVisited: 1
            },
            pvpReady: false,
            timestamp: Date.now()
        };

        const stateJson = JSON.stringify(initialState);
        const stateSize = new TextEncoder().encode(stateJson).length;

        const method = abiContract.getMethodByName('save_entity');
        const boxKey = createPlayerBoxKey(account.addr);

        // Calculate key length: player address is 58 chars, ARC4 encoded = 2 + 58 = 60
        const keyLength = 2 + account.addr.length;

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            calculateMBR(stateSize, false, keyLength),
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                account.addr,  // entity_id = player address
                stateJson,     // entity_data
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to register player:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });

            // Check if it's a balance issue
            if (error.message?.includes('below min') || error.message?.includes('balance')) {
                const mbrAmount = calculateMBR(stateSize, false, keyLength);
                throw new Error(`Insufficient balance. Need ${mbrAmount} microAlgos for MBR + 2000 for fees`);
            }
            throw error;
        }
    }
    
// v4.0: Position updates are handled as part of full save using ABI
    // We'll do lightweight position-only saves periodically
    async updatePosition(account, x, y, options = {}) {
        if (!this.appId) return;
        if (!abiContract) return;

        const now = Date.now();

        // Don't send duplicate position updates
        if (isProcessingPositionUpdate) {
            return;
        }

        isProcessingPositionUpdate = true;

        try {
            const { force = false, skipLoad = false } = options || {};

            if (!force && now - lastPositionUpdateTime < POSITION_UPDATE_COOLDOWN) {
                isProcessingPositionUpdate = false;
                return;
            }

            let playerState = null;

            const cacheIsFresh = cachedPlayerState && (force || (now - cachedPlayerStateTimestamp) <= PLAYER_STATE_CACHE_MAX_AGE);

            if (!skipLoad) {
                if (cacheIsFresh) {
                    playerState = clonePlayerState(cachedPlayerState);
                } else {
                    playerState = await this.getPlayerState(account.addr);
                }
            } else if (cacheIsFresh) {
                playerState = clonePlayerState(cachedPlayerState);
            }

            if (!playerState) {
                if (cacheIsFresh) {
                    playerState = clonePlayerState(cachedPlayerState);
                }

                if (!playerState) {
                    playerState = buildPlayerStatePayload();
                }
            }

            // Update position in state
            playerState.x = Math.max(0, Math.floor(Math.abs(x)));
            playerState.y = Math.max(0, Math.floor(Math.abs(y)));
            playerState.timestamp = Date.now();

            const params = await this.algod.getTransactionParams().do();
            const method = abiContract.getMethodByName('save_entity');
            const boxKey = createPlayerBoxKey(account.addr);
            const stateJson = JSON.stringify(playerState);
            const stateSize = new TextEncoder().encode(stateJson).length;

            const keyLength = 2 + account.addr.length; // ARC4 encoded address

            // Calculate optimal MBR (only pay for growth, saves player funds!)
            const mbrAmount = await calculateOptimalEntityMBR(
                this.algod,
                this.appId,
                boxKey,
                stateSize,
                keyLength
            );

            const paymentTxn = createMBRPaymentTransaction(
                account.addr,
                this.appId,
                mbrAmount,
                params
            );

            const methodParams = cloneSuggestedParams(params);
            methodParams.flatFee = true;
            methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

            const atc = new algosdk.AtomicTransactionComposer();
            atc.addMethodCall({
                appID: this.appId,
                method,
                methodArgs: [
                    account.addr,  // entity_id
                    stateJson,     // entity_data
                    createTransactionWithSigner(paymentTxn, account)
                ],
                sender: account.addr,
                signer: algosdk.makeBasicAccountTransactionSigner(account),
                suggestedParams: methodParams,
                boxes: [
                    { appIndex: this.appId, name: boxKey }
                ]
            });

            // Send without waiting for confirmation - fire and forget
            await atc.execute(this.algod, 0);

            lastPositionUpdateTime = now;
            refreshPlayerStateCache(playerState);
            if (typeof gameState === 'object' && gameState.player) {
                gameState.player.timestamp = playerState.timestamp;
                gameState.player.lastSynced = playerState.timestamp;
            }
        } catch (error) {
            // Silently ignore position update errors - they're non-critical
            // Common during initial registration or network issues
        } finally {
            isProcessingPositionUpdate = false;
        }
    }

// Save player progress using generic save_entity method
    async saveProgress(account, gameState, options = {}) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        // Create player state JSON (allow callers to pass a pre-built snapshot)
        const providedState = options && typeof options === 'object' ? options.prebuiltState : null;
        const playerState = providedState ? { ...providedState } : buildPlayerStatePayload(gameState);

        if (!playerState.timestamp) {
            playerState.timestamp = Date.now();
        }

        console.log('💾 Saving player state:', playerState);

        const stateJson = JSON.stringify(playerState);
        const stateSize = new TextEncoder().encode(stateJson).length;

        const method = abiContract.getMethodByName('save_entity');
        const boxKey = createPlayerBoxKey(account.addr);

        const keyLength = 2 + account.addr.length; // ARC4 encoded address

        // Calculate optimal MBR (only pay for growth, saves player funds!)
        const mbrAmount = await calculateOptimalEntityMBR(
            this.algod,
            this.appId,
            boxKey,
            stateSize,
            keyLength
        );

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            mbrAmount,
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                account.addr,  // entity_id
                stateJson,     // entity_data
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            refreshPlayerStateCache(playerState);
            clearPlayerStateDirty();
            if (typeof gameState === 'object' && gameState.player) {
                gameState.player.timestamp = playerState.timestamp;
                gameState.player.lastSynced = playerState.timestamp;
            }
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to save progress:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });

            // Check if it's a balance issue
            if (error.message?.includes('below min') || error.message?.includes('balance')) {
                throw new Error('Insufficient balance to save progress');
            }
            throw error;
        }
    }


// Start PvP battle using generic start_process method
    async startPvPBattle(account, opponentAddress, iAmChallenger, battleId, wagerData = null) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');
        if (!battleId) throw new Error('battleId is required');

        const params = await this.algod.getTransactionParams().do();

        console.log('Creating battle with ID:', battleId, 'length:', battleId.length);

        // Initial battle state with wager and initial HP/MP for both players
        const challengerAddr = iAmChallenger ? account.addr : opponentAddress;
        const receiverAddr = iAmChallenger ? opponentAddress : account.addr;

        // Load both player states to get accurate initial HP/MP
        let challengerStats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };
        let receiverStats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };

        try {
            const challengerState = await this.getPlayerState(challengerAddr);
            if (challengerState) {
                challengerStats = {
                    hp: challengerState.hp || 100,
                    maxHp: challengerState.maxHp || challengerState.hp || 100,
                    mp: challengerState.mp || 50,
                    maxMp: challengerState.maxMp || challengerState.mp || 50
                };
            }
        } catch (e) {
            console.warn('Could not load challenger stats, using defaults');
        }

        try {
            const receiverState = await this.getPlayerState(receiverAddr);
            if (receiverState) {
                receiverStats = {
                    hp: receiverState.hp || 100,
                    maxHp: receiverState.maxHp || receiverState.hp || 100,
                    mp: receiverState.mp || 50,
                    maxMp: receiverState.maxMp || receiverState.mp || 50
                };
            }
        } catch (e) {
            console.warn('Could not load receiver stats, using defaults');
        }

        const initialState = JSON.stringify({
            challenger: challengerAddr,
            opponent: receiverAddr,
            turn: 0,
            turnNumber: 0,
            currentTurn: challengerAddr,  // Challenger goes first
            isMyTurn: iAmChallenger,
            lastAction: '',
            lastDamage: 0,
            status: 'active',
            wager: wagerData || { boats: 0, keys: 0, pickaxe: 0, gold: 0 },
            player1: {
                address: challengerAddr,
                ...challengerStats
            },
            player2: {
                address: receiverAddr,
                ...receiverStats
            },
            timestamp: Date.now()
        });

        const method = abiContract.getMethodByName('start_process');
        const boxKey = createBattleBoxKey(battleId);
        const stateSize = new TextEncoder().encode(initialState).length;

        const keyLength = 2 + battleId.length; // ARC4 encoded battle ID

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            calculateMBR(stateSize, true, keyLength),
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                battleId,           // process_id
                opponentAddress,    // other_party
                initialState,       // initial_state
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to start battle:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });

            // Check if it's a balance issue
            if (error.message?.includes('below min') || error.message?.includes('balance')) {
                throw new Error('Insufficient balance to start battle');
            }
            throw error;
        }
    }

    mergeBattleState(existingState, updates = {}) {
        const mergedState = {
            ...existingState,
            ...updates
        };

        if (existingState?.wager || updates?.wager) {
            mergedState.wager = {
                ...(existingState?.wager || {}),
                ...(updates?.wager || {})
            };
        }

        if (existingState?.player1 || updates?.player1) {
            mergedState.player1 = {
                ...(existingState?.player1 || {}),
                ...(updates?.player1 || {})
            };
        }

        if (existingState?.player2 || updates?.player2) {
            mergedState.player2 = {
                ...(existingState?.player2 || {}),
                ...(updates?.player2 || {})
            };
        }

        mergedState.timestamp = updates.timestamp || Date.now();

        return mergedState;
    }

    async writeBattleState(account, battleId, stateObject) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();
        const method = abiContract.getMethodByName('update_process');
        const boxKey = createBattleBoxKey(battleId);

        const stateJson = JSON.stringify(stateObject);
        const stateSize = new TextEncoder().encode(stateJson).length;

        const keyLength = 2 + battleId.length; // ARC4 encoded battle ID

        // Calculate optimal MBR (only pay for growth, saves player funds!)
        const mbrAmount = await calculateOptimalProcessMBR(
            this.algod,
            this.appId,
            boxKey,
            stateSize,
            keyLength
        );

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            mbrAmount,
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                battleId,       // process_id
                stateJson,      // new_state
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            console.log('✅ Battle state updated on blockchain:', result.txIDs[0]);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to update battle state:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });

            // Check if it's a balance issue
            if (error.message?.includes('below min') || error.message?.includes('balance')) {
                throw new Error('Insufficient balance to update battle');
            }
            throw error;
        }
    }

    async submitPvPTurn(account, battleId, battleState) {
        const mergedState = this.mergeBattleState(battleState, {
            lastUpdated: account.addr,
            timestamp: Date.now()
        });

        return this.writeBattleState(account, battleId, mergedState);
    }

    async endPvPBattle(account, won) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const playerState = await this.getPlayerState(account.addr);
        if (!playerState || !playerState.pvpOpponent) {
            throw new Error('No active PvP battle');
        }

        const battleId = playerState.pvpOpponent;
        const existingState = await this.loadBattle(battleId);
        if (!existingState) {
            throw new Error('Battle not found on blockchain');
        }

        const opponentAddress = existingState.challenger === account.addr
            ? existingState.opponent
            : existingState.challenger;

        const updates = {
            status: 'completed',
            winner: won ? account.addr : opponentAddress,
            completedAt: Date.now()
        };

        const mergedState = this.mergeBattleState(existingState, updates);
        return this.writeBattleState(account, battleId, mergedState);
    }

    // Load battle state from blockchain using load_process
    async loadBattle(battleId) {
        if (!this.appId) return null;
        if (!abiContract) return null;

        try {
            // Read process box directly
            const boxKey = createBattleBoxKey(battleId);
            const boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Process box format: participant1(32) + participant2(32) + turn(8) + state bytes
            const boxBytes = new Uint8Array(boxValue.value);

            // Skip participant1(32) + participant2(32) + turn(8) = 72 bytes
            const jsonBytes = boxBytes.slice(72);
            const battleState = decodeBoxState(jsonBytes);

            if (!battleState) {
                return null;
            }

            return battleState;
        } catch (error) {
            console.error('Failed to load battle:', error);
            return null;
        }
    }

    // Get battle participants and turn info from process box
    async getBattleInfo(battleId) {
        if (!this.appId) return null;
        if (!abiContract) return null;

        try {
            // Read process box directly
            const boxKey = createBattleBoxKey(battleId);
            const boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Process box format: participant1(32) + participant2(32) + turn(8) + state
            const boxBytes = new Uint8Array(boxValue.value);

            const p1Bytes = boxBytes.slice(0, 32);
            const p2Bytes = boxBytes.slice(32, 64);
            const turnBytes = boxBytes.slice(64, 72);

            const p1 = algosdk.encodeAddress(p1Bytes);
            const p2 = algosdk.encodeAddress(p2Bytes);
            const turn = Number(new DataView(turnBytes.buffer).getBigUint64(0));

            return { p1, p2, turn };
        } catch (error) {
            console.error('Failed to get battle info:', error);
            return null;
        }
    }

    // Check if battle is expired (battles don't have deadlines in generic contract)
    async isBattleExpired(battleId) {
        // Generic process contract doesn't have deadline field
        // Check if battle state indicates timeout (NOT completion)
        try {
            const battleState = await this.loadBattle(battleId);
            if (!battleState) return true;

            // Only consider expired if battle timed out (very old and still active)
            // Do NOT consider completed/resigned battles as expired
            if (battleState.status === 'completed' || battleState.status === 'resigned') {
                return false; // Battle ended normally, not expired
            }

            const age = Date.now() - (battleState.timestamp || 0);
            return age > 600000; // 10 minutes timeout for active battles only
        } catch (error) {
            return true;
        }
    }

    // Resign from battle (forfeit)
    async resignBattle(account, battleId) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const existingState = await this.loadBattle(battleId);
        if (!existingState) {
            throw new Error('Battle not found on blockchain');
        }

        // Check if it's the player's turn
        // The contract enforces turn-based updates, so we can only update on our turn
        const isMyTurn = existingState.currentTurn === account.addr;

        if (isMyTurn) {
            // It's our turn - update battle state with resignation details
            const opponentAddress = existingState.challenger === account.addr
                ? existingState.opponent
                : existingState.challenger;

            const updates = {
                status: 'resigned',
                resignedBy: account.addr,
                winner: opponentAddress,
                currentTurn: opponentAddress,
                action: 'resign',
                damage: 0
            };

            const mergedState = this.mergeBattleState(existingState, updates);
            const result = await this.writeBattleState(account, battleId, mergedState);
            console.log('🏳️ Resigned from battle (with details):', result);
            return result;
        } else {
            // Not our turn - just delete the battle to end it
            // We can't record resignation details, but we can end the battle
            console.log('⚠️ Not your turn - deleting battle without recording resignation details');
            const result = await this.deleteBattle(account, battleId);
            console.log('🏳️ Resigned from battle (deleted):', result);
            return result;
        }
    }

    // Delete battle process (either participant can call this)
    async deleteBattle(account, battleId) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();
        const method = abiContract.getMethodByName('delete_process');
        const boxKey = createBattleBoxKey(battleId);

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [battleId],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            console.log('✅ Battle deleted from blockchain:', result.txIDs[0]);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to delete battle:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });
            throw error;
        }
    }

    // NEW: Accept battle by updating state
    async acceptBattle(account, battleId) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const existingState = await this.loadBattle(battleId);
        if (!existingState) {
            throw new Error('Battle not found on blockchain');
        }

        const updates = {
            status: 'accepted',
            acceptedBy: account.addr,
            acceptedAt: Date.now()
        };

        const mergedState = this.mergeBattleState(existingState, updates);
        return this.writeBattleState(account, battleId, mergedState);
    }

    async setPvPReady(account, isReady) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        // pvpReady is part of player state
        const playerState = await this.getPlayerState(account.addr);
        if (!playerState) {
            throw new Error('Player not registered');
        }

        playerState.pvpReady = isReady;

        const params = await this.algod.getTransactionParams().do();
        const method = abiContract.getMethodByName('save_entity');
        const boxKey = createPlayerBoxKey(account.addr);
        const stateJson = JSON.stringify(playerState);
        const stateSize = new TextEncoder().encode(stateJson).length;

        const keyLength = 2 + account.addr.length; // ARC4 encoded address

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            calculateMBR(stateSize, false, keyLength),
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                account.addr,  // entity_id
                stateJson,     // entity_data
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to delete battle:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });
            throw error;
        }
    }

    // ⚡ FAST Entity-based PvP matchmaking (INSTANT box reads!)
    // Using generic save_entity/delete_entity instead of specialized methods

    async joinWaitingList(account, playerData) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();
        const method = abiContract.getMethodByName('save_entity');

        // Entity ID: "w:" + address for instant matchmaking lookups
        // Using short prefix to fit within 64 byte box key limit:
        // "e:" (2) + ARC4 length (2) + "w:ADDRESS" (60) = 64 bytes
        const entityId = `w:${account.addr}`;
        const boxKey = createPlayerBoxKey(entityId);

        const playerDataJson = JSON.stringify(playerData);
        const stateSize = new TextEncoder().encode(playerDataJson).length;

        const keyLength = 2 + entityId.length; // ARC4 encoded "w:ADDRESS"

        // Calculate optimal MBR (only pay for growth, saves player funds!)
        const mbrAmount = await calculateOptimalEntityMBR(
            this.algod,
            this.appId,
            boxKey,
            stateSize,
            keyLength
        );

        const paymentTxn = createMBRPaymentTransaction(
            account.addr,
            this.appId,
            mbrAmount,
            params
        );

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                entityId,      // entity_id = "waiting:ADDRESS"
                playerDataJson, // entity_data
                createTransactionWithSigner(paymentTxn, account)
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            console.log('✅ Joined waiting list (instant matchmaking):', result.txIDs[0]);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to join waiting list:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });

            // Check if it's a balance issue
            if (error.message?.includes('below min') || error.message?.includes('balance')) {
                throw new Error(`Insufficient balance. Need ${mbrAmount} microAlgos for MBR + ${algosdk.ALGORAND_MIN_TX_FEE} for fees. Try claiming rewards or adding funds.`);
            }
            throw error;
        }
    }

    async leaveWaitingList(account) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();
        const method = abiContract.getMethodByName('delete_entity');

        // Entity ID: "w:" + address (shortened to fit 64 byte box key limit)
        const entityId = `w:${account.addr}`;
        const boxKey = createPlayerBoxKey(entityId);

        const methodParams = cloneSuggestedParams(params);
        methodParams.flatFee = true;
        methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method,
            methodArgs: [
                entityId  // entity_id to delete
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: methodParams,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        try {
            const result = await atc.execute(this.algod, 4);
            console.log('✅ Left waiting list:', result.txIDs[0]);
            return result.txIDs[0];
        } catch (error) {
            console.error('❌ Failed to leave waiting list:', error);
            console.error('Error details:', {
                message: error.message,
                response: error.response?.text || error.response?.body,
                status: error.status
            });
            throw error;
        }
    }

    async getWaitingPlayer(playerAddress) {
        if (!this.appId) return null;

        try {
            // Entity ID: "w:" + address (shortened to fit 64 byte box key limit)
            const entityId = `w:${playerAddress}`;
            const boxKey = createPlayerBoxKey(entityId);

            let boxValue;
            try {
                boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();
            } catch (boxError) {
                // Player not in waiting list
                return null;
            }

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Entity box format from contract: owner(32) + ARC4-encoded data
            const boxBytes = decodeBase64Value(boxValue.value);
            const jsonBytes = boxBytes.slice(32);  // Skip only owner (32 bytes)
            const playerData = decodeBoxState(jsonBytes);

            if (!playerData) {
                return null;
            }

            return {
                address: playerAddress,
                ...playerData
            };
        } catch (error) {
            console.error('Failed to get waiting player:', error);
            return null;
        }
    }

    async getWaitingPlayers() {
        if (!this.appId) return [];

        try {
            // Get all boxes for the app (instant read!)
            const boxes = await this.algod.getApplicationBoxes(this.appId).do();

            const waitingPlayers = [];

            for (const box of boxes.boxes) {
                const boxName = decodeBase64Value(box.name);

                // Decode box name to check if it starts with "e:" and contains "w:"
                const boxNameStr = new TextDecoder().decode(boxName);

                // Skip ARC4 length prefix (2 bytes) from "e:" boxes
                if (boxName.length > 2 && boxName[0] === 101 && boxName[1] === 58) { // "e:" prefix
                    // Extract entity_id from ARC4 encoded string
                    const entityIdBytes = boxName.slice(2);
                    const entityIdLength = (entityIdBytes[0] << 8) | entityIdBytes[1];
                    const entityId = new TextDecoder().decode(entityIdBytes.slice(2, 2 + entityIdLength));

                    // Check if entity_id starts with "w:" (waiting list prefix)
                    if (entityId.startsWith('w:')) {
                        const address = entityId.substring(2); // Remove "w:" prefix

                        // Get player data (instant box read!)
                        const playerData = await this.getWaitingPlayer(address);
                        if (playerData) {
                            waitingPlayers.push(playerData);
                        }
                    }
                }
            }

            // Filter expired players (older than 5 minutes)
            const now = Date.now();
            const validPlayers = waitingPlayers.filter(p => {
                const age = now - (p.timestamp || 0);
                return age < 300000; // 5 minutes
            });

            console.log(`⚡ Found ${validPlayers.length} waiting players via INSTANT box reads!`);
            return validPlayers;
        } catch (error) {
            console.error('Failed to get waiting players:', error);
            return [];
        }
    }

// v4.0: Load player state from box storage - direct box read approach
    async getPlayerState(address) {
        if (!this.appId) return null;
        if (!abiContract) {
            console.warn('ABI contract not loaded yet');
            return null;
        }

        try {
            // Read the box directly using the Algorand API
            // This is more reliable than simulate() for reading box data
            const boxKey = createPlayerBoxKey(address);

            let boxValue;
            try {
                boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();
            } catch (boxError) {
                // Player not registered yet
                return null;
            }

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Entity box format from contract: owner(32) + ARC4-encoded data
            const boxBytes = decodeBase64Value(boxValue.value);

            if (boxBytes.length <= 32) {
                const defaultState = createDefaultPlayerState();
                // Only cache current player's state, not other players
                if (address === account?.addr) {
                    refreshPlayerStateCache(defaultState);
                }
                return defaultState;
            }

            // Skip only owner (32 bytes) to get to ARC4-encoded JSON data
            const jsonBytes = boxBytes.slice(32);
            const parsedState = decodeBoxState(jsonBytes);

            if (!parsedState || typeof parsedState !== 'object') {
                const defaultState = createDefaultPlayerState();
                // Only cache current player's state, not other players
                if (address === account?.addr) {
                    refreshPlayerStateCache(defaultState);
                }
                return defaultState;
            }

            const normalized = normalizePlayerState(parsedState);
            // Only cache current player's state, not other players
            if (address === account?.addr) {
                refreshPlayerStateCache(normalized);
            }
            return normalized;

        } catch (error) {
            console.error('❌ Failed to read player state:', error);
            const defaultState = createDefaultPlayerState();
            // Only cache current player's state, not other players
            if (address === account?.addr) {
                refreshPlayerStateCache(defaultState);
            }
            return defaultState;
        }
    }
    
// v4.0: Get all active players by searching for save_player transactions
    async getAllActivePlayers() {
        if (!this.appId) return [];

        try {
            // Search for recent save_player transactions
            const searchResults = await this.indexer
                .searchForTransactions()
                .applicationID(this.appId)
                .txType('appl')
                .limit(1000)
                .do();

            const playerAddresses = new Set();

            if (searchResults.transactions) {
                searchResults.transactions.forEach(txn => {
                    // Look for save_player transactions
                    if (txn['application-transaction'] &&
                        txn['application-transaction']['application-args'] &&
                        txn['application-transaction']['application-args'].length > 0) {
                        // Decode base64 using atob (browser-compatible)
                        try {
                            const methodSelector = atob(txn['application-transaction']['application-args'][0]);
                            // For ABI methods, we just check if this is an application call
                            // Any NoOp application call likely involves save_player
                            playerAddresses.add(txn.sender);
                        } catch (e) {
                            // Ignore malformed transactions
                        }
                    }
                });
            }

            // Fetch state for each player
            const players = [];
            const now = Date.now();

            for (const address of playerAddresses) {
                if (address === account?.addr) continue;

                try {
                    const playerState = await this.getPlayerState(address);

                    if (playerState && playerState.timestamp) {
                        const timeSinceLastMove = now - playerState.timestamp;

                        // Only include players active in last 5 minutes
                        if (timeSinceLastMove < 300000) {
                            players.push({
                                address: address,
                                ...playerState,
                                isActive: timeSinceLastMove < 60000,
                                isStale: timeSinceLastMove > 60000
                            });
                        }
                    }
                } catch (err) {
                    console.warn(`Could not fetch state for ${address}:`, err.message);
                }
            }

            return players;

        } catch (error) {
            console.error('Failed to get active players:', error);
            return [];
        }
    }
    
    async waitForConfirmation(txId) {
        const startRound = (await this.algod.status().do())['last-round'];
        let currentRound = startRound;

        while (currentRound < startRound + 10) {
            const pendingInfo = await this.algod.pendingTransactionInformation(txId).do();
            if (pendingInfo['confirmed-round'] !== null && pendingInfo['confirmed-round'] > 0) {
                return pendingInfo;
            }
            currentRound++;
            await this.algod.statusAfterBlock(currentRound).do();
        }
        throw new Error('Transaction timeout');
    }
}

// ALGORAND INITIALIZATION

function initAlgorand() {
    try {
        algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
        indexerClient = new algosdk.Indexer(ALGOD_TOKEN, INDEXER_SERVER, ALGOD_PORT);

        // Initialize the contract ABI
        initContractABI();
    } catch (error) {
        console.error('Failed to initialize Algorand clients:', error);
    }
}

async function connectWallet() {
    await connectWithMnemonic();
}

async function connectWithMnemonic() {
    const mnemonic = document.getElementById('walletInput').value.trim();
    
    if (!mnemonic) {
        showFloatingText('Please enter your mnemonic phrase!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    const words = mnemonic.trim().split(/\s+/).filter(word => word.length > 0);
    
    if (words.length !== 25) {
        showFloatingText(`Invalid! Found ${words.length} words, need exactly 25`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    try {
        const cleanMnemonic = words.map(w => w.toLowerCase()).join(' ');
        const accountResult = algosdk.mnemonicToSecretKey(cleanMnemonic);
        
        account = accountResult;
        gameState.player.address = account.addr;
        gameState.player.name = "Hero_" + account.addr.slice(-4);

        await updateAccountBalance();

        // Initialize contract
        if (APP_ID) {
            contract = new EternalBlissContract(algodClient, indexerClient, APP_ID);
            startPvPChallengeChecking();
            
            try {
                // Check if player is already registered
                const playerState = await contract.getPlayerState(account.addr);

                if (!playerState) {
                    // New player - check balance first
                    const accountInfo = await algodClient.accountInformation(account.addr).do();
                    const estimatedMBR = 50000; // Rough estimate for player registration

                    if (accountInfo.amount < estimatedMBR) {
                        showFloatingText(`⚠️ Need ~${(estimatedMBR / 1000000).toFixed(2)} ALGO to register`,
                            gameState.player.x * 32 + 16,
                            gameState.player.y * 32 - 40,
                            '#ef4444'
                        );
                        console.error(`Insufficient balance: ${accountInfo.amount} microAlgos, need ~${estimatedMBR}`);
                        return;
                    }

                    // Register new player
                    showFloatingText('Registering on blockchain...',
                        gameState.player.x * 32 + 16,
                        gameState.player.y * 32 - 40,
                        '#3b82f6'
                    );

                    await contract.registerPlayer(account, gameState.player.name);

                    showFloatingText('✅ Registered!',
                        gameState.player.x * 32 + 16,
                        gameState.player.y * 32 - 40,
                        '#10b981'
                    );
                } else {
                    // Load existing state
                    loadPlayerStateFromContract(playerState);

                    setTimeout(async () => {
                        await loadCompleteGameDataFromNotes();
                        updateUI();
                    }, 1000);

                    showFloatingText('Welcome back!',
                        gameState.player.x * 32 + 16,
                        gameState.player.y * 32 - 40,
                        '#10b981'
                    );
                }
            } catch (contractError) {
                console.error('Contract interaction error:', contractError);

                // Provide specific error messages
                let errorMsg = '⚠️ Contract error - check console';
                if (contractError.message?.includes('balance')) {
                    errorMsg = '⚠️ Insufficient balance - fund your wallet';
                } else if (contractError.message?.includes('network')) {
                    errorMsg = '⚠️ Network error - try again';
                }

                showFloatingText(errorMsg, 
                    gameState.player.x * 32 + 16, 
                    gameState.player.y * 32 - 40, 
                    '#f59e0b'
                );
                // Continue anyway - allow offline play
            }
        }

        document.getElementById('walletInputSection').style.display = 'none';
        document.getElementById('walletConnected').style.display = 'block';
        document.getElementById('connectedAddress').textContent = account.addr;
        document.getElementById('connectionStatus').textContent = '✓ Connected';
        document.getElementById('connectionStatus').className = 'connection-status connected';
        document.getElementById('saveButton').disabled = false;
        document.getElementById('nftButton').style.display = 'block';

        showFloatingText('Wallet Connected!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');
        
        startPeriodicUpdates();
        loadPvPBroadcasts();

        if (contract) {
            setTimeout(async () => {
                try {
                    const playerState = await contract.getPlayerState(account.addr);
                    if (playerState && playerState.x !== undefined && playerState.y !== undefined) {
                        gameState.player.x = playerState.x;
                        gameState.player.y = playerState.y;
                        updateUI();
                        renderWorld();
                        centerCameraOnPlayer();
                    }
                    
                    // Initial position update
                    await contract.updatePosition(account, gameState.player.x, gameState.player.y, { force: true, skipLoad: true });
                } catch (err) {
                    console.warn('Initial position load/update failed:', err.message);
                }
            }, 2000);
        }

    } catch (error) {
        console.error('Connection error:', error);
        
        let errorMsg = 'Invalid mnemonic phrase!';
        if (error.message && error.message.includes('checksum')) {
            errorMsg = 'Invalid checksum - one or more words are incorrect!';
        }
        
        showFloatingText(errorMsg, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
startPvPChallengeChecking();

}

function loadPlayerStateFromContract(state) {
    if (!state || typeof state !== 'object') {
        return;
    }

    const normalizedState = normalizePlayerState(state);
    const incomingTimestamp = Number(normalizedState.timestamp || 0);
    const currentTimestamp = Number(gameState.player?.timestamp || 0);
    const unsavedTimestamp = Number(gameState.player?.unsavedChangesAt || 0);

    if (unsavedTimestamp && (!incomingTimestamp || incomingTimestamp <= currentTimestamp)) {
        console.warn('⚠️ Skipping blockchain sync while local changes pending', {
            incomingTimestamp,
            currentTimestamp,
            unsavedTimestamp,
            reason: gameState.player?.lastDirtyReason || 'unsaved-changes'
        });
        return;
    }

    if (currentTimestamp && (!incomingTimestamp || incomingTimestamp < currentTimestamp)) {
        console.warn('⚠️ Ignoring stale blockchain player state', {
            incomingTimestamp,
            currentTimestamp
        });
        return;
    }

    if (normalizedState.name) gameState.player.name = normalizedState.name;
    if (normalizedState.level !== undefined) gameState.player.level = normalizedState.level;
    if (normalizedState.xp !== undefined) gameState.player.xp = normalizedState.xp;
    if (normalizedState.xpToNext !== undefined) gameState.player.xpToNext = normalizedState.xpToNext;

    if (normalizedState.gold !== undefined) {
        gameState.player.gold = normalizedState.gold;
        gameState.inventory.gold = normalizedState.gold;
    }

    if (normalizedState.hp !== undefined) gameState.player.hp = normalizedState.hp;
    if (normalizedState.maxHp !== undefined) gameState.player.maxHp = normalizedState.maxHp;
    if (normalizedState.mp !== undefined) gameState.player.mp = normalizedState.mp;
    if (normalizedState.maxMp !== undefined) gameState.player.maxMp = normalizedState.maxMp;
    if (normalizedState.attack !== undefined) gameState.player.attack = normalizedState.attack;
    if (normalizedState.defense !== undefined) gameState.player.defense = normalizedState.defense;
    if (normalizedState.magic !== undefined) gameState.player.magic = normalizedState.magic;

    if (normalizedState.inventory) {
        gameState.inventory.healthPotions = normalizedState.inventory.healthPotions !== undefined ? normalizedState.inventory.healthPotions : 0;
        gameState.inventory.manaPotions = normalizedState.inventory.manaPotions !== undefined ? normalizedState.inventory.manaPotions : 0;
        gameState.inventory.keys = normalizedState.inventory.keys !== undefined ? normalizedState.inventory.keys : 0;
        gameState.inventory.boats = normalizedState.inventory.boats !== undefined ? normalizedState.inventory.boats : 0;
        gameState.inventory.pickaxe = normalizedState.inventory.pickaxe !== undefined ? normalizedState.inventory.pickaxe : 0;
    }

    if (normalizedState.stats) {
        gameState.stats.enemiesDefeated = normalizedState.stats.enemiesDefeated !== undefined ? normalizedState.stats.enemiesDefeated : 0;
        gameState.stats.treasuresFound = normalizedState.stats.treasuresFound !== undefined ? normalizedState.stats.treasuresFound : 0;
        gameState.stats.townsVisited = normalizedState.stats.townsVisited !== undefined ? normalizedState.stats.townsVisited : 0;
    }

    const appliedTimestamp = incomingTimestamp || Date.now();
    gameState.player.timestamp = appliedTimestamp;
    gameState.player.lastSynced = appliedTimestamp;
    gameState.player.unsavedChangesAt = 0;
    delete gameState.player.lastDirtyReason;

    normalizedState.timestamp = appliedTimestamp;
    refreshPlayerStateCache(normalizedState);

    updateUI();
    renderWorld();
    centerCameraOnPlayer();
}

function disconnectWallet() {
    account = null;
    gameState.player.address = null;
    
    otherPlayers.clear();
    renderWorld();
    
    stopPeriodicUpdates();
    
    document.getElementById('walletInputSection').style.display = 'block';
    document.getElementById('walletConnected').style.display = 'none';
    document.getElementById('walletInput').value = '';
    document.getElementById('connectionStatus').textContent = 'Disconnected';
    document.getElementById('connectionStatus').className = 'connection-status disconnected';
    document.getElementById('saveButton').disabled = true;
    document.getElementById('nftButton').style.display = 'none';

    showFloatingText('Wallet Disconnected', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#ef4444'
    );
}

async function updateAccountBalance() {
    if (!account || !algodClient) return;
    
    try {
        const accountInfo = await algodClient.accountInformation(account.addr).do();
        const balance = accountInfo.amount / 1000000;
        document.getElementById('algoBalance').textContent = balance.toFixed(6);
    } catch (error) {
        console.error('Failed to get balance:', error);
    }
}

// BLOCKCHAIN DATA FUNCTIONS (keeping save/sync as before)

async function saveToAlgorand() {
    if (!account || !algodClient) {
        showFloatingText('No wallet connected', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    if (!contract) {
        showFloatingText('Smart contract not initialized', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    const btn = document.getElementById('saveButton');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div> Saving...';
    
    try {
        showFloatingText('Saving to smart contract...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#3b82f6'
        );
        
        await contract.saveProgress(
            account,
            gameState
        );
        
        // Also update position in contract
        await contract.updatePosition(
            account,
            Math.floor(gameState.player.x),
            Math.floor(gameState.player.y),
            { force: true, skipLoad: true }
        );
        
        showFloatingText('Progress saved to blockchain!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');
        
        
    } catch (error) {
        console.error('Save failed:', error);
        showFloatingText('Save failed: ' + error.message, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
    
    btn.disabled = false;
    btn.innerHTML = '💾 Save to Algorand';
}

async function syncWithAlgorand() {
    if (!account || !indexerClient) {
        showFloatingText('No wallet connected', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    const btn = document.getElementById('syncButton');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div> Syncing...';
    
    try {
        showFloatingText('Syncing from Algorand...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#3b82f6'
        );
        
        if (contract) {
            try {
                const playerState = await contract.getPlayerState(account.addr);
                if (playerState) {
                    // Load basic player stats from contract
                    loadPlayerStateFromContract(playerState);
                    
                    // Load position from contract
                    if (playerState.x !== undefined && playerState.y !== undefined) {
                        gameState.player.x = playerState.x;
                        gameState.player.y = playerState.y;
                    }
                }
            } catch (contractError) {
                console.warn('Contract sync failed, trying transaction notes fallback:', contractError);
            }
        }
        
        // FIX #2: CRITICAL - Load complete game data from transaction notes
        await loadCompleteGameDataFromNotes();
        
        // Update UI and render
        updateUI();
        renderWorld();
        centerCameraOnPlayer();
        
        // Load other players using contract
        await loadOtherPlayers();
        
        // Load chat messages
        await loadChatMessages();
        
        showFloatingText('Sync complete!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        
    } catch (error) {
        console.error('Sync failed:', error);
        showFloatingText('Sync failed: ' + error.message, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
    
    btn.disabled = false;
    btn.innerHTML = '🔄 Sync from Algorand';
}

async function loadCompleteGameDataFromNotes() {
    if (!account || !contract) {
        return;
    }
    
    try {
        console.log('📖 Loading game data from contract state...');
        
        // Read player state from contract using getPlayerState
        const playerState = await contract.getPlayerState(account.addr);

        if (!playerState) {
            console.log('💡 Tip: Make sure you\'ve saved your game at least once!');
            return;
        }

        const normalizedState = normalizePlayerState(playerState);
        const incomingTimestamp = Number(normalizedState.timestamp || 0);
        const currentTimestamp = Number(gameState.player?.timestamp || 0);

        if (currentTimestamp && (!incomingTimestamp || incomingTimestamp < currentTimestamp)) {
            console.warn('⚠️ Ignoring contract sync because cached data is newer', {
                incomingTimestamp,
                currentTimestamp
            });
            return;
        }

        if (normalizedState.name) gameState.player.name = normalizedState.name;

        // Restore player stats
        if (normalizedState.level !== undefined) gameState.player.level = normalizedState.level;
        if (normalizedState.xp !== undefined) gameState.player.xp = normalizedState.xp;
        if (normalizedState.xpToNext !== undefined) gameState.player.xpToNext = normalizedState.xpToNext;
        if (normalizedState.gold !== undefined) {
            gameState.player.gold = normalizedState.gold;
            gameState.inventory.gold = normalizedState.gold;
        }
        if (normalizedState.hp !== undefined) gameState.player.hp = normalizedState.hp;
        if (normalizedState.maxHp !== undefined) gameState.player.maxHp = normalizedState.maxHp;
        if (normalizedState.mp !== undefined) gameState.player.mp = normalizedState.mp;
        if (normalizedState.maxMp !== undefined) gameState.player.maxMp = normalizedState.maxMp;
        if (normalizedState.attack !== undefined) gameState.player.attack = normalizedState.attack;
        if (normalizedState.defense !== undefined) gameState.player.defense = normalizedState.defense;
        if (normalizedState.magic !== undefined) gameState.player.magic = normalizedState.magic;

        // Restore position
        if (normalizedState.x !== undefined) gameState.player.x = normalizedState.x;
        if (normalizedState.y !== undefined) gameState.player.y = normalizedState.y;

        // Restore inventory (unpacked from contract)
        if (normalizedState.inventory) {
            if (normalizedState.inventory.healthPotions !== undefined) {
                gameState.inventory.healthPotions = normalizedState.inventory.healthPotions;
            }
            if (normalizedState.inventory.manaPotions !== undefined) {
                gameState.inventory.manaPotions = normalizedState.inventory.manaPotions;
            }
            if (normalizedState.inventory.keys !== undefined) {
                gameState.inventory.keys = normalizedState.inventory.keys;
            }
            if (normalizedState.inventory.boats !== undefined) {
                gameState.inventory.boats = normalizedState.inventory.boats;
            }
            if (normalizedState.inventory.pickaxe !== undefined) {
                gameState.inventory.pickaxe = normalizedState.inventory.pickaxe;
            }
        }

        // Restore stats (unpacked from contract)
        if (normalizedState.stats) {
            if (normalizedState.stats.enemiesDefeated !== undefined) {
                gameState.stats.enemiesDefeated = normalizedState.stats.enemiesDefeated;
            }
            if (normalizedState.stats.treasuresFound !== undefined) {
                gameState.stats.treasuresFound = normalizedState.stats.treasuresFound;
            }
            if (normalizedState.stats.townsVisited !== undefined) {
                gameState.stats.townsVisited = normalizedState.stats.townsVisited;
            }
        }

        const appliedTimestamp = incomingTimestamp || Date.now();
        gameState.player.timestamp = appliedTimestamp;
        gameState.player.lastSynced = appliedTimestamp;

        normalizedState.timestamp = appliedTimestamp;
        refreshPlayerStateCache(normalizedState);


        // Update UI to reflect loaded data
        updateUI();
        renderWorld();
        centerCameraOnPlayer();
        
    } catch (error) {
        console.error('Failed to load game data from contract:', error);
    }
}

async function waitForConfirmation(algodClient, txId, timeout) {
    const startRound = (await algodClient.status().do())['last-round'];
    let currentRound = startRound;

    while (currentRound < startRound + timeout) {
        const pendingInfo = await algodClient.pendingTransactionInformation(txId).do();
        if (pendingInfo['confirmed-round'] !== null && pendingInfo['confirmed-round'] > 0) {
            return pendingInfo;
        }
        currentRound++;
        await algodClient.statusAfterBlock(currentRound).do();
    }
    throw new Error('Transaction timeout');
}

function startPeriodicUpdates() {
    // Update chat messages - REDUCED RPC CALLS
    setInterval(loadChatMessages, 30000); // 30 seconds

    // Discover players via contract - REDUCED RPC CALLS
    setInterval(loadOtherPlayers, 30000); // 30 seconds

    // Update account balance - REDUCED RPC CALLS
    setInterval(updateAccountBalance, 120000); // 2 minutes

    // Load PvP broadcasts - faster for better matchmaking UX
    setInterval(loadPvPBroadcasts, 5000); // 5 seconds for quick challenge discovery

    // Check for PvP battle updates (only when needed) - REDUCED RPC CALLS
    if (typeof checkPvPBattleUpdates === 'function') {
        if (pvpBattleCheckInterval) {
            clearInterval(pvpBattleCheckInterval);
        }
        pvpBattleCheckInterval = setInterval(checkPvPBattleUpdates, 2000); // 2 seconds for fast battle updates
    }

    // Auto-save game state every 10 minutes - REDUCED RPC CALLS
    setInterval(async () => {
        if (account && contract && gameState && !gameState.inBattle) {
            try {
                console.log('🔄 Auto-saving game state...');
                await contract.saveProgress(account, gameState);
                console.log('✅ Auto-save complete');
            } catch (error) {
                console.warn('⚠️ Auto-save failed:', error.message);
            }
        }
    }, 600000); // 10 minutes
}

function stopPeriodicUpdates() {
    if (chatUpdateInterval) clearInterval(chatUpdateInterval);
    if (playerUpdateInterval) clearInterval(playerUpdateInterval);
    if (entityMovementInterval) clearInterval(entityMovementInterval);
    if (pvpBattleCheckInterval) {
        clearInterval(pvpBattleCheckInterval);
        pvpBattleCheckInterval = null;
    }
}

// DEPRECATED: Position updates now use box storage via contract.updatePosition()
// Transaction note-based position updates removed as of cleanup 2025-11-14

// LOAD OTHER PLAYERS

async function loadOtherPlayers() {
    if (!contract || !account) {
        console.warn('⚠️ Cannot load players: no contract or account');
        return;
    }
    
    try {
        console.log('🔍 Discovering active players via smart contract...');
        
        const players = await contract.getAllActivePlayers();
        
        const previousCount = otherPlayers.size;
        otherPlayers.clear();
        
        players.forEach(player => {
            // Preserve inBattle status if player is already in otherPlayers
            const existingPlayer = otherPlayers.get(player.address);
            const inBattle = existingPlayer?.inBattle || false;

            otherPlayers.set(player.address, {
                name: player.name || 'Hero',
                level: player.level || 1,
                x: player.x || 0,
                y: player.y || 0,
                address: player.address,
                lastUpdate: Date.now(),
                isStale: player.isStale || false,
                isActive: player.isActive || false,
                inBattle: inBattle,  // Preserve battle status
                isIdle: false  // Never show as idle if actively updating
            });

        });
        
        console.log(`👥 Total online: ${otherPlayers.size} (was ${previousCount})`);
        
        updateOnlinePlayersList();
        renderWorld();
        
    } catch (error) {
        console.error('❌ Failed to load players:', error);
    }
}

// DEPRECATED: Old transaction note-based player loading removed
// Player data is now stored in boxes using save_entity/load_entity
// See getPlayerState() for current implementation

async function loadChatMessages() {
    if (!indexerClient) return;
    
    try {
        const minRound = (await algodClient.status().do())['last-round'] - 1000;
        
        const txns = await indexerClient
            .searchForTransactions()
            .notePrefix(createNotePrefix(NOTE_PREFIXES.CHAT_MESSAGE))
            .minRound(minRound)
            .limit(20)
            .do();
        
        const chatDiv = document.getElementById('chatMessages');
        chatDiv.innerHTML = '';
        
        if (txns.transactions) {
            txns.transactions.sort((a, b) => a['round-time'] - b['round-time']);
            
            for (const txn of txns.transactions) {
                try {
                    const noteText = decodeBase64Note(txn.note);
                    const jsonStr = noteText.replace(NOTE_PREFIXES.CHAT_MESSAGE, '');
                    const chatData = JSON.parse(jsonStr);
                    
                    const messageDiv = document.createElement('div');
                    const senderName = chatData.name || txn.sender.slice(0, 6) + '...';
                    const isYou = txn.sender === account.addr;
                    
                    messageDiv.innerHTML = `<span style="color: ${isYou ? '#fbbf24' : '#74b9ff'};">${senderName}:</span> ${chatData.message}`;
                    chatDiv.appendChild(messageDiv);
                } catch (e) {
                    // Ignore
                }
            }
        }
        
        chatDiv.scrollTop = chatDiv.scrollHeight;
        
    } catch (error) {
        console.error('Failed to load chat messages:', error);
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    const chatDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.innerHTML = `<span style="color: #fbbf24;">You:</span> ${message}`;
    chatDiv.appendChild(messageDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
    
    input.value = '';
    
    if (!account || !algodClient) {
        showFloatingText('No wallet connected for chat', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    const btn = document.getElementById('sendChatBtn');
    btn.disabled = true;
    btn.innerHTML = '...';
    
    try {
        const chatData = {
            name: gameState.player.name,
            message: message,
            level: gameState.player.level,
            timestamp: Date.now()
        };
        
        const note = new TextEncoder().encode(
            NOTE_PREFIXES.CHAT_MESSAGE + JSON.stringify(chatData)
        );
        
        const params = await algodClient.getTransactionParams().do();
        
        const txn = algosdk.makePaymentTxnWithSuggestedParams(
            account.addr,
            account.addr,
            0,
            undefined,
            note,
            params
        );
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
        
        showFloatingText('Message sending...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#3b82f6'
        );
        
        await waitForConfirmation(algodClient, txId, 4);
        
        showFloatingText('Message sent!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        
    } catch (error) {
        console.error('Failed to send message:', error);
        showFloatingText('Chat failed!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
    
    btn.disabled = false;
    btn.innerHTML = 'Send';
}

// NFT FUNCTIONS (unchanged)

async function createPlayerNFT() {
    if (!account || !algodClient) {
        showFloatingText('No wallet connected', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    const btn = document.getElementById('nftButton');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading"></div> Minting...';
    
    try {
        showTxModal('Minting your Player NFT...');
        
        const params = await algodClient.getTransactionParams().do();
        
        const metadata = {
            name: `EternalBliss Hero #${Date.now()}`,
            description: `Level ${gameState.player.level} Hero in EternalBliss RPG`,
            properties: {
                level: gameState.player.level,
                attack: gameState.player.attack,
                defense: gameState.player.defense,
                magic: gameState.player.magic,
                achievements: gameState.stats
            }
        };
        
        const txn = algosdk.makeAssetCreateTxnWithSuggestedParams(
            account.addr,
            new TextEncoder().encode(JSON.stringify(metadata)),
            1,
            0,
            false,
            account.addr,
            account.addr,
            account.addr,
            account.addr,
            'CHRPG',
            `Hero-${gameState.player.level}`,
            'https://EternalBliss.algo/nft',
            undefined,
            params
        );
        
        const signedTxn = txn.signTxn(account.sk);
        
        const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
        
        const confirmedTxn = await waitForConfirmation(algodClient, txId, 4);
        
        const assetId = confirmedTxn['asset-index'];
        gameState.player.assetId = assetId;
        
        updateTxModal(true, `NFT minted successfully! Asset ID: ${assetId}`, txId);
        showFloatingText('Player NFT created!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#fbbf24'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
        
    } catch (error) {
        console.error('NFT minting failed:', error);
        updateTxModal(false, 'Failed to mint NFT: ' + error.message);
        showFloatingText('NFT minting failed!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
    
    btn.disabled = false;
    btn.innerHTML = '🎨 Mint Player NFT';
}

// TRANSACTION MODAL FUNCTIONS

function showTxModal(message) {
    const modal = document.getElementById('txModal');
    const status = document.getElementById('txStatus');
    const result = document.getElementById('txResult');
    
    status.style.display = 'block';
    result.style.display = 'none';
    status.innerHTML = `
        <div class="loading-spinner"></div>
        <p style="margin-top: 15px;">${message}</p>
    `;
    
    modal.style.display = 'flex';
}

function updateTxModal(success, message, txId = null) {
    const status = document.getElementById('txStatus');
    const result = document.getElementById('txResult');
    const txMessage = document.getElementById('txMessage');
    const txLink = document.getElementById('txLink');
    
    status.style.display = 'none';
    result.style.display = 'block';
    
    txMessage.textContent = message;
    txMessage.style.color = success ? '#10b981' : '#ef4444';
    
    if (txId) {
        txLink.style.display = 'block';
        txLink.href = `https://testnet.explorer.perawallet.app/tx/${txId}`;
    } else {
        txLink.style.display = 'none';
    }
}

function closeTxModal() {
    document.getElementById('txModal').style.display = 'none';
}

// ONLINE PLAYERS LIST

function updateOnlinePlayersList() {
    const list = document.getElementById('onlinePlayersList');
    const count = document.getElementById('onlineCount');
    
    list.innerHTML = '';
    count.textContent = otherPlayers.size + 1;
    
    const youItem = document.createElement('div');
    youItem.className = 'player-item';
    youItem.innerHTML = `<strong>You (${gameState.player.name})</strong> - Level ${gameState.player.level}<br>
        <small style="color: #10b981;">📍 (${Math.floor(gameState.player.x)}, ${Math.floor(gameState.player.y)})</small>`;
    list.appendChild(youItem);
    
    const now = Date.now();
    
    otherPlayers.forEach((player, address) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        
        const timeSince = player.lastUpdate ? 
            Math.floor((now - player.lastUpdate) / 1000) : 0;
        
        const isStale = timeSince > 60;
        const staleIndicator = isStale ? '⚠️' : '✅';
        
        item.innerHTML = `
            <strong>${player.name}</strong> (Level ${player.level}) ${staleIndicator}<br>
            <small style="color: ${isStale ? '#f59e0b' : '#10b981'};">📍 (${Math.floor(player.x)}, ${Math.floor(player.y)}) • ${address.slice(0, 6)}...${address.slice(-4)}</small><br>
            <small style="opacity: 0.7;">Last update: ${timeSince}s ago</small>
        `;
        list.appendChild(item);
    });
}
