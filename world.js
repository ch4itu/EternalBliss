// EternalBliss Algorand

const DEFAULT_MAP = null;
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 2;

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
        assetId: null,
        moveCount: 0,
        timestamp: 0,
        lastSynced: 0,
        unsavedChangesAt: 0
    },
    world: {
        width: BLISS_MAP_DATA.width,
        height: BLISS_MAP_DATA.height,
        cameraX: 0,
        cameraY: 0,
        areas: [],
        metadata: BLISS_MAP_DATA.metadata ? { ...BLISS_MAP_DATA.metadata } : {}
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
        myBroadcastAddress: null,
        isMyTurn: false,
        turnNumber: 0,
        battleId: null,
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

const worldPvPState = window.pvpState || (window.pvpState = {
    broadcasts: new Map(),
    activeBattles: new Map()
});

const worldPvPBroadcasts = worldPvPState.broadcasts;
const worldActivePvPBattles = worldPvPState.activeBattles; // Track ongoing PvP battles

// CHUNKING SYSTEM (unchanged)

let renderedChunks = new Set();
let tileCache = new Map();

function resetWorldRenderCache() {
    renderedChunks.clear();
    tileCache.forEach(tile => {
        if (tile && tile.remove) {
            tile.remove();
        }
    });
    tileCache.clear();

    const worldGrid = document.getElementById('worldGrid');
    if (worldGrid) {
        worldGrid.querySelectorAll('.tile').forEach(tile => tile.remove());
    }
}

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
            
            const terrainType = worldMap[y][x];
            const tile = document.createElement('div');
            tile.className = `tile ${terrainType}`;
            tile.style.left = `${x * 32}px`;
            tile.style.top = `${y * 32}px`;
            tile.dataset.chunk = chunkKey;
            tile.dataset.terrain = terrainType;
            tile.style.background = '';
            tile.style.backgroundImage = '';
            tile.style.backgroundColor = '';
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

// BROWSER COMPATIBLE BUFFER UTILITIES

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
let entityMovementInterval = null;
let mobileHoldIntervals = {};
let pvpBattleCheckInterval = null; // NEW: Check for PvP battle updates

// MOVING ENTITIES SYSTEM (unchanged from your code)

function initializeMovingEntities() {
    if (entityMovementInterval) {
        clearInterval(entityMovementInterval);
        entityMovementInterval = null;
    }

    enemies.forEach((enemy, index) => {
        const patrolFlag = enemy.movable !== undefined
            ? enemy.movable
            : (enemy.patrol?.enabled ?? (index % 3 === 0));

        if (!patrolFlag) {
            enemy.patrol = null;
            return;
        }

        const radius = Math.max(1, Number(enemy.patrolRadius ?? enemy.patrol?.radius ?? 3));
        const speed = enemy.patrol?.speed ?? Math.min(0.05, Math.max(0.015, radius * 0.005));

        enemy.patrol = {
            enabled: true,
            originX: enemy.x,
            originY: enemy.y,
            radius,
            angle: enemy.patrol?.angle ?? Math.random() * Math.PI * 2,
            speed,
            mode: 'patrol',
            chaseStartX: null,
            chaseStartY: null,
            lastKnownPlayerX: null,
            lastKnownPlayerY: null,
            returnSteps: 0
        };

        enemy.movable = true;
        enemy.patrolRadius = radius;
    });

    npcs.forEach((npc, index) => {
        const patrolFlag = npc.movable !== undefined
            ? npc.movable
            : (npc.patrol?.enabled ?? (index % 4 === 0));

        if (!patrolFlag) {
            npc.patrol = null;
            return;
        }

        const radius = Math.max(1, Number(npc.patrolRadius ?? npc.patrol?.radius ?? 2));
        const speed = npc.patrol?.speed ?? Math.min(0.04, Math.max(0.01, radius * 0.004));

        npc.patrol = {
            enabled: true,
            originX: npc.x,
            originY: npc.y,
            radius,
            angle: npc.patrol?.angle ?? Math.random() * Math.PI * 2,
            speed
        };

        npc.movable = true;
        npc.patrolRadius = radius;
    });

    entityMovementInterval = setInterval(updateMovingEntities, 100);
}

function updateMovingEntities() {
    if (gameState.inBattle) return;

    enemies.forEach(enemy => {
        if (!enemy.patrol || !enemy.patrol.enabled) return;

        const distToPlayer = Math.sqrt(
            Math.pow(gameState.player.x - enemy.x, 2) + 
            Math.pow(gameState.player.y - enemy.y, 2)
        );

        if (enemy.patrol.mode === 'chasing') {
            if (distToPlayer < 4) {
                const dx = gameState.player.x - enemy.x;
                const dy = gameState.player.y - enemy.y;
                const moveX = Math.sign(dx) * 0.3;
                const moveY = Math.sign(dy) * 0.3;

                const newX = enemy.x + moveX;
                const newY = enemy.y + moveY;

                if (canEntityMoveTo(newX, newY)) {
                    enemy.x = newX;
                    enemy.y = newY;
                    
                    enemy.patrol.lastKnownPlayerX = gameState.player.x;
                    enemy.patrol.lastKnownPlayerY = gameState.player.y;
                }

                if (distToPlayer < 1.5 && !gameState.inBattle) {
                    startBattle(enemy);
                    return;
                }
            } else {
                enemy.patrol.mode = 'returning';
                enemy.patrol.returnSteps = 0;
            }
        } else if (enemy.patrol.mode === 'returning') {
            const distToStart = Math.sqrt(
                Math.pow(enemy.patrol.chaseStartX - enemy.x, 2) + 
                Math.pow(enemy.patrol.chaseStartY - enemy.y, 2)
            );

            if (distToStart < 0.5) {
                enemy.patrol.mode = 'patrol';
                enemy.patrol.chaseStartX = null;
                enemy.patrol.chaseStartY = null;
                enemy.patrol.lastKnownPlayerX = null;
                enemy.patrol.lastKnownPlayerY = null;
            } else {
                const dx = enemy.patrol.chaseStartX - enemy.x;
                const dy = enemy.patrol.chaseStartY - enemy.y;
                const moveX = Math.sign(dx) * 0.25;
                const moveY = Math.sign(dy) * 0.25;

                const newX = enemy.x + moveX;
                const newY = enemy.y + moveY;

                if (canEntityMoveTo(newX, newY)) {
                    enemy.x = newX;
                    enemy.y = newY;
                    enemy.patrol.returnSteps++;
                }

                if (enemy.patrol.returnSteps > 50) {
                    enemy.x = enemy.patrol.chaseStartX;
                    enemy.y = enemy.patrol.chaseStartY;
                    enemy.patrol.mode = 'patrol';
                }
            }

            if (distToPlayer < 4) {
                enemy.patrol.mode = 'chasing';
                enemy.patrol.chaseStartX = enemy.x;
                enemy.patrol.chaseStartY = enemy.y;
            }
        } else {
            if (distToPlayer < 4) {
                enemy.patrol.mode = 'chasing';
                enemy.patrol.chaseStartX = enemy.x;
                enemy.patrol.chaseStartY = enemy.y;
            } else {
                enemy.patrol.angle += enemy.patrol.speed;
                const newX = enemy.patrol.originX + Math.cos(enemy.patrol.angle) * enemy.patrol.radius;
                const newY = enemy.patrol.originY + Math.sin(enemy.patrol.angle) * enemy.patrol.radius;

                if (canEntityMoveTo(newX, newY)) {
                    enemy.x = newX;
                    enemy.y = newY;
                }
            }
        }
    });

    npcs.forEach(npc => {
        if (!npc.patrol || !npc.patrol.enabled) return;

        npc.patrol.angle += npc.patrol.speed;
        const newX = npc.patrol.originX + Math.cos(npc.patrol.angle) * npc.patrol.radius;
        const newY = npc.patrol.originY + Math.sin(npc.patrol.angle) * npc.patrol.radius;

        if (canEntityMoveTo(newX, newY)) {
            npc.x = newX;
            npc.y = newY;
        }
    });

    renderEntitiesOnly();
}

function canEntityMoveTo(x, y) {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    
    if (tileX < 0 || tileX >= gameState.world.width || 
        tileY < 0 || tileY >= gameState.world.height) {
        return false;
    }
    
    const tileType = worldMap[tileY][tileX];
    return tileType !== 'water' && tileType !== 'mountain' && tileType !== 'door';
}

function renderEntitiesOnly() {
    const worldGrid = document.getElementById('worldGrid');
    
    const oldEntities = worldGrid.querySelectorAll('.building, .npc-avatar, .enemy-avatar, .item-drop, .other-player-avatar, .main-player-avatar, [style*="z-index: 19"]');
    oldEntities.forEach(el => el.remove());
    
    renderAllEntities();
}

async function teleportRandom() {
    const TELEPORT_COST = 25;
    
    // Wallet check removed - allow offline teleport!
    
    if (gameState.inventory.gold < TELEPORT_COST) {
        showFloatingText(`Need ${TELEPORT_COST} gold to teleport!`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    if (gameState.inBattle) {
        showFloatingText('Cannot teleport during battle!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    // Generate random valid location
    let newX, newY, attempts = 0;
    
    do {
        newX = Math.floor(Math.random() * gameState.world.width);
        newY = Math.floor(Math.random() * gameState.world.height);
        attempts++;
        
        if (attempts > 100) {
            showFloatingText('No valid location found!', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#ef4444'
            );
            return;
        }
    } while (worldMap[newY][newX] === 'water' || worldMap[newY][newX] === 'mountain');
    
    try {
        showFloatingText('Teleporting...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#3b82f6'
        );
        
        // Update local state first
        gameState.player.x = newX;
        gameState.player.y = newY;
        gameState.inventory.gold -= TELEPORT_COST;
        
        // Update position on blockchain (no separate teleport function in contract)
        if (contract && account) {
            await contract.updatePosition(account, newX, newY, { force: true, skipLoad: true });
        }
        
        // Effects
        createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#8b5cf6');
        
        showFloatingText(`✨ Teleported! (-${TELEPORT_COST} gold)`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#8b5cf6'
        );
        
        updateUI();
        renderWorld();
        centerCameraOnPlayer();
        checkLocation();
        
    } catch (error) {
        console.error('Teleport failed:', error);
        showFloatingText('Teleport failed!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
}

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

// GAME INITIALIZATION

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
    initializeMovingEntities();
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
        gameState.world.metadata = {
            ...(mapData.metadata || {}),
            useDefaultSettlements: mapData.metadata?.useDefaultSettlements ?? false
        };

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

        resetWorldRenderCache();
        renderWorld();
        initializeMovingEntities();
        centerCameraOnPlayer();

        console.log(`Custom map "${mapData.name}" loaded successfully`);
        
    } catch (error) {
        console.error('Failed to load custom map:', error);
        console.log('Falling back to default generation');
        generateWorld();
        createBuildings();
        createNPCs();
        createEnemies();
        spawnRandomItems();
        renderWorld();
        centerCameraOnPlayer();
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


// WORLD GENERATION

function generateWorld() {
    worldMap = BLISS_MAP_DATA.terrain;
    gameState.world.width = BLISS_MAP_DATA.width;
    gameState.world.height = BLISS_MAP_DATA.height;
    gameState.world.areas = BLISS_MAP_DATA.areas;
    gameState.world.metadata = BLISS_MAP_DATA.metadata ? { ...BLISS_MAP_DATA.metadata } : {};
    resetWorldRenderCache();
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

// OPTIMIZED WORLD RENDERING

function renderWorld() {
    const worldGrid = document.getElementById('worldGrid');
    
    const visibleChunks = getVisibleChunks();
    visibleChunks.forEach(chunk => {
        renderChunk(chunk.chunkX, chunk.chunkY);
    });
    
    clearDistantChunks();
    
    const entities = worldGrid.querySelectorAll('.building, .npc-avatar, .enemy-avatar, .item-drop, .other-player-avatar, .main-player-avatar, [style*="z-index: 19"]');
    entities.forEach(el => el.remove());
    
    renderAllEntities();
}

function renderAllEntities() {
    const worldGrid = document.getElementById('worldGrid');
    
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
    
    otherPlayers.forEach((player, address) => {
        const otherPlayerEl = document.createElement('div');
        otherPlayerEl.className = 'other-player-avatar';
        otherPlayerEl.style.left = `${player.x * 32}px`;
        otherPlayerEl.style.top = `${player.y * 32}px`;

        if (player.isStale) {
            otherPlayerEl.style.opacity = '0.6';
        }

        if (player.isIdle) {
            otherPlayerEl.style.opacity = '0.5';
            otherPlayerEl.style.filter = 'grayscale(50%)';
        }

        // Add visual indicator for players in battle
        if (player.inBattle) {
            otherPlayerEl.style.border = '2px solid #ef4444';
            otherPlayerEl.style.boxShadow = '0 0 10px #ef4444';
        }

        otherPlayerEl.setAttribute('data-player-level', getPlayerLevelTier(player.level));

        const playerInfo = document.createElement('div');
        playerInfo.className = 'character-name-overlay player-name';
        const statusIcon = player.inBattle ? ' ⚔️' : (player.isIdle ? ' 💤' : '');
        playerInfo.textContent = `${player.name} (${player.level})${statusIcon}`;
        otherPlayerEl.appendChild(playerInfo);

        const statusText = player.inBattle ? ' - In Battle' : (player.isIdle ? ' - Idle' : '');
        otherPlayerEl.title = `${player.name} (Level ${player.level})${statusText}`;
        otherPlayerEl.onclick = () => interactWithPlayer(address, player);
        worldGrid.appendChild(otherPlayerEl);
    });
    
    const player = document.createElement('div');
    player.className = 'main-player-avatar';
    player.style.left = `${gameState.player.x * 32}px`;
    player.style.top = `${gameState.player.y * 32}px`;
    player.setAttribute('data-player-level', getPlayerLevelTier(gameState.player.level));

    // Add sailing class when on water
    if (gameState.sailingMoves && gameState.sailingMoves > 0) {
        player.classList.add('sailing');
    }

    const yourName = document.createElement('div');
    yourName.className = 'character-name-overlay your-name';
    yourName.textContent = 'You';
    player.appendChild(yourName);

    player.title = `${gameState.player.name} (Level ${gameState.player.level})`;
    worldGrid.appendChild(player);

    // Boat sprite management - only one boat should exist at a time
    let boatEl = document.querySelector('.boat-sprite');

    if (gameState.sailingMoves && gameState.sailingMoves > 0) {
        // If boat doesn't exist, create it
        if (!boatEl) {
            boatEl = document.createElement('div');
            boatEl.className = 'boat-sprite';
            boatEl.style.position = 'absolute';
            boatEl.style.width = '48px';
            boatEl.style.height = '48px';
            boatEl.style.fontSize = '40px';
            boatEl.style.display = 'flex';
            boatEl.style.alignItems = 'center';
            boatEl.style.justifyContent = 'center';
            boatEl.style.zIndex = '18'; // Below player but visible
            boatEl.textContent = '⛵';
            boatEl.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
            boatEl.style.pointerEvents = 'none';
            worldGrid.appendChild(boatEl);
        }
        // Update boat position
        boatEl.style.left = `${gameState.player.x * 32 - 8}px`;
        boatEl.style.top = `${gameState.player.y * 32 - 8}px`;
    } else {
        // No sailing moves left - remove boat if it exists
        if (boatEl) {
            boatEl.remove();
        }
    }
}

// MOVEMENT SYSTEM (WITH POSITION TRACKING)

let lastPositionBroadcast = 0;
let lastPlayerAction = Date.now();
let positionHeartbeatInterval = null;
let sessionStart = Date.now();

const HEARTBEAT_INTERVAL = 120000; // 2 minutes
const IDLE_THRESHOLD = 180000; // 3 minutes

function recordPlayerActivity() {
    lastPlayerAction = Date.now();
}

function startPositionHeartbeat() {
    if (!account || !contract) return;

    positionHeartbeatInterval = setInterval(async () => {
        const now = Date.now();
        const timeSinceLastBroadcast = now - lastPositionBroadcast;
        const timeSinceActive = now - lastPlayerAction;

        if (timeSinceActive > IDLE_THRESHOLD && timeSinceLastBroadcast >= HEARTBEAT_INTERVAL) {
            // Use box storage for position updates
            await contract.updatePosition(account, gameState.player.x, gameState.player.y);
            lastPositionBroadcast = now;
        }
    }, 30000);
}

function stopPositionHeartbeat() {
    if (positionHeartbeatInterval) {
        clearInterval(positionHeartbeatInterval);
        positionHeartbeatInterval = null;
    }
}

function movePlayer(dx, dy) {
    if (gameState.inBattle) return;
    
    recordPlayerActivity();
    
    const newX = gameState.player.x + dx;
    const newY = gameState.player.y + dy;
    
    if (canMoveTo(newX, newY)) {
        gameState.player.x = newX;
        gameState.player.y = newY;

        if (!gameState.player.lastPositionUpdate) {
            gameState.player.lastPositionUpdate = 0;
        }
        
        if (account && contract) {
            const now = Date.now();
            const lastUpdate = gameState.player.lastPositionUpdate;
            
            if (now - lastUpdate >= 5000) { // 5 seconds minimum between updates
                gameState.player.lastPositionUpdate = now;
                contract.updatePosition(account, gameState.player.x, gameState.player.y, { force: true, skipLoad: true })
                    .catch(err => console.warn('Position update skipped:', err.message));
            }
        }

        gameState.player.isMoving = true;
        gameState.player.moveCount++;
        
        updatePlayerPositionOnly();
        centerCameraOnPlayerOptimized();
        checkLocationQuick();
        updatePositionDisplay();
        
        if ((gameState.player.x + gameState.player.y) % 5 === 0) {
            gameState.player.mp = Math.max(0, gameState.player.mp - 1);
            updateUI();
        }
        
        // REMOVED: Blockchain position broadcast every move (too spammy)
        // We now rely on the contract's position updates every 5 seconds
        
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

function updatePositionDisplay() {
    const posX = Math.floor(gameState.player.x);
    const posY = Math.floor(gameState.player.y);
    document.getElementById('quickInfo3').textContent = `Position: (${posX}, ${posY})`;
}

function updatePlayerPositionOnly() {
    const playerEl = document.querySelector('.main-player-avatar');
    if (playerEl) {
        playerEl.style.left = `${gameState.player.x * 32}px`;
        playerEl.style.top = `${gameState.player.y * 32}px`;

        // Update sailing class
        if (gameState.sailingMoves && gameState.sailingMoves > 0) {
            playerEl.classList.add('sailing');
        } else {
            playerEl.classList.remove('sailing');
        }

        if (gameState.player.isMoving) {
            playerEl.classList.add('walking');
            setTimeout(() => {
                if (playerEl) playerEl.classList.remove('walking');
                gameState.player.isMoving = false;
            }, 150);
        }
    }

    // Boat position update is now handled in renderPlayer()
    // This ensures single source of truth for boat management
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
    
    const visibleChunks = getVisibleChunks();
    let needsRerender = false;
    
    visibleChunks.forEach(chunk => {
        const chunkKey = getChunkKey(chunk.chunkX, chunk.chunkY);
        if (!renderedChunks.has(chunkKey)) {
            needsRerender = true;
        }
    });
    
    if (needsRerender) {
        visibleChunks.forEach(chunk => {
            renderChunk(chunk.chunkX, chunk.chunkY);
        });
        clearDistantChunks();
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
                showFloatingText('Boat sank! Rescuing...', 
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
            
            tileCache.delete(`${tileX},${tileY}`);
            
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
            
            tileCache.delete(`${tileX},${tileY}`);
            
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
    
    const shouldUseDefaultSettlements = gameState.world.metadata?.useDefaultSettlements !== false;

    if (locationName === "Wilderness" && shouldUseDefaultSettlements) {
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

// Continue in Part 3...
// CONTINUATION FROM PART 2 - MINIMAP SYSTEM

function initializeMinimap() {
    if (!worldMap || worldMap.length === 0 || !BLISS_MAP_DATA) {
        console.warn('⏳ WorldMap not ready, deferring minimap init...');
        setTimeout(() => initializeMinimap(), 500);
        return;
    }

    console.log(`🗺️ Initializing minimap for ${gameState.world.width}x${gameState.world.height} world...`);

    const minimapContent = document.getElementById('minimapContent');
    const minimapContainer = document.querySelector('.minimap');
    minimapContent.innerHTML = '';
    
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
    
    const canvas = document.createElement('canvas');
    canvas.width = contentWidth;
    canvas.height = contentHeight;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.imageRendering = 'pixelated';
    
    const ctx = canvas.getContext('2d');
    
    for (let y = 0; y < gameState.world.height; y++) {
        for (let x = 0; x < gameState.world.width; x++) {
            if (!worldMap[y] || worldMap[y][x] === undefined) {
                console.warn(`Missing tile at (${x}, ${y})`);
                continue;
            }
            
            let color = '#2d5016';
            
            switch(worldMap[y][x]) {
                case 'water': color = '#1e40af'; break;
                case 'mountain': color = '#6b7280'; break;
                case 'forest': color = '#166534'; break;
                case 'sand': color = '#eab308'; break;
                case 'snow': color = '#dbeafe'; break;
                case 'road': color = '#8b5a2b'; break;
                case 'door': color = '#92400e'; break;
                case 'grass':
                default: color = '#2d5016';
            }
            
            ctx.fillStyle = color;
            ctx.fillRect(
                Math.floor(x * scale), 
                Math.floor(y * scale), 
                Math.ceil(scale) + 1, 
                Math.ceil(scale) + 1
            );
        }
    }
    
    minimapContent.appendChild(canvas);
    
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
    
}

function updateMinimapOptimized() {
    const minimapContent = document.getElementById('minimapContent');
    const scale = parseFloat(minimapContent.dataset.scale);
    
    if (!scale) {
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
        
        if (player.isStale) {
            dot.style.opacity = '0.5';
        }
        
        dot.title = `${player.name} (Lv.${player.level})`;
        minimapContent.appendChild(dot);
    });
}

function updateMinimap() {
    updateMinimapOptimized();
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
    `;
    document.getElementById('interactionModal').style.display = 'flex';
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
                    <br><small>Cost: 20 gold</small>
                </div>
                <button class="btn btn-primary" onclick="restAtInn()">💤 Rest (20 gold)</button>
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

// Continue in Part 4 with Battle System...
// PART 4 - BATTLE SYSTEM (PvE)

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

    // Mark state as dirty so changes are saved to blockchain
    if (typeof markPlayerStateDirty === 'function') {
        markPlayerStateDirty('battle-victory');
    }

    setTimeout(() => endBattle(true), 3000);
}

function playerDefeated() {
    addBattleLog(`💀 You have been defeated!`, 'log-damage');

    gameState.player.hp = Math.floor(gameState.player.maxHp * 0.3);
    gameState.inventory.gold = Math.max(0, Math.floor(gameState.inventory.gold * 0.85));

    // Mark state as dirty so changes are saved to blockchain
    if (typeof markPlayerStateDirty === 'function') {
        markPlayerStateDirty('battle-defeat');
    }

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
    let leveledUp = false;

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

        leveledUp = true;
    }

    if (leveledUp && typeof markPlayerStateDirty === 'function') {
        markPlayerStateDirty('level-up');
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

// UI UPDATE FUNCTIONS

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
    updatePositionDisplay();
    
    document.getElementById('boatCount').textContent = gameState.inventory.boats || 0;
    document.getElementById('sailingMoves').textContent = gameState.sailingMoves || 0;
    document.getElementById('pickaxeStatus').textContent = gameState.inventory.pickaxe > 0 ? gameState.inventory.pickaxe : 'No';
}

// WALLET UI FUNCTIONS

function toggleMnemonicVisibility() {
    const input = document.getElementById('walletInput');
    const currentStyle = input.style.webkitTextSecurity;

    if (currentStyle === 'disc') {
        // Show mnemonic
        input.style.webkitTextSecurity = 'none';
        input.style.MozTextSecurity = 'none';
        input.style.textSecurity = 'none';
    } else {
        // Hide mnemonic
        input.style.webkitTextSecurity = 'disc';
        input.style.MozTextSecurity = 'disc';
        input.style.textSecurity = 'disc';
    }
}

// VISUAL EFFECTS

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

// KEYBOARD AND MOBILE CONTROLS

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
    
    if (buttons.length === 0) {
                return;
    }
    
        
    buttons.forEach(btn => {
        const dir = btn.dataset.dir;
        
        if (!dir) {
                        return;
        }
        
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.add('active');
            
            handleDirection(dir);
            
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
            
            mobileHoldIntervals[dir] = setInterval(() => {
                handleDirection(dir);
            }, 120);
            
        }, { passive: false });
        
        btn.addEventListener('touchend', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.remove('active');
            
            if (mobileHoldIntervals[dir]) {
                clearInterval(mobileHoldIntervals[dir]);
                delete mobileHoldIntervals[dir];
            }
        }, { passive: false });
        
        btn.addEventListener('touchcancel', e => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.remove('active');
            
            if (mobileHoldIntervals[dir]) {
                clearInterval(mobileHoldIntervals[dir]);
                delete mobileHoldIntervals[dir];
            }
        }, { passive: false });
        
        btn.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
        
        btn.addEventListener('mousedown', e => {
            e.preventDefault();
            btn.classList.add('active');
            handleDirection(dir);
            
            mobileHoldIntervals[dir] = setInterval(() => {
                handleDirection(dir);
            }, 120);
        });
        
        btn.addEventListener('mouseup', e => {
            e.preventDefault();
            btn.classList.remove('active');
            
            if (mobileHoldIntervals[dir]) {
                clearInterval(mobileHoldIntervals[dir]);
                delete mobileHoldIntervals[dir];
            }
        });
        
        btn.addEventListener('mouseleave', e => {
            btn.classList.remove('active');
            
            if (mobileHoldIntervals[dir]) {
                clearInterval(mobileHoldIntervals[dir]);
                delete mobileHoldIntervals[dir];
            }
        });
        
        btn.addEventListener('contextmenu', e => {
            e.preventDefault();
            return false;
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
}

// HELP SYSTEM

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

// GAME INITIALIZATION (FINAL)

window.addEventListener('load', () => {
    initGame();
    renderWorld();
    
    setTimeout(() => {
        initializeMinimap();
    }, 1000);
    
    initHelpSystem();
    
    setTimeout(() => {
        showFloatingText('Welcome to EternalBliss Algorand!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#fbbf24'
        );
        console.log('🔧 ALL FIXED:');
    }, 1000);
});

window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});



// DEBUG HELPERS

window.gameState = gameState;

window.addGold = (amount) => {
    gameState.inventory.gold += amount;
    updateUI();
};

window.addXP = (amount) => {
    gameState.player.xp += amount;
    checkLevelUp();
    updateUI();
};

window.debugTeleport = (x, y) => {
    gameState.player.x = x;
    gameState.player.y = y;
    renderWorld();
    centerCameraOnPlayer();
    checkLocation();
    if (account && contract) {
        contract.updatePosition(account, x, y, { force: true, skipLoad: true });
    }
};

window.healFull = () => {
    gameState.player.hp = gameState.player.maxHp;
    gameState.player.mp = gameState.player.maxMp;
    updateUI();
};

window.debugInfo = () => {
    console.log('Online players:', otherPlayers.size);
    console.log('PvP broadcasts:', worldPvPBroadcasts.size);
    console.log('PvP battle active:', gameState.pvp.inPvPBattle);
};

window.forcePlayerRefresh = async () => {
    await loadOtherPlayers();
    await loadPvPBroadcasts();
};
