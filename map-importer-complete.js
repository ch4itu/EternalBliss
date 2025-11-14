// EternalBliss Map Importer Plugin


let currentMapData = null;

function initMapImporter() {
    document.getElementById('mapImporterTrigger').addEventListener('click', openImporter);
    
    document.querySelectorAll('.import-tab').forEach(tab => {
        tab.addEventListener('click', switchTab);
    });

    document.getElementById('mapImporterOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeImporter();
    });
}

function openImporter() {
    document.getElementById('mapImporterOverlay').style.display = 'flex';
    clearImporterState();
}

function closeImporter() {
    document.getElementById('mapImporterOverlay').style.display = 'none';
}

function switchTab(e) {
    const tabName = e.target.dataset.tab;
    
    document.querySelectorAll('.import-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    e.target.classList.add('active');

    document.querySelectorAll('.import-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(tabName + 'Section').classList.add('active');
    
    clearImporterState();
}

function clearImporterState() {
    currentMapData = null;
    document.getElementById('importButton').disabled = true;
    document.getElementById('importStatus').style.display = 'none';
}

function validateJsonMap() {
    const jsonText = document.getElementById('jsonInput').value.trim();
    
    if (!jsonText) {
        showStatus('Please enter JSON data', 'error');
        return false;
    }

    try {
        const mapData = JSON.parse(jsonText);
        
        const errors = [];
        
        if (!mapData.terrain) errors.push('Missing terrain data');
        if (!mapData.width || mapData.width < 10) errors.push('Invalid or missing width (min: 10)');
        if (!mapData.height || mapData.height < 10) errors.push('Invalid or missing height (min: 10)');
        
        if (mapData.terrain && (!Array.isArray(mapData.terrain) || mapData.terrain.length !== mapData.height)) {
            errors.push('Terrain array height mismatch');
        }
        
        if (mapData.terrain && mapData.terrain.length > 0 && mapData.terrain[0].length !== mapData.width) {
            errors.push('Terrain array width mismatch');
        }
        
        if (mapData.buildings && !Array.isArray(mapData.buildings)) errors.push('Buildings must be an array');
        if (mapData.npcs && !Array.isArray(mapData.npcs)) errors.push('NPCs must be an array');
        if (mapData.enemies && !Array.isArray(mapData.enemies)) errors.push('Enemies must be an array');
        if (mapData.items && !Array.isArray(mapData.items)) errors.push('Items must be an array');
        if (mapData.areas && !Array.isArray(mapData.areas)) errors.push('Areas must be an array');
        
        if (errors.length > 0) {
            throw new Error(errors.join(', '));
        }
        
        currentMapData = mapData;
        document.getElementById('importButton').disabled = false;
        showStatus('✅ Map validation successful! Ready to import.', 'success');
        return true;
        
    } catch (error) {
        showStatus('❌ Invalid JSON: ' + error.message, 'error');
        currentMapData = null;
        document.getElementById('importButton').disabled = true;
        return false;
    }
}

function loadPresetMap(presetName) {
    const presets = {
        starter_village: generateStarterVillage(),
        large_city: generateLargeCity(),
        dungeon: generateDungeon(),
        forest_temple: generateForestTemple(),
        desert_oasis: generateDesertOasis(),
        mountain_fortress: generateMountainFortress(),
        swamp_ruins: generateSwampRuins(),
        coastal_port: generateCoastalPort()
    };
    
    currentMapData = presets[presetName];
    document.getElementById('importButton').disabled = false;
    showStatus(`Loaded ${currentMapData.name} preset!`, 'success');
}

// ============================================
// REALISTIC TERRAIN GENERATION UTILITIES
// ============================================

// Perlin-like noise for organic terrain
function generateNoiseMap(width, height, scale = 10, octaves = 4) {
    const noise = [];
    for (let y = 0; y < height; y++) {
        noise[y] = [];
        for (let x = 0; x < width; x++) {
            let value = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxValue = 0;
            
            for (let i = 0; i < octaves; i++) {
                const sampleX = x / scale * frequency;
                const sampleY = y / scale * frequency;
                const noiseValue = Math.sin(sampleX) * Math.cos(sampleY);
                value += noiseValue * amplitude;
                maxValue += amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }
            
            noise[y][x] = value / maxValue;
        }
    }
    return noise;
}

// Create organic paths between points
function createPath(grid, startX, startY, endX, endY, terrain = 'road', width = 1) {
    let x = startX;
    let y = startY;
    
    while (x !== endX || y !== endY) {
        // Mark current position
        for (let dy = -width; dy <= width; dy++) {
            for (let dx = -width; dx <= width; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
                    grid[ny][nx] = terrain;
                }
            }
        }
        
        // Move towards target with some randomness
        const diffX = endX - x;
        const diffY = endY - y;
        
        if (Math.abs(diffX) > Math.abs(diffY)) {
            x += Math.sign(diffX);
            if (Math.random() < 0.3 && diffY !== 0) y += Math.sign(diffY);
        } else {
            y += Math.sign(diffY);
            if (Math.random() < 0.3 && diffX !== 0) x += Math.sign(diffX);
        }
    }
}

// Create natural water features
function createRiver(grid, startX, startY, length, direction = 'vertical') {
    let x = startX;
    let y = startY;
    
    for (let i = 0; i < length; i++) {
        // River is 2-4 tiles wide
        const riverWidth = 1 + Math.floor(Math.random() * 2);
        
        for (let dy = -riverWidth; dy <= riverWidth; dy++) {
            for (let dx = -riverWidth; dx <= riverWidth; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
                    if (Math.abs(dx) + Math.abs(dy) <= riverWidth) {
                        grid[ny][nx] = 'water';
                    }
                }
            }
        }
        
        // Meander naturally
        if (direction === 'vertical') {
            y++;
            if (Math.random() < 0.4) x += Math.random() < 0.5 ? 1 : -1;
        } else {
            x++;
            if (Math.random() < 0.4) y += Math.random() < 0.5 ? 1 : -1;
        }
        
        if (x < 2) x = 2;
        if (x >= grid[0].length - 2) x = grid[0].length - 3;
        if (y < 2) y = 2;
        if (y >= grid.length - 2) y = grid.length - 3;
    }
}

// Create forest clusters
function createForest(grid, centerX, centerY, radius, density = 0.7) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= radius) {
                const nx = centerX + dx;
                const ny = centerY + dy;
                if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
                    // Denser in center, sparser at edges
                    const edgeFactor = 1 - (distance / radius);
                    if (Math.random() < density * edgeFactor) {
                        if (grid[ny][nx] === 'grass') {
                            grid[ny][nx] = 'forest';
                        }
                    }
                }
            }
        }
    }
}

// ============================================
// REALISTIC PRESET GENERATORS
// ============================================

