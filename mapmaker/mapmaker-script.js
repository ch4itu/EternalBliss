// EternalBliss Map Maker

let mapData = {
    name: "Custom Map",
    width: 50,
    height: 37,
    terrain: [],
    buildings: [],
    npcs: [],
    enemies: [],
    items: [],
    areas: []
};

let editorState = {
    currentTool: 'paint',
    selectedTerrain: 'grass',
    selectedBuilding: 'house',
    selectedNPC: 'villager',
    selectedEnemy: 'goblin',
    selectedItem: 'gold',
    brushSize: 1,
    isMouseDown: false,
    isPanning: false,
    panStart: {x: 0, y: 0},
    cameraX: 0,
    cameraY: 0,
    showGrid: true,
    showAreas: true,
    areaDrawing: false,
    areaStartPos: null
};

function initMapMaker() {
    initializeMap();
    setupEventListeners();
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus('Map Maker Ready');
}

function initializeMap() {
    mapData.terrain = [];
    mapData.buildings = [];
    mapData.npcs = [];
    mapData.enemies = [];
    mapData.items = [];
    mapData.areas = [];
    
    for (let y = 0; y < mapData.height; y++) {
        mapData.terrain[y] = [];
        for (let x = 0; x < mapData.width; x++) {
            mapData.terrain[y][x] = 'grass';
        }
    }
}

function setupEventListeners() {
    const canvasView = document.getElementById('canvasView');
    
    canvasView.addEventListener('mousedown', handleMouseDown);
    canvasView.addEventListener('mousemove', handleMouseMove);
    canvasView.addEventListener('mouseup', handleMouseUp);
    canvasView.addEventListener('mouseleave', handleMouseUp);
    canvasView.addEventListener('contextmenu', handleRightClick);
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => selectTool(btn.dataset.tool));
    });
    
    document.querySelectorAll('[data-terrain]').forEach(item => {
        item.addEventListener('click', () => selectTerrain(item.dataset.terrain));
    });
    
    document.querySelectorAll('[data-building]').forEach(item => {
        item.addEventListener('click', () => selectBuilding(item.dataset.building));
    });

    document.querySelectorAll('[data-npc]').forEach(item => {
        item.addEventListener('click', () => selectNPC(item.dataset.npc));
    });

    document.querySelectorAll('[data-enemy]').forEach(item => {
        item.addEventListener('click', () => selectEnemy(item.dataset.enemy));
    });
    
    document.querySelectorAll('[data-item]').forEach(item => {
        item.addEventListener('click', () => selectItem(item.dataset.item));
    });

    document.querySelectorAll('[data-size]').forEach(btn => {
        btn.addEventListener('click', () => selectBrushSize(parseInt(btn.dataset.size)));
    });
    
    document.getElementById('showGrid').addEventListener('change', (e) => {
        editorState.showGrid = e.target.checked;
        renderCanvas();
    });

    document.getElementById('showAreas').addEventListener('change', (e) => {
        editorState.showAreas = e.target.checked;
        renderCanvas();
    });
    
    document.addEventListener('keydown', handleKeyboard);
}

function handleRightClick(e) {
    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    eraseTile(coords.x, coords.y);
}

function handleMouseDown(e) {
    e.preventDefault();
    editorState.isMouseDown = true;
    
    const coords = getCanvasCoordinates(e);
    
    if (editorState.currentTool === 'pan') {
        editorState.isPanning = true;
        editorState.panStart = {x: e.clientX, y: e.clientY};
        document.getElementById('canvasView').style.cursor = 'grabbing';
    } else if (editorState.currentTool === 'area') {
        editorState.areaDrawing = true;
        editorState.areaStartPos = coords;
        updateStatus(`Drawing area from (${coords.x}, ${coords.y})`);
    } else {
        performAction(coords.x, coords.y);
    }
}

function handleMouseMove(e) {
    const coords = getCanvasCoordinates(e);
    document.getElementById('coordinates').textContent = `X: ${coords.x}, Y: ${coords.y}`;
    
    if (editorState.isPanning && editorState.isMouseDown) {
        const deltaX = e.clientX - editorState.panStart.x;
        const deltaY = e.clientY - editorState.panStart.y;
        
        editorState.cameraX += deltaX;
        editorState.cameraY += deltaY;
        
        editorState.panStart = {x: e.clientX, y: e.clientY};
        updateCameraPosition();
    } else if (editorState.areaDrawing && editorState.areaStartPos) {
        // Show preview of area being drawn
        const startX = Math.min(editorState.areaStartPos.x, coords.x);
        const startY = Math.min(editorState.areaStartPos.y, coords.y);
        const endX = Math.max(editorState.areaStartPos.x, coords.x);
        const endY = Math.max(editorState.areaStartPos.y, coords.y);
        updateStatus(`Area: (${startX}, ${startY}) to (${endX}, ${endY})`);
    } else if (editorState.isMouseDown && editorState.currentTool !== 'pan' && editorState.currentTool !== 'area') {
        performAction(coords.x, coords.y);
    }
}

function handleMouseUp(e) {
    if (editorState.areaDrawing && editorState.areaStartPos) {
        const coords = getCanvasCoordinates(e);
        createArea(editorState.areaStartPos, coords);
        editorState.areaDrawing = false;
        editorState.areaStartPos = null;
    }
    
    editorState.isMouseDown = false;
    editorState.isPanning = false;
    document.getElementById('canvasView').style.cursor = editorState.currentTool === 'pan' ? 'grab' : 'crosshair';
}

function getCanvasCoordinates(e) {
    const canvasView = document.getElementById('canvasView');
    const rect = canvasView.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - editorState.cameraX) / 32);
    const y = Math.floor((e.clientY - rect.top - editorState.cameraY) / 32);
    return {x, y};
}

function createArea(startPos, endPos) {
    const startX = Math.min(startPos.x, endPos.x);
    const startY = Math.min(startPos.y, endPos.y);
    const endX = Math.max(startPos.x, endPos.x);
    const endY = Math.max(startPos.y, endPos.y);
    
    const width = endX - startX + 1;
    const height = endY - startY + 1;
    
    if (width < 2 || height < 2) {
        updateStatus('Area too small (minimum 2x2)');
        return;
    }
    
    const areaName = prompt('Enter area name:', `Area ${mapData.areas.length + 1}`);
    if (!areaName) return;
    
    const area = {
        id: Date.now(),
        name: areaName,
        x: startX,
        y: startY,
        width: width,
        height: height,
        color: getRandomAreaColor(),
        description: ''
    };
    
    mapData.areas.push(area);
    renderCanvas();
    updateStats();
    updateStatus(`Created area "${areaName}" at (${startX}, ${startY})`);
}

