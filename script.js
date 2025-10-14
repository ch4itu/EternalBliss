// EternalBliss Algorand - Optimized Version with Chunking

// ============================================
// GAME STATE CONFIGURATION
// ============================================

const DEFAULT_MAP = null;
const CHUNK_SIZE = 16; // Render chunks of 16x16 tiles
const RENDER_DISTANCE = 2; // Render 2 chunks in each direction
const PVP_BROADCAST_DURATION = 180000; // 3 minutes (180 seconds)
const PVP_MATCH_RANGE = 5; // tiles - players must be within 5 tiles

let gameState = {
    player: {
        name: "",
        level: 1,
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        xp: 0,
        xpToNext: 100,
        attack: 15,
        defense: 10,
        magic: 20,
        gold: 100,
        x: 75,
        y: 75,
        targetX: 75,
        targetY: 75,
        isMoving: false,
        address: null,
        assetId: null
    },
    world: {
        width: 50,
        height: 37,
        cameraX: 0,
        cameraY: 0,
        areas: []
    },
    inventory: {
        gold: 100,
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
    currentLocation: "Starter Village",
    inBattle: false,
    currentEnemy: null,
    sailingMoves: 0,
    movement: {
        speed: 3,
        keys: { w: false, a: false, s: false, d: false }
    },
    pvp: {
    isReady: false,
    broadcastStart: null,
    currentChallenge: null,
    inPvPBattle: false,
    wager: {
        boats: 0,
        keys: 0,
        pickaxe: 0,
        gold: 0
            }
    },
    lastChallengeCheck: 0,
    challengeNotificationShown: false
};

let pvpBroadcasts = new Map(); // Map of address -> {name, level, x, y, timestamp, wager}

// ============================================
// ALGORAND BLOCKCHAIN VARIABLES
// ============================================

let algodClient = null;
let indexerClient = null;
let account = null;

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const INDEXER_SERVER = 'https://testnet-idx.algonode.cloud';
const ALGOD_PORT = '';
const ALGOD_TOKEN = '';

let APP_ID = 746639029;

const NOTE_PREFIXES = {
    PLAYER_DATA: 'CHRPG:PLAYER:',
    CHAT_MESSAGE: 'CHRPG:CHAT:',
    POSITION: 'CHRPG:POS:',
    BATTLE: 'CHRPG:BATTLE:',
    TRADE: 'CHRPG:TRADE:'
};

// ============================================
// CHUNKING SYSTEM FOR PERFORMANCE
// ============================================

let renderedChunks = new Set();
let tileCache = new Map();

function getChunkKey(chunkX, chunkY) {
    return `${chunkX},${chunkY}`;
}

function worldToChunk(x, y) {
    return {
        chunkX: Math.floor(x / CHUNK_SIZE),
        chunkY: Math.floor(y / CHUNK_SIZE)
    };
}

function getVisibleChunks() {
    const playerChunk = worldToChunk(gameState.player.x, gameState.player.y);
    const chunks = [];
    
    for (let cy = playerChunk.chunkY - RENDER_DISTANCE; cy <= playerChunk.chunkY + RENDER_DISTANCE; cy++) {
        for (let cx = playerChunk.chunkX - RENDER_DISTANCE; cx <= playerChunk.chunkX + RENDER_DISTANCE; cx++) {
            chunks.push({ chunkX: cx, chunkY: cy });
        }
    }
    
    return chunks;
}

function renderChunk(chunkX, chunkY) {
    const worldGrid = document.getElementById('worldGrid');
    const chunkKey = getChunkKey(chunkX, chunkY);
    
    if (renderedChunks.has(chunkKey)) return;
    
    const startX = chunkX * CHUNK_SIZE;
    const startY = chunkY * CHUNK_SIZE;
    const endX = Math.min(startX + CHUNK_SIZE, gameState.world.width);
    const endY = Math.min(startY + CHUNK_SIZE, gameState.world.height);
    
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            if (y < 0 || x < 0 || y >= gameState.world.height || x >= gameState.world.width) continue;
            
            const tileKey = `${x},${y}`;
            if (tileCache.has(tileKey)) continue;
            
            const tile = document.createElement('div');
            tile.className = `tile ${worldMap[y][x]}`;
            tile.style.left = `${x * 32}px`;
            tile.style.top = `${y * 32}px`;
            tile.dataset.chunk = chunkKey;
            worldGrid.appendChild(tile);
            tileCache.set(tileKey, tile);
        }
    }
    
    renderedChunks.add(chunkKey);
}

function clearDistantChunks() {
    const visibleChunks = new Set(getVisibleChunks().map(c => getChunkKey(c.chunkX, c.chunkY)));

    renderedChunks.forEach(chunkKey => {
        if (!visibleChunks.has(chunkKey)) {
            const tiles = document.querySelectorAll(`[data-chunk="${chunkKey}"]`);
            tiles.forEach(tile => {
                // ✅ Only remove terrain tiles, not entities
                if (tile.classList.contains('tile')) {
                    const x = parseInt(tile.style.left) / 32;
                    const y = parseInt(tile.style.top) / 32;
                    tileCache.delete(`${x},${y}`);
                    tile.remove();
                }
            });
            renderedChunks.delete(chunkKey);
        }
    });
}


// ============================================
// BROWSER COMPATIBLE BUFFER UTILITIES
// ============================================

function decodeBase64Note(base64String) {
    try {
        return atob(base64String);
    } catch (error) {
        console.error('Failed to decode base64:', error);
        return '';
    }
}

function createNotePrefix(prefix) {
    return new TextEncoder().encode(prefix);
}

let worldMap = [];
let buildings = [];
let npcs = [];
let enemies = [];
let items = [];
let otherPlayers = new Map();

let keyStates = {};
let moveInterval = null;
let chatUpdateInterval = null;
let playerUpdateInterval = null;

// ============================================
// ALGORAND INITIALIZATION FUNCTIONS
// ============================================

