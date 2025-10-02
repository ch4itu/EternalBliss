// EternalBliss Algorand

// ============================================
// GAME STATE CONFIGURATION
// ============================================

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
        x: 15,
        y: 10,
        targetX: 15,
        targetY: 10,
        isMoving: false,
        address: null,
        assetId: null
    },
    world: {
        width: 50,
        height: 37,
        cameraX: 0,
        cameraY: 0
    },
    inventory: {
        gold: 100,
        healthPotions: 3,
        manaPotions: 2,
        keys: 0
    },
    stats: {
        enemiesDefeated: 0,
        treasuresFound: 0,
        townsVisited: 1
    },
    currentLocation: "Starter Village",
    inBattle: false,
    currentEnemy: null,
    movement: {
        speed: 3,
        keys: { w: false, a: false, s: false, d: false }
    },
    pendingChatMessages: []
};

// ============================================
// ALGORAND BLOCKCHAIN VARIABLES
// ============================================

let algodClient = null;
let indexerClient = null;
let account = null;
let walletMethod = 'mnemonic';

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

function setWalletMethod(method) {
    walletMethod = method;
    document.getElementById('mnemonicMethod').classList.toggle('active', method === 'mnemonic');
    
    const input = document.getElementById('walletInput');
    if (method === 'mnemonic') {
        input.style.display = 'block';
        input.placeholder = 'Enter your 25-word Algorand mnemonic phrase...';
        input.rows = 3;
    } else {
        input.style.display = 'none';
    }
}