function getRandomAreaColor() {
    const colors = [
        'rgba(59, 130, 246, 0.3)',   // Blue
        'rgba(16, 185, 129, 0.3)',   // Green
        'rgba(251, 191, 36, 0.3)',   // Yellow
        'rgba(139, 92, 246, 0.3)',   // Purple
        'rgba(236, 72, 153, 0.3)',   // Pink
        'rgba(245, 101, 101, 0.3)',  // Red
        'rgba(52, 211, 153, 0.3)',   // Teal
        'rgba(251, 146, 60, 0.3)'    // Orange
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function performAction(x, y) {
    if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) return;
    
    switch (editorState.currentTool) {
        case 'paint':
            paintTerrain(x, y);
            break;
        case 'building':
            placeBuilding(x, y);
            break;
        case 'npc':
            placeNPC(x, y);
            break;
        case 'enemy':
            placeEnemy(x, y);
            break;
        case 'item':
            placeItem(x, y);
            break;
        case 'erase':
            eraseTile(x, y);
            break;
        case 'fill':
            fillArea(x, y);
            break;
    }
}
function paintTerrain(centerX, centerY) {
    const size = editorState.brushSize;
    const radius = Math.floor(size / 2);
    
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const x = centerX + dx;
            const y = centerY + dy;
            
            if (x >= 0 && x < mapData.width && y >= 0 && y < mapData.height) {
                if (size === 1 || Math.sqrt(dx*dx + dy*dy) <= radius) {
                    mapData.terrain[y][x] = editorState.selectedTerrain;
                }
            }
        }
    }
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Painted ${editorState.selectedTerrain} at (${centerX}, ${centerY})`);
}

function placeBuilding(x, y) {
    mapData.buildings = mapData.buildings.filter(b => !(b.x === x && b.y === y));
    
    const buildingData = {
        x: x,
        y: y,
        type: editorState.selectedBuilding,
        name: `${editorState.selectedBuilding.charAt(0).toUpperCase() + editorState.selectedBuilding.slice(1)} at (${x}, ${y})`,
        class: `building ${editorState.selectedBuilding}`
    };
    
    mapData.buildings.push(buildingData);
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Placed ${editorState.selectedBuilding} at (${x}, ${y})`);
}

function placeNPC(x, y) {
    mapData.npcs = mapData.npcs.filter(n => !(n.x === x && n.y === y));
    
    const npcTypes = {
        villager: {
            name: 'Villager',
            class: 'npc npc-villager',
            dialogue: 'Hello there, traveler! Welcome to our village.'
        },
        merchant: {
            name: 'Merchant',
            class: 'npc npc-merchant',
            dialogue: 'Welcome to my shop! I have the finest goods in the realm.'
        },
        priest: {
            name: 'Priest',
            class: 'npc npc-priest',
            dialogue: 'May the light guide your path, brave adventurer.'
        },
        elder: {
            name: 'Elder',
            class: 'npc npc-elder',
            dialogue: 'I have seen many seasons pass. Let me share my wisdom.'
        },
        guard: {
            name: 'Guard',
            class: 'npc npc-guard',
            dialogue: 'Halt! State your business in these lands.'
        }
    };
    
    const npcType = npcTypes[editorState.selectedNPC] || npcTypes.villager;
    
    const npcData = {
        x: x,
        y: y,
        name: `${npcType.name} ${Math.floor(Math.random() * 1000)}`,
        class: npcType.class,
        dialogue: npcType.dialogue
    };
    
    mapData.npcs.push(npcData);
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Placed ${npcType.name} at (${x}, ${y})`);
}

function placeEnemy(x, y) {
    mapData.enemies = mapData.enemies.filter(e => !(e.x === x && e.y === y));
    
    const enemyTypes = {
        goblin: {
            name: 'Goblin',
            class: 'enemy-spawn enemy-goblin',
            hp: 30,
            maxHp: 30,
            attack: 8,
            xpReward: 20,
            goldReward: 12
        },
        wolf: {
            name: 'Wolf',
            class: 'enemy-spawn enemy-wolf',
            hp: 45,
            maxHp: 45,
            attack: 12,
            xpReward: 30,
            goldReward: 18
        },
        dragon: {
            name: 'Dragon',
            class: 'enemy-spawn enemy-dragon',
            hp: 100,
            maxHp: 100,
            attack: 25,
            xpReward: 75,
            goldReward: 50
        },
        orc: {
            name: 'Orc',
            class: 'enemy-spawn enemy-orc',
            hp: 60,
            maxHp: 60,
            attack: 15,
            xpReward: 40,
            goldReward: 25
        },
        skeleton: {
            name: 'Skeleton',
            class: 'enemy-spawn enemy-skeleton',
            hp: 25,
            maxHp: 25,
            attack: 10,
            xpReward: 15,
            goldReward: 10
        }
    };
    
    const enemyType = enemyTypes[editorState.selectedEnemy] || enemyTypes.goblin;
    
    const enemyData = {
        x: x,
        y: y,
        name: `${enemyType.name} ${Math.floor(Math.random() * 1000)}`,
        class: enemyType.class,
        hp: enemyType.hp,
        maxHp: enemyType.maxHp,
        attack: enemyType.attack,
        xpReward: enemyType.xpReward,
        goldReward: enemyType.goldReward
    };
    
    mapData.enemies.push(enemyData);
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Placed ${enemyType.name} at (${x}, ${y})`);
}

function placeItem(x, y) {
    // Remove existing item at this position
    mapData.items = mapData.items.filter(i => !(i.x === x && i.y === y));
    
    const itemTypes = {
        gold: {
            type: 'gold',
            value: 50,
            class: 'item-drop'
        },
        health_potion: {
            type: 'health_potion',
            value: 1,
            class: 'item-drop health-potion'
        },
        mana_potion: {
            type: 'mana_potion',
            value: 1,
            class: 'item-drop mana-potion'
        },
        key: {
            type: 'key',
            value: 1,
            class: 'item-drop key'
        },
        treasure: {
            type: 'treasure',
            value: 100,
            class: 'item-drop treasure'
        }
    };
    
    const itemType = itemTypes[editorState.selectedItem] || itemTypes.gold;
    
    const itemData = {
        x: x,
        y: y,
        type: itemType.type,
        value: itemType.value,
        class: itemType.class
    };
    
    mapData.items.push(itemData);
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Placed ${itemType.type.replace('_', ' ')} at (${x}, ${y})`);
}

function eraseTile(x, y) {
    mapData.terrain[y][x] = 'grass';
    mapData.buildings = mapData.buildings.filter(b => !(b.x === x && b.y === y));
    mapData.npcs = mapData.npcs.filter(n => !(n.x === x && n.y === y));
    mapData.enemies = mapData.enemies.filter(e => !(e.x === x && e.y === y));
    mapData.items = mapData.items.filter(i => !(i.x === x && i.y === y));
    
    // Check if clicking on an area
    const area = mapData.areas.find(a => 
        x >= a.x && x < a.x + a.width && 
        y >= a.y && y < a.y + a.height
    );
    
    if (area && confirm(`Delete area "${area.name}"?`)) {
        mapData.areas = mapData.areas.filter(a => a.id !== area.id);
    }
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Erased tile at (${x}, ${y})`);
}