function generateStarterVillage() {
    const width = 45;
    const height = 40;
    const grid = [];
    
    // Initialize with grass
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    // Create natural river on the west side
    createRiver(grid, 8, 0, 25, 'vertical');
    
    // Create forest clusters around the edges
    createForest(grid, 5, 10, 5, 0.8);
    createForest(grid, 38, 8, 6, 0.75);
    createForest(grid, 40, 30, 7, 0.8);
    createForest(grid, 3, 35, 5, 0.7);
    
    // Create main road through village (east-west)
    for (let x = 12; x < 40; x++) {
        grid[20][x] = 'road';
        if (x > 15 && x < 35) {
            grid[19][x] = 'road';
            grid[21][x] = 'road';
        }
    }
    
    // Create north-south connector road
    for (let y = 10; y < 32; y++) {
        grid[y][25] = 'road';
        if (y > 15 && y < 28) {
            grid[y][24] = 'road';
            grid[y][26] = 'road';
        }
    }
    
    // Small pond in the village square
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 3) {
                grid[15 + dy][30 + dx] = 'water';
            }
        }
    }
    
    // Farm fields (replace some grass with lighter areas)
    for (let y = 25; y < 35; y++) {
        for (let x = 15; x < 22; x++) {
            if (grid[y][x] === 'grass' && Math.random() < 0.7) {
                grid[y][x] = 'grass'; // Keep as grass but represents farmland
            }
        }
    }
    
    return {
        name: "Greenleaf Village",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            // Village center
            {x: 23, y: 16, type: 'inn', name: 'The Weary Traveler Inn', class: 'building house inn'},
            {x: 28, y: 16, type: 'shop', name: 'General Store', class: 'building house shop'},
            {x: 27, y: 12, type: 'temple', name: 'Village Chapel', class: 'building temple'},
            
            // Residential area (north)
            {x: 18, y: 11, type: 'house', name: 'Miller\'s House', class: 'building house'},
            {x: 22, y: 11, type: 'house', name: 'Farmer Brown\'s Home', class: 'building house'},
            {x: 32, y: 11, type: 'house', name: 'Elder\'s Cottage', class: 'building house'},
            {x: 35, y: 13, type: 'house', name: 'Blacksmith Forge', class: 'building house'},
            
            // Residential area (south)
            {x: 18, y: 25, type: 'house', name: 'Carpenter\'s Workshop', class: 'building house'},
            {x: 22, y: 26, type: 'house', name: 'Tanner\'s House', class: 'building house'},
            {x: 30, y: 25, type: 'house', name: 'Baker\'s Home', class: 'building house'},
            {x: 34, y: 26, type: 'house', name: 'Herbalist Hut', class: 'building house'},
            
            // Farm buildings
            {x: 17, y: 30, type: 'house', name: 'Barn', class: 'building house'},
            {x: 20, y: 32, type: 'house', name: 'Windmill', class: 'building house'}
        ],
        npcs: [
            {x: 24, y: 17, name: 'Innkeeper Martha', class: 'npc npc-villager', dialogue: 'Welcome to Greenleaf! We don\'t get many travelers this far from the city.'},
            {x: 29, y: 17, name: 'Shopkeeper Thomas', class: 'npc npc-merchant', dialogue: 'Fresh supplies just arrived from Port Algorand! Best prices you\'ll find.'},
            {x: 28, y: 13, name: 'Father Benedict', class: 'npc npc-priest', dialogue: 'The chapel doors are always open. May you find peace here, traveler.'},
            {x: 33, y: 12, name: 'Village Elder Morgan', class: 'npc npc-elder', dialogue: 'Welcome, young one. Greenleaf has stood for three generations. We\'re a humble but proud folk.'},
            {x: 36, y: 14, name: 'Blacksmith Greta', class: 'npc npc-villager', dialogue: 'Need your blade sharpened? I learned my craft in the capital forges.'},
            {x: 19, y: 12, name: 'Miller Jack', class: 'npc npc-villager', dialogue: 'The wheat harvest this year is the best we\'ve seen in a decade!'},
            {x: 23, y: 27, name: 'Tanner William', class: 'npc npc-villager', dialogue: 'I work the finest leather in the region. It\'s honest work.'},
            {x: 31, y: 26, name: 'Baker Sarah', class: 'npc npc-villager', dialogue: 'Bread fresh from the oven! The smell alone is worth a visit.'},
            {x: 35, y: 27, name: 'Herbalist Elara', class: 'npc npc-villager', dialogue: 'Herbs from the forest can cure many ailments. Nature provides for those who know where to look.'},
            {x: 18, y: 31, name: 'Farmer Brown', class: 'npc npc-villager', dialogue: 'The land is good to us here. Rich soil and clean water from the river.'},
            {x: 27, y: 20, name: 'Village Guard', class: 'npc npc-villager', dialogue: 'Stay on the roads after dark. Wolves have been spotted near the forest.'},
            {x: 12, y: 8, name: 'Fisherman Pete', class: 'npc npc-villager', dialogue: 'The river provides plenty of fish. Been fishing here for forty years!'}
        ],
        enemies: [
            // Forest threats (west & north)
            {x: 5, y: 12, name: 'Forest Wolf', class: 'enemy-spawn enemy-wolf', hp: 35, maxHp: 35, attack: 10, xpReward: 25, goldReward: 18},
            {x: 7, y: 8, name: 'Wild Boar', class: 'enemy-spawn enemy-wolf', hp: 28, maxHp: 28, attack: 8, xpReward: 18, goldReward: 12},
            {x: 42, y: 10, name: 'Rabid Wolf', class: 'enemy-spawn enemy-wolf', hp: 32, maxHp: 32, attack: 9, xpReward: 22, goldReward: 16},
            
            // South/east outskirts
            {x: 40, y: 32, name: 'Goblin Scout', class: 'enemy-spawn enemy-goblin', hp: 30, maxHp: 30, attack: 8, xpReward: 20, goldReward: 15},
            {x: 5, y: 37, name: 'Swamp Slime', class: 'enemy-spawn enemy-goblin', hp: 22, maxHp: 22, attack: 6, xpReward: 14, goldReward: 10},
            {x: 38, y: 5, name: 'Giant Rat', class: 'enemy-spawn enemy-goblin', hp: 18, maxHp: 18, attack: 5, xpReward: 12, goldReward: 8},
            
            // Near roads (bandits)
            {x: 42, y: 20, name: 'Bandit Thug', class: 'enemy-spawn enemy-goblin', hp: 38, maxHp: 38, attack: 11, xpReward: 28, goldReward: 22},
            {x: 12, y: 25, name: 'Highway Robber', class: 'enemy-spawn enemy-goblin', hp: 35, maxHp: 35, attack: 10, xpReward: 24, goldReward: 20}
        ],
        items: [
            {x: 10, y: 5, type: 'health_potion', value: 1},
            {x: 32, y: 8, type: 'gold', value: 35},
            {x: 41, y: 28, type: 'gold', value: 45},
            {x: 6, y: 32, type: 'mana_potion', value: 1},
            {x: 15, y: 15, type: 'gold', value: 25},
            {x: 38, y: 18, type: 'key', value: 1},
            {x: 13, y: 38, type: 'treasure', value: 80},
            {x: 42, y: 7, type: 'gold', value: 30}
        ],
        areas: [
            {id: 1, name: 'Greenleaf Village Center', x: 20, y: 14, width: 18, height: 14, color: 'rgba(16, 185, 129, 0.3)', description: 'The heart of the peaceful village'},
            {id: 2, name: 'Farm District', x: 14, y: 28, width: 12, height: 10, color: 'rgba(251, 191, 36, 0.2)', description: 'Fertile farmlands'},
            {id: 3, name: 'Western Woods', x: 0, y: 5, width: 12, height: 20, color: 'rgba(34, 197, 94, 0.3)', description: 'Dense forest'}
        ]
    };
}

