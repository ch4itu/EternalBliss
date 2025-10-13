// EternalBliss Map Importer Plugin - Complete Version
// This file contains complete preset maps with NPCs, buildings, enemies, and items

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
// COMPLETE PRESET GENERATORS
// ============================================

function generateStarterVillage() {
    const width = 35;
    const height = 30;
    const terrain = generateSimpleGrid(width, height, 'village');
    
    return {
        name: "Greenleaf Village",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 15, y: 14, type: 'inn', name: 'The Resting Traveler Inn', class: 'building house inn'},
            {x: 19, y: 14, type: 'shop', name: 'General Goods Store', class: 'building house shop'},
            {x: 12, y: 17, type: 'house', name: 'Farmer\'s House', class: 'building house'},
            {x: 22, y: 17, type: 'house', name: 'Blacksmith\'s Home', class: 'building house'},
            {x: 17, y: 20, type: 'temple', name: 'Village Chapel', class: 'building temple'},
            {x: 10, y: 11, type: 'house', name: 'Miller\'s Cottage', class: 'building house'},
            {x: 24, y: 11, type: 'house', name: 'Elder\'s Residence', class: 'building house'}
        ],
        npcs: [
            {x: 16, y: 15, name: 'Innkeeper Martha', class: 'npc npc-villager', dialogue: 'Welcome, traveler! A warm bed and hot meal await you here.'},
            {x: 20, y: 15, name: 'Merchant Thomas', class: 'npc npc-merchant', dialogue: 'Best prices in the region! Take a look at my wares.'},
            {x: 18, y: 21, name: 'Priest Benedict', class: 'npc npc-priest', dialogue: 'May the light guide your path through these troubled times.'},
            {x: 23, y: 18, name: 'Blacksmith Greta', class: 'npc npc-villager', dialogue: 'Need your weapon sharpened? I\'m the best smith in three villages.'},
            {x: 25, y: 12, name: 'Village Elder', class: 'npc npc-elder', dialogue: 'Dangerous creatures have been spotted near the forest lately. Be careful, young one.'},
            {x: 13, y: 18, name: 'Farmer John', class: 'npc npc-villager', dialogue: 'The harvest has been good this year, thank the gods!'},
            {x: 11, y: 12, name: 'Miller Sarah', class: 'npc npc-villager', dialogue: 'Fresh bread baked daily! Stop by anytime.'}
        ],
        enemies: [
            {x: 5, y: 8, name: 'Wild Slime', class: 'enemy-spawn enemy-goblin', hp: 20, maxHp: 20, attack: 5, xpReward: 12, goldReward: 8},
            {x: 30, y: 22, name: 'Goblin Scout', class: 'enemy-spawn enemy-goblin', hp: 30, maxHp: 30, attack: 8, xpReward: 20, goldReward: 15},
            {x: 3, y: 25, name: 'Forest Wolf', class: 'enemy-spawn enemy-wolf', hp: 35, maxHp: 35, attack: 10, xpReward: 25, goldReward: 18},
            {x: 32, y: 5, name: 'Rabid Rat', class: 'enemy-spawn enemy-goblin', hp: 15, maxHp: 15, attack: 4, xpReward: 10, goldReward: 6},
            {x: 8, y: 27, name: 'Wild Boar', class: 'enemy-spawn enemy-wolf', hp: 28, maxHp: 28, attack: 7, xpReward: 18, goldReward: 12}
        ],
        items: [
            {x: 27, y: 10, type: 'gold', value: 25},
            {x: 32, y: 20, type: 'health_potion', value: 1},
            {x: 8, y: 9, type: 'gold', value: 35},
            {x: 6, y: 15, type: 'mana_potion', value: 1},
            {x: 29, y: 28, type: 'gold', value: 50},
            {x: 14, y: 6, type: 'key', value: 1}
        ],
        areas: [
            {id: 1, name: 'Greenleaf Village', x: 10, y: 10, width: 16, height: 13, color: 'rgba(16, 185, 129, 0.3)', description: 'A peaceful farming village'}
        ]
    };
}