function fillArea(startX, startY) {
    const targetTerrain = mapData.terrain[startY][startX];
    const newTerrain = editorState.selectedTerrain;
    
    if (targetTerrain === newTerrain) return;
    
    const stack = [{x: startX, y: startY}];
    const visited = new Set();
    
    while (stack.length > 0) {
        const {x, y} = stack.pop();
        const key = `${x},${y}`;
        
        if (visited.has(key)) continue;
        if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) continue;
        if (mapData.terrain[y][x] !== targetTerrain) continue;
        
        visited.add(key);
        mapData.terrain[y][x] = newTerrain;
        
        stack.push({x: x + 1, y: y});
        stack.push({x: x - 1, y: y});
        stack.push({x: x, y: y + 1});
        stack.push({x: x, y: y - 1});
    }
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Filled area with ${newTerrain} from (${startX}, ${startY})`);
}

function selectTool(tool) {
    editorState.currentTool = tool;
    
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    
    const canvasView = document.getElementById('canvasView');
    if (tool === 'pan') {
        canvasView.style.cursor = 'grab';
    } else if (tool === 'area') {
        canvasView.style.cursor = 'crosshair';
    } else {
        canvasView.style.cursor = 'crosshair';
    }
    
    updateStatus(`Selected ${tool} tool`);
}

function selectTerrain(terrain) {
    editorState.selectedTerrain = terrain;
    
    document.querySelectorAll('[data-terrain]').forEach(item => {
        item.classList.toggle('active', item.dataset.terrain === terrain);
    });
    
    updateStatus(`Selected ${terrain} terrain`);
}

function selectBuilding(building) {
    editorState.selectedBuilding = building;
    
    document.querySelectorAll('[data-building]').forEach(item => {
        item.classList.toggle('active', item.dataset.building === building);
    });
    
    updateStatus(`Selected ${building} building`);
}

function selectNPC(npc) {
    editorState.selectedNPC = npc;
    
    document.querySelectorAll('[data-npc]').forEach(item => {
        item.classList.toggle('active', item.dataset.npc === npc);
    });
    
    updateStatus(`Selected ${npc} NPC`);
}

function selectEnemy(enemy) {
    editorState.selectedEnemy = enemy;
    
    document.querySelectorAll('[data-enemy]').forEach(item => {
        item.classList.toggle('active', item.dataset.enemy === enemy);
    });
    
    updateStatus(`Selected ${enemy} enemy`);
}

function selectItem(item) {
    editorState.selectedItem = item;
    
    document.querySelectorAll('[data-item]').forEach(itemEl => {
        itemEl.classList.toggle('active', itemEl.dataset.item === item);
    });
    
    updateStatus(`Selected ${item.replace('_', ' ')} item`);
}

function selectBrushSize(size) {
    editorState.brushSize = size;
    
    document.querySelectorAll('[data-size]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
    });
    
    updateStatus(`Brush size: ${size}x${size}`);
}

function updateCameraPosition() {
    const canvasGrid = document.getElementById('canvasGrid');
    canvasGrid.style.transform = `translate3d(${editorState.cameraX}px, ${editorState.cameraY}px, 0)`;
}

function renderCanvas() {
    const canvasGrid = document.getElementById('canvasGrid');
    canvasGrid.innerHTML = '';
    
    canvasGrid.style.width = `${mapData.width * 32}px`;
    canvasGrid.style.height = `${mapData.height * 32}px`;
    
    // Render terrain
    for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
            const tile = document.createElement('div');
            tile.className = `tile ${mapData.terrain[y][x]}`;
            tile.style.left = `${x * 32}px`;
            tile.style.top = `${y * 32}px`;
            
            if (!editorState.showGrid) {
                tile.style.border = 'none';
            }
            
            canvasGrid.appendChild(tile);
        }
    }
    
    // Render areas (behind everything else)
    if (editorState.showAreas) {
        mapData.areas.forEach(area => {
            const areaEl = document.createElement('div');
            areaEl.className = 'area-zone';
            areaEl.style.position = 'absolute';
            areaEl.style.left = `${area.x * 32}px`;
            areaEl.style.top = `${area.y * 32}px`;
            areaEl.style.width = `${area.width * 32}px`;
            areaEl.style.height = `${area.height * 32}px`;
            areaEl.style.background = area.color;
            areaEl.style.border = '2px solid ' + area.color.replace('0.3', '1');
            areaEl.style.borderRadius = '8px';
            areaEl.style.pointerEvents = 'none';
            areaEl.style.zIndex = '1';
            
            // Area label
            const label = document.createElement('div');
            label.className = 'area-label';
            label.textContent = area.name;
            label.style.position = 'absolute';
            label.style.top = '4px';
            label.style.left = '8px';
            label.style.background = 'rgba(0, 0, 0, 0.7)';
            label.style.color = 'white';
            label.style.padding = '2px 6px';
            label.style.borderRadius = '4px';
            label.style.fontSize = '11px';
            label.style.fontWeight = 'bold';
            label.style.pointerEvents = 'auto';
            label.style.cursor = 'pointer';
            label.onclick = () => editArea(area);
            
            areaEl.appendChild(label);
            canvasGrid.appendChild(areaEl);
        });
    }
    
    // Render buildings
    mapData.buildings.forEach(building => {
        const buildingEl = document.createElement('div');
        buildingEl.className = `building ${building.type}`;
        buildingEl.style.left = `${building.x * 32}px`;
        buildingEl.style.top = `${building.y * 32}px`;
        buildingEl.title = building.name;
        buildingEl.onclick = (e) => {
            e.stopPropagation();
            editObject('building', building);
        };
        canvasGrid.appendChild(buildingEl);
    });
    
    // Render NPCs
    mapData.npcs.forEach(npc => {
        const npcEl = document.createElement('div');
        npcEl.className = 'npc-avatar';
        npcEl.style.left = `${npc.x * 32}px`;
        npcEl.style.top = `${npc.y * 32}px`;
        npcEl.style.width = '32px';
        npcEl.style.height = '32px';
        npcEl.style.background = 'linear-gradient(135deg, #4a7c59, #3d6b47)';
        npcEl.style.border = '2px solid #5d936c';
        npcEl.style.borderRadius = '50%';
        npcEl.style.display = 'flex';
        npcEl.style.alignItems = 'center';
        npcEl.style.justifyContent = 'center';
        npcEl.style.fontSize = '16px';
        npcEl.style.cursor = 'pointer';
        npcEl.style.transition = 'transform 0.2s ease';
        npcEl.innerHTML = getNPCEmoji(editorState.selectedNPC);
        npcEl.title = `${npc.name} - ${npc.dialogue.substring(0, 50)}...`;
        npcEl.onclick = (e) => {
            e.stopPropagation();
            editObject('npc', npc);
        };
        npcEl.onmouseenter = () => npcEl.style.transform = 'scale(1.1)';
        npcEl.onmouseleave = () => npcEl.style.transform = 'scale(1)';
        canvasGrid.appendChild(npcEl);
    });
    
    // Render enemies
    mapData.enemies.forEach(enemy => {
        const enemyEl = document.createElement('div');
        enemyEl.className = 'enemy-avatar';
        enemyEl.style.left = `${enemy.x * 32}px`;
        enemyEl.style.top = `${enemy.y * 32}px`;
        enemyEl.style.width = '32px';
        enemyEl.style.height = '32px';
        enemyEl.style.background = 'linear-gradient(135deg, #dc2626, #991b1b)';
        enemyEl.style.border = '2px solid #ef4444';
        enemyEl.style.borderRadius = '50%';
        enemyEl.style.display = 'flex';
        enemyEl.style.alignItems = 'center';
        enemyEl.style.justifyContent = 'center';
        enemyEl.style.fontSize = '16px';
        enemyEl.style.cursor = 'pointer';
        enemyEl.style.transition = 'transform 0.2s ease';
        enemyEl.style.animation = 'enemyPulse 2s ease-in-out infinite';
        
        const enemyEmojis = {
            goblin: '👹',
            wolf: '🐺', 
            dragon: '🐉',
            orc: '👺',
            skeleton: '💀'
        };
        enemyEl.innerHTML = enemyEmojis[enemy.class.split('-').pop()] || '👹';
        
        enemyEl.title = `${enemy.name} - HP: ${enemy.hp}/${enemy.maxHp}, Attack: ${enemy.attack}`;
        enemyEl.onclick = (e) => {
            e.stopPropagation();
            editObject('enemy', enemy);
        };
        enemyEl.onmouseenter = () => enemyEl.style.transform = 'scale(1.1)';
        enemyEl.onmouseleave = () => enemyEl.style.transform = 'scale(1)';
        canvasGrid.appendChild(enemyEl);
    });

// Render items
mapData.items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'item-drop';
    itemEl.style.position = 'absolute';  // ADD THIS LINE
    itemEl.style.left = `${item.x * 32 + 4}px`;
    itemEl.style.top = `${item.y * 32 + 4}px`;
    itemEl.style.width = '24px';
    itemEl.style.height = '24px';
        itemEl.style.background = 'radial-gradient(circle at 50% 30%, #fbbf24 30%, #f59e0b 60%, #d97706 100%)';
        itemEl.style.border = '3px solid #92400e';
        itemEl.style.borderRadius = '50%';
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'center';
        itemEl.style.fontSize = '14px';
        itemEl.style.cursor = 'pointer';
        itemEl.style.transition = 'transform 0.2s ease';
        itemEl.style.animation = 'itemSparkle 2s ease-in-out infinite';
        itemEl.style.zIndex = '12';
        
        const itemEmojis = {
            gold: '💰',
            health_potion: '🧪',
            mana_potion: '🔮',
            key: '🗝️',
            treasure: '📦'
        };
        itemEl.innerHTML = itemEmojis[item.type] || '💰';
        
        itemEl.title = `${item.type.replace('_', ' ')} - Value: ${item.value}`;
        itemEl.onclick = (e) => {
            e.stopPropagation();
            editObject('item', item);
        };
        itemEl.onmouseenter = () => itemEl.style.transform = 'scale(1.15)';
        itemEl.onmouseleave = () => itemEl.style.transform = 'scale(1)';
        canvasGrid.appendChild(itemEl);
    });
}



function getNPCEmoji(npcType) {
    const emojis = {
        villager: '🧑',
        merchant: '🛒',
        priest: '⛪',
        elder: '👴',
        guard: '🛡️'
    };
    return emojis[npcType] || '🧑';
}

function editArea(area) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 2000; font-family: 'Courier New', monospace;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                    border: 4px solid #3d5a80; border-radius: 16px; padding: 28px;
                    max-width: 400px; width: 90%; color: white;">
            <h4>Edit Area</h4>
            <label>Name:</label>
            <input type="text" id="editAreaName" value="${area.name}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Description:</label>
            <textarea id="editAreaDescription" style="width: 100%; margin: 8px 0; padding: 4px; height: 60px;">${area.description || ''}</textarea>
            <label>Color:</label>
            <input type="color" id="editAreaColor" value="${area.color.replace('rgba(', '#').replace(', 0.3)', '').replace(/(\d+), (\d+), (\d+)/, (m, r, g, b) => 
                '#' + parseInt(r).toString(16).padStart(2, '0') + 
                      parseInt(g).toString(16).padStart(2, '0') + 
                      parseInt(b).toString(16).padStart(2, '0')
            )}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button onclick="saveAreaEdit(this)" style="flex: 1; padding: 10px; background: #10b981; border: none; border-radius: 6px; color: white; cursor: pointer;">Save</button>
                <button onclick="deleteArea(${area.id}); this.closest('.area-modal').remove();" style="flex: 1; padding: 10px; background: #dc2626; border: none; border-radius: 6px; color: white; cursor: pointer;">Delete</button>
                <button onclick="this.closest('.area-modal').remove()" style="flex: 1; padding: 10px; background: #6b7280; border: none; border-radius: 6px; color: white; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;
    
    modal.className = 'area-modal';
    modal.areaData = area;
    document.body.appendChild(modal);
}

function saveAreaEdit(button) {
    const modal = button.closest('.area-modal');
    const area = modal.areaData;
    
    area.name = document.getElementById('editAreaName').value;
    area.description = document.getElementById('editAreaDescription').value;
    const colorHex = document.getElementById('editAreaColor').value;
    
    // Convert hex to rgba
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    area.color = `rgba(${r}, ${g}, ${b}, 0.3)`;
    
    renderCanvas();
    updateStats();
    modal.remove();
    updateStatus(`Updated area "${area.name}"`);
}

function deleteArea(areaId) {
    mapData.areas = mapData.areas.filter(a => a.id !== areaId);
    renderCanvas();
    updateStats();
    updateStatus('Area deleted');
}

function editObject(type, obj) {
    let content = '';
    
    if (type === 'building') {
        content = `
            <h4>Edit Building</h4>
            <label>Name:</label>
            <input type="text" id="editName" value="${obj.name}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Type:</label>
            <select id="editType" style="width: 100%; margin: 8px 0; padding: 4px;">
                <option value="house" ${obj.type === 'house' ? 'selected' : ''}>House</option>
                <option value="shop" ${obj.type === 'shop' ? 'selected' : ''}>Shop</option>
                <option value="inn" ${obj.type === 'inn' ? 'selected' : ''}>Inn</option>
                <option value="temple" ${obj.type === 'temple' ? 'selected' : ''}>Temple</option>
                <option value="castle" ${obj.type === 'castle' ? 'selected' : ''}>Castle</option>
            </select>
        `;
    } else if (type === 'npc') {
        content = `
            <h4>Edit NPC</h4>
            <label>Name:</label>
            <input type="text" id="editName" value="${obj.name}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Dialogue:</label>
            <textarea id="editDialogue" style="width: 100%; margin: 8px 0; padding: 4px; height: 60px;">${obj.dialogue}</textarea>
            <label>Type:</label>
            <select id="editNPCType" style="width: 100%; margin: 8px 0; padding: 4px;">
                <option value="villager" ${obj.class.includes('villager') ? 'selected' : ''}>Villager</option>
                <option value="merchant" ${obj.class.includes('merchant') ? 'selected' : ''}>Merchant</option>
                <option value="priest" ${obj.class.includes('priest') ? 'selected' : ''}>Priest</option>
                <option value="elder" ${obj.class.includes('elder') ? 'selected' : ''}>Elder</option>
                <option value="guard" ${obj.class.includes('guard') ? 'selected' : ''}>Guard</option>
            </select>
        `;
    } else if (type === 'enemy') {
        content = `
            <h4>Edit Enemy</h4>
            <label>Name:</label>
            <input type="text" id="editName" value="${obj.name}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>HP:</label>
            <input type="number" id="editHP" value="${obj.hp}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Max HP:</label>
            <input type="number" id="editMaxHP" value="${obj.maxHp}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Attack:</label>
            <input type="number" id="editAttack" value="${obj.attack}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>XP Reward:</label>
            <input type="number" id="editXPReward" value="${obj.xpReward}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Gold Reward:</label>
            <input type="number" id="editGoldReward" value="${obj.goldReward}" style="width: 100%; margin: 8px 0; padding: 4px;">
            <label>Type:</label>
            <select id="editEnemyType" style="width: 100%; margin: 8px 0; padding: 4px;">
                <option value="goblin" ${obj.class.includes('goblin') ? 'selected' : ''}>Goblin</option>
                <option value="wolf" ${obj.class.includes('wolf') ? 'selected' : ''}>Wolf</option>
                <option value="dragon" ${obj.class.includes('dragon') ? 'selected' : ''}>Dragon</option>
                <option value="orc" ${obj.class.includes('orc') ? 'selected' : ''}>Orc</option>
                <option value="skeleton" ${obj.class.includes('skeleton') ? 'selected' : ''}>Skeleton</option>
            </select>
        `;
    } else if (type === 'item') {
        content = `
            <h4>Edit Item</h4>
            <label>Type:</label>
            <select id="editItemType" style="width: 100%; margin: 8px 0; padding: 4px;">
                <option value="gold" ${obj.type === 'gold' ? 'selected' : ''}>Gold</option>
                <option value="health_potion" ${obj.type === 'health_potion' ? 'selected' : ''}>Health Potion</option>
                <option value="mana_potion" ${obj.type === 'mana_potion' ? 'selected' : ''}>Mana Potion</option>
                <option value="key" ${obj.type === 'key' ? 'selected' : ''}>Key</option>
                <option value="treasure" ${obj.type === 'treasure' ? 'selected' : ''}>Treasure</option>
            </select>
            <label>Value:</label>
            <input type="number" id="editValue" value="${obj.value}" style="width: 100%; margin: 8px 0; padding: 4px;">
        `;
    }

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 2000; font-family: 'Courier New', monospace;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                    border: 4px solid #3d5a80; border-radius: 16px; padding: 28px;
                    max-width: 400px; width: 90%; color: white;">
            ${content}
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button onclick="saveEdit('${type}', this)" style="flex: 1; padding: 10px; background: #10b981; border: none; border-radius: 6px; color: white; cursor: pointer;">Save</button>
                <button onclick="deleteObject('${type}', ${obj.x}, ${obj.y}); this.closest('.edit-modal').remove();" style="flex: 1; padding: 10px; background: #dc2626; border: none; border-radius: 6px; color: white; cursor: pointer;">Delete</button>
                <button onclick="this.closest('.edit-modal').remove()" style="flex: 1; padding: 10px; background: #6b7280; border: none; border-radius: 6px; color: white; cursor: pointer;">Cancel</button>
            </div>
        </div>
    `;
    
    modal.className = 'edit-modal';
    modal.objectData = obj;
    modal.objectType = type;
    
    document.body.appendChild(modal);
}