function generateLargeCity() {
    const width = 60;
    const height = 50;
    const grid = [];
    
    // Initialize base terrain
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    // Major roads - realistic street grid
    // Main avenue (horizontal, wider)
    for (let x = 5; x < 55; x++) {
        for (let dy = -1; dy <= 1; dy++) {
            grid[25 + dy][x] = 'road';
        }
    }
    
    // Secondary avenue (horizontal)
    for (let x = 5; x < 55; x++) {
        grid[15][x] = 'road';
        grid[35][x] = 'road';
    }
    
    // Vertical streets
    for (let y = 5; y < 45; y++) {
        grid[y][15] = 'road';
        grid[y][30] = 'road';
        grid[y][45] = 'road';
    }
    
    // Small cross streets
    for (let x = 5; x < 55; x++) {
        if (x % 10 === 0) {
            for (let y = 15; y < 35; y++) {
                grid[y][x] = 'road';
            }
        }
    }
    
    // Harbor water (southern area)
    for (let y = 42; y < height; y++) {
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'water';
        }
    }
    
    // Docks (extend into water)
    for (let x = 12; x < 18; x++) {
        for (let y = 40; y < 44; y++) {
            grid[y][x] = 'road';
        }
    }
    for (let x = 28; x < 34; x++) {
        for (let y = 40; y < 44; y++) {
            grid[y][x] = 'road';
        }
    }
    for (let x = 44; x < 50; x++) {
        for (let y = 40; y < 44; y++) {
            grid[y][x] = 'road';
        }
    }
    
    // City park (central)
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 5) {
                grid[25 + dy][30 + dx] = 'grass';
                if (Math.random() < 0.3) {
                    grid[25 + dy][30 + dx] = 'forest';
                }
            }
        }
    }
    
    // Fountain in park center
    grid[30][30] = 'water';
    grid[30][29] = 'water';
    grid[30][31] = 'water';
    grid[29][30] = 'water';
    grid[31][30] = 'water';
    
    return {
        name: "Port Algorand",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            // Government district (north-central)
            {x: 28, y: 10, type: 'castle', name: 'City Hall', class: 'building castle'},
            {x: 25, y: 17, type: 'temple', name: 'Grand Cathedral', class: 'building temple'},
            
            // Market district (center-west)
            {x: 10, y: 24, type: 'shop', name: 'Algorand Exchange', class: 'building house shop'},
            {x: 14, y: 24, type: 'shop', name: 'Weapon & Armor Shop', class: 'building house shop'},
            {x: 10, y: 28, type: 'shop', name: 'Potions & Herbs', class: 'building house shop'},
            {x: 14, y: 28, type: 'shop', name: 'Magic Items Emporium', class: 'building house shop'},
            
            // Residential (north)
            {x: 8, y: 12, type: 'house', name: 'Noble Manor', class: 'building house'},
            {x: 12, y: 12, type: 'house', name: 'Merchant\'s Estate', class: 'building house'},
            {x: 18, y: 12, type: 'house', name: 'Townhouse', class: 'building house'},
            {x: 22, y: 12, type: 'house', name: 'Apartment Block', class: 'building house'},
            
            // Entertainment district (center)
            {x: 18, y: 24, type: 'inn', name: 'The Golden Anchor Inn', class: 'building house inn'},
            {x: 22, y: 24, type: 'inn', name: 'Sailor\'s Rest Tavern', class: 'building house inn'},
            
            // Warehouse district (south)
            {x: 8, y: 38, type: 'house', name: 'Warehouse Alpha', class: 'building house'},
            {x: 16, y: 38, type: 'house', name: 'Warehouse Beta', class: 'building house'},
            {x: 24, y: 38, type: 'house', name: 'Trading House', class: 'building house'},
            
            // Eastern district
            {x: 40, y: 18, type: 'house', name: 'Guild Hall', class: 'building house'},
            {x: 48, y: 18, type: 'shop', name: 'Boat Supplies', class: 'building house shop'},
            {x: 40, y: 24, type: 'house', name: 'Craftsmen Quarter', class: 'building house'},
            {x: 48, y: 24, type: 'inn', name: 'Dockside Inn', class: 'building house inn'},
            
            // Southern port
            {x: 32, y: 38, type: 'house', name: 'Harbor Master Office', class: 'building house'},
            {x: 46, y: 38, type: 'house', name: 'Customs House', class: 'building house'}
        ],
        npcs: [
            {x: 29, y: 11, name: 'Mayor Aldrich Blackwood', class: 'npc npc-elder', dialogue: 'Port Algorand is the economic heart of the realm. Welcome, traveler!'},
            {x: 26, y: 18, name: 'Archbishop Celeste', class: 'npc npc-priest', dialogue: 'The cathedral has stood for 200 years. It is a beacon of hope.'},
            {x: 11, y: 25, name: 'Exchange Master Felix', class: 'npc npc-merchant', dialogue: 'ALGO to gold, gold to ALGO. Best rates on the continent!'},
            {x: 15, y: 25, name: 'Armorer Marcus', class: 'npc npc-merchant', dialogue: 'Steel forged in dragon fire! Only the finest equipment here.'},
            {x: 11, y: 29, name: 'Herbalist Lydia', class: 'npc npc-merchant', dialogue: 'Potions brewed from rare herbs. Each one guaranteed effective!'},
            {x: 15, y: 29, name: 'Mage Artificer Zephyr', class: 'npc npc-merchant', dialogue: 'Enchanted items of considerable power. For serious adventurers only.'},
            {x: 19, y: 25, name: 'Innkeeper Rosa', class: 'npc npc-villager', dialogue: 'The Golden Anchor - finest rooms in the city! Musicians play nightly.'},
            {x: 23, y: 25, name: 'Tavern Owner Björn', class: 'npc npc-villager', dialogue: 'Ales from every port! Come in, warm yourself by the fire.'},
            {x: 41, y: 19, name: 'Guild Master Helena', class: 'npc npc-elder', dialogue: 'The Adventurer\'s Guild takes only the bravest. Prove yourself worthy!'},
            {x: 49, y: 19, name: 'Ship Chandler', class: 'npc npc-merchant', dialogue: 'Boats, sails, ropes - everything needed for seafaring!'},
            {x: 33, y: 39, name: 'Harbor Master Dimitri', class: 'npc npc-elder', dialogue: 'Ships arrive daily from across the seas. Port never sleeps!'},
            {x: 47, y: 39, name: 'Customs Officer', class: 'npc npc-villager', dialogue: 'All cargo must be declared. No contraband in MY port!'},
            {x: 30, y: 26, name: 'Street Performer', class: 'npc npc-villager', dialogue: 'Spare a coin for a song? I know tales from every land!'},
            {x: 16, y: 16, name: 'City Guard Captain', class: 'npc npc-elder', dialogue: 'The guard keeps the peace. Report any criminal activity immediately.'},
            {x: 8, y: 20, name: 'Street Vendor', class: 'npc npc-villager', dialogue: 'Fresh fish! Caught this morning from the bay!'}
        ],
        enemies: [
            // Docks and warehouse district (thieves, smugglers)
            {x: 10, y: 40, name: 'Dock Thug', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 13, xpReward: 32, goldReward: 26},
            {x: 20, y: 40, name: 'Smuggler', class: 'enemy-spawn enemy-goblin', hp: 45, maxHp: 45, attack: 12, xpReward: 30, goldReward: 24},
            {x: 28, y: 41, name: 'Pirate Deserter', class: 'enemy-spawn enemy-goblin', hp: 52, maxHp: 52, attack: 14, xpReward: 35, goldReward: 28},
            
            // Back alleys
            {x: 8, y: 32, name: 'Cutpurse', class: 'enemy-spawn enemy-goblin', hp: 42, maxHp: 42, attack: 11, xpReward: 28, goldReward: 22},
            {x: 52, y: 28, name: 'Street Thug', class: 'enemy-spawn enemy-goblin', hp: 46, maxHp: 46, attack: 12, xpReward: 30, goldReward: 24},
            
            // Eastern outskirts
            {x: 55, y: 12, name: 'Bandit Leader', class: 'enemy-spawn enemy-goblin', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32},
            {x: 55, y: 32, name: 'Highwayman', class: 'enemy-spawn enemy-goblin', hp: 50, maxHp: 50, attack: 14, xpReward: 34, goldReward: 27},
            
            // Northern district
            {x: 5, y: 8, name: 'Corrupt Guard', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            
            // Random encounters
            {x: 35, y: 8, name: 'Assassin', class: 'enemy-spawn enemy-goblin', hp: 60, maxHp: 60, attack: 17, xpReward: 45, goldReward: 35}
        ],
        items: [
            {x: 12, y: 42, type: 'gold', value: 60},
            {x: 26, y: 20, type: 'health_potion', value: 2},
            {x: 50, y: 14, type: 'gold', value: 75},
            {x: 6, y: 26, type: 'mana_potion', value: 2},
            {x: 42, y: 30, type: 'key', value: 2},
            {x: 54, y: 6, type: 'treasure', value: 150},
            {x: 18, y: 42, type: 'gold', value: 80},
            {x: 38, y: 12, type: 'health_potion', value: 1},
            {x: 52, y: 36, type: 'gold', value: 90}
        ],
        areas: [
            {id: 1, name: 'Government Quarter', x: 22, y: 8, width: 16, height: 12, color: 'rgba(251, 191, 36, 0.3)', description: 'Seat of power'},
            {id: 2, name: 'Market District', x: 8, y: 22, width: 12, height: 10, color: 'rgba(16, 185, 129, 0.3)', description: 'Bustling marketplace'},
            {id: 3, name: 'Harbor District', x: 6, y: 36, width: 48, height: 8, color: 'rgba(59, 130, 246, 0.3)', description: 'Busy docks'},
            {id: 4, name: 'Central Park', x: 24, y: 21, width: 12, height: 9, color: 'rgba(34, 197, 94, 0.2)', description: 'Green space'}
        ]
    };
}