async function connectWallet() {
    if (walletMethod === 'mnemonic') {
        await connectWithMnemonic();
    } else {
        await connectWithMyAlgo();
    }
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

    try {
        account = algosdk.mnemonicToSecretKey(mnemonic);
        gameState.player.address = account.addr;
        gameState.player.name = "Hero_" + account.addr.slice(-4);

        await updateAccountBalance();

        document.getElementById('walletInputSection').style.display = 'none';
        document.getElementById('walletConnected').style.display = 'block';
        document.getElementById('connectedAddress').textContent = account.addr;
        document.getElementById('connectionStatus').textContent = 'Connected';
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
        
        setTimeout(async () => {
            await syncWithAlgorand();
        }, 1000);

    } catch (error) {
        console.error('Connection error:', error);
        showFloatingText('Invalid mnemonic phrase!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
}

async function connectWithMyAlgo() {
    showFloatingText('MyAlgo integration coming soon!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#fbbf24'
    );
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
        
        const signedTxn = txn.signTxn(account.sk);
        
        showTxModal('Saving player data to Algorand...');
        
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
    
    generateWorld();
    createBuildings();
    createNPCs();
    createEnemies();
    spawnRandomItems();
    
    updateUI();
    centerCameraOnPlayer();
    
    setupEventListeners();
    setupMobileControls();
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
    worldMap = [];
    const seed = 12345;
    let random = seed;
    
    function seededRandom() {
        random = (random * 9301 + 49297) % 233280;
        return random / 233280;
    }
    
    for (let y = 0; y < gameState.world.height; y++) {
        worldMap[y] = [];
        for (let x = 0; x < gameState.world.width; x++) {
            let tileType = 'grass';
            
            const distanceFromCenter = Math.sqrt((x - 25) ** 2 + (y - 18) ** 2);
            const noise = Math.sin(x * 0.3) * Math.cos(y * 0.3);
            
            if (distanceFromCenter > 20 && seededRandom() < 0.15) {
                tileType = 'mountain';
            } else if (noise > 0.3 && seededRandom() < 0.12) {
                tileType = 'forest';
            } else if (x < 8 && y > 15 && y < 25 && seededRandom() < 0.4) {
                tileType = 'water';
            } else if (x > 35 && y > 25 && seededRandom() < 0.3) {
                tileType = 'sand';
            } else if (seededRandom() < 0.08) {
                tileType = 'forest';
            }
            
            if ((x === 10 || x === 25 || x === 40) && y > 5 && y < 32) tileType = 'road';
            if ((y === 10 || y === 20) && x > 5 && x < 45) tileType = 'road';
            if ((x === 15 && y > 8 && y < 14) || (y === 15 && x > 20 && x < 30)) tileType = 'road';
            
            worldMap[y][x] = tileType;
        }
    }
}

function createBuildings() {
    buildings = [
        {x: 12, y: 8, type: 'inn', name: 'Algorand Rest Inn', class: 'building house inn'},
        {x: 18, y: 8, type: 'shop', name: 'ALGO Trading Post', class: 'building house shop'},
        {x: 15, y: 12, type: 'temple', name: 'Temple of Consensus', class: 'building temple'},
        {x: 10, y: 15, type: 'castle', name: 'Governance Hall', class: 'building castle'},
        {x: 20, y: 12, type: 'house', name: 'Validator House', class: 'building house'},
        {x: 38, y: 8, type: 'shop', name: 'Smart Contract Forge', class: 'building house shop'},
        {x: 42, y: 10, type: 'inn', name: 'Node Operator Inn', class: 'building house inn'},
        {x: 40, y: 6, type: 'temple', name: 'Pure Proof Shrine', class: 'building temple'},
        {x: 36, y: 12, type: 'house', name: 'Miner Dwelling', class: 'building house'},
        {x: 8, y: 25, type: 'shop', name: 'ASA Marketplace', class: 'building house shop'},
        {x: 12, y: 27, type: 'inn', name: 'DeFi Den', class: 'building house inn'},
        {x: 6, y: 22, type: 'temple', name: 'Yield Temple', class: 'building temple'},
        {x: 10, y: 30, type: 'house', name: 'Staker Lodge', class: 'building house'},
        {x: 25, y: 30, type: 'shop', name: 'NFT Bazaar', class: 'building house shop'},
        {x: 28, y: 32, type: 'inn', name: 'Creator Tavern', class: 'building house inn'},
        {x: 30, y: 28, type: 'house', name: 'Artist Studio', class: 'building house'},
        {x: 24, y: 4, type: 'castle', name: 'Foundation Palace', class: 'building castle'}
    ];
}

function createNPCs() {
    npcs = [
        {x: 13, y: 9, name: 'Keeper Marcus', class: 'npc npc-villager', dialogue: 'Welcome to Algorand realm! Rest here for 20 ALGO to restore your strength.'},
        {x: 19, y: 9, name: 'Trader Elena', class: 'npc npc-merchant', dialogue: 'Trade your ALGOs for powerful items! Health potions: 15 ALGO, Mana potions: 10 ALGO.'},
        {x: 16, y: 13, name: 'Consensus Priest', class: 'npc npc-priest', dialogue: 'The Pure Proof of Stake blesses all who seek it. May your transactions be swift!'},
        {x: 11, y: 16, name: 'Governor Theron', class: 'npc npc-elder', dialogue: 'Participate in governance to shape the future of our realm. Your voice matters!'},
        {x: 21, y: 15, name: 'Validator Willem', class: 'npc npc-villager', dialogue: 'The network grows stronger with each block. Have you staked your ALGOs?'},
        {x: 25, y: 18, name: 'ASA Merchant', class: 'npc npc-merchant', dialogue: 'I carry rare Algorand Standard Assets from distant smart contracts!'},
        {x: 39, y: 12, name: 'Contract Smith', class: 'npc npc-villager', dialogue: 'TEAL smart contracts power our realm. The code is law here!'},
        {x: 9, y: 26, name: 'DeFi Sage Lyra', class: 'npc npc-priest', dialogue: 'Yield farming and liquidity pools await the brave. Compound your rewards!'},
        {x: 26, y: 31, name: 'NFT Guide Rashid', class: 'npc npc-merchant', dialogue: 'Mint your achievements as NFTs! Your legend lives forever on-chain.'},
        {x: 25, y: 6, name: 'Foundation Guard', class: 'npc npc-elder', dialogue: 'The Algorand Foundation seeks heroes to advance the ecosystem!'}
    ];
}

function createEnemies() {
    enemies = [
        {x: 20, y: 12, name: 'FUD Goblin', class: 'enemy-spawn enemy-goblin', hp: 40, maxHp: 40, attack: 8, xpReward: 25, goldReward: 15},
        {x: 5, y: 28, name: 'Gas Fee Wolf', class: 'enemy-spawn enemy-wolf', hp: 45, maxHp: 45, attack: 12, xpReward: 30, goldReward: 18},
        {x: 14, y: 26, name: 'Fork Sprite', class: 'enemy-spawn enemy-goblin', hp: 35, maxHp: 35, attack: 10, xpReward: 20, goldReward: 12},
        {x: 35, y: 15, name: 'Whale Troll', class: 'enemy-spawn enemy-dragon', hp: 80, maxHp: 80, attack: 20, xpReward: 60, goldReward: 40},
        {x: 43, y: 18, name: 'MEV Bot', class: 'enemy-spawn enemy-dragon', hp: 100, maxHp: 100, attack: 25, xpReward: 75, goldReward: 50},
        {x: 30, y: 25, name: 'Rug Pull Scorpion', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 40, goldReward: 25},
        {x: 27, y: 35, name: 'Phishing Wraith', class: 'enemy-spawn enemy-wolf', hp: 60, maxHp: 60, attack: 18, xpReward: 45, goldReward: 30},
        {x: 22, y: 18, name: 'Scam Bandit', class: 'enemy-spawn enemy-wolf', hp: 50, maxHp: 50, attack: 14, xpReward: 35, goldReward: 22},
        {x: 32, y: 12, name: 'Volatility Elemental', class: 'enemy-spawn enemy-dragon', hp: 70, maxHp: 70, attack: 22, xpReward: 55, goldReward: 35}
    ];
}

function spawnRandomItems() {
    items = [];
    const seed = 98765;
    let random = seed;
    
    function seededRandom() {
        random = (random * 9301 + 49297) % 233280;
        return random / 233280;
    }
    
    for (let i = 0; i < 8; i++) {
        let x, y, attempts = 0;
        do {
            x = Math.floor(seededRandom() * gameState.world.width);
            y = Math.floor(seededRandom() * gameState.world.height);
            attempts++;
        } while ((worldMap[y][x] === 'water' || worldMap[y][x] === 'mountain') && attempts < 20);
        
        if (attempts < 20) {
            items.push({
                x: x,
                y: y,
                type: 'gold',
                value: 25 + Math.floor(seededRandom() * 30)
            });
        }
    }
}

// ============================================
// WORLD RENDERING
// ============================================

function renderWorld() {
    const worldGrid = document.getElementById('worldGrid');
    worldGrid.innerHTML = '';
    
    for (let y = 0; y < gameState.world.height; y++) {
        for (let x = 0; x < gameState.world.width; x++) {
            const tile = document.createElement('div');
            tile.className = `tile ${worldMap[y][x]}`;
            tile.style.left = `${x * 32}px`;
            tile.style.top = `${y * 32}px`;
            worldGrid.appendChild(tile);
        }
    }
    
    buildings.forEach(building => {
        const buildingEl = document.createElement('div');
        buildingEl.className = building.class;
        buildingEl.style.left = `${building.x * 32}px`;
        buildingEl.style.top = `${building.y * 32}px`;
        buildingEl.onclick = () => tryInteractWithBuilding(building);
        buildingEl.title = building.name;
        worldGrid.appendChild(buildingEl);
    });
    
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
        
        npcEl.onclick = () => tryTalkToNPC(npc);
        npcEl.title = npc.name;
        worldGrid.appendChild(npcEl);
    });
    
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
    
    // FIXED: Gold items now render correctly
    items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'item-drop';
        itemEl.style.left = `${item.x * 32}px`;
        itemEl.style.top = `${item.y * 32}px`;
        itemEl.style.width = '32px';
        itemEl.style.height = '32px';
        itemEl.style.position = 'absolute';
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'center';
        itemEl.style.fontSize = '20px';
        itemEl.style.cursor = 'pointer';
        itemEl.innerHTML = '💰';
        itemEl.onclick = () => tryCollectItem(index, item);
        itemEl.title = `Treasure: ${item.value} gold`;
        worldGrid.appendChild(itemEl);
    });
    
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
    
    if ((gameState.player.x + gameState.player.y) % 3 === 0) {
        updateMinimapOptimized();
    }
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
    if (tileType === 'water' || tileType === 'mountain') {
        return false;
    }
    
    return true;
}