function generateLargeCity() {
    const width = 55;
    const height = 45;
    const terrain = generateSimpleGrid(width, height, 'city');
    
    return {
        name: "Port Algorand",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 25, y: 20, type: 'castle', name: 'City Hall & Treasury', class: 'building castle'},
            {x: 18, y: 15, type: 'shop', name: 'ALGO Exchange Market', class: 'building house shop'},
            {x: 32, y: 15, type: 'shop', name: 'Weapon & Armor Shop', class: 'building house shop'},
            {x: 20, y: 25, type: 'inn', name: 'The Golden Anchor Inn', class: 'building house inn'},
            {x: 30, y: 25, type: 'inn', name: 'Sailor\'s Rest Tavern', class: 'building house inn'},
            {x: 25, y: 30, type: 'temple', name: 'Grand Cathedral', class: 'building temple'},
            {x: 12, y: 10, type: 'house', name: 'Harbor Master\'s Office', class: 'building house'},
            {x: 38, y: 10, type: 'house', name: 'Guild Hall', class: 'building house'},
            {x: 15, y: 35, type: 'house', name: 'Warehouse', class: 'building house'},
            {x: 35, y: 35, type: 'house', name: 'Trading Post', class: 'building house'}
        ],
        npcs: [
            {x: 26, y: 21, name: 'Mayor Aldrich', class: 'npc npc-elder', dialogue: 'Welcome to Port Algorand, the jewel of the coast!'},
            {x: 19, y: 16, name: 'Exchange Master Felix', class: 'npc npc-merchant', dialogue: 'Looking to exchange currencies? I offer the fairest rates.'},
            {x: 33, y: 16, name: 'Weaponsmith Drake', class: 'npc npc-merchant', dialogue: 'The finest blades and armor in all the land!'},
            {x: 21, y: 26, name: 'Innkeeper Rosa', class: 'npc npc-villager', dialogue: 'Our rooms are cozy and our ale is cold!'},
            {x: 26, y: 31, name: 'High Priest Marcus', class: 'npc npc-priest', dialogue: 'The cathedral welcomes all who seek solace.'},
            {x: 13, y: 11, name: 'Harbor Master', class: 'npc npc-villager', dialogue: 'Ships come and go daily. The sea trade keeps us prosperous.'},
            {x: 39, y: 11, name: 'Guild Leader', class: 'npc npc-elder', dialogue: 'Join our guild and take on the toughest quests!'},
            {x: 16, y: 36, name: 'Warehouse Keeper', class: 'npc npc-villager', dialogue: 'I\'ve got goods from all over the world stored here.'}
        ],
        enemies: [
            {x: 48, y: 38, name: 'City Thug', class: 'enemy-spawn enemy-goblin', hp: 45, maxHp: 45, attack: 12, xpReward: 30, goldReward: 25},
            {x: 8, y: 6, name: 'Alley Cat', class: 'enemy-spawn enemy-wolf', hp: 25, maxHp: 25, attack: 7, xpReward: 15, goldReward: 10},
            {x: 50, y: 12, name: 'Pickpocket', class: 'enemy-spawn enemy-goblin', hp: 35, maxHp: 35, attack: 9, xpReward: 22, goldReward: 18},
            {x: 6, y: 40, name: 'Dock Ruffian', class: 'enemy-spawn enemy-goblin', hp: 40, maxHp: 40, attack: 11, xpReward: 28, goldReward: 22},
            {x: 45, y: 20, name: 'Street Gang Leader', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 14, xpReward: 38, goldReward: 30}
        ],
        items: [
            {x: 40, y: 30, type: 'gold', value: 50},
            {x: 10, y: 18, type: 'health_potion', value: 2},
            {x: 44, y: 8, type: 'mana_potion', value: 2},
            {x: 28, y: 42, type: 'gold', value: 75},
            {x: 52, y: 25, type: 'key', value: 2},
            {x: 5, y: 22, type: 'treasure', value: 100},
            {x: 34, y: 5, type: 'gold', value: 60}
        ],
        areas: [
            {id: 1, name: 'Market District', x: 12, y: 8, width: 18, height: 12, color: 'rgba(251, 191, 36, 0.3)', description: 'Bustling marketplace'},
            {id: 2, name: 'Harbor Quarter', x: 5, y: 30, width: 15, height: 12, color: 'rgba(59, 130, 246, 0.3)', description: 'Busy docks'}
        ]
    };
}