function generateDungeon() {
    const width = 45;
    const height = 38;
    const grid = [];
    
    // Initialize with walls (mountains)
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'mountain';
        }
    }
    
    // Create main chamber (center)
    for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 10) {
                grid[19 + dy][22 + dx] = 'grass';
            }
        }
    }
    
    // North chamber
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 7) {
                grid[8 + dy][22 + dx] = 'grass';
            }
        }
    }
    
    // South chamber
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 7) {
                grid[30 + dy][22 + dx] = 'grass';
            }
        }
    }
    
    // West chamber
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 6) {
                grid[19 + dy][10 + dx] = 'grass';
            }
        }
    }
    
    // East chamber
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 6) {
                grid[19 + dy][35 + dx] = 'grass';
            }
        }
    }
    
    // Corridors connecting chambers
    // North corridor
    for (let y = 12; y < 19; y++) {
        grid[y][22] = 'grass';
        grid[y][21] = 'grass';
        grid[y][23] = 'grass';
    }
    
    // South corridor
    for (let y = 26; y < 31; y++) {
        grid[y][22] = 'grass';
        grid[y][21] = 'grass';
        grid[y][23] = 'grass';
    }
    
    // West corridor
    for (let x = 14; x < 19; x++) {
        grid[19][x] = 'grass';
        grid[18][x] = 'grass';
        grid[20][x] = 'grass';
    }
    
    // East corridor
    for (let x = 30; x < 35; x++) {
        grid[19][x] = 'grass';
        grid[18][x] = 'grass';
        grid[20][x] = 'grass';
    }
    
    // Underground pools
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            grid[8 + dy][22 + dx] = 'water';
            grid[30 + dy][22 + dx] = 'water';
        }
    }
    
    // Locked doors
    grid[15][22] = 'door';
    grid[28][22] = 'door';
    grid[19][17] = 'door';
    grid[19][27] = 'door';
    
    return {
        name: "Crypts of the Forgotten",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            {x: 22, y: 19, type: 'temple', name: 'Ancient Altar', class: 'building temple'},
            {x: 22, y: 8, type: 'castle', name: 'Boss Chamber', class: 'building castle'}
        ],
        npcs: [
            {x: 23, y: 20, name: 'Ghost of Sir Aldrin', class: 'npc npc-elder', dialogue: 'Turn back... death awaits those who disturb this cursed place...'},
            {x: 10, y: 19, name: 'Imprisoned Scholar', class: 'npc npc-villager', dialogue: 'Help! I\'ve been trapped here for days! The undead won\'t let me leave!'},
            {x: 35, y: 19, name: 'Mad Cultist', class: 'npc npc-priest', dialogue: 'The dark lord shall rise! None can stop the ritual!'}
        ],
        enemies: [
            // Main chamber
            {x: 18, y: 19, name: 'Skeleton Warrior', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            {x: 26, y: 19, name: 'Skeleton Archer', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 14, xpReward: 35, goldReward: 28},
            {x: 22, y: 22, name: 'Armored Skeleton', class: 'enemy-spawn enemy-goblin', hp: 62, maxHp: 62, attack: 17, xpReward: 42, goldReward: 34},
            
            // North chamber (boss area)
            {x: 20, y: 8, name: 'Crypt Guardian', class: 'enemy-spawn enemy-dragon', hp: 95, maxHp: 95, attack: 22, xpReward: 70, goldReward: 55},
            {x: 24, y: 8, name: 'Death Knight', class: 'enemy-spawn enemy-goblin', hp: 75, maxHp: 75, attack: 19, xpReward: 55, goldReward: 42},
            
            // South chamber
            {x: 22, y: 32, name: 'Wraith', class: 'enemy-spawn enemy-wolf', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32},
            {x: 20, y: 29, name: 'Spectre', class: 'enemy-spawn enemy-wolf', hp: 52, maxHp: 52, attack: 15, xpReward: 36, goldReward: 29},
            
            // West chamber
            {x: 10, y: 17, name: 'Zombie Brute', class: 'enemy-spawn enemy-goblin', hp: 65, maxHp: 65, attack: 18, xpReward: 45, goldReward: 36},
            {x: 10, y: 21, name: 'Ghoul', class: 'enemy-spawn enemy-goblin', hp: 50, maxHp: 50, attack: 14, xpReward: 34, goldReward: 27},
            
            // East chamber
            {x: 35, y: 17, name: 'Shadow Beast', class: 'enemy-spawn enemy-wolf', hp: 68, maxHp: 68, attack: 19, xpReward: 48, goldReward: 38},
            {x: 35, y: 21, name: 'Cursed Hound', class: 'enemy-spawn enemy-wolf', hp: 55, maxHp: 55, attack: 16, xpReward: 38, goldReward: 30},
            
            // Corridors
            {x: 22, y: 15, name: 'Skeleton Guard', class: 'enemy-spawn enemy-goblin', hp: 45, maxHp: 45, attack: 13, xpReward: 32, goldReward: 25}
        ],
        items: [
            {x: 22, y: 17, type: 'health_potion', value: 3},
            {x: 25, y: 19, type: 'mana_potion', value: 3},
            {x: 10, y: 19, type: 'key', value: 3},
            {x: 35, y: 19, type: 'key', value: 2},
            {x: 22, y: 6, type: 'treasure', value: 250},
            {x: 22, y: 33, type: 'treasure', value: 180},
            {x: 8, y: 19, type: 'gold', value: 120},
            {x: 37, y: 19, type: 'gold', value: 110}
        ],
        areas: [
            {id: 1, name: 'Central Chamber', x: 16, y: 15, width: 14, height: 10, color: 'rgba(107, 114, 128, 0.4)', description: 'Heart of the crypt'},
            {id: 2, name: 'Boss Chamber', x: 18, y: 5, width: 10, height: 8, color: 'rgba(220, 38, 38, 0.4)', description: 'Ancient evil awakens'},
            {id: 3, name: 'Flooded Crypt', x: 18, y: 27, width: 10, height: 8, color: 'rgba(30, 64, 175, 0.4)', description: 'Cursed waters'}
        ]
    };
}