function saveEdit(type, button) {
    const modal = button.closest('.edit-modal');
    const obj = modal.objectData;
    
    if (type === 'building') {
        obj.name = document.getElementById('editName').value;
        obj.type = document.getElementById('editType').value;
        obj.class = `building ${obj.type}`;
    } else if (type === 'npc') {
        obj.name = document.getElementById('editName').value;
        obj.dialogue = document.getElementById('editDialogue').value;
        const npcType = document.getElementById('editNPCType').value;
        obj.class = `npc npc-${npcType}`;
    } else if (type === 'enemy') {
        obj.name = document.getElementById('editName').value;
        obj.hp = parseInt(document.getElementById('editHP').value);
        obj.maxHp = parseInt(document.getElementById('editMaxHP').value);
        obj.attack = parseInt(document.getElementById('editAttack').value);
        obj.xpReward = parseInt(document.getElementById('editXPReward').value);
        obj.goldReward = parseInt(document.getElementById('editGoldReward').value);
        const enemyType = document.getElementById('editEnemyType').value;
        obj.class = `enemy-spawn enemy-${enemyType}`;
    } else if (type === 'item') {
        obj.type = document.getElementById('editItemType').value;
        obj.value = parseInt(document.getElementById('editValue').value);
    }
    
    renderCanvas();
    updateStats();
    modal.remove();
    updateStatus(`Updated ${type}`);
}