function generateDungeon() {
    const width = 40;
    const height = 35;
    const terrain = generateSimpleGrid(width, height, 'dungeon');
    
    return {
        name: "Dark Caverns",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 20, y: 5, type: 'temple', name: 'Ancient Shrine', class: 'building temple'}
        ],
        npcs: [
            {x: 21, y: 6, name: 'Lost Explorer', class: 'npc npc-villager', dialogue: 'I\'ve been trapped here for days! Please, help me find the exit!'},
            {x: 15, y: 30, name: 'Cave Hermit', class: 'npc npc-elder', dialogue: 'These caves hold ancient secrets... and ancient dangers.'}
        ],
        enemies: [
            {x: 20, y: 20, name: 'Cave Bat', class: 'enemy-spawn enemy-goblin', hp: 40, maxHp: 40, attack: 12, xpReward: 28, goldReward: 20},
            {x: 10, y: 15, name: 'Giant Spider', class: 'enemy-spawn enemy-goblin', hp: 50, maxHp: 50, attack: 14, xpReward: 35, goldReward: 28},
            {x: 30, y: 25, name: 'Cave Troll', class: 'enemy-spawn enemy-wolf', hp: 70, maxHp: 70, attack: 18, xpReward: 50, goldReward: 40},
            {x: 8, y: 8, name: 'Rock Golem', class: 'enemy-spawn enemy-goblin', hp: 80, maxHp: 80, attack: 20, xpReward: 60, goldReward: 45},
            {x: 35, y: 10, name: 'Shadow Wraith', class: 'enemy-spawn enemy-wolf', hp: 60, maxHp: 60, attack: 16, xpReward: 45, goldReward: 35},
            {x: 5, y: 30, name: 'Cave Lizard', class: 'enemy-spawn enemy-goblin', hp: 45, maxHp: 45, attack: 13, xpReward: 30, goldReward: 24},
            {x: 38, y: 32, name: 'Dark Imp', class: 'enemy-spawn enemy-goblin', hp: 35, maxHp: 35, attack: 11, xpReward: 25, goldReward: 18}
        ],
        items: [
            {x: 15, y: 10, type: 'gold', value: 80},
            {x: 25, y: 18, type: 'health_potion', value: 3},
            {x: 32, y: 28, type: 'mana_potion', value: 3},
            {x: 12, y: 32, type: 'treasure', value: 150},
            {x: 36, y: 8, type: 'key', value: 3},
            {x: 28, y: 15, type: 'gold', value: 120}
        ],
        areas: [
            {id: 1, name: 'Upper Caverns', x: 5, y: 5, width: 30, height: 10, color: 'rgba(107, 114, 128, 0.3)', description: 'Dark winding passages'},
            {id: 2, name: 'Deep Chamber', x: 15, y: 25, width: 12, height: 8, color: 'rgba(220, 38, 38, 0.3)', description: 'Ancient ritual site'}
        ]
    };
}