function generateForestTemple() {
    const width = 48;
    const height = 42;
    const grid = [];
    
    // Initialize with grass
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    // Dense forest around edges
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Outer forest ring
            if (x < 8 || x >= width - 8 || y < 6 || y >= height - 6) {
                if (Math.random() < 0.75) {
                    grid[y][x] = 'forest';
                }
            }
        }
    }
    
    // Forest clusters throughout middle area
    createForest(grid, 12, 12, 5, 0.7);
    createForest(grid, 35, 10, 6, 0.75);
    createForest(grid, 10, 32, 5, 0.7);
    createForest(grid, 37, 34, 6, 0.72);
    
    // Sacred grove clearing (center-north)
    for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 8) {
                grid[15 + dy][24 + dx] = 'grass';
            }
        }
    }
    
    // Temple grounds (center)
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 7) {
                grid[26 + dy][24 + dx] = 'grass';
            }
        }
    }
    
    // Ancient stone paths
    createPath(grid, 24, 8, 24, 38, 'road', 0);
    createPath(grid, 12, 21, 36, 21, 'road', 0);
    
    // Sacred pool
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 3) {
                grid[15 + dy][24 + dx] = 'water';
            }
        }
    }
    
    // Small streams
    createRiver(grid, 5, 15, 12, 'horizontal');
    createRiver(grid, 35, 28, 10, 'horizontal');
    
    return {
        name: "Verdant Grove Temple",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            {x: 24, y: 26, type: 'temple', name: 'Ancient Forest Temple', class: 'building temple'},
            {x: 20, y: 28, type: 'house', name: 'Druid\'s Sanctuary', class: 'building house'},
            {x: 28, y: 28, type: 'house', name: 'Hermit\'s Hut', class: 'building house'},
            {x: 14, y: 18, type: 'house', name: 'Ranger\'s Lodge', class: 'building house'},
            {x: 34, y: 18, type: 'house', name: 'Herbalist Retreat', class: 'building house'}
        ],
        npcs: [
            {x: 25, y: 27, name: 'High Druid Silvanus', class: 'npc npc-priest', dialogue: 'The forest speaks to those who listen. Nature is both beautiful and terrible.'},
            {x: 21, y: 29, name: 'Druid Apprentice Lira', class: 'npc npc-villager', dialogue: 'Master Silvanus teaches us the old ways. The balance must be maintained.'},
            {x: 29, y: 29, name: 'Old Hermit Gregor', class: 'npc npc-elder', dialogue: 'I\'ve lived in these woods for sixty years. They have changed much since my youth.'},
            {x: 15, y: 19, name: 'Ranger Marcus Swiftarrow', class: 'npc npc-villager', dialogue: 'I patrol the forest paths. Poachers and dark creatures both threaten this sacred place.'},
            {x: 35, y: 19, name: 'Herbalist Elara', class: 'npc npc-villager', dialogue: 'Every plant has a purpose. Some heal, some harm, all are part of nature\'s design.'},
            {x: 24, y: 16, name: 'Forest Spirit', class: 'npc npc-elder', dialogue: 'I am the guardian of this grove. Those who harm the forest face my wrath.'},
            {x: 18, y: 21, name: 'Wandering Pilgrim', class: 'npc npc-villager', dialogue: 'I have traveled far to seek the blessing of the ancient temple.'}
        ],
        enemies: [
            // Outer forest
            {x: 5, y: 8, name: 'Dire Wolf', class: 'enemy-spawn enemy-wolf', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32},
            {x: 42, y: 10, name: 'Alpha Wolf', class: 'enemy-spawn enemy-wolf', hp: 62, maxHp: 62, attack: 17, xpReward: 44, goldReward: 35},
            {x: 8, y: 36, name: 'Wild Bear', class: 'enemy-spawn enemy-wolf', hp: 70, maxHp: 70, attack: 19, xpReward: 50, goldReward: 40},
            {x: 40, y: 35, name: 'Forest Troll', class: 'enemy-spawn enemy-goblin', hp: 75, maxHp: 75, attack: 20, xpReward: 55, goldReward: 44},
            
            // Corrupted forest creatures
            {x: 12, y: 14, name: 'Corrupted Treant', class: 'enemy-spawn enemy-goblin', hp: 82, maxHp: 82, attack: 21, xpReward: 60, goldReward: 48},
            {x: 36, y: 16, name: 'Twisted Dryad', class: 'enemy-spawn enemy-goblin', hp: 68, maxHp: 68, attack: 18, xpReward: 48, goldReward: 38},
            
            // Dark cultists
            {x: 16, y: 30, name: 'Dark Cultist', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            {x: 32, y: 32, name: 'Cult Enforcer', class: 'enemy-spawn enemy-goblin', hp: 60, maxHp: 60, attack: 17, xpReward: 42, goldReward: 34},
            
            // Magical creatures
            {x: 24, y: 10, name: 'Will-o\'-Wisp', class: 'enemy-spawn enemy-wolf', hp: 45, maxHp: 45, attack: 14, xpReward: 35, goldReward: 28},
            {x: 10, y: 25, name: 'Forest Sprite', class: 'enemy-spawn enemy-goblin', hp: 42, maxHp: 42, attack: 13, xpReward: 32, goldReward: 26}
        ],
        items: [
            {x: 24, y: 14, type: 'mana_potion', value: 2},
            {x: 20, y: 24, type: 'health_potion', value: 2},
            {x: 28, y: 24, type: 'gold', value: 95},
            {x: 6, y: 12, type: 'gold', value: 75},
            {x: 42, y: 14, type: 'treasure', value: 140},
            {x: 10, y: 38, type: 'key', value: 2},
            {x: 38, y: 36, type: 'gold', value: 85}
        ],
        areas: [
            {id: 1, name: 'Sacred Grove', x: 18, y: 10, width: 14, height: 12, color: 'rgba(34, 197, 94, 0.3)', description: 'Ancient druidic site'},
            {id: 2, name: 'Temple Grounds', x: 18, y: 22, width: 14, height: 10, color: 'rgba(251, 191, 36, 0.2)', description: 'Holy sanctuary'},
            {id: 3, name: 'Deep Forest', x: 0, y: 0, width: 10, height: 42, color: 'rgba(22, 163, 74, 0.4)', description: 'Dense wilderness'}
        ]
    };
}

function generateDesertOasis() {
    const width = 52;
    const height = 38;
    const grid = [];
    
    // Initialize with sand
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'sand';
        }
    }
    
    // Oasis center (water and grass)
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= 6) {
                if (dist <= 3) {
                    grid[19 + dy][26 + dx] = 'water';
                } else {
                    grid[19 + dy][26 + dx] = 'grass';
                    if (Math.random() < 0.3) {
                        grid[19 + dy][26 + dx] = 'forest'; // Palm trees
                    }
                }
            }
        }
    }
    
    // Small secondary oasis (northeast)
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 3) {
                grid[10 + dy][40 + dx] = 'grass';
                if (Math.abs(dx) + Math.abs(dy) <= 2) {
                    grid[10 + dy][40 + dx] = 'water';
                }
            }
        }
    }
    
    // Trade route (sandy road)
    for (let x = 5; x < 48; x++) {
        grid[19][x] = 'road';
        if (x > 10 && x < 42) {
            grid[18][x] = 'road';
            grid[20][x] = 'road';
        }
    }
    
    // Scattered rock formations (mountains)
    // North
    for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 4; dx++) {
            if (Math.random() < 0.7) {
                grid[5 + dy][10 + dx] = 'mountain';
            }
        }
    }
    
    // East
    for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 3; dx++) {
            if (Math.random() < 0.7) {
                grid[25 + dy][48 + dx] = 'mountain';
            }
        }
    }
    
    // Scattered palm trees
    for (let i = 0; i < 15; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        if (grid[y][x] === 'sand' && Math.random() < 0.5) {
            grid[y][x] = 'forest';
        }
    }
    
    return {
        name: "Mirage Oasis",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            {x: 24, y: 17, type: 'shop', name: 'Desert Trading Post', class: 'building house shop'},
            {x: 28, y: 17, type: 'inn', name: 'Oasis Rest Inn', class: 'building house inn'},
            {x: 26, y: 22, type: 'temple', name: 'Sun Temple', class: 'building temple'},
            {x: 22, y: 20, type: 'house', name: 'Caravanserai', class: 'building house'},
            {x: 30, y: 20, type: 'house', name: 'Merchant\'s Tent', class: 'building house'}
        ],
        npcs: [
            {x: 25, y: 18, name: 'Trader Khalid', class: 'npc npc-merchant', dialogue: 'Welcome, traveler! Goods from across the desert sands! Spices, silk, and rare artifacts!'},
            {x: 29, y: 18, name: 'Innkeeper Amira', class: 'npc npc-villager', dialogue: 'Rest your weary bones. The oasis provides respite from the merciless sun.'},
            {x: 27, y: 23, name: 'Sun Priest Rashid', class: 'npc npc-priest', dialogue: 'The sun god blesses those who respect the desert. Pray for safe travels.'},
            {x: 23, y: 21, name: 'Caravan Master Hassan', class: 'npc npc-elder', dialogue: 'My caravans cross the desert twice yearly. It is a perilous journey.'},
            {x: 31, y: 21, name: 'Merchant Zara', class: 'npc npc-merchant', dialogue: 'Silks from the east, jewels from the south. Every treasure has a price!'},
            {x: 20, y: 19, name: 'Desert Guide Malik', class: 'npc npc-villager', dialogue: 'The desert is treacherous. Only fools travel alone without a guide.'},
            {x: 40, y: 11, name: 'Nomad Elder', class: 'npc npc-elder', dialogue: 'My people have lived in these sands for a thousand years. The desert is harsh but fair.'}
        ],
        enemies: [
            // Desert creatures
            {x: 8, y: 8, name: 'Giant Scorpion', class: 'enemy-spawn enemy-goblin', hp: 52, maxHp: 52, attack: 15, xpReward: 36, goldReward: 29},
            {x: 48, y: 10, name: 'Sand Serpent', class: 'enemy-spawn enemy-wolf', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32},
            {x: 12, y: 30, name: 'Dust Devil', class: 'enemy-spawn enemy-wolf', hp: 48, maxHp: 48, attack: 14, xpReward: 34, goldReward: 27},
            {x: 45, y: 28, name: 'Sand Wurm', class: 'enemy-spawn enemy-dragon', hp: 80, maxHp: 80, attack: 21, xpReward: 58, goldReward: 46},
            
            // Bandits
            {x: 6, y: 19, name: 'Desert Raider', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            {x: 46, y: 19, name: 'Bandit Leader', class: 'enemy-spawn enemy-goblin', hp: 62, maxHp: 62, attack: 17, xpReward: 44, goldReward: 35},
            {x: 15, y: 12, name: 'Nomad Thief', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 14, xpReward: 32, goldReward: 26},
            
            // Ancient guardians
            {x: 11, y: 6, name: 'Mummy Warrior', class: 'enemy-spawn enemy-goblin', hp: 68, maxHp: 68, attack: 18, xpReward: 48, goldReward: 38},
            {x: 48, y: 27, name: 'Stone Guardian', class: 'enemy-spawn enemy-goblin', hp: 75, maxHp: 75, attack: 20, xpReward: 52, goldReward: 42}
        ],
        items: [
            {x: 26, y: 20, type: 'health_potion', value: 2},
            {x: 40, y: 9, type: 'mana_potion', value: 2},
            {x: 10, y: 10, type: 'gold', value: 85},
            {x: 48, y: 25, type: 'treasure', value: 160},
            {x: 14, y: 32, type: 'key', value: 2},
            {x: 42, y: 5, type: 'gold', value: 95}
        ],
        areas: [
            {id: 1, name: 'Central Oasis', x: 20, y: 14, width: 14, height: 12, color: 'rgba(59, 130, 246, 0.3)', description: 'Life-giving water'},
            {id: 2, name: 'Northern Wastes', x: 0, y: 0, width: 52, height: 10, color: 'rgba(251, 191, 36, 0.2)', description: 'Endless sands'},
            {id: 3, name: 'Rocky Outcrops', x: 8, y: 4, width: 6, height: 5, color: 'rgba(107, 114, 128, 0.3)', description: 'Stone formations'}
        ]
    };
}