function checkLocationQuick() {
    let locationName = "Wilderness";
    
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

// FIXED: Distance check for gold collection
function tryCollectItem(index, item) {
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - item.x, 2) + 
        Math.pow(gameState.player.y - item.y, 2)
    );
    
    const PICKUP_RANGE = 1.5;
    
    if (distance <= PICKUP_RANGE) {
        collectItem(index);
    } else {
        showFloatingText('Too far away!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#ef4444');
    }
}

function collectItem(index) {
    const item = items[index];
    gameState.inventory.gold += item.value;
    gameState.stats.treasuresFound++;
    
    showFloatingText(`+${item.value} Gold!`, item.x * 32 + 16, item.y * 32, '#fbbf24');
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
    minimapContent.innerHTML = '';
    
    const scale = 4;
    
    for (let y = 0; y < gameState.world.height; y++) {
        for (let x = 0; x < gameState.world.width; x++) {
            const tile = document.createElement('div');
            tile.style.position = 'absolute';
            tile.style.left = `${x * scale}px`;
            tile.style.top = `${y * scale}px`;
            tile.style.width = `${scale}px`;
            tile.style.height = `${scale}px`;
            
            switch(worldMap[y][x]) {
                case 'water':
                    tile.style.background = '#1e40af';
                    break;
                case 'mountain':
                    tile.style.background = '#6b7280';
                    break;
                case 'forest':
                    tile.style.background = '#166534';
                    break;
                case 'sand':
                    tile.style.background = '#eab308';
                    break;
                case 'road':
                    tile.style.background = '#8b5a2b';
                    break;
                default:
                    tile.style.background = '#2d5016';
            }
            
            minimapContent.appendChild(tile);
        }
    }
    
    buildings.forEach(building => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'building');
        dot.style.position = 'absolute';
        dot.style.left = `${building.x * scale - 1}px`;
        dot.style.top = `${building.y * scale - 1}px`;
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.background = building.type === 'castle' ? '#fbbf24' : '#3b82f6';
        dot.style.borderRadius = '50%';
        dot.style.border = '1px solid #fff';
        dot.style.zIndex = '10';
        minimapContent.appendChild(dot);
    });
    
    enemies.forEach(enemy => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'enemy');
        dot.style.position = 'absolute';
        dot.style.left = `${enemy.x * scale - 1}px`;
        dot.style.top = `${enemy.y * scale - 1}px`;
        dot.style.width = '4px';
        dot.style.height = '4px';
        dot.style.background = '#dc2626';
        dot.style.borderRadius = '50%';
        dot.style.zIndex = '10';
        minimapContent.appendChild(dot);
    });
}