function generateForestTemple() {
    const width = 45;
    const height = 40;
    const terrain = generateSimpleGrid(width, height, 'forest_temple');
    
    return {
        name: "Sacred Grove Temple",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 22, y: 20, type: 'temple', name: 'Ancient Temple', class: 'building temple'},
            {x: 15, y: 10, type: 'house', name: 'Druid\'s Hut', class: 'building house'},
            {x: 30, y: 30, type: 'house', name: 'Ranger\'s Cabin', class: 'building house'}
        ],
        npcs: [
            {x: 23, y: 21, name: 'High Druid Elara', class: 'npc npc-priest', dialogue: 'The forest spirits are restless. Dark forces threaten the grove.'},
            {x: 16, y: 11, name: 'Druid Apprentice', class: 'npc npc-villager', dialogue: 'My master teaches me the ways of nature magic.'},
            {x: 31, y: 31, name: 'Ranger Marcus', class: 'npc npc-villager', dialogue: 'I protect these woods from poachers and monsters.'},
            {x: 10, y: 25, name: 'Forest Sage', class: 'npc npc-elder', dialogue: 'The ancient trees whisper secrets to those who listen.'}
        ],
        enemies: [
            {x: 5, y: 5, name: 'Forest Wolf', class: 'enemy-spawn enemy-wolf', hp: 42, maxHp: 42, attack: 13, xpReward: 30, goldReward: 22},
            {x: 40, y: 8, name: 'Corrupted Treant', class: 'enemy-spawn enemy-goblin', hp: 65, maxHp: 65, attack: 17, xpReward: 48, goldReward: 38},
            {x: 8, y: 35, name: 'Wild Elemental', class: 'enemy-spawn enemy-wolf', hp: 55, maxHp: 55, attack: 15, xpReward: 40, goldReward: 32},
            {x: 38, y: 32, name: 'Shadow Beast', class: 'enemy-spawn enemy-wolf', hp: 70, maxHp: 70, attack: 19, xpReward: 55, goldReward: 42},
            {x: 20, y: 5, name: 'Poison Spider', class: 'enemy-spawn enemy-goblin', hp: 38, maxHp: 38, attack: 12, xpReward: 27, goldReward: 20}
        ],
        items: [
            {x: 12, y: 15, type: 'health_potion', value: 2},
            {x: 35, y: 18, type: 'mana_potion', value: 2},
            {x: 25, y: 35, type: 'gold', value: 90},
            {x: 42, y: 25, type: 'treasure', value: 130},
            {x: 18, y: 8, type: 'key', value: 2}
        ],
        areas: [
            {id: 1, name: 'Sacred Grove', x: 18, y: 16, width: 10, height: 10, color: 'rgba(16, 185, 129, 0.3)', description: 'Ancient temple grounds'}
        ]
    };
}

function generateDesertOasis() {
    const width = 50;
    const height = 35;
    const terrain = generateSimpleGrid(width, height, 'desert');
    
    return {
        name: "Mirage Oasis",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 25, y: 18, type: 'shop', name: 'Desert Trading Post', class: 'building house shop'},
            {x: 22, y: 22, type: 'inn', name: 'Oasis Inn', class: 'building house inn'},
            {x: 28, y: 22, type: 'temple', name: 'Sun Temple', class: 'building temple'}
        ],
        npcs: [
            {x: 26, y: 19, name: 'Merchant Khalid', class: 'npc npc-merchant', dialogue: 'Welcome, traveler! Rare goods from across the desert!'},
            {x: 23, y: 23, name: 'Innkeeper Amira', class: 'npc npc-villager', dialogue: 'Rest here and escape the scorching sun.'},
            {x: 29, y: 23, name: 'Sun Priest', class: 'npc npc-priest', dialogue: 'May the sun god bless your journey.'},
            {x: 15, y: 15, name: 'Desert Nomad', class: 'npc npc-villager', dialogue: 'The sands hide many secrets and treasures.'}
        ],
        enemies: [
            {x: 8, y: 8, name: 'Sand Scorpion', class: 'enemy-spawn enemy-goblin', hp: 38, maxHp: 38, attack: 11, xpReward: 26, goldReward: 19},
            {x: 45, y: 10, name: 'Desert Raider', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 14, xpReward: 33, goldReward: 26},
            {x: 12, y: 30, name: 'Sand Worm', class: 'enemy-spawn enemy-wolf', hp: 75, maxHp: 75, attack: 20, xpReward: 58, goldReward: 45},
            {x: 42, y: 28, name: 'Mummy Guardian', class: 'enemy-spawn enemy-goblin', hp: 62, maxHp: 62, attack: 17, xpReward: 47, goldReward: 36},
            {x: 5, y: 20, name: 'Dust Devil', class: 'enemy-spawn enemy-wolf', hp: 52, maxHp: 52, attack: 15, xpReward: 38, goldReward: 30}
        ],
        items: [
            {x: 18, y: 10, type: 'gold', value: 85},
            {x: 35, y: 12, type: 'health_potion', value: 2},
            {x: 10, y: 25, type: 'mana_potion', value: 2},
            {x: 46, y: 32, type: 'treasure', value: 140},
            {x: 30, y: 8, type: 'key', value: 2}
        ],
        areas: [
            {id: 1, name: 'Oasis Settlement', x: 20, y: 15, width: 12, height: 10, color: 'rgba(59, 130, 246, 0.3)', description: 'Life-giving water'}
        ]
    };
}