function deleteObject(type, x, y) {
    if (type === 'building') {
        mapData.buildings = mapData.buildings.filter(b => !(b.x === x && b.y === y));
    } else if (type === 'npc') {
        mapData.npcs = mapData.npcs.filter(n => !(n.x === x && n.y === y));
    } else if (type === 'enemy') {
        mapData.enemies = mapData.enemies.filter(e => !(e.x === x && e.y === y));
    } else if (type === 'item') {
        mapData.items = mapData.items.filter(i => !(i.x === x && i.y === y));
    }
    
    renderCanvas();
    updateStats();
    updateStatus(`Deleted ${type} at (${x}, ${y})`);
}

function updateMinimap() {
    const minimapContent = document.getElementById('minimapContent');
    minimapContent.innerHTML = '';
    
    const scaleX = 260 / mapData.width;
    const scaleY = 180 / mapData.height;
    const scale = Math.min(scaleX, scaleY);
    
    minimapContent.style.transform = `scale(${scale})`;
    minimapContent.style.width = `${mapData.width}px`;
    minimapContent.style.height = `${mapData.height}px`;
    
    // Terrain
    for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
            const pixel = document.createElement('div');
            pixel.style.position = 'absolute';
            pixel.style.left = `${x}px`;
            pixel.style.top = `${y}px`;
            pixel.style.width = '1px';
            pixel.style.height = '1px';
            pixel.style.backgroundColor = getTerrainColor(mapData.terrain[y][x]);
            minimapContent.appendChild(pixel);
        }
    }
    
    // Areas
    mapData.areas.forEach(area => {
        const areaEl = document.createElement('div');
        areaEl.style.position = 'absolute';
        areaEl.style.left = `${area.x}px`;
        areaEl.style.top = `${area.y}px`;
        areaEl.style.width = `${area.width}px`;
        areaEl.style.height = `${area.height}px`;
        areaEl.style.border = '1px solid ' + area.color.replace('0.3', '0.8');
        areaEl.style.background = area.color.replace('0.3', '0.2');
        minimapContent.appendChild(areaEl);
    });
    
    // Buildings
    mapData.buildings.forEach(building => {
        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.left = `${building.x}px`;
        dot.style.top = `${building.y}px`;
        dot.style.width = '2px';
        dot.style.height = '2px';
        dot.style.backgroundColor = '#fbbf24';
        dot.style.borderRadius = '50%';
        minimapContent.appendChild(dot);
    });
    
    // NPCs
    mapData.npcs.forEach(npc => {
        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.left = `${npc.x}px`;
        dot.style.top = `${npc.y}px`;
        dot.style.width = '2px';
        dot.style.height = '2px';
        dot.style.backgroundColor = '#10b981';
        dot.style.borderRadius = '50%';
        minimapContent.appendChild(dot);
    });
    
    // Enemies
    mapData.enemies.forEach(enemy => {
        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.left = `${enemy.x}px`;
        dot.style.top = `${enemy.y}px`;
        dot.style.width = '2px';
        dot.style.height = '2px';
        dot.style.backgroundColor = '#dc2626';
        dot.style.borderRadius = '50%';
        minimapContent.appendChild(dot);
    });

    // Items
    mapData.items.forEach(item => {
        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.left = `${item.x}px`;
        dot.style.top = `${item.y}px`;
        dot.style.width = '2px';
        dot.style.height = '2px';
        dot.style.backgroundColor = '#fbbf24';
        dot.style.borderRadius = '50%';
        minimapContent.appendChild(dot);
    });
}