function updateMinimapOptimized() {
    const minimapContent = document.getElementById('minimapContent');
    const scale = 4;
    
    const existingPlayerDots = minimapContent.querySelectorAll('[data-type="player"]');
    existingPlayerDots.forEach(dot => dot.remove());
    
    const playerDot = document.createElement('div');
    playerDot.setAttribute('data-type', 'player');
    playerDot.style.position = 'absolute';
    playerDot.style.left = `${gameState.player.x * scale - 2}px`;
    playerDot.style.top = `${gameState.player.y * scale - 2}px`;
    playerDot.style.width = '8px';
    playerDot.style.height = '8px';
    playerDot.style.background = '#10b981';
    playerDot.style.border = '2px solid #fff';
    playerDot.style.zIndex = '100';
    playerDot.style.boxShadow = '0 0 8px #10b981';
    minimapContent.appendChild(playerDot);
    
    otherPlayers.forEach((player) => {
        const dot = document.createElement('div');
        dot.setAttribute('data-type', 'player');
        dot.style.position = 'absolute';
        dot.style.left = `${player.x * scale - 1}px`;
        dot.style.top = `${player.y * scale - 1}px`;
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.background = player.level >= 5 ? '#fbbf24' : '#34d399';
        dot.style.borderRadius = '50%';
        dot.style.border = '1px solid #fff';
        dot.style.zIndex = '50';
        dot.style.boxShadow = '0 0 4px rgba(52, 211, 153, 0.5)';
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

function challengePlayer(targetAddress) {
    showFloatingText('PvP battles coming soon!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#fbbf24');
    closeModal();
}

function tradeWithPlayer(targetAddress) {
    showFloatingText('P2P trading coming soon!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#fbbf24');
    closeModal();
}

// FIXED: Distance check for NPC interaction
function tryTalkToNPC(npc) {
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - npc.x, 2) + 
        Math.pow(gameState.player.y - npc.y, 2)
    );
    
    const INTERACTION_RANGE = 1.5;
    
    if (distance <= INTERACTION_RANGE) {
        talkToNPC(npc);
    } else {
        showFloatingText(`Too far from ${npc.name}!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#ef4444');
    }
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

// FIXED: Distance check for building interaction
function tryInteractWithBuilding(building) {
    const distance = Math.sqrt(
        Math.pow(gameState.player.x - building.x, 2) + 
        Math.pow(gameState.player.y - building.y, 2)
    );
    
    const INTERACTION_RANGE = 2.0;
    
    if (distance <= INTERACTION_RANGE) {
        interactWithBuilding(building);
    } else {
        showFloatingText(`Too far from ${building.name}!`, gameState.player.x * 32 + 16, gameState.player.y * 32 - 20, '#ef4444');
    }
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
                </div>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-primary" onclick="buyItem('health', 15)">Buy Health</button>
                    <button class="btn btn-primary" onclick="buyItem('mana', 10)">Buy Mana</button>
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

function setupMobileControls() {
    const buttons = document.querySelectorAll('#mobile-controls .ctl-btn');
    buttons.forEach(btn => {
        const dir = btn.dataset.dir;
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            handleDirection(dir);
        });
        btn.addEventListener('touchend', e => {
            e.preventDefault();
        });
    });
}

function handleDirection(dir) {
    switch(dir) {
        case 'up':    movePlayer( 0,-1); break;
        case 'down':  movePlayer( 0, 1); break;
        case 'left':  movePlayer(-1, 0); break;
        case 'right': movePlayer( 1, 0); break;
    }
    centerCameraOnPlayerOptimized();
    updatePlayerPositionOnly();
}

// ============================================
// GAME INITIALIZATION AND STARTUP
// ============================================

window.addEventListener('load', () => {
    initGame();
    renderWorld();
    initGame();
    renderWorld();
    initializeMinimap();
    
    setTimeout(() => {
        showFloatingText('Welcome to EternalBliss Algorand!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#fbbf24'
        );
        console.log('EternalBliss Algorand v1.0 - Blockchain RPG');
        console.log('Built on Algorand - The Carbon-Negative Blockchain');
        console.log('');
        console.log('Features:');
        console.log('   • On-chain player data storage');
        console.log('   • NFT character minting (ASA)');
        console.log('   • Decentralized chat system');
        console.log('   • Real-time multiplayer tracking');
        console.log('   • Transaction-based save system');
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
// DEBUG HELPERS
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

window.spawnEnemy = (x, y) => {
    const newEnemy = {
        x: x || gameState.player.x + 2,
        y: y || gameState.player.y,
        name: 'Debug Enemy',
        class: 'enemy-spawn enemy-goblin',
        hp: 30,
        maxHp: 30,
        attack: 8,
        xpReward: 25,
        goldReward: 15
    };
    enemies.push(newEnemy);
    renderWorld();
    showFloatingText('Enemy spawned!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#dc2626'
    );
};

window.showLocation = () => {
    console.log(`Current location: ${gameState.currentLocation}`);
    console.log(`Position: (${gameState.player.x}, ${gameState.player.y})`);
    console.log(`Nearby NPCs: ${npcs.filter(npc => 
        Math.abs(npc.x - gameState.player.x) < 3 && 
        Math.abs(npc.y - gameState.player.y) < 3
    ).map(npc => npc.name)}`);
    console.log(`Nearby buildings: ${buildings.filter(b => 
        Math.abs(b.x - gameState.player.x) < 3 && 
        Math.abs(b.y - gameState.player.y) < 3
    ).map(b => b.name)}`);
};

window.listPlayers = () => {
    console.log('=== ONLINE PLAYERS ===');
    console.log(`You: ${gameState.player.name} (Level ${gameState.player.level}) at (${gameState.player.x}, ${gameState.player.y})`);
    otherPlayers.forEach((player, address) => {
        console.log(`${player.name} (Level ${player.level}) at (${player.x}, ${player.y}) - ${address.slice(0, 6)}...${address.slice(-4)}`);
    });
    console.log(`Total players online: ${otherPlayers.size + 1}`);
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
    console.log('In Battle:', gameState.inBattle);
    console.log('Wallet Connected:', !!account);
    console.log('Algorand Client:', !!algodClient);
};

window.setLevel = (level) => {
    gameState.player.level = Math.max(1, level);
    gameState.player.maxHp = 100 + (gameState.player.level - 1) * 20;
    gameState.player.hp = gameState.player.maxHp;
    gameState.player.maxMp = 50 + (gameState.player.level - 1) * 10;
    gameState.player.mp = gameState.player.maxMp;
    gameState.player.attack = 15 + (gameState.player.level - 1) * 3;
    gameState.player.defense = 10 + (gameState.player.level - 1) * 2;
    gameState.player.magic = 20 + (gameState.player.level - 1) * 4;
    gameState.player.xp = (gameState.player.level - 1) * 100;
    gameState.player.xpToNext = gameState.player.level * 100;
    updateUI();
    renderWorld();
    showFloatingText(`Level set to ${level}!`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#8b5cf6'
    );
};

window.testBattle = () => {
    const testEnemy = {
        x: gameState.player.x,
        y: gameState.player.y,
        name: 'Test Monster',
        class: 'enemy-spawn enemy-dragon',
        hp: 50,
        maxHp: 50,
        attack: 12,
        xpReward: 100,
        goldReward: 50
    };
    startBattle(testEnemy);
};

window.restoreAll = () => {
    gameState.player.hp = gameState.player.maxHp;
    gameState.player.mp = gameState.player.maxMp;
    gameState.inventory.healthPotions = 10;
    gameState.inventory.manaPotions = 10;
    updateUI();
    showFloatingText('Everything restored!', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
};

window.quickLocations = () => {
    console.log('=== QUICK TELEPORT LOCATIONS ===');
    console.log('teleport(15, 10) - Starter Village (spawn point)');
    console.log('teleport(13, 9) - Algorand Rest Inn');
    console.log('teleport(19, 9) - ALGO Trading Post');
    console.log('teleport(16, 13) - Temple of Consensus');
    console.log('teleport(25, 6) - Foundation Palace');
    console.log('teleport(39, 12) - Smart Contract Town');
    console.log('teleport(9, 26) - DeFi Village');
    console.log('teleport(26, 31) - NFT Outpost');
    console.log('teleport(25, 18) - Road intersection');
};

console.log('EternalBliss Algorand Ready!');
console.log('Connect your Algorand wallet to start playing');
console.log('');
console.log('CONTROLS:');
console.log('   • WASD or Arrow Keys - Move');
console.log('   • Space or Enter - Interact');
console.log('   • Escape - Close modals');
console.log('');
console.log('ALGORAND FEATURES:');
console.log('   • Save/Load - Store game data on-chain');
console.log('   • NFT Minting - Create player NFT (ASA)');
console.log('   • Chat - Decentralized messaging');
console.log('   • Multiplayer - Track other players on-chain');
console.log('');
console.log('DEBUG COMMANDS:');
console.log('   • addGold(100) - Add gold');
console.log('   • addXP(50) - Add experience');
console.log('   • setLevel(10) - Set player level');
console.log('   • teleport(x, y) - Teleport to coordinates');
console.log('   • quickLocations() - Show teleport locations');
console.log('   • healFull() - Restore HP/MP');
console.log('   • restoreAll() - Restore everything');
console.log('   • testBattle() - Start test battle');
console.log('   • debugInfo() - Show detailed debug info');
console.log('');
console.log('Ready to explore the Algorand-powered realm!');