function generateMountainFortress() {
    const width = 40;
    const height = 45;
    const terrain = generateSimpleGrid(width, height, 'mountain');
    
    return {
        name: "Skyhold Fortress",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 18, y: 20, type: 'castle', name: 'Mountain Fortress', class: 'building castle'},
            {x: 15, y: 25, type: 'shop', name: 'Armory', class: 'building house shop'},
            {x: 24, y: 25, type: 'inn', name: 'Soldier\'s Barracks', class: 'building house inn'}
        ],
        npcs: [
            {x: 19, y: 21, name: 'Commander Steelheart', class: 'npc npc-elder', dialogue: 'Welcome to Skyhold! We guard the mountain passes.'},
            {x: 16, y: 26, name: 'Master Smith', class: 'npc npc-merchant', dialogue: 'The finest weapons forged in dragon fire!'},
            {x: 25, y: 26, name: 'Quartermaster', class: 'npc npc-villager', dialogue: 'Supplies are limited up here in the mountains.'},
            {x: 12, y: 15, name: 'Scout Captain', class: 'npc npc-villager', dialogue: 'We\'ve spotted dragon activity in the peaks.'}
        ],
        enemies: [
            {x: 8, y: 10, name: 'Mountain Golem', class: 'enemy-spawn enemy-goblin', hp: 85, maxHp: 85, attack: 22, xpReward: 65, goldReward: 50},
            {x: 35, y: 12, name: 'Ice Wyvern', class: 'enemy-spawn enemy-dragon', hp: 95, maxHp: 95, attack: 25, xpReward: 75, goldReward: 60},
            {x: 10, y: 38, name: 'Snow Troll', class: 'enemy-spawn enemy-wolf', hp: 78, maxHp: 78, attack: 21, xpReward: 60, goldReward: 48},
            {x: 32, y: 35, name: 'Frost Giant', class: 'enemy-spawn enemy-goblin', hp: 110, maxHp: 110, attack: 28, xpReward: 85, goldReward: 70},
            {x: 20, y: 5, name: 'Storm Elemental', class: 'enemy-spawn enemy-wolf', hp: 68, maxHp: 68, attack: 19, xpReward: 52, goldReward: 42}
        ],
        items: [
            {x: 25, y: 15, type: 'health_potion', value: 3},
            {x: 15, y: 35, type: 'mana_potion', value: 3},
            {x: 35, y: 25, type: 'gold', value: 120},
            {x: 8, y: 42, type: 'treasure', value: 180},
            {x: 28, y: 8, type: 'key', value: 3}
        ],
        areas: [
            {id: 1, name: 'Fortress Grounds', x: 12, y: 18, width: 16, height: 12, color: 'rgba(107, 114, 128, 0.3)', description: 'Military stronghold'}
        ]
    };
}