function getTerrainColor(terrain) {
    const colors = {
        grass: '#2d5016',
        water: '#1e40af',
        mountain: '#9ca3af',
        forest: '#166534',
        road: '#8b5a2b',
        sand: '#eab308',
        door: '#92400e'
    };
    return colors[terrain] || '#2d5016';
}

function updateStats() {
    const totalTiles = mapData.width * mapData.height;
    const terrainCounts = {};
    
    for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
            const terrain = mapData.terrain[y][x];
            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;
        }
    }
    
    document.getElementById('tileCount').textContent = totalTiles;
    document.getElementById('buildingCount').textContent = mapData.buildings.length;
    document.getElementById('terrainTypes').textContent = Object.keys(terrainCounts).length;
    
    const npcCountEl = document.getElementById('npcCount');
    const enemyCountEl = document.getElementById('enemyCount');
    const itemCountEl = document.getElementById('itemCount');
    const areaCountEl = document.getElementById('areaCount');
    if (npcCountEl) npcCountEl.textContent = mapData.npcs.length;
    if (enemyCountEl) enemyCountEl.textContent = mapData.enemies.length;
    if (itemCountEl) itemCountEl.textContent = mapData.items.length;
    if (areaCountEl) areaCountEl.textContent = mapData.areas.length;
}

function updateStatus(message) {
    document.getElementById('status').textContent = message;
    document.getElementById('lastAction').textContent = message;
}

function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key) {
        case '1': selectTool('paint'); break;
        case '2': selectTool('building'); break;
        case '3': selectTool('npc'); break;
        case '4': selectTool('enemy'); break;
        case '5': selectTool('item'); break;
        case '6': selectTool('erase'); break;
        case '7': selectTool('pan'); break;
        case '8': selectTool('fill'); break;
        case '9': selectTool('area'); break;
        case 'g': case 'G': toggleGrid(); break;
        case 'a': case 'A': toggleAreas(); break;
        case ' ': e.preventDefault(); centerView(); break;
        case 'r': case 'R': generateRandom(); break;
        case 'c': case 'C': clearMap(); break;
        case 'e': case 'E': exportMap(); break;
        case 'Escape': closeModal(); break;
    }
}

function toggleGrid() {
    const checkbox = document.getElementById('showGrid');
    checkbox.checked = !checkbox.checked;
    editorState.showGrid = checkbox.checked;
    renderCanvas();
}

function toggleAreas() {
    const checkbox = document.getElementById('showAreas');
    checkbox.checked = !checkbox.checked;
    editorState.showAreas = checkbox.checked;
    renderCanvas();
}

function centerView() {
    editorState.cameraX = 0;
    editorState.cameraY = 0;
    updateCameraPosition();
    updateStatus('View centered');
}

function resizeMap() {
    const newWidth = parseInt(document.getElementById('mapWidth').value);
    const newHeight = parseInt(document.getElementById('mapHeight').value);
    
    if (newWidth < 10 || newWidth > 200 || newHeight < 10 || newHeight > 150) {
        alert('Invalid map size! Width: 10-200, Height: 10-150');
        return;
    }
    
    const oldTerrain = mapData.terrain;
    mapData.terrain = [];
    
    for (let y = 0; y < newHeight; y++) {
        mapData.terrain[y] = [];
        for (let x = 0; x < newWidth; x++) {
            if (y < oldTerrain.length && x < oldTerrain[0].length) {
                mapData.terrain[y][x] = oldTerrain[y][x];
            } else {
                mapData.terrain[y][x] = 'grass';
            }
        }
    }
    
    mapData.buildings = mapData.buildings.filter(b => b.x < newWidth && b.y < newHeight);
    mapData.npcs = mapData.npcs.filter(n => n.x < newWidth && n.y < newHeight);
    mapData.enemies = mapData.enemies.filter(e => e.x < newWidth && e.y < newHeight);
    mapData.items = mapData.items.filter(i => i.x < newWidth && i.y < newHeight);
    mapData.areas = mapData.areas.filter(a => a.x + a.width <= newWidth && a.y + a.height <= newHeight);
    
    mapData.width = newWidth;
    mapData.height = newHeight;
    
    renderCanvas();
    updateMinimap();
    updateStats();
    updateStatus(`Map resized to ${newWidth}x${newHeight}`);
}