function initAlgorand() {
    try {
        algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
        indexerClient = new algosdk.Indexer(ALGOD_TOKEN, INDEXER_SERVER, ALGOD_PORT);
        console.log('Algorand clients initialized');
    } catch (error) {
        console.error('Failed to initialize Algorand clients:', error);
        showFloatingText('Failed to connect to Algorand network', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
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

    // Count words and validate
    const words = mnemonic.trim().split(/\s+/).filter(word => word.length > 0);
    
    if (words.length !== 25) {
        showFloatingText(`Invalid! Found ${words.length} words, need exactly 25`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // Check if words contain only valid characters (letters)
    const hasInvalidChars = words.some(word => !/^[a-zA-Z]+$/.test(word));
    if (hasInvalidChars) {
        showFloatingText('Mnemonic contains invalid characters!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    try {
        // Clean the mnemonic - lowercase and join with single spaces
        const cleanMnemonic = words.map(w => w.toLowerCase()).join(' ');
        
        console.log('Attempting to connect with 25-word mnemonic...');
        
        // 25-word is Algorand standard, use directly
        const accountResult = algosdk.mnemonicToSecretKey(cleanMnemonic);
        console.log('✅ 25-word Algorand mnemonic validated');
        
        account = accountResult;
        gameState.player.address = account.addr;
        gameState.player.name = "Hero_" + account.addr.slice(-4);

        await updateAccountBalance();

        document.getElementById('walletInputSection').style.display = 'none';
        document.getElementById('walletConnected').style.display = 'block';
        document.getElementById('connectedAddress').textContent = account.addr;
        document.getElementById('connectionStatus').textContent = '✔ Connected';
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

        setTimeout(async () => {
            await syncWithAlgorand();
        }, 1000);

    } catch (error) {
        console.error('Connection error:', error);
        
        let errorMsg = 'Invalid mnemonic phrase!';
        if (error.message && error.message.includes('checksum')) {
            errorMsg = 'Invalid checksum - one or more words are incorrect!';
        } else if (error.message && error.message.includes('decode')) {
            errorMsg = 'Cannot decode - verify all words are correct!';
        }
        
        showFloatingText(errorMsg, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
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

// ============================================
// BLOCKCHAIN DATA FUNCTIONS
// ============================================

async function saveToAlgorand() {
    if (!account || !algodClient) {
        showFloatingText('No wallet connected', 
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
        const playerData = {
            name: gameState.player.name,
            level: gameState.player.level,
            hp: gameState.player.hp,
            maxHp: gameState.player.maxHp,
            mp: gameState.player.mp,
            maxMp: gameState.player.maxMp,
            xp: gameState.player.xp,
            xpToNext: gameState.player.xpToNext,
            attack: gameState.player.attack,
            defense: gameState.player.defense,
            magic: gameState.player.magic,
            gold: gameState.inventory.gold,
            x: gameState.player.x,
            y: gameState.player.y,
            inventory: gameState.inventory,
            stats: gameState.stats,
            timestamp: Date.now()
        };
        
        const note = new TextEncoder().encode(
            NOTE_PREFIXES.PLAYER_DATA + JSON.stringify(playerData)
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
        
        showTxModal('Saving player data to Algorand...');
        
        const signedTxn = txn.signTxn(account.sk);
        
        const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
        
        await waitForConfirmation(algodClient, txId, 4);
        
        updateTxModal(true, 'Player data saved successfully!', txId);
        showFloatingText('Progress saved to blockchain!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');
        
    } catch (error) {
        console.error('Save failed:', error);
        updateTxModal(false, 'Failed to save: ' + error.message);
        showFloatingText('Save failed!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
    
    btn.disabled = false;
    btn.innerHTML = 'Save to Algorand';
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
        
        await loadPlayerFromAlgorand();
        await loadOtherPlayers();
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
    btn.innerHTML = 'Sync from Algorand';
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
    chatUpdateInterval = setInterval(loadChatMessages, 10000);
    playerUpdateInterval = setInterval(loadOtherPlayers, 15000);
    setInterval(updateAccountBalance, 30000);
    setInterval(loadPvPBroadcasts, 15000); // Check every 15 seconds
    setInterval(checkForIncomingChallenges, 5000);
}

function stopPeriodicUpdates() {
    if (chatUpdateInterval) clearInterval(chatUpdateInterval);
    if (playerUpdateInterval) clearInterval(playerUpdateInterval);
}

// ============================================
// DATA LOADING FROM ALGORAND
// ============================================

async function loadPlayerFromAlgorand() {
    if (!account || !indexerClient) return;
    
    try {
        const txns = await indexerClient
            .searchForTransactions()
            .address(account.addr)
            .addressRole('sender')
            .notePrefix(createNotePrefix(NOTE_PREFIXES.PLAYER_DATA))
            .limit(1)
            .do();
        
        if (txns.transactions && txns.transactions.length > 0) {
            const latestTxn = txns.transactions[0];
            
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
                gameState.player.x = playerData.x || 15;
                gameState.player.y = playerData.y || 10;
                
                if (playerData.inventory) {
                    gameState.inventory = playerData.inventory;
                }
                if (playerData.stats) {
                    gameState.stats = playerData.stats;
                }
                
                updateUI();
                renderWorld();
                centerCameraOnPlayer();
                checkLocation();
                
                showFloatingText('Player data loaded!', 
                    gameState.player.x * 32 + 16, 
                    gameState.player.y * 32 - 40, 
                    '#10b981'
                );
            }
        } else {
            showFloatingText('New player created!', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#10b981'
            );
        }
        
    } catch (error) {
        console.error('Failed to load player data:', error);
    }
}

async function loadOtherPlayers() {
    if (!indexerClient) return;
    
    try {
        const minRound = (await algodClient.status().do())['last-round'] - 86400;
        
        const txns = await indexerClient
            .searchForTransactions()
            .notePrefix(createNotePrefix(NOTE_PREFIXES.POSITION))
            .minRound(minRound)
            .limit(100)
            .do();
        
        otherPlayers.clear();
        
        if (txns.transactions) {
            for (const txn of txns.transactions) {
                if (txn.sender === account.addr) continue;
                
                try {
                    const noteText = decodeBase64Note(txn.note);
                    const jsonStr = noteText.replace(NOTE_PREFIXES.POSITION, '');
                    const posData = JSON.parse(jsonStr);
                    
                    otherPlayers.set(txn.sender, {
                        name: posData.name || 'Hero',
                        level: posData.level || 1,
                        x: posData.x || 0,
                        y: posData.y || 0,
                        address: txn.sender,
                        lastUpdate: txn['round-time']
                    });
                } catch (e) {
                    console.log('Failed to parse position data:', e);
                }
            }
        }
        
        updateOnlinePlayersList();
        renderWorld();
        
    } catch (error) {
        console.error('Failed to load other players:', error);
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
                    console.log('Failed to parse chat message:', e);
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

async function updatePositionOnChain() {
    if (!account || !algodClient) return;
    
    try {
        const posData = {
            name: gameState.player.name,
            level: gameState.player.level,
            x: gameState.player.x,
            y: gameState.player.y,
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

// ============================================
// NFT FUNCTIONS
// ============================================

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
    btn.innerHTML = 'Mint Player NFT';
}

// ============================================
// TRANSACTION MODAL FUNCTIONS
// ============================================

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
        txLink.href = `https://testnet.algoexplorer.io/tx/${txId}`;
    } else {
        txLink.style.display = 'none';
    }
}

function closeTxModal() {
    document.getElementById('txModal').style.display = 'none';
}

// ============================================
// ONLINE PLAYERS LIST
// ============================================

function updateOnlinePlayersList() {
    const list = document.getElementById('onlinePlayersList');
    const count = document.getElementById('onlineCount');
    
    list.innerHTML = '';
    count.textContent = otherPlayers.size + 1;
    
    const youItem = document.createElement('div');
    youItem.className = 'player-item';
    youItem.innerHTML = `<strong>You (${gameState.player.name})</strong> - Level ${gameState.player.level}`;
    list.appendChild(youItem);
    
    otherPlayers.forEach((player, address) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        
        const timeSince = player.lastUpdate ? 
            Math.floor((Date.now() - player.lastUpdate * 1000) / 60000) : 0;
        
        item.innerHTML = `
            <strong>${player.name}</strong> (Level ${player.level})<br>
            <small>Position: (${player.x}, ${player.y}) • ${address.slice(0, 6)}...${address.slice(-4)}</small><br>
            <small style="opacity: 0.7;">Last seen: ${timeSince} min ago</small>
        `;
        list.appendChild(item);
    });
}

// ============================================
// HELPER FUNCTIONS FOR AVATARS
// ============================================

function getNPCType(npcClass) {
    if (npcClass.includes('merchant')) return 'merchant';
    if (npcClass.includes('priest')) return 'priest';
    if (npcClass.includes('elder')) return 'elder';
    return 'villager';
}

function getEnemyType(enemyClass) {
    if (enemyClass.includes('goblin')) return 'goblin';
    if (enemyClass.includes('dragon')) return 'dragon';
    if (enemyClass.includes('wolf')) return 'wolf';
    return 'monster';
}

function getPlayerLevelTier(level) {
    if (level >= 20) return 'legendary';
    if (level >= 15) return 'master';
    if (level >= 10) return 'expert';
    if (level >= 5) return 'veteran';
    return 'novice';
}

// ============================================
// GAME INITIALIZATION
// ============================================

function initGame() {
    initAlgorand();
    
    if (DEFAULT_MAP) {
        loadCustomMap(DEFAULT_MAP);
    } else {
        generateWorld();
        createBuildings();
        createNPCs();
        createEnemies();
        spawnRandomItems();
    }
    
    updateUI();
    centerCameraOnPlayer();
    
    setupEventListeners();
    setupMobileControls();
}

function loadCustomMap(mapData) {
    try {
        if (!mapData.terrain || !mapData.width || !mapData.height) {
            console.error('Invalid map data, using default generation');
            generateWorld();
            createBuildings();
            createNPCs();
            createEnemies();
            spawnRandomItems();
            return;
        }
        
        gameState.world.width = mapData.width;
        gameState.world.height = mapData.height;
        gameState.world.areas = mapData.areas || [];
        
        worldMap = mapData.terrain;
        buildings = mapData.buildings || [];
        npcs = mapData.npcs || [];
        enemies = mapData.enemies || [];
        items = mapData.items || [];
        
        gameState.player.x = Math.floor(mapData.width / 2);
        gameState.player.y = Math.floor(mapData.height / 2);
        
        const worldGrid = document.getElementById('worldGrid');
        if (worldGrid) {
            worldGrid.style.width = `${mapData.width * 32}px`;
            worldGrid.style.height = `${mapData.height * 32}px`;
        }
        
        console.log(`Custom map "${mapData.name}" loaded successfully`);
        
    } catch (error) {
        console.error('Failed to load custom map:', error);
        console.log('Falling back to default generation');
        generateWorld();
        createBuildings();
        createNPCs();
        createEnemies();
        spawnRandomItems();
    }
}

function setupEventListeners() {
    document.getElementById('sendChatBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    document.addEventListener('keydown', handleKeyboard);
    document.addEventListener('keyup', handleKeyUp);
    
    window.addEventListener('resize', () => {
        centerCameraOnPlayer();
    });
}

// ============================================
// WORLD GENERATION
// ============================================

function generateWorld() {
    worldMap = BLISS_MAP_DATA.terrain;
    gameState.world.width = BLISS_MAP_DATA.width;
    gameState.world.height = BLISS_MAP_DATA.height;
    gameState.world.areas = BLISS_MAP_DATA.areas;
}

function createBuildings() {
    buildings = BLISS_MAP_DATA.buildings;
}

function createNPCs() {
    npcs = BLISS_MAP_DATA.npcs;
}

function createEnemies() {
    enemies = BLISS_MAP_DATA.enemies;
}

function spawnRandomItems() {
    items = BLISS_MAP_DATA.items;
}

// ============================================
// OPTIMIZED WORLD RENDERING WITH CHUNKING
// ============================================

function renderWorld() {
    const worldGrid = document.getElementById('worldGrid');
    
    // Render visible chunks FIRST (terrain only)
    const visibleChunks = getVisibleChunks();
    visibleChunks.forEach(chunk => {
        renderChunk(chunk.chunkX, chunk.chunkY);
    });
    
    // Clear distant chunks (terrain only)
    clearDistantChunks();
    
    // Clear only entities, keep terrain chunks
    const entities = worldGrid.querySelectorAll('.building, .npc-avatar, .enemy-avatar, .item-drop, .other-player-avatar, .main-player-avatar, [style*="z-index: 19"]');
    entities.forEach(el => el.remove());
    
    // RENDER ALL ENTITIES (they don't use chunking)
    renderAllEntities();
}

function renderAllEntities() {
    const worldGrid = document.getElementById('worldGrid');
    
    // Render buildings
    buildings.forEach(building => {
        const buildingEl = document.createElement('div');
        buildingEl.className = building.class;
        buildingEl.style.left = `${building.x * 32}px`;
        buildingEl.style.top = `${building.y * 32}px`;
        buildingEl.onclick = () => {
            const distance = Math.sqrt(
                Math.pow(gameState.player.x - building.x, 2) + 
                Math.pow(gameState.player.y - building.y, 2)
            );
            if (distance <= 2.0) {
                interactWithBuilding(building);
            } else {
                showFloatingText(`Too far from ${building.name}!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#ef4444');
            }
        };
        buildingEl.title = building.name;
        worldGrid.appendChild(buildingEl);
    });
    
    // Render NPCs with avatars
    npcs.forEach(npc => {
        const npcEl = document.createElement('div');
        npcEl.className = 'npc-avatar';
        npcEl.style.left = `${npc.x * 32}px`;
        npcEl.style.top = `${npc.y * 32}px`;
        
        npcEl.setAttribute('data-npc-type', getNPCType(npc.class));
        
        const nameOverlay = document.createElement('div');
        nameOverlay.className = 'character-name-overlay';
        nameOverlay.textContent = npc.name.split(' ')[0];
        npcEl.appendChild(nameOverlay);
        
        npcEl.onclick = () => {
            const distance = Math.sqrt(
                Math.pow(gameState.player.x - npc.x, 2) + 
                Math.pow(gameState.player.y - npc.y, 2)
            );
            if (distance <= 1.5) {
                talkToNPC(npc);
            } else {
                showFloatingText(`Too far from ${npc.name}!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#ef4444');
            }
        };
        npcEl.title = npc.name;
        worldGrid.appendChild(npcEl);
    });
    
    // Render enemies with avatars
    enemies.forEach(enemy => {
        const enemyEl = document.createElement('div');
        enemyEl.className = 'enemy-avatar';
        enemyEl.style.left = `${enemy.x * 32}px`;
        enemyEl.style.top = `${enemy.y * 32}px`;
        
        enemyEl.setAttribute('data-enemy-type', getEnemyType(enemy.class));
        
        const healthBar = document.createElement('div');
        healthBar.className = 'enemy-health-bar';
        const healthFill = document.createElement('div');
        healthFill.className = 'enemy-health-fill';
        healthFill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
        healthBar.appendChild(healthFill);
        enemyEl.appendChild(healthBar);
        
        enemyEl.onclick = () => tryBattleEnemy(enemy);
        enemyEl.title = `${enemy.name} (HP: ${enemy.hp}/${enemy.maxHp})`;
        worldGrid.appendChild(enemyEl);
    });

    // Render items
    items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'item-drop';
        itemEl.style.left = `${item.x * 32 + 4}px`;
        itemEl.style.top = `${item.y * 32 + 4}px`;
        
        const itemEmojis = {
            gold: '💰',
            health_potion: '🧪',
            mana_potion: '🔮',
            key: '🗝️',
            treasure: '📦'
        };
        itemEl.innerHTML = itemEmojis[item.type] || '💰';
        
        itemEl.title = `${item.type.replace('_', ' ')}: ${item.value}`;
        itemEl.style.fontSize = '14px';
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'center';
        
        worldGrid.appendChild(itemEl);
    });
    
    // Render other players
    otherPlayers.forEach((player, address) => {
        const otherPlayerEl = document.createElement('div');
        otherPlayerEl.className = 'other-player-avatar';
        otherPlayerEl.style.left = `${player.x * 32}px`;
        otherPlayerEl.style.top = `${player.y * 32}px`;
        
        otherPlayerEl.setAttribute('data-player-level', getPlayerLevelTier(player.level));
        
        const playerInfo = document.createElement('div');
        playerInfo.className = 'character-name-overlay player-name';
        playerInfo.textContent = `${player.name} (${player.level})`;
        otherPlayerEl.appendChild(playerInfo);
        
        otherPlayerEl.title = `${player.name} (Level ${player.level})`;
        otherPlayerEl.onclick = () => interactWithPlayer(address, player);
        worldGrid.appendChild(otherPlayerEl);
    });
    
    // Render main player
    const player = document.createElement('div');
    player.className = 'main-player-avatar';
    player.style.left = `${gameState.player.x * 32}px`;
    player.style.top = `${gameState.player.y * 32}px`;
    player.setAttribute('data-player-level', getPlayerLevelTier(gameState.player.level));

    const yourName = document.createElement('div');
    yourName.className = 'character-name-overlay your-name';
    yourName.textContent = 'You';
    player.appendChild(yourName);

    player.title = `${gameState.player.name} (Level ${gameState.player.level})`;
    worldGrid.appendChild(player);

    // Render boat if sailing
    if (gameState.sailingMoves && gameState.sailingMoves > 0) {
        const boatEl = document.createElement('div');
        boatEl.style.position = 'absolute';
        boatEl.style.left = `${gameState.player.x * 32}px`;
        boatEl.style.top = `${gameState.player.y * 32}px`;
        boatEl.style.width = '32px';
        boatEl.style.height = '32px';
        boatEl.style.fontSize = '28px';
        boatEl.style.display = 'flex';
        boatEl.style.alignItems = 'center';
        boatEl.style.justifyContent = 'center';
        boatEl.style.zIndex = '19';
        boatEl.textContent = '⛵';
        boatEl.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
        boatEl.style.animation = 'boat-bob 2s ease-in-out infinite';
        boatEl.style.pointerEvents = 'none';
        worldGrid.appendChild(boatEl);
    }
}

// ============================================
// MOVEMENT SYSTEM
// ============================================

function movePlayer(dx, dy) {
    if (gameState.inBattle) return;
    
    const newX = gameState.player.x + dx;
    const newY = gameState.player.y + dy;
    
    if (canMoveTo(newX, newY)) {
        gameState.player.x = newX;
        gameState.player.y = newY;
        gameState.player.isMoving = true;
        
        updatePlayerPositionOnly();
        centerCameraOnPlayerOptimized();
        checkLocationQuick();
        
        if ((gameState.player.x + gameState.player.y) % 5 === 0) {
            gameState.player.mp = Math.max(0, gameState.player.mp - 1);
            updateUI();
        }
        
        if ((gameState.player.x + gameState.player.y) % 10 === 0 && account) {
            updatePositionOnChain();
        }
        
        if (Math.random() < 0.005) {
            const tileType = worldMap[Math.floor(newY)][Math.floor(newX)];
            const encounterChance = tileType === 'road' ? 0.005 : 0.01;
            if (Math.random() < encounterChance) {
                randomEncounter();
            }
        }
        
        checkItemCollectionOptimized();
        
    } else {
        showFloatingText('Path Blocked!', gameState.player.x * 32 + 16, gameState.player.y * 32, '#ef4444');
    }
}

function updatePlayerPositionOnly() {
    const playerEl = document.querySelector('.main-player-avatar');
    if (playerEl) {
        playerEl.style.left = `${gameState.player.x * 32}px`;
        playerEl.style.top = `${gameState.player.y * 32}px`;
        
        if (gameState.player.isMoving) {
            playerEl.classList.add('walking');
            setTimeout(() => {
                if (playerEl) playerEl.classList.remove('walking');
                gameState.player.isMoving = false;
            }, 150);
        }
    }
    
    // Update boat position if sailing
    if (gameState.sailingMoves && gameState.sailingMoves > 0) {
        const boatEl = document.querySelector('[style*="boat-bob"]');
        if (boatEl) {
            boatEl.style.left = `${gameState.player.x * 32}px`;
            boatEl.style.top = `${gameState.player.y * 32}px`;
        }
    }
}

function centerCameraOnPlayerOptimized() {
    const worldView = document.getElementById('worldView');
    const worldGrid = document.getElementById('worldGrid');
    const viewWidth = worldView.offsetWidth;
    const viewHeight = worldView.offsetHeight;
    
    const targetX = (gameState.player.x * 32) - (viewWidth / 2) + 16;
    const targetY = (gameState.player.y * 32) - (viewHeight / 2) + 16;
    
    const worldWidth = gameState.world.width * 32;
    const worldHeight = gameState.world.height * 32;

    const finalX = -Math.max(0, Math.min(worldWidth - viewWidth, targetX));
    const finalY = -Math.max(0, Math.min(worldHeight - viewHeight, targetY));

    worldGrid.style.transform = `translate3d(${finalX}px, ${finalY}px, 0)`;
    
    // Check if we need to render new chunks
    const visibleChunks = getVisibleChunks();
    let needsRerender = false;
    
    visibleChunks.forEach(chunk => {
        const chunkKey = getChunkKey(chunk.chunkX, chunk.chunkY);
        if (!renderedChunks.has(chunkKey)) {
            needsRerender = true;
        }
    });
    
    if (needsRerender) {
        // Only render new TERRAIN chunks - DON'T touch entities!
        visibleChunks.forEach(chunk => {
            renderChunk(chunk.chunkX, chunk.chunkY);
        });
        clearDistantChunks();
        // CRITICAL FIX: Removed renderAllEntities() call - entities stay persistent!
    }
    
    updateMinimapOptimized();
}

function centerCameraOnPlayer() {
    centerCameraOnPlayerOptimized();
}

function canMoveTo(x, y) {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    
    if (tileX < 0 || tileX >= gameState.world.width || 
        tileY < 0 || tileY >= gameState.world.height) {
        return false;
    }
    
    const tileType = worldMap[tileY][tileX];
    
    if (tileType === 'water') {
        if (gameState.sailingMoves && gameState.sailingMoves > 0) {
            gameState.sailingMoves--;
            if (gameState.sailingMoves === 0) {
                showFloatingText('Boat sank! Click anywhere to be rescued', 
                    x * 32 + 16, 
                    y * 32 - 20, 
                    '#ef4444'
                );
                setTimeout(() => rescueFromWater(), 2000);
            }
            return true;
        }
        
        if (gameState.inventory.boats > 0) {
            gameState.inventory.boats--;
            gameState.sailingMoves = 15;
            updateUI();
            showFloatingText('Boat deployed! 15 moves remaining', 
                x * 32 + 16, 
                y * 32 - 20, 
                '#3b82f6'
            );
            return true;
        }
        return false;
    }

    if (gameState.sailingMoves && gameState.sailingMoves > 0) {
        gameState.sailingMoves = 0;
        showFloatingText('Reached land - boat available for next use', 
            x * 32 + 16, 
            y * 32 - 20, 
            '#10b981'
        );
    }

    if (tileType === 'mountain') {
        if (gameState.inventory.pickaxe > 0) {
            gameState.inventory.pickaxe--;
            
            worldMap[tileY][tileX] = 'grass';
            
            // Clear the old tile from cache
            tileCache.delete(`${tileX},${tileY}`);
            
            // Force re-render of this chunk
            const chunk = worldToChunk(tileX, tileY);
            renderedChunks.delete(getChunkKey(chunk.chunkX, chunk.chunkY));
            
            renderWorld();
            updateUI();
            
            if (gameState.inventory.pickaxe === 0) {
                showFloatingText('Mountain cleared! Pickaxe broke!', 
                    tileX * 32 + 16, 
                    tileY * 32 - 20, 
                    '#ef4444'
                );
            } else {
                showFloatingText(`Mountain cleared! (${gameState.inventory.pickaxe} uses left)`, 
                    tileX * 32 + 16, 
                    tileY * 32 - 20, 
                    '#fbbf24'
                );
            }
            
            createParticleEffect(tileX * 32 + 16, tileY * 32, '#6b7280');
            return true;
        }
        return false;
    }

    if (tileType === 'door') {
        if (gameState.inventory.keys > 0) {
            gameState.inventory.keys--;
            worldMap[tileY][tileX] = 'road';
            
            // Clear the old tile from cache
            tileCache.delete(`${tileX},${tileY}`);
            
            // Force re-render of this chunk
            const chunk = worldToChunk(tileX, tileY);
            renderedChunks.delete(getChunkKey(chunk.chunkX, chunk.chunkY));
            
            renderWorld();
            updateUI();
            showFloatingText('Door Unlocked!', 
                x * 32 + 16, 
                y * 32 - 20, 
                '#fbbf24'
            );
            createParticleEffect(x * 32 + 16, y * 32, '#fbbf24');
            return true;
        } else {
            showFloatingText('Locked! Need a key.', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#ef4444'
            );
            return false;
        }
    }
    
    const blockingEnemy = enemies.find(enemy => 
        Math.floor(enemy.x) === tileX && Math.floor(enemy.y) === tileY
    );
    
    if (blockingEnemy) {
        if (!gameState.inBattle) {
            showFloatingText(`${blockingEnemy.name} blocks your path!`, 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#ef4444'
            );
            setTimeout(() => startBattle(blockingEnemy), 500);
        }
        return false;
    }
    
    const adjacentEnemies = enemies.filter(enemy => {
        const enemyX = Math.floor(enemy.x);
        const enemyY = Math.floor(enemy.y);
        const distX = Math.abs(enemyX - tileX);
        const distY = Math.abs(enemyY - tileY);
        return distX <= 1 && distY <= 1 && (distX + distY) > 0;
    });

    if (adjacentEnemies.length > 0 && !gameState.inBattle) {
        showFloatingText('Enemy nearby - approach carefully!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 20, 
            '#f59e0b'
        );
    }
    
    return true;
}

function rescueFromWater() {
    if (gameState.sailingMoves === 0) {
        let nearestLand = null;
        let minDistance = Infinity;
        
        for (let y = 0; y < gameState.world.height; y++) {
            for (let x = 0; x < gameState.world.width; x++) {
                if (worldMap[y][x] !== 'water' && worldMap[y][x] !== 'mountain') {
                    const distance = Math.sqrt(
                        Math.pow(x - gameState.player.x, 2) + 
                        Math.pow(y - gameState.player.y, 2)
                    );
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestLand = {x, y};
                    }
                }
            }
        }
        
        if (nearestLand) {
            gameState.player.x = nearestLand.x;
            gameState.player.y = nearestLand.y;
            
            gameState.player.hp = Math.max(10, gameState.player.hp - 20);
            gameState.inventory.gold = Math.max(0, gameState.inventory.gold - 10);
            
            updateUI();
            renderWorld();
            centerCameraOnPlayer();
            
            showFloatingText('Rescued! -20 HP, -10 Gold', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#f59e0b'
            );
        }
    }
}

function checkLocationQuick() {
    let locationName = "Wilderness";
    
    if (gameState.world.areas && gameState.world.areas.length > 0) {
        for (const area of gameState.world.areas) {
            if (gameState.player.x >= area.x && 
                gameState.player.x < area.x + area.width &&
                gameState.player.y >= area.y && 
                gameState.player.y < area.y + area.height) {
                locationName = area.name;
                break;
            }
        }
    }
    
    if (locationName === "Wilderness") {
        const settlements = {
            "Starter Village": {x1: 10, y1: 6, x2: 22, y2: 18},
            "Smart Contract Town": {x1: 35, y1: 6, x2: 45, y2: 14},
            "DeFi Village": {x1: 4, y1: 20, x2: 16, y2: 32},
            "NFT Outpost": {x1: 22, y1: 26, x2: 32, y2: 36},
            "Foundation Castle": {x1: 22, y1: 2, x2: 28, y2: 8}
        };

        for (const [name, bounds] of Object.entries(settlements)) {
            if (gameState.player.x >= bounds.x1 && gameState.player.x <= bounds.x2 &&
                gameState.player.y >= bounds.y1 && gameState.player.y <= bounds.y2) {
                locationName = name;
                break;
            }
        }
    }
    
    if (locationName !== gameState.currentLocation) {
        gameState.currentLocation = locationName;
        
        document.getElementById('currentLocation').textContent = locationName;
        document.getElementById('locationName').textContent = locationName;
        
        showFloatingText(`Welcome to ${locationName}!`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 25, 
            '#10b981'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');
    }
}

function checkLocation() {
    checkLocationQuick();
}

function checkItemCollectionOptimized() {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const distance = Math.sqrt(
            Math.pow(gameState.player.x - item.x, 2) + 
            Math.pow(gameState.player.y - item.y, 2)
        );
        if (distance < 0.8) {
            collectItem(i);
            break;
        }
    }
}

function collectItem(index) {
    const item = items[index];
    
    switch(item.type) {
        case 'gold':
        case 'treasure':
            gameState.inventory.gold += item.value;
            showFloatingText(`+${item.value} Gold!`, item.x * 32 + 16, item.y * 32, '#fbbf24');
            break;
        case 'health_potion':
            gameState.inventory.healthPotions += item.value;
            showFloatingText(`+${item.value} Health Potion!`, item.x * 32 + 16, item.y * 32, '#ef4444');
            break;
        case 'mana_potion':
            gameState.inventory.manaPotions += item.value;
            showFloatingText(`+${item.value} Mana Potion!`, item.x * 32 + 16, item.y * 32, '#3b82f6');
            break;
        case 'key':
            gameState.inventory.keys += item.value;
            showFloatingText(`+${item.value} Key!`, item.x * 32 + 16, item.y * 32, '#fbbf24');
            break;
        default:
            gameState.inventory.gold += item.value;
            showFloatingText(`+${item.value} Gold!`, item.x * 32 + 16, item.y * 32, '#fbbf24');
    }
    
    gameState.stats.treasuresFound++;
    createParticleEffect(item.x * 32 + 16, item.y * 32, '#fbbf24');
    
    items.splice(index, 1);
    updateUI();
    renderWorld();
}

// ============================================
// MINIMAP SYSTEM
// ============================================

function initializeMinimap() {
    const minimapContent = document.getElementById('minimapContent');
    const minimapContainer = document.querySelector('.minimap');
    minimapContent.innerHTML = '';
    
    // Calculate scale to fit entire world in minimap
    const targetWidth = 200;
    const targetHeight = 200;
    
    const scaleX = targetWidth / gameState.world.width;
    const scaleY = targetHeight / gameState.world.height;
    const scale = Math.min(scaleX, scaleY);
    
    const contentWidth = gameState.world.width * scale;
    const contentHeight = gameState.world.height * scale;
    
    minimapContent.style.width = `${contentWidth}px`;
    minimapContent.style.height = `${contentHeight}px`;
    minimapContent.style.overflow = 'hidden';
    minimapContent.style.position = 'relative';
    
    const headerHeight = 35;
    minimapContainer.style.height = `${contentHeight + headerHeight}px`;
    minimapContainer.style.maxHeight = '400px';
    minimapContainer.style.overflow = 'hidden';
    
    // CRITICAL FIX: Ensure worldMap is loaded
    if (!worldMap || worldMap.length === 0) {
        console.warn('WorldMap not loaded yet, deferring minimap init');
        setTimeout(() => initializeMinimap(), 500);
        return;
    }
    
    // Use canvas for better performance - renders ALL tiles
    const canvas = document.createElement('canvas');
    canvas.width = contentWidth;
    canvas.height = contentHeight;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.imageRendering = 'pixelated';
    
    const ctx = canvas.getContext('2d');
    
    // Render EVERY single tile - this fixes the incomplete minimap
    for (let y = 0; y < gameState.world.height; y++) {
        for (let x = 0; x < gameState.world.width; x++) {
            if (!worldMap[y] || worldMap[y][x] === undefined) continue;
            
            let color = '#2d5016';
            
            switch(worldMap[y][x]) {
                case 'water': color = '#1e40af'; break;
                case 'mountain': color = '#6b7280'; break;
                case 'forest': color = '#166534'; break;
                case 'sand': color = '#eab308'; break;
                case 'road': color = '#8b5a2b'; break;
                case 'door': color = '#92400e'; break;
                case 'grass':
                default: color = '#2d5016';
            }
            
            ctx.fillStyle = color;
            // CRITICAL FIX: Fill with proper dimensions to avoid gaps
            ctx.fillRect(
                Math.floor(x * scale), 
                Math.floor(y * scale), 
                Math.ceil(scale) + 1, 
                Math.ceil(scale) + 1
            );
        }
    }
    
    minimapContent.appendChild(canvas);
    
    // Add buildings to minimap
    buildings.forEach(building => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'building');
        dot.style.position = 'absolute';
        dot.style.left = `${building.x * scale - 1}px`;
        dot.style.top = `${building.y * scale - 1}px`;
        dot.style.width = '4px';
        dot.style.height = '4px';
        dot.style.background = building.type === 'castle' ? '#fbbf24' : '#3b82f6';
        dot.style.borderRadius = '50%';
        dot.style.border = '1px solid #fff';
        dot.style.zIndex = '10';
        minimapContent.appendChild(dot);
    });
    
    // Add enemies to minimap
    enemies.forEach(enemy => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'enemy');
        dot.style.position = 'absolute';
        dot.style.left = `${enemy.x * scale - 1}px`;
        dot.style.top = `${enemy.y * scale - 1}px`;
        dot.style.width = '3px';
        dot.style.height = '3px';
        dot.style.background = '#dc2626';
        dot.style.borderRadius = '50%';
        dot.style.zIndex = '10';
        minimapContent.appendChild(dot);
    });
    
    minimapContent.dataset.scale = scale;
    
    console.log(`✅ Minimap initialized: World ${gameState.world.width}x${gameState.world.height} -> Display ${contentWidth.toFixed(0)}x${contentHeight.toFixed(0)} (scale: ${scale.toFixed(3)})`);
    console.log(`   Total tiles rendered: ${gameState.world.width * gameState.world.height}`);
}


function updateMinimapOptimized() {
    const minimapContent = document.getElementById('minimapContent');
    const scale = parseFloat(minimapContent.dataset.scale);
    
    if (!scale) {
        console.warn('Minimap not initialized, initializing now...');
        initializeMinimap();
        return;
    }
    
    const existingPlayerDots = minimapContent.querySelectorAll('[data-type="player"]');
    existingPlayerDots.forEach(dot => dot.remove());
    
    const playerDot = document.createElement('div');
    playerDot.setAttribute('data-type', 'player');
    playerDot.style.position = 'absolute';
    playerDot.style.left = `${gameState.player.x * scale - 3}px`;
    playerDot.style.top = `${gameState.player.y * scale - 3}px`;
    playerDot.style.width = '6px';
    playerDot.style.height = '6px';
    playerDot.style.background = '#10b981';
    playerDot.style.border = '2px solid #fff';
    playerDot.style.borderRadius = '50%';
    playerDot.style.zIndex = '100';
    playerDot.style.boxShadow = '0 0 6px #10b981';
    minimapContent.appendChild(playerDot);
    
    otherPlayers.forEach((player) => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'player');
        dot.style.position = 'absolute';
        dot.style.left = `${player.x * scale - 2}px`;
        dot.style.top = `${player.y * scale - 2}px`;
        dot.style.width = '4px';
        dot.style.height = '4px';
        dot.style.background = player.level >= 5 ? '#fbbf24' : '#34d399';
        dot.style.borderRadius = '50%';
        dot.style.border = '1px solid #fff';
        dot.style.zIndex = '50';
        dot.style.boxShadow = '0 0 3px rgba(52, 211, 153, 0.5)';
        dot.title = `${player.name} (Lv.${player.level})`;
        minimapContent.appendChild(dot);
    });
}

function updateMinimap() {
    updateMinimapOptimized();
}

// ============================================
// INTERACTION SYSTEM
// ============================================

function interact() {
    let interacted = false;
    const INTERACTION_RANGE = 1.5;
    
    otherPlayers.forEach((player, address) => {
        if (interacted) return;
        const distance = Math.sqrt(Math.pow(gameState.player.x - player.x, 2) + Math.pow(gameState.player.y - player.y, 2));
        if (distance <= INTERACTION_RANGE) {
            interactWithPlayer(address, player);
            interacted = true;
        }
    });
    if (interacted) return;
    
    npcs.forEach(npc => {
        if (interacted) return;
        const distance = Math.sqrt(Math.pow(gameState.player.x - npc.x, 2) + Math.pow(gameState.player.y - npc.y, 2));
        if (distance <= INTERACTION_RANGE) {
            talkToNPC(npc);
            interacted = true;
        }
    });
    if (interacted) return;
    
    buildings.forEach(building => {
        if (interacted) return;
        const distance = Math.sqrt(Math.pow(gameState.player.x - building.x, 2) + Math.pow(gameState.player.y - building.y, 2));
        if (distance <= INTERACTION_RANGE + 0.5) {
            interactWithBuilding(building);
            interacted = true;
        }
    });
    if (interacted) return;
    
    enemies.forEach(enemy => {
        if (interacted) return;
        const distance = Math.sqrt(Math.pow(gameState.player.x - enemy.x, 2) + Math.pow(gameState.player.y - enemy.y, 2));
        if (distance <= INTERACTION_RANGE) {
            startBattle(enemy);
            interacted = true;
        }
    });
    
    if (!interacted) {
        showFloatingText('Nothing nearby', gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#94a3b8');
    }
}

function interactWithPlayer(address, player) {
    document.getElementById('modalTitle').textContent = `${player.name} (Level ${player.level})`;
    document.getElementById('modalContent').innerHTML = `
        <div style="font-size: 24px; margin-bottom: 20px;">👤</div>
        <p>Another Algorand adventurer exploring the realm!</p>
        <div style="margin: 20px 0;">
            <div>Level: ${player.level}</div>
            <div>Location: (${player.x}, ${player.y})</div>
            <div style="font-size: 11px; opacity: 0.7; margin-top: 8px;">
                Address: ${address.slice(0, 6)}...${address.slice(-4)}
            </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
            <button class="btn btn-primary" onclick="challengePlayer('${address}')">⚔️ Challenge</button>
            <button class="btn btn-success" onclick="tradeWithPlayer('${address}')">💰 Trade ALGOs</button>
        </div>
    `;
    document.getElementById('interactionModal').style.display = 'flex';
}

async function challengePlayer(targetAddress) {
    closeModal(); // Close the player info modal first
    
    // Check if we already have this player's broadcast
    const opponent = pvpBroadcasts.get(targetAddress);
    
    if (opponent) {
        // They have an active PvP broadcast - challenge them!
        await acceptPvPChallenge(targetAddress);
    } else {
        // They don't have an active PvP broadcast
        showFloatingText('Player is not ready for PvP', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#f59e0b'
        );
        
        // Show them how to challenge
        setTimeout(() => {
            showFloatingText('Check "Active PvP Challenges" list!', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 60, 
                '#3b82f6'
            );
        }, 1500);
    }
}

async function checkForIncomingChallenges() {
    // Only check if we're ready for PvP
    if (!gameState.pvp.isReady || gameState.pvp.inPvPBattle) return;
    
    // Don't check too frequently (every 5 seconds max)
    const now = Date.now();
    if (now - gameState.pvp.lastChallengeCheck < 5000) return;
    gameState.pvp.lastChallengeCheck = now;
    
    if (!indexerClient || !account) return;
    
    try {
        const minRound = (await algodClient.status().do())['last-round'] - 500;
        
        // Search for PvP challenge acceptance targeting us
        const txns = await indexerClient
            .searchForTransactions()
            .notePrefix(createNotePrefix('CHRPG:PVP_ACCEPT:'))
            .minRound(minRound)
            .limit(20)
            .do();
        
        if (txns.transactions) {
            for (const txn of txns.transactions) {
                // Skip our own transactions
                if (txn.sender === account.addr) continue;
                
                try {
                    const noteText = decodeBase64Note(txn.note);
                    const jsonStr = noteText.replace('CHRPG:PVP_ACCEPT:', '');
                    const challengeData = JSON.parse(jsonStr);
                    
                    // Check if this challenge is for us
                    if (challengeData.targetAddress === account.addr) {
                        // Check if it's recent (within last 30 seconds)
                        const age = now - challengeData.timestamp;
                        if (age < 30000) {
                            // Someone challenged us!
                            await handleIncomingChallenge(challengeData, txn.sender);
                            return; // Handle one challenge at a time
                        }
                    }
                } catch (e) {
                    console.log('Failed to parse challenge acceptance:', e);
                }
            }
        }
    } catch (error) {
        console.error('Failed to check for incoming challenges:', error);
    }
}

// ============================================
// NEW FUNCTION: HANDLE INCOMING CHALLENGE
// ============================================

async function handleIncomingChallenge(challengeData, challengerAddress) {
    // Don't show notification if already in battle
    if (gameState.pvp.inPvPBattle) return;
    
    // Vibrant notification
    showFloatingText('⚔️ PVP CHALLENGE!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#dc2626'
    );
    
    setTimeout(() => {
        showFloatingText(`${challengeData.challengerName} wants to fight!`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 60, 
            '#fbbf24'
        );
    }, 1000);
    
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#dc2626');
    
    // Play sound if available
    if (typeof playSound === 'function') {
        playSound('challenge');
    }
    
    // Show modal to accept or decline
    setTimeout(() => {
        showIncomingChallengeModal(challengeData, challengerAddress);
    }, 2000);
}

// ============================================
// NEW FUNCTION: SHOW INCOMING CHALLENGE MODAL
// ============================================

function showIncomingChallengeModal(challengeData, challengerAddress) {
    const modal = document.getElementById('incomingChallengeModal');
    if (!modal) {
        console.error('Incoming challenge modal not found!');
        return;
    }
    
    document.getElementById('challengerName').textContent = challengeData.challengerName;
    document.getElementById('challengerLevel').textContent = challengeData.challengerLevel;
    
    const wager = gameState.pvp.wager;
    document.getElementById('challengeWagerInfo').innerHTML = `
        ⛵ ${wager.boats} Boats<br>
        🗝️ ${wager.keys} Keys<br>
        ⛏️ ${wager.pickaxe} Pickaxe Uses<br>
        💰 ${wager.gold} Gold
    `;
    
    // Store challenger data for acceptance
    modal.dataset.challengerAddress = challengerAddress;
    modal.dataset.challengerName = challengeData.challengerName;
    modal.dataset.challengerLevel = challengeData.challengerLevel;
    modal.dataset.challengerHp = challengeData.challengerHp;
    modal.dataset.challengerMaxHp = challengeData.challengerMaxHp;
    modal.dataset.challengerAttack = challengeData.challengerAttack;
    modal.dataset.challengerDefense = challengeData.challengerDefense;
    
    modal.style.display = 'flex';
    
    // Auto-decline after 30 seconds
    setTimeout(() => {
        if (modal.style.display === 'flex') {
            declineIncomingChallenge();
        }
    }, 30000);
}

function closeIncomingChallengeModal() {
    document.getElementById('incomingChallengeModal').style.display = 'none';
}

async function acceptIncomingChallenge() {
    const modal = document.getElementById('incomingChallengeModal');
    const challengerAddress = modal.dataset.challengerAddress;
    
    // Prepare opponent data
    const opponent = {
        name: modal.dataset.challengerName,
        level: parseInt(modal.dataset.challengerLevel),
        hp: parseInt(modal.dataset.challengerHp),
        maxHp: parseInt(modal.dataset.challengerMaxHp),
        attack: parseInt(modal.dataset.challengerAttack),
        defense: parseInt(modal.dataset.challengerDefense),
        x: gameState.player.x, // They're nearby
        y: gameState.player.y
    };
    
    closeIncomingChallengeModal();
    
    // Start the battle
    await startPvPBattle(opponent, challengerAddress);
}

function declineIncomingChallenge() {
    closeIncomingChallengeModal();
    
    showFloatingText('Challenge declined', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#94a3b8'
    );
    
    // Disable PvP ready since we declined
    if (gameState.pvp.isReady) {
        disablePvPReady();
    }
}

// ============================================
// UPDATED: BROADCAST CHALLENGE ACCEPTANCE
// ============================================

// UPDATE the acceptPvPChallenge function to broadcast the challenge acceptance
// FIND the existing acceptPvPChallenge function and ADD this broadcast at the start:

async function acceptPvPChallenge(targetAddress) {
    const opponent = pvpBroadcasts.get(targetAddress);
    
    if (!opponent) {
        showFloatingText('Challenge expired!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // Check distance
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - opponent.x, 2) + 
        Math.pow(gameState.player.y - opponent.y, 2)
    );

    if (distance > PVP_MATCH_RANGE) {
        showFloatingText('Too far! Move closer.', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // Check if player can match wager
    if (opponent.wager.boats > (gameState.inventory.boats || 0)) {
        showFloatingText(`Need ${opponent.wager.boats} boats to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.keys > (gameState.inventory.keys || 0)) {
        showFloatingText(`Need ${opponent.wager.keys} keys to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.pickaxe > (gameState.inventory.pickaxe || 0)) {
        showFloatingText(`Need ${opponent.wager.pickaxe} pickaxe uses to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.gold > (gameState.inventory.gold || 0)) {
        showFloatingText(`Need ${opponent.wager.gold} gold to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    // ========================================
    // ADD THIS: Broadcast challenge acceptance
    // ========================================
    try {
        const acceptanceData = {
            type: 'PVP_ACCEPT',
            targetAddress: targetAddress,
            challengerName: gameState.player.name,
            challengerLevel: gameState.player.level,
            challengerHp: gameState.player.hp,
            challengerMaxHp: gameState.player.maxHp,
            challengerAttack: gameState.player.attack,
            challengerDefense: gameState.player.defense,
            timestamp: Date.now()
        };

        const note = new TextEncoder().encode(
            'CHRPG:PVP_ACCEPT:' + JSON.stringify(acceptanceData)
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

        console.log('PvP challenge acceptance broadcasted');
    } catch (error) {
        console.error('Failed to broadcast challenge acceptance:', error);
    }

// Broadcast challenge acceptance to notify the target player
    try {
        const acceptanceData = {
            type: 'PVP_ACCEPT',
            targetAddress: targetAddress,
            challengerName: gameState.player.name,
            challengerLevel: gameState.player.level,
            challengerHp: gameState.player.hp,
            challengerMaxHp: gameState.player.maxHp,
            challengerAttack: gameState.player.attack,
            challengerDefense: gameState.player.defense,
            timestamp: Date.now()
        };

        const note = new TextEncoder().encode(
            'CHRPG:PVP_ACCEPT:' + JSON.stringify(acceptanceData)
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

        console.log('PvP challenge acceptance broadcasted');
    } catch (error) {
        console.error('Failed to broadcast challenge acceptance:', error);
    }


    // Start PvP battle
    await startPvPBattle(opponent, targetAddress);
}

function tradeWithPlayer(targetAddress) {
    showFloatingText('P2P trading coming soon!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#fbbf24');
    closeModal();
}

function talkToNPC(npc) {
    document.getElementById('modalTitle').textContent = npc.name;
    document.getElementById('modalContent').innerHTML = `
        <div style="font-size: 24px; margin-bottom: 20px;">💬</div>
        <div style="font-style: italic; line-height: 1.6;">"${npc.dialogue}"</div>
        <div style="margin-top: 20px; font-size: 12px; opacity: 0.7;">
            Press ESC or click Close to continue your journey
        </div>
    `;
    document.getElementById('interactionModal').style.display = 'flex';
    createParticleEffect(npc.x * 32 + 16, npc.y * 32, '#3b82f6');
}

function interactWithBuilding(building) {
    document.getElementById('modalTitle').textContent = building.name;
    
    let content = `<div style="font-size: 32px; margin-bottom: 20px;">🏛️</div>`;
    
    switch (building.type) {
        case 'inn':
            content += `
                <p style="margin-bottom: 20px;">A warm blockchain validator node hums in the corner. The innkeeper offers rest for weary crypto travelers.</p>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <strong>Rest Service:</strong> Fully restore HP & MP
                    <br><small>Cost: 0.02 ALGO (transaction fee)</small>
                </div>
                <button class="btn btn-primary" onclick="restAtInn()">💤 Rest (20 gold + tx fee)</button>
            `;
            break;
        case 'shop':
            content += `
                <p style="margin-bottom: 20px;">Smart contracts display various items. The shopkeeper accepts ALGO payments.</p>
                <div style="display: grid; gap: 10px; margin: 20px 0;">
                    <div style="background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 6px;">
                        <strong>🧪 Health Potion:</strong> Restores 30-50 HP (15 gold)
                    </div>
                    <div style="background: rgba(59, 130, 246, 0.1); padding: 10px; border-radius: 6px;">
                        <strong>🔮 Mana Potion:</strong> Restores 20-30 MP (10 gold)
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 6px;">
                        <strong>⛵ Boat:</strong> Cross water for 15 moves (50 gold)
                    </div>
                    <div style="background: rgba(251, 191, 36, 0.1); padding: 10px; border-radius: 6px;">
                        <strong>⛏️ Pickaxe:</strong> Break mountains (75 gold)
                    </div>
                </div>
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="buyItem('health', 15)">Buy Health</button>
                    <button class="btn btn-primary" onclick="buyItem('mana', 10)">Buy Mana</button>
                    <button class="btn btn-primary" onclick="buyItem('boat', 50)">Buy Boat</button>
                    <button class="btn btn-primary" onclick="buyItem('pickaxe', 75)">Buy Pickaxe</button>
                </div>
            `;
            break;
        case 'temple':
            content += `
                <p style="margin-bottom: 20px;">The Pure Proof of Stake consensus emanates divine energy. Your wounds heal through cryptographic blessing.</p>
                <div style="background: rgba(251, 191, 36, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <strong>Consensus Blessing:</strong> Complete healing by the power of decentralization
                </div>
                <button class="btn btn-success" onclick="templeHeal()">🙏 Receive Blessing</button>
            `;
            break;
        case 'castle':
            content += `
                <p style="margin-bottom: 20px;">Governance proposals flutter on the walls. The Foundation seeks brave validators!</p>
                <div style="background: rgba(147, 51, 234, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <strong>Governance Quest:</strong> Participate in Algorand governance for rewards
                </div>
                <button class="btn btn-primary" onclick="castleQuest()">👑 Accept Quest</button>
            `;
            break;
        default:
            content += `
                <p style="margin-bottom: 20px;">A modest dwelling powered by renewable energy and blockchain nodes.</p>
                <div style="background: rgba(107, 114, 128, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <em>"May your transactions always confirm quickly!"</em>
                </div>
            `;
    }
    
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('interactionModal').style.display = 'flex';
    createParticleEffect(building.x * 32 + 32, building.y * 32 + 32, '#fbbf24');
}

function restAtInn() {
    if (gameState.inventory.gold >= 20) {
        gameState.inventory.gold -= 20;
        gameState.player.hp = gameState.player.maxHp;
        gameState.player.mp = gameState.player.maxMp;
        updateUI();
        closeModal();
        showFloatingText('Fully Rested!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#10b981');
        flashStatBar('hp', 'heal');
        flashStatBar('mp', 'heal');
    } else {
        showFloatingText('Insufficient Gold!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#ef4444');
    }
}

function buyItem(type, cost) {
    if (gameState.inventory.gold >= cost) {
        gameState.inventory.gold -= cost;
        if (type === 'health') {
            gameState.inventory.healthPotions++;
            showFloatingText(`+1 Health Potion!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#ef4444');
        } else if (type === 'mana') {
            gameState.inventory.manaPotions++;
            showFloatingText(`+1 Mana Potion!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#3b82f6');
        } else if (type === 'boat') {
            if (!gameState.inventory.boats) gameState.inventory.boats = 0;
            gameState.inventory.boats++;
            showFloatingText(`+1 Boat!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#3b82f6');
        } else if (type === 'pickaxe') {
            gameState.inventory.pickaxe += 10;
            showFloatingText(`Pickaxe acquired! (10 uses)`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#fbbf24');
        }
        updateUI();
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
    } else {
        showFloatingText('Insufficient Gold!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#ef4444');
    }
}

function templeHeal() {
    gameState.player.hp = gameState.player.maxHp;
    gameState.player.mp = gameState.player.maxMp;
    updateUI();
    closeModal();
    showFloatingText('Blessed by Consensus!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#fbbf24');
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
    flashStatBar('hp', 'heal');
    flashStatBar('mp', 'heal');
}

function castleQuest() {
    const questRewards = [
        {message: "The Foundation needs validators! Take these ALGOs for your node setup.", gold: 75, xp: 50},
        {message: "Governance period is open! Here's your participation reward.", gold: 50, xp: 75},
        {message: "Your DeFi contributions strengthen the ecosystem. Accept this reward!", gold: 100, xp: 40},
        {message: "The Algorand ecosystem grows thanks to builders like you!", gold: 60, xp: 60}
    ];
    
    const reward = questRewards[Math.floor(Math.random() * questRewards.length)];
    gameState.inventory.gold += reward.gold;
    gameState.player.xp += reward.xp;
    
    checkLevelUp();
    updateUI();
    
    document.getElementById('modalContent').innerHTML = `
        <div style="font-size: 32px; margin-bottom: 20px;">👑</div>
        <div style="font-style: italic; line-height: 1.6; margin-bottom: 20px;">
            "${reward.message}"
        </div>
        <div style="background: rgba(251, 191, 36, 0.2); padding: 15px; border-radius: 8px; border: 2px solid #fbbf24;">
            <strong>Governance Reward:</strong><br>
            💰 +${reward.gold} Gold<br>
            ⭐ +${reward.xp} Experience
        </div>
    `;
    
    showFloatingText(`Governance Reward!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#fbbf24');
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
}

function closeModal() {
    document.getElementById('interactionModal').style.display = 'none';
}

// ============================================
// BATTLE SYSTEM
// ============================================

function tryBattleEnemy(enemy) {
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - enemy.x, 2) + 
        Math.pow(gameState.player.y - enemy.y, 2)
    );
    
    const BATTLE_RANGE = 1.5;
    
    if (distance <= BATTLE_RANGE) {
        startBattle(enemy);
    } else {
        showFloatingText(
            `Too far from ${enemy.name}!`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 20, 
            '#ef4444'
        );
        showFloatingText(
            'Move closer to engage!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 + 5, 
            '#f59e0b'
        );
    }
}

function startBattle(enemy) {
    gameState.inBattle = true;
    gameState.currentEnemy = {...enemy};
    
    document.getElementById('battleEnemy').textContent = getBattleEmoji(enemy.class);
    document.getElementById('enemyName').textContent = enemy.name;
    document.getElementById('enemyHp').textContent = enemy.hp;
    document.getElementById('enemyMaxHp').textContent = enemy.maxHp;
    document.getElementById('enemyHpBar').style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
    
    const battleLog = document.getElementById('battleLog');
    battleLog.innerHTML = '';
    addBattleLog(`⚔️ ${enemy.name} blocks your path!`, 'log-info');
    
    document.getElementById('battleModal').style.display = 'flex';
    createParticleEffect(enemy.x * 32 + 16, enemy.y * 32, '#dc2626');
}

function getBattleEmoji(enemyClass) {
    switch(enemyClass) {
        case 'enemy-spawn enemy-goblin': return '👹';
        case 'enemy-spawn enemy-dragon': return '🐉';
        case 'enemy-spawn enemy-wolf': return '🐺';
        default: return '👾';
    }
}

function battleAction(action) {
    if (!gameState.inBattle || !gameState.currentEnemy) return;
    
    if (gameState.currentEnemy.hp <= 0) {
        addBattleLog('Enemy is already defeated!', 'log-info');
        return;
    }
    
    let playerDamage = 0;
    let playerUsedTurn = true;
    
    switch (action) {
        case 'attack':
            playerDamage = Math.floor(Math.random() * gameState.player.attack) + 8;
            gameState.currentEnemy.hp = Math.max(0, gameState.currentEnemy.hp - playerDamage);
            addBattleLog(`⚔️ You strike for ${playerDamage} damage!`, 'log-damage');
            break;
            
        case 'magic':
            if (gameState.player.mp >= 12) {
                playerDamage = Math.floor(Math.random() * gameState.player.magic) + 10;
                gameState.player.mp -= 12;
                gameState.currentEnemy.hp = Math.max(0, gameState.currentEnemy.hp - playerDamage);
                addBattleLog(`✨ Magic bolt deals ${playerDamage} damage!`, 'log-damage');
                flashStatBar('mp', 'damage');
            } else {
                addBattleLog(`⚠️ Insufficient mana!`, 'log-info');
                playerUsedTurn = false;
            }
            break;
            
        case 'heal':
            if (gameState.inventory.healthPotions > 0) {
                const healAmount = Math.floor(Math.random() * 20) + 30;
                gameState.player.hp = Math.min(gameState.player.maxHp, gameState.player.hp + healAmount);
                gameState.inventory.healthPotions--;
                addBattleLog(`💚 You heal for ${healAmount} HP!`, 'log-heal');
                flashStatBar('hp', 'heal');
            } else {
                addBattleLog(`⚠️ No health potions remaining!`, 'log-info');
                playerUsedTurn = false;
            }
            break;
            
        case 'flee':
            if (Math.random() < 0.75) {
                addBattleLog(`🏃 You successfully escaped!`, 'log-info');
                endBattle(false);
                return;
            } else {
                addBattleLog(`⚠️ Could not escape!`, 'log-info');
            }
            break;
    }
    
    updateBattleUI();
    updateUI();
    
    if (gameState.currentEnemy.hp <= 0) {
        enemyDefeated();
        return;
    }
    
    if (playerUsedTurn) {
        setTimeout(enemyTurn, 1500);
    }
}

function enemyTurn() {
    if (!gameState.inBattle || !gameState.currentEnemy) return;
    
    const baseEnemyDamage = Math.floor(Math.random() * gameState.currentEnemy.attack) + 5;
    const defense = Math.floor(gameState.player.defense / 3);
    const actualDamage = Math.max(1, baseEnemyDamage - defense);
    
    gameState.player.hp = Math.max(0, gameState.player.hp - actualDamage);
    addBattleLog(`🔥 ${gameState.currentEnemy.name} attacks for ${actualDamage} damage!`, 'log-damage');
    
    flashStatBar('hp', 'damage');
    updateBattleUI();
    updateUI();
    
    if (gameState.player.hp <= 0) {
        playerDefeated();
    }
}

function enemyDefeated() {
    const enemy = gameState.currentEnemy;
    gameState.player.xp += enemy.xpReward;
    gameState.inventory.gold += enemy.goldReward;
    gameState.stats.enemiesDefeated++;
    
    addBattleLog(`🎉 Victory! ${enemy.name} defeated!`, 'log-heal');
    addBattleLog(`💰 Gained ${enemy.goldReward} gold and ${enemy.xpReward} XP!`, 'log-heal');
    
    enemies = enemies.filter(e => e.x !== enemy.x || e.y !== enemy.y);
    
    checkLevelUp();
    
    if (Math.random() < 0.4) {
        const dropValue = Math.floor(Math.random() * 30) + 15;
        items.push({x: enemy.x, y: enemy.y, type: 'gold', value: dropValue});
        addBattleLog(`✨ Enemy dropped treasure!`, 'log-heal');
    }
    
    setTimeout(() => endBattle(true), 3000);
}

function playerDefeated() {
    addBattleLog(`💀 You have been defeated!`, 'log-damage');
    
    gameState.player.hp = Math.floor(gameState.player.maxHp * 0.3);
    gameState.inventory.gold = Math.max(0, Math.floor(gameState.inventory.gold * 0.85));
    
    setTimeout(() => {
        gameState.player.x = 15;
        gameState.player.y = 10;
        endBattle(false);
        showFloatingText('Revived in Starter Village', gameState.player.x * 32 + 16, gameState.player.y * 32 - 25, '#fbbf24');
    }, 2500);
}

function endBattle(victory) {
    gameState.inBattle = false;
    gameState.currentEnemy = null;
    document.getElementById('battleModal').style.display = 'none';
    updateUI();
    renderWorld();
    centerCameraOnPlayer();
    
    if (victory) {
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');
    }
}

function checkLevelUp() {
    while (gameState.player.xp >= gameState.player.xpToNext) {
        gameState.player.level++;
        gameState.player.xp -= gameState.player.xpToNext;
        gameState.player.xpToNext = Math.floor(gameState.player.xpToNext * 1.4);
        
        gameState.player.maxHp += Math.floor(Math.random() * 10) + 15;
        gameState.player.hp = gameState.player.maxHp;
        gameState.player.maxMp += Math.floor(Math.random() * 5) + 8;
        gameState.player.mp = gameState.player.maxMp;
        gameState.player.attack += Math.floor(Math.random() * 3) + 2;
        gameState.player.defense += Math.floor(Math.random() * 2) + 1;
        gameState.player.magic += Math.floor(Math.random() * 4) + 3;
        
        showLevelUpEffect();
        if (gameState.inBattle) {
            addBattleLog(`🎊 LEVEL UP! Now level ${gameState.player.level}!`, 'log-heal');
        }
    }
}

function randomEncounter() {
    if (gameState.inBattle) return;
    
    const wildEnemies = [
        {name: 'FUD Slime', class: 'enemy-spawn enemy-goblin', hp: 20 + gameState.player.level * 3, maxHp: 20 + gameState.player.level * 3, attack: 5 + gameState.player.level, xpReward: 15 + gameState.player.level * 2, goldReward: 8 + gameState.player.level},
        {name: 'Gas Fee Rat', class: 'enemy-spawn enemy-wolf', hp: 15 + gameState.player.level * 2, maxHp: 15 + gameState.player.level * 2, attack: 6 + gameState.player.level, xpReward: 12 + gameState.player.level, goldReward: 6 + gameState.player.level}
    ];
    
    const enemy = wildEnemies[Math.floor(Math.random() * wildEnemies.length)];
    showFloatingText('Random Encounter!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#dc2626');
    setTimeout(() => startBattle(enemy), 1000);
}

function updateBattleUI() {
    if (gameState.currentEnemy) {
        document.getElementById('enemyHp').textContent = gameState.currentEnemy.hp;
        document.getElementById('enemyHpBar').style.width = `${(gameState.currentEnemy.hp / gameState.currentEnemy.maxHp) * 100}%`;
    }
}

function addBattleLog(message, type) {
    const log = document.getElementById('battleLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

function updateUI() {
    document.getElementById('playerLevel').textContent = gameState.player.level;
    document.getElementById('playerHp').textContent = gameState.player.hp;
    document.getElementById('playerMaxHp').textContent = gameState.player.maxHp;
    document.getElementById('playerMp').textContent = gameState.player.mp;
    document.getElementById('playerMaxMp').textContent = gameState.player.maxMp;
    document.getElementById('playerXp').textContent = gameState.player.xp;
    document.getElementById('playerXpNext').textContent = gameState.player.xpToNext;
    
    document.getElementById('playerHpBar').style.width = `${(gameState.player.hp / gameState.player.maxHp) * 100}%`;
    document.getElementById('playerMpBar').style.width = `${(gameState.player.mp / gameState.player.maxMp) * 100}%`;
    document.getElementById('playerXpBar').style.width = `${(gameState.player.xp / gameState.player.xpToNext) * 100}%`;
    
    document.getElementById('goldAmount').textContent = gameState.inventory.gold;
    document.getElementById('healthPotions').textContent = gameState.inventory.healthPotions;
    document.getElementById('manaPotions').textContent = gameState.inventory.manaPotions;
    document.getElementById('keyCount').textContent = gameState.inventory.keys;
    
    document.getElementById('attackStat').textContent = gameState.player.attack;
    document.getElementById('defenseStat').textContent = gameState.player.defense;
    document.getElementById('magicStat').textContent = gameState.player.magic;
    
    document.getElementById('quickInfo1').textContent = `Enemies Defeated: ${gameState.stats.enemiesDefeated}`;
    document.getElementById('quickInfo2').textContent = `Treasures Found: ${gameState.stats.treasuresFound}`;
    document.getElementById('quickInfo3').textContent = `Position: (${gameState.player.x}, ${gameState.player.y})`;
    
    document.getElementById('boatCount').textContent = gameState.inventory.boats || 0;
    document.getElementById('sailingMoves').textContent = gameState.sailingMoves || 0;
    document.getElementById('pickaxeStatus').textContent = gameState.inventory.pickaxe > 0 ? gameState.inventory.pickaxe : 'No';
}

// ============================================
// VISUAL EFFECTS
// ============================================

function showFloatingText(text, x, y, color = '#10b981') {
    const floating = document.createElement('div');
    floating.className = 'floating-text';
    floating.textContent = text;
    floating.style.left = `${x}px`;
    floating.style.top = `${y}px`;
    floating.style.color = color;
    floating.style.transform = 'translateX(-50%)';
    document.getElementById('worldGrid').appendChild(floating);
    
    setTimeout(() => {
        if (document.getElementById('worldGrid').contains(floating)) {
            document.getElementById('worldGrid').removeChild(floating);
        }
    }, 2000);
}

function createParticleEffect(x, y, color = '#fbbf24') {
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = `${x + (Math.random() - 0.5) * 20}px`;
        particle.style.top = `${y + (Math.random() - 0.5) * 20}px`;
        particle.style.background = color;
        particle.style.setProperty('--random-x', Math.random());
        
        document.getElementById('worldGrid').appendChild(particle);
        
        setTimeout(() => {
            if (document.getElementById('worldGrid').contains(particle)) {
                document.getElementById('worldGrid').removeChild(particle);
            }
        }, 1500);
    }
}

function flashStatBar(type, effect) {
    const barFill = document.getElementById(`player${type.charAt(0).toUpperCase() + type.slice(1)}Bar`);
    if (barFill) {
        barFill.classList.add(effect);
        setTimeout(() => barFill.classList.remove(effect), 300);
    }
}

function showLevelUpEffect() {
    const levelUpEl = document.createElement('div');
    levelUpEl.className = 'level-up-effect';
    levelUpEl.innerHTML = `<div>🎊 LEVEL UP! 🎊</div><div style="font-size: 18px; margin-top: 8px;">Level ${gameState.player.level}</div>`;
    document.body.appendChild(levelUpEl);
    
    setTimeout(() => {
        if (document.body.contains(levelUpEl)) {
            document.body.removeChild(levelUpEl);
        }
    }, 3000);
}

// ============================================
// KEYBOARD AND MOBILE CONTROLS
// ============================================

function handleKeyboard(event) {
    if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;

    if (gameState.inBattle || document.getElementById('interactionModal').style.display === 'flex') {
        if (event.key === 'Escape') {
            closeModal();
        }
        return;
    }
    
    const key = event.key.toLowerCase();
    
    if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault();
        
        if (!keyStates[key] && !moveInterval) {
            keyStates[key] = true;
            
            performMove(key);
            
            moveInterval = setInterval(() => {
                if (keyStates[key]) {
                    performMove(key);
                } else {
                    clearInterval(moveInterval);
                    moveInterval = null;
                }
            }, 120);
        }
    } else if (key === ' ' || key === 'enter') {
        event.preventDefault();
        interact();
    } else if (key === 'escape') {
        closeModal();
    }
}

function handleKeyUp(event) {
    const key = event.key.toLowerCase();
    keyStates[key] = false;
    
    if (!Object.values(keyStates).some(state => state) && moveInterval) {
        clearInterval(moveInterval);
        moveInterval = null;
    }
}

function performMove(key) {
    switch(key) {
        case 'w': case 'arrowup':
            movePlayer(0, -1); break;
        case 's': case 'arrowdown':
            movePlayer(0, 1); break;
        case 'a': case 'arrowleft':
            movePlayer(-1, 0); break;
        case 'd': case 'arrowright':
            movePlayer(1, 0); break;
    }
}

// ============================================
// ENHANCED MOBILE CONTROLS - FIXED VERSION
// ============================================
// Replace the setupMobileControls() function in script.js (around line 2470)

function setupMobileControls() {
    const buttons = document.querySelectorAll('#mobile-controls .ctl-btn');
    
    if (buttons.length === 0) {
        console.warn('Mobile control buttons not found!');
        return;
    }
    
    console.log('Setting up mobile controls...');
    
    buttons.forEach(btn => {
        const dir = btn.dataset.dir;
        
        if (!dir) {
            console.warn('Button missing data-dir attribute:', btn);
            return;
        }
        
        // Touch events for mobile
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.add('active');
            handleDirection(dir);
            
            // Haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
            
            console.log('Mobile control touched:', dir);
        }, { passive: false });
        
        btn.addEventListener('touchend', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.remove('active');
        }, { passive: false });
        
        // Prevent touch move (stops scrolling)
        btn.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        
        // Mouse events for desktop testing
        btn.addEventListener('mousedown', e => {
            e.preventDefault();
            btn.classList.add('active');
            handleDirection(dir);
            console.log('Mobile control clicked:', dir);
        });
        
        btn.addEventListener('mouseup', e => {
            e.preventDefault();
            btn.classList.remove('active');
        });
        
        // Prevent context menu on long press
        btn.addEventListener('contextmenu', e => {
            e.preventDefault();
            return false;
        });
    });
    
    console.log('Mobile controls setup complete! Buttons:', buttons.length);
}

// Keep the existing handleDirection function as is
function handleDirection(dir) {
    switch(dir) {
        case 'up':    movePlayer( 0,-1); break;
        case 'down':  movePlayer( 0, 1); break;
        case 'left':  movePlayer(-1, 0); break;
        case 'right': movePlayer( 1, 0); break;
        default:
            console.warn('Unknown direction:', dir);
    }
}

// ============================================
// Continuous movement (hold to move)
// ============================================



let movementInterval = null;
let currentDirection = null;

function setupMobileControls() {
    const buttons = document.querySelectorAll('#mobile-controls .ctl-btn');
    
    buttons.forEach(btn => {
        const dir = btn.dataset.dir;
        
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.add('active');
            
            // Start continuous movement
            currentDirection = dir;
            handleDirection(dir); // First move
            
            // Continue moving while held
            movementInterval = setInterval(() => {
                if (currentDirection === dir) {
                    handleDirection(dir);
                }
            }, 150); // Move every 150ms
            
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
        }, { passive: false });
        
        btn.addEventListener('touchend', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.remove('active');
            
            // Stop continuous movement
            currentDirection = null;
            if (movementInterval) {
                clearInterval(movementInterval);
                movementInterval = null;
            }
        }, { passive: false });
        
        btn.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        
        btn.addEventListener('contextmenu', e => {
            e.preventDefault();
        });
    });
}


// ============================================
// DEBUGGING HELPER
// ============================================
// Add this temporarily to help debug mobile controls

function debugMobileControls() {
    console.log('=== Mobile Controls Debug ===');
    
    const controlsDiv = document.getElementById('mobile-controls');
    console.log('Controls div found:', !!controlsDiv);
    console.log('Controls display:', controlsDiv ? window.getComputedStyle(controlsDiv).display : 'N/A');
    
    const buttons = document.querySelectorAll('#mobile-controls .ctl-btn');
    console.log('Button count:', buttons.length);
    
    buttons.forEach((btn, i) => {
        console.log(`Button ${i}:`, {
            dir: btn.dataset.dir,
            visible: window.getComputedStyle(btn).display !== 'none',
            text: btn.textContent
        });
    });
    
    console.log('Touch support:', 'ontouchstart' in window);
    console.log('Screen width:', window.innerWidth);
    console.log('Screen height:', window.innerHeight);
    console.log('=========================');
}

// Call this in browser console to debug:
// debugMobileControls();

// ============================================
// HELP SYSTEM
// ============================================

function openHelp() {
    document.getElementById('helpModal').style.display = 'flex';
}

function closeHelp() {
    document.getElementById('helpModal').style.display = 'none';
}

function initHelpSystem() {
    const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('helpModal');
    
    if (helpButton) {
        helpButton.addEventListener('click', openHelp);
    }
    
    if (helpModal) {
        helpModal.addEventListener('click', function(e) {
            if (e.target === this) closeHelp();
        });
    }
    
    if (!localStorage.getItem('eternalBlissHelpShown')) {
        setTimeout(() => {
            openHelp();
            localStorage.setItem('eternalBlissHelpShown', 'true');
        }, 2000);
    }
}

// ============================================
// PVP BROADCASTING SYSTEM
// ============================================

function togglePvPReady() {
    if (!account || !algodClient) {
        showFloatingText('Connect wallet to use PvP!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    if (gameState.inBattle) {
        showFloatingText('Cannot enable PvP during battle!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    if (gameState.pvp.isReady) {
        // Disable PvP ready
        disablePvPReady();
    } else {
        // Show wager selection modal
        showPvPWagerModal();
    }
}

function showPvPWagerModal() {
    document.getElementById('pvpWagerModal').style.display = 'flex';
    
    // Update available amounts
    document.getElementById('wagerBoatsAvailable').textContent = gameState.inventory.boats || 0;
    document.getElementById('wagerKeysAvailable').textContent = gameState.inventory.keys || 0;
    document.getElementById('wagerPickaxeAvailable').textContent = gameState.inventory.pickaxe || 0;
    document.getElementById('wagerGoldAvailable').textContent = gameState.inventory.gold || 0;
    
    // Reset wager amounts
    document.getElementById('wagerBoats').value = 0;
    document.getElementById('wagerKeys').value = 0;
    document.getElementById('wagerPickaxe').value = 0;
    document.getElementById('wagerGold').value = 0;
}

function closePvPWagerModal() {
    document.getElementById('pvpWagerModal').style.display = 'none';
}

async function confirmPvPWager() {
    const boatsWager = parseInt(document.getElementById('wagerBoats').value) || 0;
    const keysWager = parseInt(document.getElementById('wagerKeys').value) || 0;
    const pickaxeWager = parseInt(document.getElementById('wagerPickaxe').value) || 0;
    const goldWager = parseInt(document.getElementById('wagerGold').value) || 0;

    // Validate wagers
    if (boatsWager > (gameState.inventory.boats || 0)) {
        showFloatingText('Not enough boats!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (keysWager > (gameState.inventory.keys || 0)) {
        showFloatingText('Not enough keys!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (pickaxeWager > (gameState.inventory.pickaxe || 0)) {
        showFloatingText('Not enough pickaxe uses!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (goldWager > (gameState.inventory.gold || 0)) {
        showFloatingText('Not enough gold!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    // Check minimum wager
    if (boatsWager === 0 && keysWager === 0 && pickaxeWager === 0 && goldWager < 10) {
        showFloatingText('Minimum wager: 10 gold or items!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    // Set wager
    gameState.pvp.wager = {
        boats: boatsWager,
        keys: keysWager,
        pickaxe: pickaxeWager,
        gold: goldWager
    };

    closePvPWagerModal();
    
    // Enable PvP ready
    await enablePvPReady();
}

async function enablePvPReady() {
    gameState.pvp.isReady = true;
    gameState.pvp.broadcastStart = Date.now();

    // Update UI
    const pvpBtn = document.getElementById('pvpReadyBtn');
    pvpBtn.textContent = '🛡️ PvP Active';
    pvpBtn.classList.add('pvp-active');

    // Show status
    showFloatingText('PvP Ready! Broadcasting for 3 minutes...', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');

    // Broadcast to blockchain
    await broadcastPvPStatus();

    // Start timer
    setTimeout(() => {
        if (gameState.pvp.isReady && !gameState.pvp.inPvPBattle) {
            disablePvPReady();
            showFloatingText('PvP broadcast expired', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#f59e0b'
            );
        }
    }, PVP_BROADCAST_DURATION);
}

function disablePvPReady() {
    gameState.pvp.isReady = false;
    gameState.pvp.broadcastStart = null;
    gameState.pvp.wager = { boats: 0, keys: 0, pickaxe: 0, gold: 0 };

    const pvpBtn = document.getElementById('pvpReadyBtn');
    pvpBtn.textContent = '⚔️ Ready for PvP';
    pvpBtn.classList.remove('pvp-active');

    showFloatingText('PvP disabled', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#94a3b8'
    );
}

async function broadcastPvPStatus() {
    if (!account || !algodClient) return;

    try {
        const pvpData = {
            type: 'PVP_READY',
            name: gameState.player.name,
            level: gameState.player.level,
            x: gameState.player.x,
            y: gameState.player.y,
            hp: gameState.player.hp,
            maxHp: gameState.player.maxHp,
            attack: gameState.player.attack,
            defense: gameState.player.defense,
            wager: gameState.pvp.wager,
            timestamp: Date.now()
        };

        const note = new TextEncoder().encode(
            'CHRPG:PVP:' + JSON.stringify(pvpData)
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

        console.log('PvP status broadcasted to blockchain');
    } catch (error) {
        console.error('Failed to broadcast PvP status:', error);
    }
}

async function loadPvPBroadcasts() {
    if (!indexerClient) return;

    try {
        const minRound = (await algodClient.status().do())['last-round'] - 2000;
        
        const txns = await indexerClient
            .searchForTransactions()
            .notePrefix(createNotePrefix('CHRPG:PVP:'))
            .minRound(minRound)
            .limit(50)
            .do();

        pvpBroadcasts.clear();

        if (txns.transactions) {
            const now = Date.now();
            
            for (const txn of txns.transactions) {
                if (txn.sender === account.addr) continue;

                try {
                    const noteText = decodeBase64Note(txn.note);
                    const jsonStr = noteText.replace('CHRPG:PVP:', '');
                    const pvpData = JSON.parse(jsonStr);

                    // Check if broadcast is still valid (within 3 minutes)
                    const age = now - pvpData.timestamp;
                    if (age < PVP_BROADCAST_DURATION) {
                        pvpBroadcasts.set(txn.sender, pvpData);
                    }
                } catch (e) {
                    console.log('Failed to parse PvP broadcast:', e);
                }
            }
        }

        updatePvPBroadcastsList();
    } catch (error) {
        console.error('Failed to load PvP broadcasts:', error);
    }
}

function updatePvPBroadcastsList() {
    const list = document.getElementById('pvpBroadcastsList');
    list.innerHTML = '';

    if (pvpBroadcasts.size === 0) {
        list.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">No active PvP challenges</div>';
        return;
    }

    pvpBroadcasts.forEach((data, address) => {
        const distance = Math.sqrt(
            Math.pow(gameState.player.x - data.x, 2) + 
            Math.pow(gameState.player.y - data.y, 2)
        );

        const inRange = distance <= PVP_MATCH_RANGE;
        const timeLeft = Math.max(0, PVP_BROADCAST_DURATION - (Date.now() - data.timestamp));
        const minutesLeft = Math.floor(timeLeft / 60000);
        const secondsLeft = Math.floor((timeLeft % 60000) / 1000);

        const wagerText = `⛵${data.wager.boats} 🗝️${data.wager.keys} ⛏️${data.wager.pickaxe} 💰${data.wager.gold}`;

        const item = document.createElement('div');
        item.className = 'pvp-broadcast-item';
        item.style.background = inRange ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)';
        item.style.border = inRange ? '2px solid #10b981' : '2px solid #3b82f6';
        item.style.padding = '12px';
        item.style.borderRadius = '8px';
        item.style.marginBottom = '8px';

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: bold; color: ${inRange ? '#10b981' : '#3b82f6'};">
                        ${data.name} (Lv.${data.level})
                    </div>
                    <div style="font-size: 11px; opacity: 0.8;">
                        📍 (${data.x}, ${data.y}) • ${distance.toFixed(1)} tiles away
                    </div>
                    <div style="font-size: 11px; margin-top: 4px;">
                        💎 Wager: ${wagerText}
                    </div>
                    <div style="font-size: 10px; opacity: 0.7; margin-top: 4px;">
                        ⏱️ ${minutesLeft}m ${secondsLeft}s left
                    </div>
                </div>
                <div>
                    ${inRange ? 
                        `<button class="btn btn-danger" onclick="acceptPvPChallenge('${address}')" style="font-size: 11px; padding: 8px 12px;">⚔️ Challenge!</button>` :
                        `<button class="btn btn-primary" onclick="navigateToPvP(${data.x}, ${data.y})" style="font-size: 11px; padding: 8px 12px;">📍 Navigate</button>`
                    }
                </div>
            </div>
        `;

        list.appendChild(item);
    });
}

function navigateToPvP(x, y) {
    showFloatingText(`Navigate to (${x}, ${y})`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#3b82f6'
    );
    
    // Show direction arrow (optional enhancement)
    const dx = x - gameState.player.x;
    const dy = y - gameState.player.y;
    const direction = Math.atan2(dy, dx);
    const dirText = direction > -0.785 && direction < 0.785 ? '→' :
                    direction >= 0.785 && direction < 2.356 ? '↓' :
                    direction >= 2.356 || direction < -2.356 ? '←' : '↑';
    
    showFloatingText(`Go ${dirText}`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32, 
        '#fbbf24'
    );
}

// ============================================
// PVP BATTLE SYSTEM
// ============================================

async function acceptPvPChallenge(targetAddress) {
    const opponent = pvpBroadcasts.get(targetAddress);
    
    if (!opponent) {
        showFloatingText('Challenge expired!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // Check distance
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - opponent.x, 2) + 
        Math.pow(gameState.player.y - opponent.y, 2)
    );

    if (distance > PVP_MATCH_RANGE) {
        showFloatingText('Too far! Move closer.', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // Check if player can match wager
    if (opponent.wager.boats > (gameState.inventory.boats || 0)) {
        showFloatingText(`Need ${opponent.wager.boats} boats to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.keys > (gameState.inventory.keys || 0)) {
        showFloatingText(`Need ${opponent.wager.keys} keys to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.pickaxe > (gameState.inventory.pickaxe || 0)) {
        showFloatingText(`Need ${opponent.wager.pickaxe} pickaxe uses to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }
    if (opponent.wager.gold > (gameState.inventory.gold || 0)) {
        showFloatingText(`Need ${opponent.wager.gold} gold to match wager!`, 
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    // Start PvP battle
    await startPvPBattle(opponent, targetAddress);
}

async function startPvPBattle(opponent, opponentAddress) {
    gameState.pvp.inPvPBattle = true;
    gameState.inBattle = true;

    // Deduct wagers from both players
    gameState.inventory.boats -= opponent.wager.boats;
    gameState.inventory.keys -= opponent.wager.keys;
    gameState.inventory.pickaxe -= opponent.wager.pickaxe;
    gameState.inventory.gold -= opponent.wager.gold;

    updateUI();

    // Setup opponent
    gameState.pvp.currentChallenge = {
        opponent: opponent,
        address: opponentAddress,
        totalWager: {
            boats: opponent.wager.boats * 2,
            keys: opponent.wager.keys * 2,
            pickaxe: opponent.wager.pickaxe * 2,
            gold: opponent.wager.gold * 2
        }
    };

    // Show PvP battle modal
    showPvPBattleModal(opponent);
}

function showPvPBattleModal(opponent) {
    const modal = document.getElementById('pvpBattleModal');
    
    // Setup UI
    document.getElementById('pvpOpponentName').textContent = opponent.name;
    document.getElementById('pvpOpponentLevel').textContent = opponent.level;
    document.getElementById('pvpOpponentHp').textContent = opponent.hp;
    document.getElementById('pvpOpponentMaxHp').textContent = opponent.maxHp;
    document.getElementById('pvpOpponentHpBar').style.width = `${(opponent.hp / opponent.maxHp) * 100}%`;

    // Show wager
    const wager = gameState.pvp.currentChallenge.totalWager;
    document.getElementById('pvpWagerDisplay').innerHTML = `
        <strong>Winner Takes All:</strong><br>
        ⛵ ${wager.boats} Boats | 🗝️ ${wager.keys} Keys | ⛏️ ${wager.pickaxe} Pickaxe Uses | 💰 ${wager.gold} Gold
    `;

    // Clear battle log
    document.getElementById('pvpBattleLog').innerHTML = '';
    addPvPBattleLog(`⚔️ PvP Battle: ${gameState.player.name} vs ${opponent.name}!`, 'log-info');
    addPvPBattleLog(`💎 Fighting for ${wager.gold}g, ${wager.boats} boats, ${wager.keys} keys, ${wager.pickaxe} pickaxe!`, 'log-info');

    modal.style.display = 'flex';
    
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#dc2626');
}

function pvpBattleAction(action) {
    const opponent = gameState.pvp.currentChallenge.opponent;
    
    if (!opponent || opponent.hp <= 0) return;

    let playerDamage = 0;
    let playerUsedTurn = true;

    switch (action) {
        case 'attack':
            playerDamage = Math.floor(Math.random() * gameState.player.attack) + 8;
            const critChance = Math.random();
            if (critChance < 0.15) {
                playerDamage = Math.floor(playerDamage * 1.5);
                addPvPBattleLog(`💥 CRITICAL HIT! ${playerDamage} damage!`, 'log-damage');
            } else {
                addPvPBattleLog(`⚔️ You attack for ${playerDamage} damage!`, 'log-damage');
            }
            opponent.hp = Math.max(0, opponent.hp - playerDamage);
            break;

        case 'magic':
            if (gameState.player.mp >= 15) {
                playerDamage = Math.floor(Math.random() * gameState.player.magic) + 12;
                gameState.player.mp -= 15;
                opponent.hp = Math.max(0, opponent.hp - playerDamage);
                addPvPBattleLog(`✨ Magic blast deals ${playerDamage} damage!`, 'log-damage');
                flashStatBar('mp', 'damage');
            } else {
                addPvPBattleLog(`⚠️ Insufficient mana!`, 'log-info');
                playerUsedTurn = false;
            }
            break;

        case 'defend':
            gameState.player.defense += 5;
            addPvPBattleLog(`🛡️ You raise your defenses! (+5 DEF for this turn)`, 'log-heal');
            setTimeout(() => {
                gameState.player.defense -= 5;
            }, 2000);
            break;

        case 'heal':
            if (gameState.inventory.healthPotions > 0) {
                const healAmount = Math.floor(Math.random() * 25) + 35;
                gameState.player.hp = Math.min(gameState.player.maxHp, gameState.player.hp + healAmount);
                gameState.inventory.healthPotions--;
                addPvPBattleLog(`💚 You heal for ${healAmount} HP!`, 'log-heal');
                flashStatBar('hp', 'heal');
            } else {
                addPvPBattleLog(`⚠️ No health potions!`, 'log-info');
                playerUsedTurn = false;
            }
            break;

        case 'special':
            if (gameState.player.mp >= 25) {
                playerDamage = Math.floor(gameState.player.attack * 1.8 + Math.random() * 20);
                gameState.player.mp -= 25;
                opponent.hp = Math.max(0, opponent.hp - playerDamage);
                addPvPBattleLog(`🔥 ULTIMATE ATTACK! ${playerDamage} massive damage!`, 'log-damage');
                flashStatBar('mp', 'damage');
                createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
            } else {
                addPvPBattleLog(`⚠️ Need 25 MP for special attack!`, 'log-info');
                playerUsedTurn = false;
            }
            break;
    }

    updatePvPBattleUI();
    updateUI();

    if (opponent.hp <= 0) {
        pvpPlayerVictory();
        return;
    }

    if (playerUsedTurn) {
        setTimeout(pvpOpponentTurn, 1500);
    }
}

function pvpOpponentTurn() {
    const opponent = gameState.pvp.currentChallenge.opponent;
    if (!opponent || opponent.hp <= 0) return;

    // Opponent AI - varied actions
    const actionRoll = Math.random();
    let opponentAction = '';
    let damage = 0;

    if (actionRoll < 0.6) {
        // Normal attack
        const baseDamage = Math.floor(Math.random() * opponent.attack) + 8;
        const defense = Math.floor(gameState.player.defense / 3);
        damage = Math.max(1, baseDamage - defense);
        opponentAction = 'attacks';
    } else if (actionRoll < 0.8) {
        // Strong attack
        const baseDamage = Math.floor(Math.random() * opponent.attack * 1.3) + 12;
        const defense = Math.floor(gameState.player.defense / 3);
        damage = Math.max(1, baseDamage - defense);
        opponentAction = 'uses a powerful strike';
    } else {
        // Magic attack
        const baseDamage = Math.floor(Math.random() * 25) + 15;
        const defense = Math.floor(gameState.player.defense / 4);
        damage = Math.max(1, baseDamage - defense);
        opponentAction = 'casts a spell';
    }

    gameState.player.hp = Math.max(0, gameState.player.hp - damage);
    addPvPBattleLog(`⚡ ${opponent.name} ${opponentAction} for ${damage} damage!`, 'log-damage');

    flashStatBar('hp', 'damage');
    updatePvPBattleUI();
    updateUI();

    if (gameState.player.hp <= 0) {
        pvpPlayerDefeat();
    }
}

function pvpPlayerVictory() {
    const wager = gameState.pvp.currentChallenge.totalWager;
    
    // Award all winnings
    gameState.inventory.boats += wager.boats;
    gameState.inventory.keys += wager.keys;
    gameState.inventory.pickaxe += wager.pickaxe;
    gameState.inventory.gold += wager.gold;
    
    // Bonus XP
    const xpGain = Math.floor(gameState.pvp.currentChallenge.opponent.level * 50);
    gameState.player.xp += xpGain;

    addPvPBattleLog(`🎉 VICTORY! You defeated ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-heal');
    addPvPBattleLog(`💰 You won: ${wager.boats}⛵ ${wager.keys}🗝️ ${wager.pickaxe}⛏️ ${wager.gold}💰`, 'log-heal');
    addPvPBattleLog(`⭐ Gained ${xpGain} XP!`, 'log-heal');

    checkLevelUp();
    updateUI();

    setTimeout(() => endPvPBattle(true), 3000);
}

function pvpPlayerDefeat() {
    addPvPBattleLog(`💀 DEFEAT! You were bested by ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-damage');
    addPvPBattleLog(`💸 You lost your wager...`, 'log-damage');
    
    // Small penalty
    gameState.player.hp = Math.floor(gameState.player.maxHp * 0.25);
    updateUI();

    setTimeout(() => endPvPBattle(false), 3000);
}

function endPvPBattle(victory) {
    gameState.pvp.inPvPBattle = false;
    gameState.inBattle = false;
    gameState.pvp.currentChallenge = null;

    document.getElementById('pvpBattleModal').style.display = 'none';

    if (victory) {
        showFloatingText('PvP VICTORY!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
    } else {
        showFloatingText('PvP Defeat...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }

    // Disable PvP ready if it was active
    if (gameState.pvp.isReady) {
        disablePvPReady();
    }

    updateUI();
}

function updatePvPBattleUI() {
    const opponent = gameState.pvp.currentChallenge.opponent;
    if (!opponent) return;

    document.getElementById('pvpOpponentHp').textContent = opponent.hp;
    document.getElementById('pvpOpponentHpBar').style.width = `${(opponent.hp / opponent.maxHp) * 100}%`;
}

function addPvPBattleLog(message, type) {
    const log = document.getElementById('pvpBattleLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// ============================================
// GAME INITIALIZATION AND STARTUP
// ============================================

window.addEventListener('load', () => {
    initGame();
    renderWorld();
    initializeMinimap();
    initHelpSystem();
    
    setTimeout(() => {
        showFloatingText('Welcome to EternalBliss Algorand!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#fbbf24'
        );
        console.log('EternalBliss Algorand v1.1 - Optimized & Enhanced');
        console.log('Built on Algorand - The Carbon-Negative Blockchain');
        console.log('');
        console.log('NEW Features:');
        console.log('   • Optimized rendering with chunking system');
        console.log('   • Support for 25-word mnemonics');
        console.log('   • Improved performance & reduced lag');
        console.log('');
        console.log('Connect your Algorand wallet to start playing!');
    }, 1000);
});

window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// ============================================
// DEBUG HELPERS (Development Only)
// ============================================

window.gameState = gameState;

window.addGold = (amount) => {
    gameState.inventory.gold += amount;
    updateUI();
    showFloatingText(`Added ${amount} gold!`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#fbbf24'
    );
};

window.addXP = (amount) => {
    gameState.player.xp += amount;
    checkLevelUp();
    updateUI();
    showFloatingText(`Added ${amount} XP!`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
};

window.teleport = (x, y) => {
    gameState.player.x = x;
    gameState.player.y = y;
    renderWorld();
    centerCameraOnPlayer();
    checkLocation();
    showFloatingText(`Teleported to (${x}, ${y})`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#3b82f6'
    );
};

window.healFull = () => {
    gameState.player.hp = gameState.player.maxHp;
    gameState.player.mp = gameState.player.maxMp;
    updateUI();
    showFloatingText('Fully healed!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
};

window.addPotions = (health = 5, mana = 5) => {
    gameState.inventory.healthPotions += health;
    gameState.inventory.manaPotions += mana;
    updateUI();
    showFloatingText(`Added potions!`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#3b82f6'
    );
};

window.clearEnemies = () => {
    enemies = [];
    renderWorld();
    showFloatingText('All enemies cleared!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
};

window.debugInfo = () => {
    console.log('=== DEBUG INFORMATION ===');
    console.log('Player Stats:', {
        level: gameState.player.level,
        hp: `${gameState.player.hp}/${gameState.player.maxHp}`,
        mp: `${gameState.player.mp}/${gameState.player.maxMp}`,
        xp: `${gameState.player.xp}/${gameState.player.xpToNext}`,
        attack: gameState.player.attack,
        defense: gameState.player.defense,
        magic: gameState.player.magic
    });
    console.log('Inventory:', gameState.inventory);
    console.log('Statistics:', gameState.stats);
    console.log('Position:', `(${gameState.player.x}, ${gameState.player.y})`);
    console.log('Location:', gameState.currentLocation);
    console.log('Rendered Chunks:', renderedChunks.size);
    console.log('Cached Tiles:', tileCache.size);
    console.log('Buildings Array:', buildings.length);
    console.log('NPCs Array:', npcs.length);
    console.log('Enemies Array:', enemies.length);
    console.log('Items Array:', items.length);
    console.log('Buildings in DOM:', document.querySelectorAll('.building').length);
    console.log('NPCs in DOM:', document.querySelectorAll('.npc-avatar').length);
    console.log('Enemies in DOM:', document.querySelectorAll('.enemy-avatar').length);
    console.log('Items in DOM:', document.querySelectorAll('.item-drop').length);
    console.log('Wallet Connected:', !!account);
    console.log('Wallet Type:', 'Mnemonic');
    console.log('AlgoSDK Available:', typeof algosdk !== 'undefined');

};

window.forceRender = () => {
    console.log('Forcing full render...');
    renderWorld();
    console.log('Render complete!');
    debugInfo();
};

window.generateTestMnemonic = () => {
    if (typeof algosdk === 'undefined') {
        console.error('AlgoSDK not loaded!');
        return;
    }
    const account = algosdk.generateAccount();
    const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
    console.log('=== TEST MNEMONIC (Testnet) ===');
    console.log(mnemonic);
    console.log('Address:', account.addr);
    console.log('Copy the mnemonic above to test wallet connection!');
    return mnemonic;
};

function playSound(soundType) {
    // You can add actual sound files later
    // For now, this is just a placeholder
    if (soundType === 'challenge') {
        console.log('🔊 Playing challenge sound');
        // Example: new Audio('sounds/challenge.mp3').play();
    }
}

console.log('EternalBliss Algorand Ready!');
console.log('Optimized with chunking system for better performance');
console.log('');
console.log('SDK STATUS:');
console.log('   • AlgoSDK:', typeof algosdk !== 'undefined' ? '✅ Loaded' : '❌ Not Loaded');


console.log('');
console.log('CONTROLS:');
console.log('   • WASD or Arrow Keys - Move');
console.log('   • Space or Enter - Interact');
console.log('   • Escape - Close modals');
console.log('');
console.log('WALLET OPTIONS:');
console.log('   • 25-word mnemonic (Algorand standard)');
console.log('   • Note: Algorand always uses 25 words (not 24)');
console.log('');
console.log('DEBUG COMMANDS:');
console.log('   • debugInfo() - Show detailed debug info');
console.log('   • generateTestMnemonic() - Create test 25-word mnemonic');
console.log('   • addGold(100) - Add gold');
console.log('   • addXP(50) - Add experience');
console.log('   • teleport(x, y) - Teleport to coordinates');
console.log('   • healFull() - Restore HP/MP');
console.log('');
console.log('Ready to explore the optimized Algorand-powered realm!');