function generateSwampRuins() {
    const width = 48;
    const height = 42;
    const terrain = generateSimpleGrid(width, height, 'swamp');
    
    return {
        name: "Fetid Marshlands",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 24, y: 21, type: 'temple', name: 'Cursed Temple', class: 'building temple'},
            {x: 15, y: 15, type: 'house', name: 'Witch\'s Hut', class: 'building house'}
        ],
        npcs: [
            {x: 25, y: 22, name: 'Cursed Priest', class: 'npc npc-priest', dialogue: 'Turn back... this place is forsaken...'},
            {x: 16, y: 16, name: 'Swamp Witch', class: 'npc npc-elder', dialogue: 'I can brew potions... for a price.'},
            {x: 35, y: 30, name: 'Lost Adventurer', class: 'npc npc-villager', dialogue: 'I\'ve been wandering these cursed swamps for days!'}
        ],
        enemies: [
            {x: 10, y: 10, name: 'Swamp Zombie', class: 'enemy-spawn enemy-goblin', hp: 55, maxHp: 55, attack: 16, xpReward: 42, goldReward: 32},
            {x: 40, y: 15, name: 'Bog Monster', class: 'enemy-spawn enemy-wolf', hp: 72, maxHp: 72, attack: 20, xpReward: 56, goldReward: 44},
            {x: 8, y: 35, name: 'Poison Toad', class: 'enemy-spawn enemy-goblin', hp: 48, maxHp: 48, attack: 14, xpReward: 35, goldReward: 27},
            {x: 42, y: 38, name: 'Cursed Spirit', class: 'enemy-spawn enemy-wolf', hp: 65, maxHp: 65, attack: 18, xpReward: 50, goldReward: 39},
            {x: 20, y: 8, name: 'Swamp Serpent', class: 'enemy-spawn enemy-wolf', hp: 80, maxHp: 80, attack: 22, xpReward: 62, goldReward: 48},
            {x: 35, y: 10, name: 'Plague Rat Swarm', class: 'enemy-spawn enemy-goblin', hp: 42, maxHp: 42, attack: 13, xpReward: 30, goldReward: 23}
        ],
        items: [
            {x: 18, y: 25, type: 'health_potion', value: 3},
            {x: 30, y: 28, type: 'mana_potion', value: 3},
            {x: 12, y: 20, type: 'gold', value: 95},
            {x: 38, y: 35, type: 'treasure', value: 160},
            {x: 25, y: 12, type: 'key', value: 2}
        ],
        areas: [
            {id: 1, name: 'Cursed Ruins', x: 20, y: 18, width: 10, height: 8, color: 'rgba(139, 92, 246, 0.3)', description: 'Ancient evil lurks'}
        ]
    };
}

function generateCoastalPort() {
    const width = 52;
    const height = 38;
    const terrain = generateSimpleGrid(width, height, 'coastal');
    
    return {
        name: "Seabreeze Harbor",
        width: width,
        height: height,
        terrain: terrain,
        buildings: [
            {x: 25, y: 15, type: 'castle', name: 'Harbor Master\'s Tower', class: 'building castle'},
            {x: 18, y: 12, type: 'shop', name: 'Ship Supplies', class: 'building house shop'},
            {x: 32, y: 12, type: 'shop', name: 'Fish Market', class: 'building house shop'},
            {x: 20, y: 20, type: 'inn', name: 'Sailor\'s Haven', class: 'building house inn'},
            {x: 30, y: 20, type: 'temple', name: 'Sea God Temple', class: 'building temple'}
        ],
        npcs: [
            {x: 26, y: 16, name: 'Harbor Master', class: 'npc npc-elder', dialogue: 'Welcome to the busiest port on the coast!'},
            {x: 19, y: 13, name: 'Ship Vendor', class: 'npc npc-merchant', dialogue: 'Need supplies for your voyage? I\'ve got everything!'},
            {x: 33, y: 13, name: 'Fish Monger', class: 'npc npc-merchant', dialogue: 'Fresh catch of the day! Best seafood in town!'},
            {x: 21, y: 21, name: 'Tavern Keeper', class: 'npc npc-villager', dialogue: 'Sailors from all over the world stop here!'},
            {x: 31, y: 21, name: 'Sea Priest', class: 'npc npc-priest', dialogue: 'May the tides always favor your journey.'},
            {x: 15, y: 8, name: 'Old Sailor', class: 'npc npc-villager', dialogue: 'I\'ve sailed these waters for 40 years!'}
        ],
        enemies: [
            {x: 8, y: 32, name: 'Reef Shark', class: 'enemy-spawn enemy-wolf', hp: 58, maxHp: 58, attack: 17, xpReward: 44, goldReward: 34},
            {x: 45, y: 30, name: 'Sea Serpent', class: 'enemy-spawn enemy-dragon', hp: 88, maxHp: 88, attack: 24, xpReward: 68, goldReward: 54},
            {x: 12, y: 5, name: 'Pirate Raider', class: 'enemy-spawn enemy-goblin', hp: 52, maxHp: 52, attack: 15, xpReward: 38, goldReward: 30},
            {x: 42, y: 8, name: 'Dock Thug', class: 'enemy-spawn enemy-goblin', hp: 46, maxHp: 46, attack: 13, xpReward: 32, goldReward: 25},
            {x: 25, y: 35, name: 'Kraken Spawn', class: 'enemy-spawn enemy-wolf', hp: 95, maxHp: 95, attack: 26, xpReward: 75, goldReward: 60}
        ],
        items: [
            {x: 22, y: 25, type: 'health_potion', value: 2},
            {x: 28, y: 25, type: 'mana_potion', value: 2},
            {x: 38, y: 18, type: 'gold', value: 100},
            {x: 48, y: 35, type: 'treasure', value: 170},
            {x: 10, y: 10, type: 'key', value: 3},
            {x: 40, y: 5, type: 'gold', value: 80}
        ],
        areas: [
            {id: 1, name: 'Harbor District', x: 14, y: 8, width: 24, height: 16, color: 'rgba(59, 130, 246, 0.3)', description: 'Bustling port town'},
            {id: 2, name: 'Open Sea', x: 5, y: 28, width: 42, height: 8, color: 'rgba(30, 64, 175, 0.3)', description: 'Deep waters'}
        ]
    };
}