function generateMountainFortress() {
    const width = 46;
    const height = 44;
    const grid = [];
    
    // Initialize with mountains
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'mountain';
        }
    }
    
    // Main fortress area (center)
    for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 10) {
                grid[22 + dy][23 + dx] = 'grass';
            }
        }
    }
    
    // Outer courtyard
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 6) {
                grid[18 + dy][23 + dx] = 'grass';
            }
        }
    }
    
    // Training grounds (south)
    for (let dy = 0; dy < 6; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
            if (Math.abs(dx) + dy <= 7) {
                grid[28 + dy][23 + dx] = 'grass';
            }
        }
    }
    
    // Mountain pass roads
    createPath(grid, 23, 0, 23, 15, 'road', 0);
    createPath(grid, 23, 35, 23, height - 1, 'road', 0);
    
    // Battlements (convert some grass back to "walls")
    for (let x = 17; x < 30; x++) {
        grid[14][x] = 'mountain';
        grid[30][x] = 'mountain';
    }
    for (let y = 14; y < 31; y++) {
        grid[y][16] = 'mountain';
        grid[y][30] = 'mountain';
    }
    
    // Watchtowers (clear small areas)
    grid[14][16] = 'grass';
    grid[14][30] = 'grass';
    grid[30][16] = 'grass';
    grid[30][30] = 'grass';
    
    // Fortress gate
    grid[14][22] = 'door';
    grid[14][23] = 'door';
    grid[14][24] = 'door';
    
    return {
        name: "Skyhold Fortress",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            {x: 23, y: 22, type: 'castle', name: 'Great Hall', class: 'building castle'},
            {x: 19, y: 20, type: 'shop', name: 'Armory', class: 'building house shop'},
            {x: 27, y: 20, type: 'inn', name: 'Soldier Barracks', class: 'building house inn'},
            {x: 23, y: 26, type: 'house', name: 'Training Ground', class: 'building house'},
            {x: 19, y: 26, type: 'house', name: 'Quartermaster', class: 'building house'},
            {x: 27, y: 26, type: 'house', name: 'Infirmary', class: 'building house'},
            {x: 23, y: 18, type: 'temple', name: 'War Chapel', class: 'building temple'}
        ],
        npcs: [
            {x: 24, y: 23, name: 'Commander Steelheart', class: 'npc npc-elder', dialogue: 'Welcome to Skyhold! We are the shield that guards the realm from the mountain threats.'},
            {x: 20, y: 21, name: 'Weaponmaster Brom', class: 'npc npc-merchant', dialogue: 'Only the finest steel forged in dragon fire! These weapons have defended Skyhold for generations.'},
            {x: 28, y: 21, name: 'Quartermaster Thora', class: 'npc npc-villager', dialogue: 'Supplies are limited at this altitude. Every resource is precious up here.'},
            {x: 24, y: 19, name: 'War Priest Valtor', class: 'npc npc-priest', dialogue: 'We pray for strength in battle and mercy for the fallen. War is a grim necessity.'},
            {x: 24, y: 27, name: 'Training Master Ragnar', class: 'npc npc-elder', dialogue: 'Every soldier trains daily. Discipline and skill keep us alive in these mountains.'},
            {x: 20, y: 27, name: 'Supply Officer', class: 'npc npc-villager', dialogue: 'Food and medicine arrive monthly by caravan. We must ration carefully.'},
            {x: 28, y: 27, name: 'Healer Mira', class: 'npc npc-villager', dialogue: 'The cold and altitude take their toll. I tend many injuries daily.'},
            {x: 17, y: 15, name: 'Scout Captain Elena', class: 'npc npc-villager', dialogue: 'I\'ve spotted frost giants in the peaks. They\'re preparing for something big.'}
        ],
        enemies: [
            // Mountain threats
            {x: 15, y: 10, name: 'Frost Giant', class: 'enemy-spawn enemy-dragon', hp: 110, maxHp: 110, attack: 26, xpReward: 82, goldReward: 65},
            {x: 32, y: 10, name: 'Ice Wyvern', class: 'enemy-spawn enemy-dragon', hp: 95, maxHp: 95, attack: 24, xpReward: 72, goldReward: 58},
            {x: 10, y: 22, name: 'Snow Troll', class: 'enemy-spawn enemy-wolf', hp: 85, maxHp: 85, attack: 22, xpReward: 65, goldReward: 52},
            {x: 36, y: 22, name: 'Mountain Ogre', class: 'enemy-spawn enemy-goblin', hp: 90, maxHp: 90, attack: 23, xpReward: 68, goldReward: 54},
            
            // Training grounds sparring enemies
            {x: 20, y: 32, name: 'Veteran Soldier', class: 'enemy-spawn enemy-goblin', hp: 72, maxHp: 72, attack: 20, xpReward: 55, goldReward: 44},
            {x: 26, y: 32, name: 'Elite Guard', class: 'enemy-spawn enemy-goblin', hp: 78, maxHp: 78, attack: 21, xpReward: 60, goldReward: 48},
            
            // South approach
            {x: 23, y: 38, name: 'Mountain Bandit', class: 'enemy-spawn enemy-goblin', hp: 65, maxHp: 65, attack: 18, xpReward: 48, goldReward: 38},
            
            // North approach
            {x: 23, y: 8, name: 'Ice Elemental', class: 'enemy-spawn enemy-wolf', hp: 82, maxHp: 82, attack: 22, xpReward: 62, goldReward: 50}
        ],
        items: [
            {x: 23, y: 24, type: 'health_potion', value: 3},
            {x: 25, y: 24, type: 'mana_potion', value: 3},
            {x: 15, y: 22, type: 'key', value: 3},
            {x: 12, y: 12, type: 'treasure', value: 200},
            {x: 34, y: 12, type: 'treasure', value: 180},
            {x: 23, y: 40, type: 'gold', value: 125}
        ],
        areas: [
            {id: 1, name: 'Fortress Courtyard', x: 17, y: 15, width: 14, height: 16, color: 'rgba(107, 114, 128, 0.3)', description: 'Stronghold center'},
            {id: 2, name: 'Training Grounds', x: 18, y: 28, width: 12, height: 8, color: 'rgba(251, 191, 36, 0.2)', description: 'Combat training area'},
            {id: 3, name: 'Northern Peaks', x: 0, y: 0, width: 46, height: 12, color: 'rgba(148, 163, 184, 0.4)', description: 'Frozen heights'}
        ]
    };
}

