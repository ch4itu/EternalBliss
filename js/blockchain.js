// ALGORAND BLOCKCHAIN VARIABLES

const POSITION_UPDATE_COOLDOWN = 60000; // 60 seconds minimum between updates (reduced RPC calls)
let lastPositionUpdateTime = 0;
let isProcessingPositionUpdate = false;

let algodClient = null;
let indexerClient = null;
let contract = null;
let account = null;

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const INDEXER_SERVER = 'https://testnet-idx.algonode.cloud';
const ALGOD_PORT = '';
const ALGOD_TOKEN = '';

// UPDATED: New App ID for v4.0 Contract (puyapy version)
let APP_ID = 748578144;

// v4.0 Contract uses JSON-based storage instead of bit-packing
// No unpacking functions needed - data is stored as JSON strings in boxes

// Embedded ABI contract definition (to avoid CORS issues with file:// protocol)
const CONTRACT_ABI = {
    name: "EternalBlissContract",
    methods: [
        {
            name: "save_player",
            args: [
                { type: "string", name: "player_id" },
                { type: "string", name: "state_data" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_player",
            args: [
                { type: "string", name: "player_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_player_owner",
            args: [
                { type: "string", name: "player_id" }
            ],
            returns: { type: "address" }
        },
        {
            name: "start_battle",
            args: [
                { type: "string", name: "battle_id" },
                { type: "address", name: "opponent" },
                { type: "uint64", name: "deadline_rounds" },
                { type: "string", name: "initial_state" }
            ],
            returns: { type: "string" }
        },
        {
            name: "update_battle",
            args: [
                { type: "string", name: "battle_id" },
                { type: "string", name: "new_state" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_battle",
            args: [
                { type: "string", name: "battle_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_battle_info",
            args: [
                { type: "string", name: "battle_id" }
            ],
            returns: { type: "(address,address,uint64)" }
        },
        {
            name: "get_stats",
            args: [],
            returns: { type: "(uint64,uint64)" }
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
    // Contract uses: BoxMap(Bytes, Bytes, key_prefix=b"p:")[player_id.bytes]
    // where player_id.bytes is ARC4 encoded string: [length_high, length_low, ...string_bytes]
    const addressBytes = new TextEncoder().encode(playerId);
    const addressLength = addressBytes.length;

    // ARC4 string encoding: 2-byte length prefix + string bytes
    const arc4Encoded = new Uint8Array(2 + addressLength);
    arc4Encoded[0] = (addressLength >> 8) & 0xFF;
    arc4Encoded[1] = addressLength & 0xFF;
    arc4Encoded.set(addressBytes, 2);

    // Full box key: "p:" + arc4_encoded_player_id
    const boxKey = new Uint8Array(2 + arc4Encoded.length);
    boxKey.set(new TextEncoder().encode('p:'), 0);
    boxKey.set(arc4Encoded, 2);

    return boxKey;
}

function createBattleBoxKey(battleId) {
    // Contract uses: BoxMap(Bytes, Bytes, key_prefix=b"b:")[battle_id.bytes]
    const battleBytes = new TextEncoder().encode(battleId);
    const battleLength = battleBytes.length;

    // ARC4 string encoding
    const arc4Encoded = new Uint8Array(2 + battleLength);
    arc4Encoded[0] = (battleLength >> 8) & 0xFF;
    arc4Encoded[1] = battleLength & 0xFF;
    arc4Encoded.set(battleBytes, 2);

    // Full box key: "b:" + arc4_encoded_battle_id
    const boxKey = new Uint8Array(2 + arc4Encoded.length);
    boxKey.set(new TextEncoder().encode('b:'), 0);
    boxKey.set(arc4Encoded, 2);

    return boxKey;
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

    // v4.0: No opt-in needed - contract uses box storage
    // This method creates initial player state
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

        // Get the ABI method
        const method = abiContract.getMethodByName('save_player');

        // Create box key using helper function
        const boxKey = createPlayerBoxKey(account.addr);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                account.addr,                      // player_id
                JSON.stringify(initialState)       // state_data
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }
    
// v4.0: Position updates are handled as part of full save using ABI
    // We'll do lightweight position-only saves periodically
    async updatePosition(account, x, y) {
        if (!this.appId) return;
        if (!abiContract) return;

        const now = Date.now();

        // Throttle: Don't send if last update was less than 1 second ago
        if (now - lastPositionUpdateTime < POSITION_UPDATE_COOLDOWN) {
            return;
        }

        // Don't send duplicate position updates
        if (isProcessingPositionUpdate) {
            return;
        }

        isProcessingPositionUpdate = true;

        try {
            // Load current state, update position, and save
            const playerState = await this.getPlayerState(account.addr);
            if (!playerState) {
                // Player not registered yet or state not available - skip silently
                // This is normal during initial connection before registration completes
                return;
            }

            // Update position in state
            playerState.x = Math.max(0, Math.floor(Math.abs(x)));
            playerState.y = Math.max(0, Math.floor(Math.abs(y)));
            playerState.timestamp = Date.now();

            const params = await this.algod.getTransactionParams().do();

            // Get the ABI method
            const method = abiContract.getMethodByName('save_player');

            // Create box key using helper function
            const boxKey = createPlayerBoxKey(account.addr);

            // Create ABI method call
            const atc = new algosdk.AtomicTransactionComposer();
            atc.addMethodCall({
                appID: this.appId,
                method: method,
                methodArgs: [
                    account.addr,                      // player_id
                    JSON.stringify(playerState)        // state_data
                ],
                sender: account.addr,
                signer: algosdk.makeBasicAccountTransactionSigner(account),
                suggestedParams: params,
                boxes: [
                    { appIndex: this.appId, name: boxKey }
                ]
            });

            // Send without waiting for confirmation - fire and forget
            await atc.execute(this.algod, 0);

            lastPositionUpdateTime = now;
        } catch (error) {
            // Silently ignore position update errors - they're non-critical
            // Common during initial registration or network issues
        } finally {
            isProcessingPositionUpdate = false;
        }
    }
    
// v4.0: Save player progress as JSON using ABI encoding
    async saveProgress(account, gameState) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        // Create player state JSON
        const playerState = {
            name: gameState.player.name || 'Hero',
            level: Math.max(1, Math.floor(gameState.player.level)),
            xp: Math.max(0, Math.floor(gameState.player.xp)),
            xpToNext: Math.max(1, Math.floor(gameState.player.xpToNext)),
            gold: Math.max(0, Math.floor(gameState.inventory.gold)),
            hp: Math.max(0, Math.floor(gameState.player.hp)),
            maxHp: Math.max(1, Math.floor(gameState.player.maxHp)),
            mp: Math.max(0, Math.floor(gameState.player.mp)),
            maxMp: Math.max(1, Math.floor(gameState.player.maxMp)),
            attack: Math.max(1, Math.floor(gameState.player.attack)),
            defense: Math.max(1, Math.floor(gameState.player.defense)),
            magic: Math.max(1, Math.floor(gameState.player.magic)),
            x: Math.max(0, Math.floor(gameState.player.x)),
            y: Math.max(0, Math.floor(gameState.player.y)),
            inventory: {
                healthPotions: Math.max(0, Math.floor(gameState.inventory.healthPotions)),
                manaPotions: Math.max(0, Math.floor(gameState.inventory.manaPotions)),
                keys: Math.max(0, Math.floor(gameState.inventory.keys)),
                boats: Math.max(0, Math.floor(gameState.inventory.boats)),
                pickaxe: Math.max(0, Math.floor(gameState.inventory.pickaxe))
            },
            stats: {
                enemiesDefeated: Math.max(0, Math.floor(gameState.stats.enemiesDefeated)),
                treasuresFound: Math.max(0, Math.floor(gameState.stats.treasuresFound)),
                townsVisited: Math.max(0, Math.floor(gameState.stats.townsVisited))
            },
            pvpReady: gameState.player.pvpReady || false,
            timestamp: Date.now()
        };

        console.log('💾 Saving player state:', playerState);

        // Get the ABI method
        const method = abiContract.getMethodByName('save_player');

        // Create box key using helper function
        const boxKey = createPlayerBoxKey(account.addr);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                account.addr,                      // player_id
                JSON.stringify(playerState)        // state_data
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }


// v4.0: Start PvP battle using new battle system with ABI
    // battleId is now passed as a parameter to ensure consistency
    async startPvPBattle(account, opponentAddress, iAmChallenger, battleId, wagerData = null) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');
        if (!battleId) throw new Error('battleId is required');

        const params = await this.algod.getTransactionParams().do();

        console.log('Creating battle with ID:', battleId, 'length:', battleId.length);

        // Initial battle state with wager
        const challengerAddr = iAmChallenger ? account.addr : opponentAddress;
        const initialState = JSON.stringify({
            challenger: challengerAddr,
            opponent: iAmChallenger ? opponentAddress : account.addr,
            turn: 0,
            turnNumber: 0,
            currentTurn: challengerAddr,  // Challenger goes first
            isMyTurn: iAmChallenger,
            lastAction: '',
            lastDamage: 0,
            status: 'active',
            wager: wagerData || { boats: 0, keys: 0, pickaxe: 0, gold: 0 },
            timestamp: Date.now()
        });

        // Get the ABI method
        const method = abiContract.getMethodByName('start_battle');

        // Create box key using helper function
        const boxKey = createBattleBoxKey(battleId);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                battleId,               // battle_id
                opponentAddress,        // opponent (address)
                100,                    // deadline_rounds
                initialState            // initial_state
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async submitPvPTurn(account, battleId, battleState) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        // Update battle state with full information
        const newState = JSON.stringify({
            ...battleState,
            lastUpdated: account.addr,
            timestamp: Date.now()
        });

        // Get the ABI method
        const method = abiContract.getMethodByName('update_battle');

        // Create box key using helper function
        const boxKey = createBattleBoxKey(battleId);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                battleId,      // battle_id
                newState       // new_state
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        console.log('✅ Battle state updated on blockchain:', result.txIDs[0]);
        return result.txIDs[0];
    }

    async endPvPBattle(account, won) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        // In v4.0, ending battle is done by updating battle state to 'completed'
        const playerState = await this.getPlayerState(account.addr);
        if (!playerState || !playerState.pvpOpponent) {
            throw new Error('No active PvP battle');
        }

        const battleId = playerState.pvpOpponent;

        const params = await this.algod.getTransactionParams().do();

        const finalState = JSON.stringify({
            status: 'completed',
            winner: won ? account.addr : null,
            timestamp: Date.now()
        });

        // Get the ABI method
        const method = abiContract.getMethodByName('update_battle');

        // Create box key using helper function
        const boxKey = createBattleBoxKey(battleId);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                battleId,      // battle_id
                finalState     // new_state
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    // NEW: Load battle state from blockchain
    async loadBattle(battleId) {
        if (!this.appId) return null;
        if (!abiContract) return null;

        try {
            // Read battle box directly
            const boxKey = createBattleBoxKey(battleId);
            const boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Battle box format: p1(32) + p2(32) + deadline(8) + state(ARC4 String)
            const boxBytes = new Uint8Array(boxValue.value);

            // Skip p1(32) + p2(32) + deadline(8) + ARC4 string length(2) = 74 bytes
            const jsonBytes = boxBytes.slice(74);
            const jsonString = new TextDecoder().decode(jsonBytes);

            if (!jsonString || jsonString.trim() === '') {
                return null;
            }

            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Failed to load battle:', error);
            return null;
        }
    }

    // NEW: Get battle participants and info
    async getBattleInfo(battleId) {
        if (!this.appId) return null;
        if (!abiContract) return null;

        try {
            // Read battle box directly
            const boxKey = createBattleBoxKey(battleId);
            const boxValue = await this.algod.getApplicationBoxByName(this.appId, boxKey).do();

            if (!boxValue || !boxValue.value) {
                return null;
            }

            // Battle box format: p1(32) + p2(32) + deadline(8) + state
            const boxBytes = new Uint8Array(boxValue.value);

            const p1Bytes = boxBytes.slice(0, 32);
            const p2Bytes = boxBytes.slice(32, 64);
            const deadlineBytes = boxBytes.slice(64, 72);

            const p1 = algosdk.encodeAddress(p1Bytes);
            const p2 = algosdk.encodeAddress(p2Bytes);
            const deadline = Number(new DataView(deadlineBytes.buffer).getBigUint64(0));

            return { p1, p2, deadline };
        } catch (error) {
            console.error('Failed to get battle info:', error);
            return null;
        }
    }

    // Check if battle is expired and clean it up
    async isBattleExpired(battleId) {
        const info = await this.getBattleInfo(battleId);
        if (!info) return false;

        const status = await this.algod.status().do();
        const currentRound = status['last-round'];

        return currentRound > info.deadline;
    }

    // Resign from battle (forfeit)
    async resignBattle(account, battleId) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        const resignState = JSON.stringify({
            status: 'resigned',
            resignedBy: account.addr,
            timestamp: Date.now()
        });

        const method = abiContract.getMethodByName('update_battle');
        const boxKey = createBattleBoxKey(battleId);

        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [battleId, resignState],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [{ appIndex: this.appId, name: boxKey }]
        });

        const result = await atc.execute(this.algod, 4);
        console.log('🏳️ Resigned from battle:', result.txIDs[0]);
        return result.txIDs[0];
    }

    // NEW: Accept battle by updating state
    async acceptBattle(account, battleId) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        const params = await this.algod.getTransactionParams().do();

        const acceptedState = JSON.stringify({
            status: 'accepted',
            acceptedBy: account.addr,
            timestamp: Date.now()
        });

        // Get the ABI method
        const method = abiContract.getMethodByName('update_battle');

        // Create box key using helper function
        const boxKey = createBattleBoxKey(battleId);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                battleId,         // battle_id
                acceptedState     // new_state with accepted status
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
    }

    async setPvPReady(account, isReady) {
        if (!this.appId) throw new Error('Contract not deployed');
        if (!abiContract) throw new Error('ABI contract not loaded');

        // In v4.0, pvpReady is part of player state
        const playerState = await this.getPlayerState(account.addr);
        if (!playerState) {
            throw new Error('Player not registered');
        }

        playerState.pvpReady = isReady;

        const params = await this.algod.getTransactionParams().do();

        // Get the ABI method
        const method = abiContract.getMethodByName('save_player');

        // Create box key using helper function
        const boxKey = createPlayerBoxKey(account.addr);

        // Create ABI method call
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addMethodCall({
            appID: this.appId,
            method: method,
            methodArgs: [
                account.addr,                      // player_id
                JSON.stringify(playerState)        // state_data
            ],
            sender: account.addr,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: this.appId, name: boxKey }
            ]
        });

        const result = await atc.execute(this.algod, 4);
        return result.txIDs[0];
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

            // Box format from contract: owner(32) + last_update(8) + state_data(ARC4 String)
            const boxBytes = new Uint8Array(boxValue.value);

            // Skip owner (32 bytes) + last_update (8 bytes) + ARC4 string length prefix (2 bytes) = 42 bytes
            // The state_data is stored as arc4.String which has 2-byte length prefix
            const jsonBytes = boxBytes.slice(42);
            const jsonString = new TextDecoder().decode(jsonBytes);

            if (!jsonString || jsonString.trim() === '') {
                return null;
            }

            const playerState = JSON.parse(jsonString);

            // Return in expected format
            return {
                ...playerState,
                // Ensure inventory and stats are properly structured
                inventory: playerState.inventory || {
                    healthPotions: 0,
                    manaPotions: 0,
                    keys: 0,
                    boats: 0,
                    pickaxe: 0
                },
                stats: playerState.stats || {
                    enemiesDefeated: 0,
                    treasuresFound: 0,
                    townsVisited: 0
                }
            };

        } catch (error) {
            console.error('❌ Failed to read player state:', error);
            return null;
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
                    // New player - register
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
                showFloatingText('⚠️ Contract error - playing in offline mode', 
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
                    await contract.updatePosition(account, gameState.player.x, gameState.player.y);
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
    if (state.level !== undefined) gameState.player.level = state.level;
    if (state.xp !== undefined) gameState.player.xp = state.xp;
    if (state.xpToNext !== undefined) gameState.player.xpToNext = state.xpToNext;
    
    if (state.gold !== undefined) {
        gameState.player.gold = state.gold;
        gameState.inventory.gold = state.gold;
    }
    
    if (state.hp !== undefined) gameState.player.hp = state.hp;
    if (state.maxHp !== undefined) gameState.player.maxHp = state.maxHp;
    if (state.mp !== undefined) gameState.player.mp = state.mp;
    if (state.maxMp !== undefined) gameState.player.maxMp = state.maxMp;
    if (state.attack !== undefined) gameState.player.attack = state.attack;
    if (state.defense !== undefined) gameState.player.defense = state.defense;
    if (state.magic !== undefined) gameState.player.magic = state.magic;
    
    if (state.inventory) {
        gameState.inventory.healthPotions = state.inventory.healthPotions !== undefined ? state.inventory.healthPotions : 0;
        gameState.inventory.manaPotions = state.inventory.manaPotions !== undefined ? state.inventory.manaPotions : 0;
        gameState.inventory.keys = state.inventory.keys !== undefined ? state.inventory.keys : 0;
        gameState.inventory.boats = state.inventory.boats !== undefined ? state.inventory.boats : 0;
        gameState.inventory.pickaxe = state.inventory.pickaxe !== undefined ? state.inventory.pickaxe : 0;
    }
    
    if (state.stats) {
        gameState.stats.enemiesDefeated = state.stats.enemiesDefeated !== undefined ? state.stats.enemiesDefeated : 0;
        gameState.stats.treasuresFound = state.stats.treasuresFound !== undefined ? state.stats.treasuresFound : 0;
        gameState.stats.townsVisited = state.stats.townsVisited !== undefined ? state.stats.townsVisited : 0;
    }
    
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
            Math.floor(gameState.player.y)
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
        
        
        // Restore player stats
        if (playerState.level) gameState.player.level = playerState.level;
        if (playerState.xp) gameState.player.xp = playerState.xp;
        if (playerState.xpToNext) gameState.player.xpToNext = playerState.xpToNext;
        if (playerState.gold !== undefined) {
            gameState.player.gold = playerState.gold;
            gameState.inventory.gold = playerState.gold;
        }
        if (playerState.hp) gameState.player.hp = playerState.hp;
        if (playerState.maxHp) gameState.player.maxHp = playerState.maxHp;
        if (playerState.mp) gameState.player.mp = playerState.mp;
        if (playerState.maxMp) gameState.player.maxMp = playerState.maxMp;
        if (playerState.attack) gameState.player.attack = playerState.attack;
        if (playerState.defense) gameState.player.defense = playerState.defense;
        if (playerState.magic) gameState.player.magic = playerState.magic;
        
        // Restore position
        if (playerState.x !== undefined) gameState.player.x = playerState.x;
        if (playerState.y !== undefined) gameState.player.y = playerState.y;
        
        // Restore inventory (unpacked from contract)
        if (playerState.inventory) {
            if (playerState.inventory.healthPotions !== undefined) {
                gameState.inventory.healthPotions = playerState.inventory.healthPotions;
            }
            if (playerState.inventory.manaPotions !== undefined) {
                gameState.inventory.manaPotions = playerState.inventory.manaPotions;
            }
            if (playerState.inventory.keys !== undefined) {
                gameState.inventory.keys = playerState.inventory.keys;
            }
            if (playerState.inventory.boats !== undefined) {
                gameState.inventory.boats = playerState.inventory.boats;
            }
            if (playerState.inventory.pickaxe !== undefined) {
                gameState.inventory.pickaxe = playerState.inventory.pickaxe;
            }
        }
        
        // Restore stats (unpacked from contract)
        if (playerState.stats) {
            if (playerState.stats.enemiesDefeated !== undefined) {
                gameState.stats.enemiesDefeated = playerState.stats.enemiesDefeated;
            }
            if (playerState.stats.treasuresFound !== undefined) {
                gameState.stats.treasuresFound = playerState.stats.treasuresFound;
            }
            if (playerState.stats.townsVisited !== undefined) {
                gameState.stats.townsVisited = playerState.stats.townsVisited;
            }
        }
        
        
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

    // Load PvP broadcasts - REDUCED RPC CALLS
    setInterval(loadPvPBroadcasts, 30000); // 30 seconds

    // Check for PvP battle updates (only when needed) - REDUCED RPC CALLS
    if (pvpBattleCheckInterval) {
        setInterval(checkPvPBattleUpdates, 15000); // 15 seconds
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
    if (pvpBattleCheckInterval) clearInterval(pvpBattleCheckInterval);
}


async function updatePositionOnChain() {
    if (!account || !algodClient) return;
    
    try {
        const posData = {
            name: gameState.player.name,
            level: gameState.player.level,
            x: Math.floor(gameState.player.x),
            y: Math.floor(gameState.player.y),
            timestamp: Date.now()
        };
        
        const note = new TextEncoder().encode(
            NOTE_PREFIXES.POSITION + JSON.stringify(posData)
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
        
        await algodClient.sendRawTransaction(signedTxn).do();
        
        
    } catch (error) {
        console.error('Failed to update position:', error);
    }
}

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

async function loadPlayerFromAlgorand() {
    if (!account || !indexerClient) return;
    
    try {
        // First, try to load from PLAYER_DATA for full state
        const playerTxns = await indexerClient
            .searchForTransactions()
            .address(account.addr)
            .addressRole('sender')
            .notePrefix(createNotePrefix(NOTE_PREFIXES.PLAYER_DATA))
            .limit(1)
            .do();
        
        if (playerTxns.transactions && playerTxns.transactions.length > 0) {
            const latestTxn = playerTxns.transactions[0];
            
            if (latestTxn.note) {
                const noteText = decodeBase64Note(latestTxn.note);
                const jsonStr = noteText.replace(NOTE_PREFIXES.PLAYER_DATA, '');
                const playerData = JSON.parse(jsonStr);
                
                gameState.player.name = playerData.name || gameState.player.name;
                gameState.player.level = playerData.level || 1;
                gameState.player.hp = playerData.hp || 100;
                gameState.player.maxHp = playerData.maxHp || 100;
                gameState.player.mp = playerData.mp || 50;
                gameState.player.maxMp = playerData.maxMp || 50;
                gameState.player.xp = playerData.xp || 0;
                gameState.player.xpToNext = playerData.xpToNext || 100;
                gameState.player.attack = playerData.attack || 15;
                gameState.player.defense = playerData.defense || 10;
                gameState.player.magic = playerData.magic || 20;
                
                // DON'T load position from PLAYER_DATA - use POSITION instead
                
                if (playerData.inventory) {
                    gameState.inventory = playerData.inventory;
                }
                if (playerData.stats) {
                    gameState.stats = playerData.stats;
                }
            }
        }
        
        // CRITICAL FIX: Load position from POSITION updates, not PLAYER_DATA
        const posTxns = await indexerClient
            .searchForTransactions()
            .address(account.addr)
            .addressRole('sender')
            .notePrefix(createNotePrefix(NOTE_PREFIXES.POSITION))
            .limit(1)
            .do();
        
        if (posTxns.transactions && posTxns.transactions.length > 0) {
            const latestPosTxn = posTxns.transactions[0];
            
            if (latestPosTxn.note) {
                const noteText = decodeBase64Note(latestPosTxn.note);
                const jsonStr = noteText.replace(NOTE_PREFIXES.POSITION, '');
                const posData = JSON.parse(jsonStr);
                
                // Load ONLY position from POSITION transaction
                gameState.player.x = posData.x || gameState.player.x;
                gameState.player.y = posData.y || gameState.player.y;
                
            }
        }
        
        updateUI();
        renderWorld();
        centerCameraOnPlayer();
        checkLocation();
        
        showFloatingText('Sync complete!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        
    } catch (error) {
        console.error('Failed to load player data:', error);
        showFloatingText('Sync failed: ' + error.message, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
}

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