// ============================================
// TERRAIN GENERATION HELPER
// ============================================

function generateSimpleGrid(width, height, type) {
    const grid = [];
    
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = 'grass';
        }
    }
    
    if (type === 'village') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (x < 3 || x >= width - 3 || y < 2 || y >= height - 2) {
                    if (Math.random() < 0.4) grid[y][x] = 'forest';
                }
            }
        }
        
        const pondX = Math.floor(width * 0.25);
        const pondY = Math.floor(height * 0.3);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= 2) {
                    grid[pondY + dy][pondX + dx] = 'water';
                }
            }
        }
        
        const roadY = Math.floor(height / 2);
        for (let x = 0; x < width; x++) {
            grid[roadY][x] = 'road';
        }
        
        const roadX = Math.floor(width / 2);
        for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.8); y++) {
            grid[y][roadX] = 'road';
        }
    } else if (type === 'city') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (x % 8 === 0 || x % 8 === 1 || y % 8 === 0 || y % 8 === 1) {
                    grid[y][x] = 'road';
                }
            }
        }
    } else if (type === 'dungeon') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                grid[y][x] = Math.random() < 0.7 ? 'mountain' : 'grass';
            }
        }
        
        const pathY = Math.floor(height / 2);
        for (let x = 0; x < width; x++) {
            for (let dy = -2; dy <= 2; dy++) {
                grid[pathY + dy][x] = 'grass';
            }
        }
    } else if (type === 'forest_temple') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (Math.random() < 0.6) grid[y][x] = 'forest';
            }
        }
        
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= 5) {
                    grid[centerY + dy][centerX + dx] = 'grass';
                }
            }
        }
    } else if (type === 'desert') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                grid[y][x] = 'sand';
            }
        }
        
        const oasisX = Math.floor(width / 2);
        const oasisY = Math.floor(height / 2);
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= 4) {
                    grid[oasisY + dy][oasisX + dx] = 'grass';
                }
            }
        }
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= 2) {
                    grid[oasisY + dy][oasisX + dx] = 'water';
                }
            }
        }
    } else if (type === 'mountain') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                grid[y][x] = 'mountain';
            }
        }
        
        const my = Math.floor(height / 2);
        for (let x = 0; x < width; x++) {
            for (let dy = -3; dy <= 3; dy++) {
                grid[my + dy][x] = 'grass';
            }
        }
    } else if (type === 'swamp') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (Math.random() < 0.3) {
                    grid[y][x] = 'water';
                } else if (Math.random() < 0.2) {
                    grid[y][x] = 'forest';
                }
            }
        }
    } else if (type === 'coastal') {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (y > height * 0.65) {
                    grid[y][x] = 'water';
                } else if (y > height * 0.6) {
                    grid[y][x] = 'sand';
                }
            }
        }
    }
    
    return grid;
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

console.log('🗺️ Complete Map Importer Ready!');
console.log('   ✅ All 8 presets fully populated with NPCs, buildings, enemies, and items');