function generateSwampRuins() {
    const width = 50;
    const height = 44;
    const grid = [];
    
    // Initialize with grass
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    // Random water pools throughout (swamp characteristic)
    for (let i = 0; i < 30; i++) {
        const poolX = Math.floor(Math.random() * (width - 6)) + 3;
        const poolY = Math.floor(Math.random() * (height - 6)) + 3;
        const poolSize = 2 + Math.floor(Math.random() * 3);
        
        for (let dy = -poolSize; dy <= poolSize; dy++) {
            for (let dx = -poolSize; dx <= poolSize; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= poolSize && 
                    poolY + dy >= 0 && poolY + dy < height &&
                    poolX + dx >= 0 && poolX + dx < width) {
                    if (Math.random() < 0.7) {
                        grid[poolY + dy][poolX + dx] = 'water';
                    }
                }
            }
        }
    }
    
    // Dead trees and vegetation
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (grid[y][x] === 'grass' && Math.random() < 0.25) {
                grid[y][x] = 'forest';
            }
        }
    }
    
    // Ancient ruins area (center)
    for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 8) {
                grid[22 + dy][25 + dx] = 'grass';
                // Occasional mountain (broken walls)
                if ((Math.abs(dx) === 6 || Math.abs(dy) === 5) && Math.random() < 0.4) {
                    grid[22 + dy][25 + dx] = 'mountain';
                }
            }
        }
    }
    
    // Muddy paths
    createPath(grid, 10, 0, 25, 22, 'road', 0);
    createPath(grid, 40, 0, 25, 22, 'road', 0);
    createPath(grid, 25, 32, 25, height - 1, 'road', 0);
    
    // Cursed pool in ruins
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 3) {
                grid[27 + dy][30 + dx] = 'water';
            }
        }
    }
    
    return {
        name: "Blightfen Ruins",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            {x: 25, y: 22, type: 'temple', name: 'Cursed Temple', class: 'building temple'},
            {x: 18, y: 18, type: 'house', name: 'Witch\'s Hut', class: 'building house'},
            {x: 32, y: 18, type: 'house', name: 'Abandoned Shrine', class: 'building house'}
        ],
        npcs: [
            {x: 26, y: 23, name: 'Cursed Spirit', class: 'npc npc-priest', dialogue: 'Leave... this place... is forsaken... death awaits all who linger...'},
            {x: 19, y: 19, name: 'Swamp Witch Morgana', class: 'npc npc-elder', dialogue: 'I know the old magics. For a price, I can brew potions... powerful potions...'},
            {x: 33, y: 19, name: 'Lost Pilgrim', class: 'npc npc-villager', dialogue: 'I came seeking the temple... now I cannot find my way out. This swamp is cursed!'},
            {x: 15, y: 25, name: 'Hermit Ezra', class: 'npc npc-elder', dialogue: 'The ruins were once a great city. A terrible plague destroyed everything. The curse lingers still.'}
        ],
        enemies: [
            // Undead
            {x: 22, y: 20, name: 'Swamp Zombie', class: 'enemy-spawn enemy-goblin', hp: 62, maxHp: 62, attack: 17, xpReward: 44, goldReward: 35},
            {x: 28, y: 20, name: 'Drowned Corpse', class: 'enemy-spawn enemy-goblin', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32},
            {x: 25, y: 25, name: 'Wraith', class: 'enemy-spawn enemy-wolf', hp: 68, maxHp: 68, attack: 19, xpReward: 50, goldReward: 40},
            
            // Swamp creatures
            {x: 12, y: 12, name: 'Giant Toad', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            {x: 38, y: 14, name: 'Swamp Serpent', class: 'enemy-spawn enemy-wolf', hp: 60, maxHp: 60, attack: 17, xpReward: 42, goldReward: 34},
            {x: 8, y: 30, name: 'Bog Monster', class: 'enemy-spawn enemy-wolf', hp: 75, maxHp: 75, attack: 20, xpReward: 55, goldReward: 44},
            {x: 42, y: 32, name: 'Plague Rat Swarm', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 14, xpReward: 32, goldReward: 26},
            
            // Dark magic
            {x: 20, y: 28, name: 'Cursed Hound', class: 'enemy-spawn enemy-wolf', hp: 65, maxHp: 65, attack: 18, xpReward: 46, goldReward: 37},
            {x: 30, y: 28, name: 'Shadow Fiend', class: 'enemy-spawn enemy-wolf', hp: 70, maxHp: 70, attack: 19, xpReward: 52, goldReward: 42}
        ],
        items: [
            {x: 25, y: 18, type: 'health_potion', value: 3},
            {x: 28, y: 22, type: 'mana_potion', value: 3},
            {x: 18, y: 20, type: 'key', value: 2},
            {x: 32, y: 20, type: 'key', value: 2},
            {x: 25, y: 28, type: 'treasure', value: 170},
            {x: 10, y: 10, type: 'gold', value: 95},
            {x: 40, y: 36, type: 'gold', value: 105}
        ],
        areas: [
            {id: 1, name: 'Ancient Ruins', x: 18, y: 16, width: 16, height: 14, color: 'rgba(107, 114, 128, 0.3)', description: 'Cursed remnants'},
            {id: 2, name: 'Deep Swamp', x: 0, y: 0, width: 50, height: 44, color: 'rgba(34, 139, 34, 0.2)', description: 'Fetid marshland'}
        ]
    };
}