function clearMap() {
    if (confirm('Clear all terrain, buildings, NPCs, enemies and areas? This cannot be undone.')) {
        initializeMap();
        renderCanvas();
        updateMinimap();
        updateStats();
        updateStatus('Map cleared');
    }
}

function generateRandom() {
    if (confirm('Generate a random map? This will replace current content.')) {
        const terrainTypes = ['grass', 'water', 'mountain', 'forest', 'road', 'sand'];
        
        for (let y = 0; y < mapData.height; y++) {
            for (let x = 0; x < mapData.width; x++) {
                if (Math.random() < 0.7) {
                    mapData.terrain[y][x] = 'grass';
                } else {
                    mapData.terrain[y][x] = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];
                }
            }
        }
        
        mapData.buildings = [];
        mapData.npcs = [];
        mapData.enemies = [];
        mapData.items = [];
        mapData.areas = [];
        
        // Generate areas
        const areaNames = ['Village Center', 'Dark Forest', 'Mountain Pass', 'Coastal Region', 'Desert Wasteland'];
        const numAreas = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < numAreas; i++) {
            const x = Math.floor(Math.random() * (mapData.width - 10));
            const y = Math.floor(Math.random() * (mapData.height - 10));
            const width = Math.floor(Math.random() * 10) + 8;
            const height = Math.floor(Math.random() * 8) + 6;
            
            mapData.areas.push({
                id: Date.now() + i,
                name: areaNames[i % areaNames.length],
                x: x, y: y,
                width: width, height: height,
                color: getRandomAreaColor(),
                description: `Randomly generated area ${i + 1}`
            });
        }
        
        const buildingTypes = ['house', 'shop', 'inn', 'temple'];
        const npcTypes = ['villager', 'merchant', 'priest', 'elder', 'guard'];
        const enemyTypes = ['goblin', 'wolf', 'dragon', 'orc', 'skeleton'];
        
        const numBuildings = Math.floor(Math.random() * 10) + 5;
        for (let i = 0; i < numBuildings; i++) {
            const x = Math.floor(Math.random() * mapData.width);
            const y = Math.floor(Math.random() * mapData.height);
            const type = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
            
            mapData.buildings.push({
                x: x, y: y, type: type,
                name: `Random ${type} at (${x}, ${y})`,
                class: `building ${type}`
            });
        }
        
        const numNPCs = Math.floor(Math.random() * 8) + 3;
        for (let i = 0; i < numNPCs; i++) {
            const x = Math.floor(Math.random() * mapData.width);
            const y = Math.floor(Math.random() * mapData.height);
            const type = npcTypes[Math.floor(Math.random() * npcTypes.length)];
            
            mapData.npcs.push({
                x: x, y: y,
                name: `Random ${type} ${Math.floor(Math.random() * 1000)}`,
                class: `npc npc-${type}`,
                dialogue: `Hello, I am a ${type}! Welcome to our realm.`
            });
        }
        
        const numEnemies = Math.floor(Math.random() * 12) + 5;
        for (let i = 0; i < numEnemies; i++) {
            const x = Math.floor(Math.random() * mapData.width);
            const y = Math.floor(Math.random() * mapData.height);
            const type = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
            
            const baseStats = {
                goblin: {hp: 30, attack: 8, xp: 20, gold: 12},
                wolf: {hp: 45, attack: 12, xp: 30, gold: 18},
                dragon: {hp: 100, attack: 25, xp: 75, gold: 50},
                orc: {hp: 60, attack: 15, xp: 40, gold: 25},
                skeleton: {hp: 25, attack: 10, xp: 15, gold: 10}
            };
            
            const stats = baseStats[type];
            mapData.enemies.push({
                x: x, y: y,
                name: `${type} ${Math.floor(Math.random() * 1000)}`,
                class: `enemy-spawn enemy-${type}`,
                hp: stats.hp, maxHp: stats.hp,
                attack: stats.attack,
                xpReward: stats.xp,
                goldReward: stats.gold
            });
        }
        
        // Generate items (OUTSIDE the enemies loop!)
        const itemTypes = ['gold', 'health_potion', 'mana_potion', 'key', 'treasure'];
        const numItems = Math.floor(Math.random() * 15) + 8;
        for (let i = 0; i < numItems; i++) {
            const x = Math.floor(Math.random() * mapData.width);
            const y = Math.floor(Math.random() * mapData.height);
            const type = itemTypes[Math.floor(Math.random() * itemTypes.length)];
            
            const baseValues = {
                gold: 50,
                health_potion: 1,
                mana_potion: 1,
                key: 1,
                treasure: 100
            };
            
            mapData.items.push({
                x: x, y: y,
                type: type,
                value: baseValues[type],
                class: 'item-drop'
            });
        }
        
        renderCanvas();
        updateMinimap();
        updateStats();
        updateStatus('Random map with areas and items generated');
    }
}

function exportMap() {
    mapData.name = document.getElementById('mapName').value || 'Custom Map';
    
    const exportData = {
    name: mapData.name,
    width: mapData.width,
    height: mapData.height,
    terrain: mapData.terrain,
    buildings: mapData.buildings,
    npcs: mapData.npcs,
    enemies: mapData.enemies,
    items: mapData.items,  // <-- ADD THIS LINE
    areas: mapData.areas,
    metadata: {
        created: new Date().toISOString(),
        version: '1.2',
        creator: 'EternalBliss Map Maker Enhanced with Areas and Items'
    }
};
    
    document.getElementById('exportOutput').textContent = JSON.stringify(exportData, null, 2);
    document.getElementById('exportModal').style.display = 'flex';
    updateStatus('Map exported with all entities and areas');
}