function generateCoastalPort() {
    const width = 58;
    const height = 42;
    const grid = [];
    
    // Initialize with grass
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    // Ocean (southern half)
    for (let y = 30; y < height; y++) {
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'water';
        }
    }
    
    // Beach transition
    for (let x = 0; x < width; x++) {
        for (let y = 27; y < 30; y++) {
            grid[y][x] = 'sand';
        }
    }
    
    // Harbor (man-made extensions)
    // West pier
    for (let y = 28; y < 36; y++) {
        for (let x = 12; x < 18; x++) {
            grid[y][x] = 'road';
        }
    }
    
    // Center pier
    for (let y = 28; y < 36; y++) {
        for (let x = 26; x < 32; x++) {
            grid[y][x] = 'road';
        }
    }
    
    // East pier
    for (let y = 28; y < 36; y++) {
        for (let x = 40; x < 46; x++) {
            grid[y][x] = 'road';
        }
    }
    
    // Town roads
    // Main coastal road
    for (let x = 5; x < 53; x++) {
        grid[20][x] = 'road';
        grid[21][x] = 'road';
    }
    
    // Vertical streets
    for (let y = 8; y < 27; y++) {
        grid[y][15] = 'road';
        grid[y][29] = 'road';
        grid[y][43] = 'road';
    }
    
    // Secondary horizontal streets
    for (let x = 5; x < 53; x++) {
        if (x > 10 && x < 50) {
            grid[12][x] = 'road';
        }
    }
    
    // Lighthouse island (small rocky outcrop)
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= 3) {
                grid[38 + dy][50 + dx] = 'mountain';
            }
        }
    }
    grid[38][50] = 'grass';
    grid[37][50] = 'grass';
    
    // Town park/square
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            grid[15 + dy][29 + dx] = 'grass';
            if (Math.random() < 0.2) {
                grid[15 + dy][29 + dx] = 'forest';
            }
        }
    }
    
    return {
        name: "Seabreeze Harbor",
        width: width,
        height: height,
        terrain: grid,
        buildings: [
            // Harbor district
            {x: 15, y: 24, type: 'house', name: 'Harbor Master Office', class: 'building house'},
            {x: 29, y: 24, type: 'house', name: 'Customs House', class: 'building house'},
            {x: 43, y: 24, type: 'house', name: 'Fish Market', class: 'building house'},
            
            // Commercial district
            {x: 12, y: 18, type: 'shop', name: 'Ship Supplies', class: 'building house shop'},
            {x: 18, y: 18, type: 'shop', name: 'Rope & Sail Merchant', class: 'building house shop'},
            {x: 26, y: 18, type: 'inn', name: 'The Salty Anchor Inn', class: 'building house inn'},
            {x: 32, y: 18, type: 'inn', name: 'Dockside Tavern', class: 'building house inn'},
            {x: 40, y: 18, type: 'shop', name: 'Fisherman\'s Supply', class: 'building house shop'},
            {x: 46, y: 18, type: 'shop', name: 'Maritime Goods', class: 'building house shop'},
            
            // Town center
            {x: 29, y: 15, type: 'temple', name: 'Temple of the Tides', class: 'building temple'},
            {x: 29, y: 10, type: 'castle', name: 'Governor\'s Manor', class: 'building castle'},
            
            // Residential
            {x: 10, y: 10, type: 'house', name: 'Captain\'s Residence', class: 'building house'},
            {x: 18, y: 10, type: 'house', name: 'Merchant\'s Home', class: 'building house'},
            {x: 40, y: 10, type: 'house', name: 'Shipwright\'s House', class: 'building house'},
            {x: 48, y: 10, type: 'house', name: 'Noble Villa', class: 'building house'},
            
            // Lighthouse
            {x: 50, y: 38, type: 'castle', name: 'Lighthouse', class: 'building castle'}
        ],
        npcs: [
            {x: 16, y: 25, name: 'Harbor Master Drake', class: 'npc npc-elder', dialogue: 'Welcome to Seabreeze! Busiest port on the coast. Ships arrive daily from every corner of the world!'},
            {x: 30, y: 25, name: 'Customs Officer Lyra', class: 'npc npc-villager', dialogue: 'All cargo must be inspected and taxed. Governor\'s orders, no exceptions!'},
            {x: 44, y: 25, name: 'Fish Monger Boris', class: 'npc npc-merchant', dialogue: 'Fresh catch daily! Tuna, salmon, crab - the sea provides bountifully!'},
            {x: 13, y: 19, name: 'Ship Chandler Marcus', class: 'npc npc-merchant', dialogue: 'Setting sail? You\'ll need supplies! Ropes, canvas, tools - I have everything!'},
            {x: 19, y: 19, name: 'Sailmaker Helena', class: 'npc npc-merchant', dialogue: 'I sew the finest sails in the realm. Canvas that can weather any storm!'},
            {x: 27, y: 19, name: 'Innkeeper Rosa', class: 'npc npc-villager', dialogue: 'The Salty Anchor - warm beds and hot meals! Sailors from every land rest here.'},
            {x: 33, y: 19, name: 'Tavern Owner Bjorn', class: 'npc npc-villager', dialogue: 'Best rum this side of the ocean! Come in, hear tales from across the seas!'},
            {x: 41, y: 19, name: 'Fisherman Pete', class: 'npc npc-villager', dialogue: 'Been fishing these waters for forty years. The sea is a harsh mistress but fair.'},
            {x: 30, y: 16, name: 'Sea Priestess Marina', class: 'npc npc-priest', dialogue: 'The ocean gods protect those who respect them. Pray for calm seas and safe passage.'},
            {x: 30, y: 11, name: 'Governor Edmund', class: 'npc npc-elder', dialogue: 'Trade keeps Seabreeze prosperous. We welcome merchants from all nations!'},
            {x: 15, y: 32, name: 'Old Sailor Jack', class: 'npc npc-villager', dialogue: 'I\'ve sailed to every port in the known world. Each has its own stories and treasures.'},
            {x: 50, y: 39, name: 'Lighthouse Keeper', class: 'npc npc-elder', dialogue: 'The light guides ships safely to harbor. In fifty years, I\'ve never let it go dark.'}
        ],
        enemies: [
            // Harbor threats (pirates, smugglers)
            {x: 10, y: 32, name: 'Pirate Raider', class: 'enemy-spawn enemy-goblin', hp: 58, maxHp: 58, attack: 16, xpReward: 42, goldReward: 34},
            {x: 48, y: 32, name: 'Smuggler Captain', class: 'enemy-spawn enemy-goblin', hp: 62, maxHp: 62, attack: 17, xpReward: 46, goldReward: 37},
            
            // Sea creatures
            {x: 20, y: 38, name: 'Giant Crab', class: 'enemy-spawn enemy-goblin', hp: 52, maxHp: 52, attack: 15, xpReward: 36, goldReward: 29},
            {x: 38, y: 38, name: 'Reef Shark', class: 'enemy-spawn enemy-wolf', hp: 60, maxHp: 60, attack: 17, xpReward: 44, goldReward: 35},
            {x: 29, y: 40, name: 'Sea Serpent', class: 'enemy-spawn enemy-dragon', hp: 85, maxHp: 85, attack: 22, xpReward: 65, goldReward: 52},
            
            // Town criminals
            {x: 6, y: 22, name: 'Dock Thug', class: 'enemy-spawn enemy-goblin', hp: 50, maxHp: 50, attack: 14, xpReward: 34, goldReward: 27},
            {x: 52, y: 22, name: 'Cutthroat', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 15, xpReward: 38, goldReward: 30},
            
            // Outskirts
            {x: 55, y: 8, name: 'Highwayman', class: 'enemy-spawn enemy-goblin', hp: 58, maxHp: 58, attack: 16, xpReward: 40, goldReward: 32}
        ],
        items: [
            {x: 15, y: 30, type: 'health_potion', value: 2},
            {x: 43, y: 30, type: 'mana_potion', value: 2},
            {x: 29, y: 17, type: 'gold', value: 85},
            {x: 6, y: 12, type: 'key', value: 2},
            {x: 54, y: 6, type: 'treasure', value: 175},
            {x: 25, y: 36, type: 'gold', value: 95},
            {x: 50, y: 40, type: 'key', value: 1}
        ],
        areas: [
            {id: 1, name: 'Harbor District', x: 10, y: 22, width: 38, height: 8, color: 'rgba(59, 130, 246, 0.3)', description: 'Busy docks'},
            {id: 2, name: 'Commercial Quarter', x: 10, y: 16, width: 38, height: 6, color: 'rgba(16, 185, 129, 0.3)', description: 'Shops and inns'},
            {id: 3, name: 'Town Center', x: 24, y: 8, width: 12, height: 10, color: 'rgba(251, 191, 36, 0.2)', description: 'Government district'},
            {id: 4, name: 'Open Sea', x: 0, y: 30, width: 58, height: 12, color: 'rgba(30, 64, 175, 0.4)', description: 'Ocean waters'}
        ]
    };
}

// ============================================
// MAP IMPORT FUNCTION
// ============================================

function importMap() {
    if (!currentMapData) {
        showStatus('No valid map data to import', 'error');
        return;
    }

    try {
        gameState.world.width = currentMapData.width;
        gameState.world.height = currentMapData.height;
        gameState.world.areas = currentMapData.areas || [];
        
        worldMap = currentMapData.terrain;
        buildings = currentMapData.buildings || [];
        npcs = currentMapData.npcs || [];
        enemies = currentMapData.enemies || [];
        items = currentMapData.items || [];
        
        gameState.player.x = Math.floor(currentMapData.width / 2);
        gameState.player.y = Math.floor(currentMapData.height / 2);
        
        const worldGrid = document.getElementById('worldGrid');
        worldGrid.style.width = `${currentMapData.width * 32}px`;
        worldGrid.style.height = `${currentMapData.height * 32}px`;
        
        // Clear chunking cache for new map
        renderedChunks.clear();
        tileCache.clear();
        
        renderWorld();

        // Initialize moving entities (NPC and enemy patrol logic)
        if (typeof initializeMovingEntities === 'function') {
            initializeMovingEntities();
        }

        setTimeout(() => {
            initializeMinimap();
            updateMinimapOptimized();
        }, 100);

        centerCameraOnPlayer();
        checkLocation();
        updateUI();
        
        showStatus('🎉 Map imported successfully!', 'success');
        showFloatingText(`Loaded ${currentMapData.name}!`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        
        console.log(`✅ Imported: ${currentMapData.name}`);
        console.log(`   Buildings: ${buildings.length}, NPCs: ${npcs.length}, Enemies: ${enemies.length}, Items: ${items.length}`);
        
        setTimeout(closeImporter, 2000);
        
    } catch (error) {
        showStatus('Import failed: ' + error.message, 'error');
        console.error('Map import error:', error);
    }
}

function showStatus(message, type) {
    const statusEl = document.getElementById('importStatus');
    statusEl.textContent = message;
    statusEl.className = `import-status status-${type}`;
    statusEl.style.display = 'block';
}

window.addEventListener('load', initMapImporter);