function exportCode() {
    const terrainCode = `// Terrain Map\nconst customTerrain = ${JSON.stringify(mapData.terrain, null, 2)};`;
    const buildingsCode = `\n\n// Buildings\nconst customBuildings = ${JSON.stringify(mapData.buildings, null, 2)};`;
    const npcsCode = `\n\n// NPCs\nconst customNPCs = ${JSON.stringify(mapData.npcs, null, 2)};`;
    const enemiesCode = `\n\n// Enemies\nconst customEnemies = ${JSON.stringify(mapData.enemies, null, 2)};`;
    const itemsCode = `\n\n// Items\nconst customItems = ${JSON.stringify(mapData.items, null, 2)};`;  // ADD THIS
    const areasCode = `\n\n// Areas/Zones\nconst customAreas = ${JSON.stringify(mapData.areas, null, 2)};`;
    
    const integrationCode = `\n\n// Integration Code\n// Replace the generateWorld() function with:\nfunction generateWorld() {\n    worldMap = customTerrain;\n    gameState.world.width = ${mapData.width};\n    gameState.world.height = ${mapData.height};\n    gameState.world.areas = customAreas;\n}\n\n// Replace the createBuildings() function with:\nfunction createBuildings() {\n    buildings = customBuildings;\n}\n\n// Replace the createNPCs() function with:\nfunction createNPCs() {\n    npcs = customNPCs;\n}\n\n// Replace the createEnemies() function with:\nfunction createEnemies() {\n    enemies = customEnemies;\n}\n\n// Replace the createItems() function with:\nfunction createItems() {\n    items = customItems;\n}\n\n// Add area detection function:\nfunction getAreaAtPosition(x, y) {\n    return customAreas.find(area => \n        x >= area.x && x < area.x + area.width &&\n        y >= area.y && y < area.y + area.height\n    );\n}`;
    
    const fullCode = terrainCode + buildingsCode + npcsCode + enemiesCode + itemsCode + areasCode + integrationCode;  // ADD itemsCode here
    
    document.getElementById('exportOutput').textContent = fullCode;
    document.getElementById('exportModal').style.display = 'flex';
    updateStatus('Game code exported with all entities, items and areas');
}

function showImportModal() {
    document.getElementById('importModal').style.display = 'flex';
}

function importMap() {
    try {
        const importText = document.getElementById('importData').value.trim();
        const importedData = JSON.parse(importText);
        
        if (!importedData.terrain || !importedData.width || !importedData.height) {
            throw new Error('Invalid map data structure');
        }
        
        mapData.name = importedData.name || 'Imported Map';
        mapData.width = importedData.width;
        mapData.height = importedData.height;
        mapData.terrain = importedData.terrain;
        mapData.buildings = importedData.buildings || [];
        mapData.npcs = importedData.npcs || [];
        mapData.enemies = importedData.enemies || [];
        mapData.items = importedData.items || [];
        mapData.areas = importedData.areas || [];
        
        document.getElementById('mapName').value = mapData.name;
        document.getElementById('mapWidth').value = mapData.width;
        document.getElementById('mapHeight').value = mapData.height;
        
        renderCanvas();
        updateMinimap();
        updateStats();
        closeModal();
        updateStatus('Map imported successfully with all entities');
        
    } catch (error) {
        alert('Error importing map: ' + error.message);
        updateStatus('Import failed');
    }
}

function copyToClipboard() {
    const output = document.getElementById('exportOutput');
    const textArea = document.createElement('textarea');
    textArea.value = output.textContent;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    updateStatus('Copied to clipboard');
}

function closeModal() {
    document.getElementById('exportModal').style.display = 'none';
    document.getElementById('importModal').style.display = 'none';
}

let autoSaveInterval;
function startAutoSave() {
    if (typeof Storage === "undefined" || !localStorage) {
        console.log('localStorage not available, auto-save disabled');
        return;
    }
    
    autoSaveInterval = setInterval(() => {
        try {
            const autoSaveData = {
                mapData: mapData,
                editorState: {
                    currentTool: editorState.currentTool,
                    selectedTerrain: editorState.selectedTerrain,
                    selectedBuilding: editorState.selectedBuilding,
                    selectedNPC: editorState.selectedNPC,
                    selectedEnemy: editorState.selectedEnemy,
                    brushSize: editorState.brushSize,
                    showAreas: editorState.showAreas
                }
            };
            localStorage.setItem('EternalBliss_mapmaker_autosave', JSON.stringify(autoSaveData));
        } catch (error) {
            console.log('Auto-save failed:', error.message);
        }
    }, 30000);
}

function loadAutoSave() {
    try {
        if (typeof Storage === "undefined" || !localStorage) {
            console.log('localStorage not available, skipping auto-save');
            return false;
        }
        
        const savedData = localStorage.getItem('EternalBliss_mapmaker_autosave');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            mapData = parsed.mapData;
            
            if (parsed.editorState) {
                selectTool(parsed.editorState.currentTool);
                selectTerrain(parsed.editorState.selectedTerrain);
                selectBuilding(parsed.editorState.selectedBuilding);
                selectNPC(parsed.editorState.selectedNPC || 'villager');
                selectEnemy(parsed.editorState.selectedEnemy || 'goblin');
                selectBrushSize(parsed.editorState.brushSize);
                editorState.showAreas = parsed.editorState.showAreas !== false;
                document.getElementById('showAreas').checked = editorState.showAreas;
            }
            
            document.getElementById('mapName').value = mapData.name;
            document.getElementById('mapWidth').value = mapData.width;
            document.getElementById('mapHeight').value = mapData.height;
            
            renderCanvas();
            updateMinimap();
            updateStats();
            updateStatus('Auto-save restored');
            return true;
        }
    } catch (error) {
        console.log('Auto-save not available:', error.message);
    }
    return false;
}

function clearAutoSave() {
    try {
        if (typeof Storage !== "undefined" && localStorage) {
            localStorage.removeItem('EternalBliss_mapmaker_autosave');
            updateStatus('Auto-save data cleared');
        } else {
            updateStatus('localStorage not available');
        }
    } catch (error) {
        updateStatus('Failed to clear auto-save: ' + error.message);
    }
}

window.addEventListener('load', () => {
    if (!loadAutoSave()) {
        initMapMaker();
    } else {
        renderCanvas();
        updateMinimap();
        updateStats();
    }
    
    startAutoSave();
    
    console.log('🎨 EternalBliss Map Maker Enhanced Ready!');
    console.log('');
    console.log('🎯 FEATURES:');
    console.log('   • Terrain Painting');
    console.log('   • Building Placement');
    console.log('   • NPC Creation');
    console.log('   • Enemy Placement');
    console.log('   • Area/Zone Definition');
    console.log('');
    console.log('🎮 CONTROLS:');
    console.log('   • 1-8: Select tools');
    console.log('   • Left Click: Place/Paint');
    console.log('   • Right Click: Quick erase');
    console.log('   • Click entities to edit');
    console.log('   • Drag for areas');
    console.log('');
    console.log('🗺️ AREA TOOL:');
    console.log('   • Select Area tool (8)');
    console.log('   • Click and drag to define area');
    console.log('   • Click area labels to edit');
    console.log('   • Toggle with "A" key');
    console.log('');
    console.log('Ready to create complete game worlds! 🌟');
});

window.addEventListener('beforeunload', () => {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
});

window.clearAutoSave = clearAutoSave;
window.mapData = mapData;
window.editorState = editorState;
