const PVP_BROADCAST_DURATION = 180000; // 3 minutes
const PVP_MATCH_RANGE = 5;
const POSITION_STALE_THRESHOLD = 300000; // 5 minutes
let pvpChallengeMonitor = null;
let pendingChallenges = new Map(); // Track pending challenges by txId
let processedChallenges = new Map(); // Track processed challenge battleIds with timestamps
let activeChallenges = new Map(); // Track active outgoing challenges by opponent address

const pvpSharedState = window.pvpState || (window.pvpState = {
    broadcasts: new Map(),
    activeBattles: new Map()
});

const pvpBroadcasts = pvpSharedState.broadcasts;
const activePvPBattles = pvpSharedState.activeBattles; // Track ongoing PvP battles

// PVP BATTLE MONITORING & TIMEOUT FUNCTIONS

function createCombatantSnapshot(source = {}, address = null, fallbackName = 'Opponent') {
    const normalizeNumber = (value, fallback, minimum = null) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        if (minimum !== null) {
            return Math.max(minimum, numeric);
        }
        return numeric;
    };

    const baseMaxHp = normalizeNumber(source.maxHp ?? source.hp ?? 100, 100, 1);
    const baseMaxMp = normalizeNumber(source.maxMp ?? source.mp ?? 50, 50, 1);

    const snapshot = {
        address: address || source.address || null,
        name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : fallbackName,
        level: normalizeNumber(source.level, 1, 1),
        hp: normalizeNumber(source.hp ?? baseMaxHp, baseMaxHp, 0),
        maxHp: baseMaxHp,
        mp: normalizeNumber(source.mp ?? baseMaxMp, baseMaxMp, 0),
        maxMp: baseMaxMp,
        attack: normalizeNumber(source.attack, 10, 0),
        defense: normalizeNumber(source.defense, 5, 0),
        magic: normalizeNumber(source.magic, 5, 0),
        sprite: source.sprite || source.icon || null
    };

    if (snapshot.hp > snapshot.maxHp) {
        snapshot.hp = snapshot.maxHp;
    }

    snapshot.shortAddress = snapshot.address ? `${snapshot.address.slice(0, 4)}…${snapshot.address.slice(-4)}` : '';

    return snapshot;
}

async function monitorPvPBattle(opponentAddress, maxWaitSeconds = 60) {
    console.log('🔍 Starting battle monitor (simplified - timeout only)');

    if (!contract || !account) {
        console.error('Contract or account not initialized');
        return;
    }

    const checkInterval = 3000; // Check every 3 seconds
    let checksRemaining = Math.floor(maxWaitSeconds / (checkInterval / 1000));

    const monitorInterval = setInterval(async () => {
        checksRemaining--;

        // NOTE: Battle state checking is now handled by checkPvPBattleUpdates()
        // This monitor only handles extreme timeout

        // Timeout check (this is a backup - battles should end via blockchain state)
        if (checksRemaining <= 0) {
            clearInterval(monitorInterval);
            console.warn('⏰ PvP battle monitor timed out after', maxWaitSeconds, 'seconds');
            console.log('Note: This is a backup timeout. Battle should end via blockchain state check.');
        }
    }, checkInterval);

    return monitorInterval;
}

async function forfeitPvPBattle() {
    if (!contract || !account) return;
    
    try {
        console.log('🏳️ Forfeiting PvP battle...');
        
        // Send a transaction to reset battle state
        // This would need a "forfeit_pvp" method in your TEAL contract
        // For now, we'll just clear local state
        
        gameState.pvp.inPvPBattle = false;
        gameState.pvp.currentChallenge = null;
        gameState.pvp.isMyTurn = false;
        gameState.pvp.battleId = null;
        gameState.inBattle = false;
        
        // Try to update contract state if possible
        try {
            // This requires adding a "forfeit_pvp" method to the TEAL contract
            // For now, we'll just update position to signal we're out of battle
            await contract.updatePosition(account, gameState.player.x, gameState.player.y, { force: true, skipLoad: true });
        } catch (err) {
            console.warn('Could not update contract state:', err.message);
        }
        
        updateUI();
        closeModal();
        
        showFloatingText(
            'Forfeited PvP Battle',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ff0000'
        );
        
    } catch (error) {
        console.error('Failed to forfeit PvP battle:', error);
    }
}

// PVP CHALLENGE FUNCTIONS (Transaction Notes)

// ========== DEPRECATED CODE REMOVED ==========
// Old transaction note-based PvP challenge system removed.
// PvP now uses blockchain box storage:
// - joinWaitingList() to advertise availability
// - start_process() to create battles
// - update_process() for turns
// See acceptPvPChallenge() below for current implementation.
// =============================================

function closePvPModal() {
    document.getElementById('pvpModal').style.display = 'none';
    
    // Clear challenge monitor if active
    if (pvpChallengeMonitor) {
        clearInterval(pvpChallengeMonitor);
        pvpChallengeMonitor = null;
    }
}



// PVP SYSTEM WITH REAL TURN COORDINATION

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
        disablePvPReady();
    } else {
        showPvPWagerModal();
    }
}

function showPvPWagerModal() {
    document.getElementById('pvpWagerModal').style.display = 'flex';
    
    document.getElementById('wagerBoatsAvailable').textContent = gameState.inventory.boats || 0;
    document.getElementById('wagerKeysAvailable').textContent = gameState.inventory.keys || 0;
    document.getElementById('wagerPickaxeAvailable').textContent = gameState.inventory.pickaxe || 0;
    document.getElementById('wagerGoldAvailable').textContent = gameState.inventory.gold || 0;
    
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

    if (boatsWager > (gameState.inventory.boats || 0) ||
        keysWager > (gameState.inventory.keys || 0) ||
        pickaxeWager > (gameState.inventory.pickaxe || 0) ||
        goldWager > (gameState.inventory.gold || 0)) {
        showFloatingText('Insufficient resources!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    if (boatsWager === 0 && keysWager === 0 && pickaxeWager === 0 && goldWager < 10) {
        showFloatingText('Minimum wager: 10 gold or items!', gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    gameState.pvp.wager = {
        boats: boatsWager,
        keys: keysWager,
        pickaxe: pickaxeWager,
        gold: goldWager
    };

    closePvPWagerModal();
    await enablePvPReady();
}

async function enablePvPReady() {
    gameState.pvp.isReady = true;
    gameState.pvp.broadcastStart = Date.now();
    gameState.pvp.myBroadcastAddress = account.addr;

    const pvpBtn = document.getElementById('pvpReadyBtn');
    pvpBtn.textContent = '🛡️ PvP Active';
    pvpBtn.classList.add('pvp-active');

    showFloatingText('PvP Ready! Broadcasting...', 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#10b981'
    );
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#10b981');

    await broadcastPvPStatus();

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
    gameState.pvp.myBroadcastAddress = null;
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

let challengeCheckInterval = null;

function startPvPChallengeChecking() {
    if (!account || !indexerClient) {
        console.error('Cannot start challenge checking: wallet not connected');
        return;
    }
    
    if (challengeCheckInterval) {
        clearInterval(challengeCheckInterval);
    }
    
    challengeCheckInterval = setInterval(async () => {
        if (!account || !indexerClient || gameState.pvp.inPvPBattle) return;
        await checkForIncomingChallenges();
    }, 3000); // Check every 3 seconds for faster challenge detection
    
    // Initial check
    checkForIncomingChallenges();
    
}

async function checkForIncomingChallenges() {
    if (!account || !indexerClient || !contract) return;

    // Don't check for new challenges if already in battle
    if (gameState.pvp.inPvPBattle || gameState.inBattle) {
        console.log('⚔️ Already in battle - skipping challenge check');
        return;
    }

    // Clean up old processed challenges (older than 10 minutes)
    const now = Date.now();
    const CLEANUP_AGE = 10 * 60 * 1000; // 10 minutes
    for (const [battleId, timestamp] of processedChallenges.entries()) {
        if (now - timestamp > CLEANUP_AGE) {
            processedChallenges.delete(battleId);
        }
    }

    try {
        const currentRound = (await algodClient.status().do())['last-round'];
        const minRound = Math.max(0, currentRound - 1000);

        console.log('🔍 Checking for incoming PvP challenges via blockchain...');

        // Search for app call transactions to our contract (start_battle calls)
        const response = await indexerClient
            .searchForTransactions()
            .applicationID(APP_ID)
            .minRound(minRound)
            .limit(50)
            .do();

        console.log(`Found ${response.transactions.length} contract transactions to check`);

        for (const txn of response.transactions) {
            // Only process application call transactions
            if (txn['tx-type'] !== 'appl') continue;

            const appCall = txn['application-transaction'];
            if (!appCall || !appCall['application-args']) continue;

            try {
                // start_process (v3.2): method_selector, process_id (battleId), other_party (opponent), initial_state, timeout_rounds
                // We need to check for 5 method args (payment is separate in the group)
                const numArgs = appCall['application-args'].length;

                if (numArgs >= 5) {
                    // Verify this is a start_process call by checking method selector
                    const methodSelectorBytes = Uint8Array.from(atob(appCall['application-args'][0]), c => c.charCodeAt(0));

                    // Get expected selector for start_process(string,address,string,uint64)string
                    const expectedMethod = algosdk.ABIMethod.fromSignature('start_process(string,address,string,uint64)string');
                    const expectedSelector = expectedMethod.getSelector();

                    // Debug logging
                    console.log(`📋 Transaction with ${numArgs} args`);
                    console.log(`   Selector (got): ${Array.from(methodSelectorBytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    console.log(`   Selector (exp): ${Array.from(expectedSelector).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

                    // Check if method selector matches (first 4 bytes)
                    if (methodSelectorBytes.length < 4 ||
                        methodSelectorBytes[0] !== expectedSelector[0] ||
                        methodSelectorBytes[1] !== expectedSelector[1] ||
                        methodSelectorBytes[2] !== expectedSelector[2] ||
                        methodSelectorBytes[3] !== expectedSelector[3]) {
                        console.log('   ❌ Selector mismatch - skipping');
                        continue; // Not a start_process call, skip
                    }

                    console.log('✅ Found start_process call');

                    // Decode battleId (arg 1) - skip ARC4 length prefix
                    const battleIdBytes = Uint8Array.from(atob(appCall['application-args'][1]), c => c.charCodeAt(0));
                    const battleId = new TextDecoder().decode(battleIdBytes.slice(2));

                    // Decode opponent address (arg 2) - raw address bytes
                    const opponentBytes = Uint8Array.from(atob(appCall['application-args'][2]), c => c.charCodeAt(0));
                    const opponentAddress = algosdk.encodeAddress(opponentBytes);

                    console.log(`Battle ID: ${battleId.substring(0, 20)}...`);
                    console.log(`Opponent: ${opponentAddress}`);
                    console.log(`My address: ${account.addr}`);
                    console.log(`Match: ${opponentAddress === account.addr}`);

                    // Check if I'm the opponent being challenged
                    if (opponentAddress === account.addr) {
                        // Check if already processed
                        if (processedChallenges.has(battleId)) {
                            continue;  // Silently skip already processed
                        }

                        // Check if we already have a pending challenge for this specific battleId
                        if (gameState.pvp.pendingChallenge?.battleId === battleId) {
                            continue;  // Already showing modal for this battle
                        }

                        // Try to load battle state, but don't require it to show modal
                        // (handles race condition where transaction is visible before box is created)
                        let battleState = null;
                        let retryCount = 0;
                        const MAX_RETRIES = 3;

                        while (retryCount < MAX_RETRIES && !battleState) {
                            try {
                                battleState = await contract.loadBattle(battleId);
                                if (battleState) break;
                            } catch (loadError) {
                                console.log(`⏳ Battle box not ready yet (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                            }
                            retryCount++;
                            if (retryCount < MAX_RETRIES) {
                                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
                            }
                        }

                        // Check if battle is already accepted, completed, or resigned (skip if so)
                        if (battleState && (battleState.status === 'completed' || battleState.status === 'resigned' || battleState.status === 'accepted' || battleState.status === 'active')) {
                            console.log(`⏭️ Skipping battle with status: ${battleState.status}`);
                            processedChallenges.set(battleId, Date.now());
                            continue;
                        }

                        // Only show modal for 'pending' battles (new challenges)
                        if (battleState && battleState.status !== 'pending') {
                            console.log(`⏭️ Skipping battle - status is ${battleState.status}, not pending`);
                            processedChallenges.set(battleId, Date.now());
                            continue;
                        }

                        // Check age based on transaction timestamp (fallback if no battleState)
                        const txnTimestamp = txn['round-time'] ? txn['round-time'] * 1000 : Date.now();
                        const battleAge = Date.now() - (battleState?.timestamp || txnTimestamp);
                        const MAX_CHALLENGE_AGE = 5 * 60 * 1000; // 5 minutes

                        if (battleAge > MAX_CHALLENGE_AGE) {
                            processedChallenges.set(battleId, Date.now());
                            continue;  // Silently skip old battles
                        }

                        // Only log if battle is valid and recent
                        console.log('✅ New PvP challenge! BattleId:', battleId.substring(0, 20) + '...');

                        const challengerAddress = txn.sender;
                        processedChallenges.set(battleId, Date.now());

                        // Use wager from battle state if available, otherwise use defaults
                        const wager = battleState?.wager || {
                            boats: 0,
                            keys: 0,
                            pickaxe: 0,
                            gold: 10 // Default minimum wager
                        };

                        gameState.pvp.pendingChallenge = {
                            from: challengerAddress,
                            wager,
                            totalWager: {
                                boats: (wager.boats || 0) * 2,
                                keys: (wager.keys || 0) * 2,
                                pickaxe: (wager.pickaxe || 0) * 2,
                                gold: (wager.gold || 0) * 2
                            },
                            battleId: battleId,
                            txId: txn.id,
                            timestamp: Date.now(),
                            battleStateLoaded: !!battleState // Track if we loaded state successfully
                        };

                        const challengeData = {
                            type: 'pvp_challenge',
                            from: challengerAddress,
                            to: account.addr,
                            battleId: battleId,
                            wager
                        };

                        console.log('🎯 Showing PvP challenge modal (battleState loaded:', !!battleState, ')');
                        showPvPChallengeModal(challengeData, challengerAddress);
                    }
                } else if (numArgs > 0) {
                    console.log(`⏭️ Skipping transaction with ${numArgs} args (need 5+)`);
                }
            } catch (e) {
                console.error('❌ Error processing transaction:', e.message, e);
                continue;
            }
        }
    } catch (error) {
        console.error('Error checking for challenges:', error);
    }
}


function formatWagerText(wager) {
    if (!wager) {
        return '0 gold';
    }

    const parts = [];
    if (wager.gold) parts.push(`💰 ${wager.gold} gold`);
    if (wager.boats) parts.push(`⛵ ${wager.boats} boats`);
    if (wager.keys) parts.push(`🗝️ ${wager.keys} keys`);
    if (wager.pickaxe) parts.push(`⛏️ ${wager.pickaxe} pickaxe uses`);

    return parts.length > 0 ? parts.join(' • ') : '0 gold';
}

function showPvPChallengeModal(challengeData, fromAddress) {
    // Remove any existing modal
    const existing = document.getElementById('pvpChallengeModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pvpChallengeModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.8)';
    modal.style.zIndex = '10000';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    modal.innerHTML = `
        <div style="background: #1f2937; padding: 30px; border-radius: 12px; max-width: 400px; color: white;">
            <h2 style="color: #ef4444; margin-bottom: 20px;">⚔️ PvP Challenge!</h2>
            <p style="margin-bottom: 10px;">From: <strong>${fromAddress.substring(0, 8)}...${fromAddress.substring(fromAddress.length - 4)}</strong></p>
            <p style="margin-bottom: 20px;">Wager: <strong>${formatWagerText(challengeData.wager)}</strong></p>
            <div style="display: flex; gap: 10px;">
                <button id="acceptPvPBtn" style="flex: 1; padding: 12px; background: #10b981; border: none; border-radius: 6px; color: white; font-weight: bold; cursor: pointer;">
                    Accept
                </button>
                <button id="declinePvPBtn" style="flex: 1; padding: 12px; background: #ef4444; border: none; border-radius: 6px; color: white; font-weight: bold; cursor: pointer;">
                    Decline
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners
    document.getElementById('acceptPvPBtn').onclick = () => acceptPvPChallengeHandler();
    document.getElementById('declinePvPBtn').onclick = () => declinePvPChallengeHandler();
}

async function acceptPvPChallengeHandler() {
    if (!gameState.pvp.pendingChallenge || !account) {
        console.error('No pending challenge or no account');
        return;
    }

    const challenge = gameState.pvp.pendingChallenge;

    try {
        console.log('📝 Accepting challenge - battleId:', challenge.battleId);

        // Disable accept button to prevent double-click
        const acceptBtn = document.getElementById('acceptPvPBtn');
        if (acceptBtn) acceptBtn.disabled = true;

        // Load battle state with retry logic (handles race condition)
        let battleState = null;
        let retryCount = 0;
        const MAX_RETRIES = 5;

        while (retryCount < MAX_RETRIES && !battleState) {
            try {
                battleState = await contract.loadBattle(challenge.battleId);
                if (battleState) {
                    console.log(`✅ Battle state loaded on attempt ${retryCount + 1}`);
                    break;
                }
            } catch (loadError) {
                console.log(`⏳ Battle box not ready yet (attempt ${retryCount + 1}/${MAX_RETRIES}): ${loadError.message}`);
            }
            retryCount++;
            if (retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        if (!battleState) {
            throw new Error('Could not load battle state from blockchain');
        }

        console.log('📊 Battle state:', battleState);

        // CRITICAL: Update battle status to 'accepted' on blockchain
        // This signals to the challenger that we're ready
        console.log('📤 Updating battle status to accepted on blockchain...');

        const updatedState = {
            ...battleState,
            status: 'accepted',
            acceptedBy: account.addr,
            acceptedAt: Date.now()
        };

        await contract.writeBattleState(account, challenge.battleId, updatedState);
        console.log('✅ Battle status updated to accepted');

        // Close modal
        document.getElementById('pvpChallengeModal')?.remove();

        // Show notification
        showFloatingText('Challenge accepted! Starting battle...',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#10b981'
        );

        // Get opponent info from battle state or blockchain
        let opponent;
        try {
            const opponentState = await contract.loadPlayerState(challenge.from);
            if (opponentState) {
                console.log('✅ Loaded opponent state from blockchain:', opponentState);
                opponent = opponentState;
            } else {
                throw new Error('Opponent state not found');
            }
        } catch (error) {
            console.warn('⚠️ Failed to load opponent from blockchain, using fallback:', error.message);
            opponent = pvpBroadcasts.get(challenge.from) || otherPlayers.get(challenge.from) || {
                address: challenge.from,
                name: 'Challenger',
                level: 1,
                hp: 100,
                maxHp: 100,
                mp: 50,
                maxMp: 50,
                attack: 10,
                defense: 5,
                magic: 5
            };
        }

        // Use wager from battle state
        opponent.wager = battleState.wager || { boats: 0, keys: 0, pickaxe: 0, gold: 0 };
        gameState.pvp.pendingChallenge.wager = opponent.wager;
        gameState.pvp.pendingChallenge.totalWager = {
            boats: (opponent.wager.boats || 0) * 2,
            keys: (opponent.wager.keys || 0) * 2,
            pickaxe: (opponent.wager.pickaxe || 0) * 2,
            gold: (opponent.wager.gold || 0) * 2
        };

        console.log('💎 Wager from blockchain:', opponent.wager);
        console.log('🎯 Starting battle as receiver with battleId:', challenge.battleId);

        // Start the battle - receiver goes second (waits for challenger's first move)
        await startPvPBattle(opponent, challenge.from, false, challenge.battleId);

        // Clear challenge
        gameState.pvp.pendingChallenge = null;

    } catch (error) {
        console.error('Failed to accept challenge:', error);
        showFloatingText('Failed to accept challenge: ' + error.message,
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
        // Re-enable button on error
        const acceptBtn = document.getElementById('acceptPvPBtn');
        if (acceptBtn) acceptBtn.disabled = false;
    }
}

async function declinePvPChallengeHandler() {
    if (!gameState.pvp.pendingChallenge || !account) return;
    
    const challenge = gameState.pvp.pendingChallenge;
    
    try {
        const params = await algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const declineData = {
            type: 'pvp_decline',
            challengeTxId: challenge.txId,
            from: account.addr,
            timestamp: Date.now()
        };
        
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.addr,
            to: challenge.from,
            amount: 0,
            note: encoder.encode(JSON.stringify(declineData)),
            suggestedParams: params
        });
        
        const signedTxn = txn.signTxn(account.sk);

        try {
            await algodClient.sendRawTransaction(signedTxn).do();
            console.log('❌ Declined PvP challenge');
        } catch (txnError) {
            console.error('❌ Failed to send decline transaction:', txnError);
            console.error('Transaction error details:', {
                message: txnError.message,
                response: txnError.response?.text || txnError.response?.body,
                status: txnError.status
            });
            // Continue despite error - local state will be cleared anyway
        }
        
        processedChallenges.set(challenge.battleId || challenge.txId, Date.now());
        
        document.getElementById('pvpChallengeModal')?.remove();

        gameState.pvp.pendingChallenge = null;
        
        showFloatingText('Challenge declined', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#94a3b8'
        );
    } catch (error) {
        console.error('Failed to decline challenge:', error);
    }
}

// Blockchain-based matchmaking: Join waiting list
async function broadcastPvPStatus() {
    if (!account || !contract) return;

    try {
        const pvpData = {
            name: gameState.player.name,
            level: gameState.player.level,
            x: Math.floor(gameState.player.x),
            y: Math.floor(gameState.player.y),
            hp: gameState.player.hp,
            maxHp: gameState.player.maxHp,
            mp: gameState.player.mp,
            maxMp: gameState.player.maxMp,
            attack: gameState.player.attack,
            defense: gameState.player.defense,
            magic: gameState.player.magic,
            wager: gameState.pvp.wager,
            timestamp: Date.now()
        };

        // Join blockchain waiting list (100% spam-proof)
        await contract.joinWaitingList(account, pvpData);
        console.log('✅ Joined blockchain matchmaking');

    } catch (error) {
        console.error('Failed to join waiting list:', error);
        showFloatingText('Failed to join matchmaking!',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
    }
}

// Blockchain-based matchmaking: Load waiting players
async function loadPvPBroadcasts() {
    if (!contract) {
        console.log('⏳ loadPvPBroadcasts: Waiting for contract...');
        return;
    }

    try {
        // Get all waiting players from blockchain (spam-proof!)
        const waitingPlayers = await contract.getWaitingPlayers();

        pvpBroadcasts.clear();

        // Convert to map format (address -> playerData)
        const myAddress = account?.addr;
        for (const player of waitingPlayers) {
            if (myAddress && player.address === myAddress) continue; // Skip self
            pvpBroadcasts.set(player.address, player);
        }

        updatePvPBroadcastsList();
        console.log(`📡 Loaded ${waitingPlayers.length} players from blockchain matchmaking (showing ${pvpBroadcasts.size})`);
    } catch (error) {
        console.error('Failed to load waiting players:', error);
    }
}

function updatePvPBroadcastsList() {
    const list = document.getElementById('pvpBroadcastsList');
    list.innerHTML = '';

    const otherBroadcasts = Array.from(pvpBroadcasts.entries())
        .filter(([address]) => address !== account.addr);

    if (otherBroadcasts.length === 0) {
        if (gameState.pvp.isReady) {
            list.innerHTML = `
                <div style="text-align: center; padding: 20px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 2px solid #10b981;">
                    <div style="font-size: 24px; margin-bottom: 8px;">⚔️</div>
                    <div style="color: #10b981; font-weight: bold; margin-bottom: 8px;">
                        You're Broadcasting!
                    </div>
                    <div style="font-size: 12px; opacity: 0.9;">
                        Waiting for challengers...<br>
                        Others can see and challenge you
                    </div>
                </div>
            `;
        } else {
            list.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">No active PvP challenges</div>';
        }
        return;
    }

    otherBroadcasts.forEach(([address, data]) => {
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
                        `<button class="btn btn-primary" onclick="teleportToChallenger('${address}')" style="font-size: 11px; padding: 8px 12px;">⚡ Teleport</button>`
                    }
                </div>
            </div>
        `;

        list.appendChild(item);
    });
}

async function teleportToChallenger(targetAddress) {
    const opponent = pvpBroadcasts.get(targetAddress);
    if (!opponent) {
        showFloatingText('Challenge expired!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    gameState.player.x = opponent.x + 1;
    gameState.player.y = opponent.y;

    updateUI();
    renderWorld();
    centerCameraOnPlayer();
    checkLocation();

    if (contract && account) {
        try {
            await contract.updatePosition(account, gameState.player.x, gameState.player.y, { force: true, skipLoad: true });
        } catch (error) {
            console.warn('Failed to sync teleport position:', error.message);
        }
    }

    showFloatingText(`Teleported to ${opponent.name}!`, 
        gameState.player.x * 32 + 16, 
        gameState.player.y * 32 - 40, 
        '#3b82f6'
    );
    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#3b82f6');

    setTimeout(() => {
        showFloatingText('Click "Challenge!" to fight!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 60, 
            '#fbbf24'
        );
    }, 1000);
}

async function acceptPvPChallenge(targetAddress) {
    console.log('🎯 acceptPvPChallenge called with targetAddress:', targetAddress);

    // DUPLICATE PREVENTION: Check if already challenging this player
    if (activeChallenges.has(targetAddress)) {
        const existingChallenge = activeChallenges.get(targetAddress);
        const challengeAge = Date.now() - existingChallenge.timestamp;

        if (challengeAge < 60000) { // Less than 1 minute old
            showFloatingText('Challenge already sent! Please wait...',
                gameState.player.x * 32 + 16,
                gameState.player.y * 32 - 40,
                '#fbbf24'
            );
            return;
        } else {
            // Old challenge, clean it up
            activeChallenges.delete(targetAddress);
        }
    }

    const opponent = pvpBroadcasts.get(targetAddress);

    console.log('📊 Opponent data from waiting list:', opponent);

    if (!opponent) {
        console.error('❌ No opponent found in pvpBroadcasts for address:', targetAddress);
        showFloatingText('Challenge expired!',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
        return;
    }

    console.log('✅ Opponent found:', {
        name: opponent.name,
        level: opponent.level,
        address: opponent.address,
        wager: opponent.wager
    });

    const distance = Math.sqrt(
        Math.pow(gameState.player.x - opponent.x, 2) +
        Math.pow(gameState.player.y - opponent.y, 2)
    );

    if (distance > PVP_MATCH_RANGE) {
        showFloatingText('Too far! Use teleport button.',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
        return;
    }

    if (opponent.wager.boats > (gameState.inventory.boats || 0) ||
        opponent.wager.keys > (gameState.inventory.keys || 0) ||
        opponent.wager.pickaxe > (gameState.inventory.pickaxe || 0) ||
        opponent.wager.gold > (gameState.inventory.gold || 0)) {
        showFloatingText('Cannot match wager!',
            gameState.player.x * 32 + 16, gameState.player.y * 32 - 40, '#ef4444');
        return;
    }

    // Create battle on blockchain immediately (blockchain-based, no transaction notes!)
    try {
        showFloatingText('Creating battle on blockchain...',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#3b82f6'
        );

        // Generate battleId FIRST (must match between challenger and receiver)
        // Format: first8chars_first7chars_timestamp
        const addresses = [account.addr, targetAddress].sort();
        const timestamp = Date.now().toString().slice(-10);
        const battleId = `${addresses[0].substring(0, 8)}_${addresses[1].substring(0, 7)}_${timestamp}`;

        console.log(`📝 Creating PvP battle on-chain with ID: ${battleId}`);
        console.log('📝 Opponent wager:', opponent.wager);
        console.log('📝 Opponent full data:', opponent);

        // Create battle on blockchain using contract method - pass battleId AND wager data
        const txId = await contract.startPvPBattle(account, targetAddress, true, battleId, opponent.wager);

        console.log('✅ Battle created on blockchain successfully');
        console.log('✅ Battle ID:', battleId);
        console.log('✅ TxID:', txId);
        console.log('✅ Wager stored:', opponent.wager);

        // Remove opponent from broadcasts list immediately (they're now in battle)
        if (pvpBroadcasts.has(targetAddress)) {
            pvpBroadcasts.delete(targetAddress);
            updatePvPBroadcastsList();
            console.log('🧹 Removed opponent from broadcasts list (battle started)');
        }

        // Track active challenge to prevent duplicates
        activeChallenges.set(targetAddress, {
            battleId: battleId,
            timestamp: Date.now(),
            txId: txId
        });

        showFloatingText('Challenge sent! Opponent will be notified...',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#10b981'
        );

        console.log('👀 Starting to wait for acceptance...');
        // Start monitoring for acceptance via blockchain state
        startWaitingForChallengeAcceptance(targetAddress, opponent, battleId);

    } catch (error) {
        console.error('Failed to create battle:', error);
        activeChallenges.delete(targetAddress); // Clean up on error
        showFloatingText('Failed to send challenge: ' + error.message,
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
    }
}

// NEW: Monitor for challenge acceptance
let acceptanceCheckInterval = null;

async function startWaitingForChallengeAcceptance(opponentAddress, opponentData, battleId) {
    // Show waiting modal instead of starting battle immediately
    showWaitingForAcceptanceModal(opponentData, battleId);

    console.log('⏳ Waiting for opponent to accept challenge...');

    // Clear any existing interval
    if (acceptanceCheckInterval) {
        clearInterval(acceptanceCheckInterval);
    }

    // Poll for acceptance every 2 seconds
    let checksRemaining = 90; // 3 minutes timeout (90 * 2 seconds)

    acceptanceCheckInterval = setInterval(async () => {
        checksRemaining--;

        try {
            const battleState = await contract.loadBattle(battleId);

            if (!battleState) {
                console.warn('⚠️ Battle not found - may have been deleted');
                clearInterval(acceptanceCheckInterval);
                acceptanceCheckInterval = null;
                closeWaitingModal();
                showFloatingText('Challenge expired or declined',
                    gameState.player.x * 32 + 16,
                    gameState.player.y * 32 - 40,
                    '#ef4444'
                );
                activeChallenges.delete(opponentAddress);
                return;
            }

            console.log(`🔍 Checking acceptance status: ${battleState.status} (${checksRemaining} checks left)`);

            // Check if opponent accepted
            if (battleState.status === 'accepted') {
                console.log('✅ Opponent accepted! Starting battle...');
                clearInterval(acceptanceCheckInterval);
                acceptanceCheckInterval = null;
                closeWaitingModal();

                // Load fresh opponent state
                try {
                    const opponentState = await contract.loadPlayerState(opponentAddress);
                    if (opponentState) {
                        opponentData = opponentState;
                    }
                } catch (error) {
                    console.warn('⚠️ Failed to load opponent state:', error.message);
                }

                opponentData.wager = battleState.wager || { boats: 0, keys: 0, pickaxe: 0, gold: 0 };
                activeChallenges.delete(opponentAddress);

                // Now start the battle - challenger goes first
                await startPvPBattle(opponentData, opponentAddress, true, battleId);
                return;
            }

            // Check if opponent declined or battle was deleted
            if (battleState.status === 'declined' || battleState.status === 'resigned') {
                console.log('❌ Opponent declined the challenge');
                clearInterval(acceptanceCheckInterval);
                acceptanceCheckInterval = null;
                closeWaitingModal();
                showFloatingText('Challenge declined',
                    gameState.player.x * 32 + 16,
                    gameState.player.y * 32 - 40,
                    '#ef4444'
                );
                activeChallenges.delete(opponentAddress);
                return;
            }

        } catch (error) {
            console.error('Error checking acceptance:', error);
        }

        // Timeout check
        if (checksRemaining <= 0) {
            console.warn('⏰ Challenge acceptance timed out');
            clearInterval(acceptanceCheckInterval);
            acceptanceCheckInterval = null;
            closeWaitingModal();
            showFloatingText('Challenge timed out - no response',
                gameState.player.x * 32 + 16,
                gameState.player.y * 32 - 40,
                '#f59e0b'
            );
            activeChallenges.delete(opponentAddress);

            // Try to clean up the battle
            try {
                await contract.deleteBattle(account, battleId);
            } catch (e) {
                console.warn('Failed to cleanup timed out battle:', e.message);
            }
        }
    }, 2000);
}

function showWaitingForAcceptanceModal(opponent, battleId) {
    // Remove any existing modal
    closeWaitingModal();

    const modal = document.createElement('div');
    modal.id = 'pvpWaitingModal';
    modal.className = 'modal';
    modal.style.cssText = `
        display: flex;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        z-index: 10000;
        align-items: center;
        justify-content: center;
    `;

    modal.innerHTML = `
        <div style="background: #1f2937; padding: 30px; border-radius: 12px; max-width: 400px; color: white; text-align: center;">
            <h2 style="color: #fbbf24; margin-bottom: 20px;">⏳ Challenge Sent!</h2>
            <p style="margin-bottom: 10px;">Waiting for <strong>${opponent.name || 'opponent'}</strong> to accept...</p>
            <div style="margin: 20px 0;">
                <div class="spinner" style="
                    border: 4px solid #374151;
                    border-top: 4px solid #fbbf24;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                "></div>
            </div>
            <p style="font-size: 12px; opacity: 0.7; margin-bottom: 20px;">
                Battle will start automatically when accepted.<br>
                Timeout: 3 minutes
            </p>
            <button id="cancelChallengeBtn" style="
                padding: 12px 24px;
                background: #ef4444;
                border: none;
                border-radius: 6px;
                color: white;
                font-weight: bold;
                cursor: pointer;
            ">Cancel Challenge</button>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;

    document.body.appendChild(modal);

    document.getElementById('cancelChallengeBtn').onclick = async () => {
        if (acceptanceCheckInterval) {
            clearInterval(acceptanceCheckInterval);
            acceptanceCheckInterval = null;
        }
        closeWaitingModal();

        // Try to delete the battle
        try {
            await contract.deleteBattle(account, battleId);
            console.log('✅ Challenge cancelled');
        } catch (e) {
            console.warn('Failed to delete battle:', e.message);
        }

        showFloatingText('Challenge cancelled',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#94a3b8'
        );
    };
}

function closeWaitingModal() {
    const modal = document.getElementById('pvpWaitingModal');
    if (modal) modal.remove();
}

async function startPvPBattle(opponent, opponentAddress, iAmChallenger = false, sharedBattleId = null) {
    console.log('🎮 startPvPBattle called - iAmChallenger:', iAmChallenger);
    console.log('🎮 Opponent:', opponent);
    console.log('🎮 OpponentAddress:', opponentAddress);
    console.log('🎮 SharedBattleId:', sharedBattleId);

    try {
        gameState.pvp.inPvPBattle = true;
        gameState.inBattle = true;
        console.log('✅ Set inPvPBattle=true, inBattle=true');

        // Leave waiting list when battle starts (non-blocking)
        if (contract && account && gameState.pvp.isReady) {
            contract.leaveWaitingList(account).then(() => {
                console.log('✅ Left waiting list for battle');
            }).catch(error => {
                console.warn('Failed to leave waiting list (non-blocking):', error.message);
            });
        }

        // Remove opponent from local broadcasts list (they're now in battle with us)
        // This ensures they don't show in the UI while blockchain cleanup happens
        if (pvpBroadcasts.has(opponentAddress)) {
            pvpBroadcasts.delete(opponentAddress);
            updatePvPBroadcastsList();
            console.log('🧹 Removed opponent from broadcasts list (battle started)');
        }

        gameState.pvp.monitorHandle = await monitorPvPBattle(opponentAddress, 60);
        console.log('✅ Monitor started');

        // CRITICAL FIX: Ensure wager object exists and has all properties
        if (!opponent.wager) {
            opponent.wager = { boats: 0, keys: 0, pickaxe: 0, gold: 0 };
            console.log('⚠️ No wager on opponent, using default');
        }

        const wager = {
            boats: opponent.wager.boats || 0,
            keys: opponent.wager.keys || 0,
            pickaxe: opponent.wager.pickaxe || 0,
            gold: opponent.wager.gold || 0
        };
        console.log('💎 Wager:', wager);

        gameState.inventory.boats -= wager.boats;
        gameState.inventory.keys -= wager.keys;
        gameState.inventory.pickaxe -= wager.pickaxe;
        gameState.inventory.gold -= wager.gold;

        if (typeof markPlayerStateDirty === 'function') {
            markPlayerStateDirty('pvp-wager-lock');
        }

        updateUI();

        const isMyTurn = iAmChallenger ? true : false;

        // Update opponent in otherPlayers map to show they're in battle
        if (otherPlayers.has(opponentAddress)) {
            const opponentData = otherPlayers.get(opponentAddress);
            opponentData.inBattle = true;
            opponentData.isIdle = false;
            otherPlayers.set(opponentAddress, opponentData);
        }

        // CRITICAL FIX: Use shared battleId if provided, otherwise generate deterministic one
        let battleId;
        if (sharedBattleId) {
            battleId = sharedBattleId;
            console.log(`🔗 Using shared Battle ID: ${battleId}`);
        } else {
            // Generate deterministic battleId that both players will have
            // Sort addresses alphabetically to ensure both players generate same ID
            const addresses = [account.addr, opponentAddress].sort();
            battleId = `${addresses[0]}_${addresses[1]}_${Date.now()}`.substring(0, 50);
            console.log(`🆕 Generated new Battle ID: ${battleId}`);
        }

        console.log(`🎮 PvP Battle Starting - I am ${iAmChallenger ? 'CHALLENGER' : 'RECEIVER'}, my turn: ${isMyTurn}`);

        const opponentSnapshot = createCombatantSnapshot(opponent, opponentAddress, 'Opponent');
        const playerSnapshot = createCombatantSnapshot(gameState.player, account?.addr, gameState.player.name || 'You');

        gameState.pvp.currentChallenge = {
            opponent: opponentSnapshot,
            address: opponentAddress,
            battleId: battleId,
            totalWager: {
                boats: wager.boats * 2,
                keys: wager.keys * 2,
                pickaxe: wager.pickaxe * 2,
                gold: wager.gold * 2
            },
            isMyTurn: isMyTurn,
            turnNumber: 0,
            iAmChallenger: iAmChallenger,
            player: playerSnapshot
        };

        console.log('✅ currentChallenge set:', {
            battleId: gameState.pvp.currentChallenge.battleId,
            isMyTurn: gameState.pvp.currentChallenge.isMyTurn,
            turnNumber: gameState.pvp.currentChallenge.turnNumber
        });

        // IMPORTANT: Challenger should have ALREADY created battle before calling this function
        // This is just a safety check
        if (iAmChallenger && !sharedBattleId) {
            console.error('⚠️ Challenger called startPvPBattle without creating battle first!');
            // This shouldn't happen in the new flow
        } else if (!iAmChallenger) {
            console.log('📖 Receiver - battle already created by challenger, joining...');
        }

        // Broadcast battle start
        await broadcastPvPBattleStart(opponentAddress);

        console.log('🎬 Showing PvP battle modal...');
        showPvPBattleModal(opponentSnapshot);
        console.log('✅ startPvPBattle completed successfully');

        if (typeof checkPvPBattleUpdates === 'function') {
            checkPvPBattleUpdates();
        }

    } catch (error) {
        console.error('❌ CRITICAL ERROR in startPvPBattle:', error);
        console.error('Stack:', error.stack);

        // Clean up
        gameState.pvp.inPvPBattle = false;
        gameState.inBattle = false;
        gameState.pvp.currentChallenge = null;

        alert('Failed to start PvP battle: ' + error.message);
        throw error;
    }
}

// DEPRECATED: Battle state now tracked on blockchain via start_battle contract method
async function broadcastPvPBattleStart(opponentAddress) {
    // No-op: Transaction notes replaced by blockchain state
    console.log('✓ Battle tracked on blockchain (start_battle contract method)');
}

function showPvPBattleModal(opponent) {
    console.log('🎬 showPvPBattleModal called');
    console.log('Current state:', {
        inPvPBattle: gameState.pvp.inPvPBattle,
        inBattle: gameState.inBattle,
        hasCurrentChallenge: !!gameState.pvp.currentChallenge,
        currentChallenge: gameState.pvp.currentChallenge
    });

    // CRITICAL: Validate state before showing modal
    if (!gameState.pvp.currentChallenge) {
        console.error('❌ CRITICAL: Cannot show battle modal - currentChallenge is null!');
        console.error('State dump:', {
            inPvPBattle: gameState.pvp.inPvPBattle,
            inBattle: gameState.inBattle,
            opponent: opponent
        });
        alert('Error: Battle state is invalid. Please try again.');

        // Clean up invalid state
        gameState.pvp.inPvPBattle = false;
        gameState.inBattle = false;
        return;
    }

    const modal = document.getElementById('pvpBattleModal');

    const challenge = gameState.pvp.currentChallenge;
    const playerSnapshot = challenge.player || createCombatantSnapshot(gameState.player, account?.addr, gameState.player.name || 'You');
    const playerHp = Math.max(0, Math.floor(gameState.player.hp || playerSnapshot.hp || 0));
    const playerMaxHp = Math.max(1, Math.floor(gameState.player.maxHp || playerSnapshot.maxHp || 1));

    const playerNameEl = document.getElementById('pvpPlayerName');
    const playerLevelEl = document.getElementById('pvpPlayerLevel');
    const playerIdentity = document.getElementById('pvpPlayerIdentity');

    const resolvedPlayerName = (gameState.player.name || playerSnapshot.name || '').trim();
    if (playerNameEl) {
        playerNameEl.textContent = resolvedPlayerName ? `You — ${resolvedPlayerName}` : 'You';
    }
    if (playerLevelEl) {
        playerLevelEl.textContent = gameState.player.level || playerSnapshot.level || 1;
    }
    if (playerIdentity) {
        const playerShortAddress = playerSnapshot.shortAddress || (account?.addr ? `${account.addr.slice(0, 4)}…${account.addr.slice(-4)}` : '');
        playerIdentity.textContent = playerShortAddress ? `(${playerShortAddress})` : '(You)';
    }

    const playerHpPercent = Math.min(100, (playerHp / playerMaxHp) * 100);
    const playerHpBar = document.getElementById('pvpPlayerHpBar');
    if (playerHpBar) {
        playerHpBar.style.width = `${playerHpPercent}%`;
        playerHpBar.setAttribute('data-percent', Math.round(playerHpPercent));
    }

    const playerHpLabel = document.getElementById('pvpPlayerHpLabel');
    if (playerHpLabel) {
        playerHpLabel.textContent = `${playerHp} / ${playerMaxHp}`;
    }

    const playerHpMeta = document.getElementById('pvpPlayerHpMeta');
    if (playerHpMeta) {
        playerHpMeta.textContent = `${playerHp} HP • ${Math.round(playerHpPercent)}%`;
    }

    // BUGFIX: Ensure opponent snapshot has correct name from otherPlayers if available
    let opponentSnapshot = opponent || challenge.opponent || createCombatantSnapshot({}, challenge.address, 'Opponent');

    // If opponent snapshot has default name but we have real player data, use that
    if (opponentSnapshot && challenge.address && otherPlayers.has(challenge.address)) {
        const realOpponentData = otherPlayers.get(challenge.address);
        if (realOpponentData.name && realOpponentData.name !== 'Opponent') {
            opponentSnapshot.name = realOpponentData.name;
        }
    }

    challenge.opponent = opponentSnapshot;

    const opponentMaxHp = Math.max(1, Math.floor(opponentSnapshot.maxHp || opponentSnapshot.hp || 1));
    const opponentHp = Math.max(0, Math.floor(opponentSnapshot.hp || opponentMaxHp));

    const opponentNameEl = document.getElementById('pvpOpponentName');
    const opponentLevelEl = document.getElementById('pvpOpponentLevel');
    const opponentIdentity = document.getElementById('pvpOpponentIdentity');

    if (opponentNameEl) {
        const playerName = gameState.player.name || playerSnapshot.name;
        const sameName = opponentSnapshot.name && playerName && opponentSnapshot.name === playerName;
        const suffix = sameName && opponentSnapshot.address !== playerSnapshot.address ? ' (Opponent)' : '';
        const baseName = (opponentSnapshot.name || '').trim();
        const displayName = baseName && baseName.toLowerCase() !== 'opponent' ? `Opponent — ${baseName}${suffix}` : 'Opponent';
        opponentNameEl.textContent = displayName;
    }
    if (opponentLevelEl) {
        opponentLevelEl.textContent = opponentSnapshot.level || 1;
    }
    if (opponentIdentity) {
        if (opponentSnapshot.address && !opponentSnapshot.shortAddress) {
            opponentSnapshot.shortAddress = `${opponentSnapshot.address.slice(0, 4)}…${opponentSnapshot.address.slice(-4)}`;
        }
        opponentIdentity.textContent = opponentSnapshot.shortAddress ? `(${opponentSnapshot.shortAddress})` : '(Opponent)';
    }

    const opponentHpPercent = Math.min(100, (opponentHp / opponentMaxHp) * 100);
    const opponentHpBar = document.getElementById('pvpOpponentHpBar');
    if (opponentHpBar) {
        opponentHpBar.style.width = `${opponentHpPercent}%`;
        opponentHpBar.setAttribute('data-percent', Math.round(opponentHpPercent));
    }

    const opponentHpLabel = document.getElementById('pvpOpponentHpLabel');
    if (opponentHpLabel) {
        opponentHpLabel.textContent = `${opponentHp} / ${opponentMaxHp}`;
    }

    const opponentHpMeta = document.getElementById('pvpOpponentHpMeta');
    if (opponentHpMeta) {
        opponentHpMeta.textContent = `${opponentHp} HP • ${Math.round(opponentHpPercent)}%`;
    }

    const wager = gameState.pvp.currentChallenge.totalWager;
    console.log('💎 Displaying wager:', wager);

    document.getElementById('pvpWagerDisplay').innerHTML = `
        <strong>Winner Takes All:</strong><br>
        ⛵ ${wager.boats} Boats | 🗝️ ${wager.keys} Keys | ⛏️ ${wager.pickaxe} Pickaxe Uses | 💰 ${wager.gold} Gold
    `;

    document.getElementById('pvpBattleLog').innerHTML = '';
    addPvPBattleLog(`⚔️ PvP Battle: ${gameState.player.name} vs ${opponentSnapshot.name}!`, 'log-info');
    addPvPBattleLog(`💎 Fighting for ${wager.gold}g, ${wager.boats} boats, ${wager.keys} keys, ${wager.pickaxe} pickaxe!`, 'log-info');

    // Show correct turn message
    if (gameState.pvp.currentChallenge.isMyTurn) {
        addPvPBattleLog(`🎯 It's YOUR turn! Choose your action.`, 'log-info');
    } else {
        addPvPBattleLog(`⏳ Opponent's turn - waiting...`, 'log-info');
    }

    // CRITICAL: Ensure modal is visible even on mobile devices
    modal.style.display = 'flex';
    modal.style.zIndex = '2000'; // Higher than mobile controls (500)
    console.log('✅ Modal displayed with z-index 2000');

    // FIX #2: Add Resign button dynamically
    const existingResignBtn = document.getElementById('pvpResignBtn');
    if (existingResignBtn) existingResignBtn.remove();

    const resignBtn = document.createElement('button');
    resignBtn.id = 'pvpResignBtn';
    resignBtn.className = 'btn btn-danger';
    resignBtn.textContent = '🏳️ Resign';
    resignBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #dc2626; z-index: 10001;';
    resignBtn.onclick = () => resignPvPBattle();

    modal.appendChild(resignBtn);

    // Hide mobile controls when battle modal opens
    const mobileControls = document.getElementById('mobile-controls');
    if (mobileControls) {
        mobileControls.style.display = 'none';
    }

    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#dc2626');
}

async function pvpBattleAction(action) {
    console.log('🎮 pvpBattleAction called:', action);

    const state = gameState.pvp.currentChallenge;
    if (!state) {
        console.error('❌ No current challenge');
        return;
    }

    if (state.opponent.hp <= 0) {
        console.log('❌ Opponent already defeated');
        return;
    }

    if (!state.isMyTurn) {
        console.log('⏳ Not my turn - isMyTurn:', state.isMyTurn);
        addPvPBattleLog(`⏳ Wait for opponent's turn!`, 'log-info');
        return;
    }

    // Disable buttons while processing turn
    const actionButtons = document.querySelectorAll('#pvpBattleModal button');
    actionButtons.forEach(btn => btn.disabled = true);

    console.log('✅ Executing action:', action);
    let playerDamage = 0;
    let actionValid = true;

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
            state.opponent.hp = Math.max(0, state.opponent.hp - playerDamage);
            break;

        case 'magic':
            if (gameState.player.mp >= 15) {
                playerDamage = Math.floor(Math.random() * gameState.player.magic) + 12;
                gameState.player.mp -= 15;
                state.opponent.hp = Math.max(0, state.opponent.hp - playerDamage);
                addPvPBattleLog(`✨ Magic blast deals ${playerDamage} damage!`, 'log-damage');
                flashStatBar('mp', 'damage');
            } else {
                addPvPBattleLog(`⚠️ Insufficient mana!`, 'log-info');
                actionValid = false;
            }
            break;

        case 'defend':
            gameState.player.defense += 5;
            addPvPBattleLog(`🛡️ You raise your defenses! (+5 DEF)`, 'log-heal');
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
                actionValid = false;
            }
            break;

        case 'special':
            if (gameState.player.mp >= 25) {
                playerDamage = Math.floor(gameState.player.attack * 1.8 + Math.random() * 20);
                gameState.player.mp -= 25;
                state.opponent.hp = Math.max(0, state.opponent.hp - playerDamage);
                addPvPBattleLog(`🔥 ULTIMATE ATTACK! ${playerDamage} massive damage!`, 'log-damage');
                flashStatBar('mp', 'damage');
                createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#fbbf24');
            } else {
                addPvPBattleLog(`⚠️ Need 25 MP for special attack!`, 'log-info');
                actionValid = false;
            }
            break;
    }

    if (!actionValid) {
        // Re-enable buttons if action was invalid
        actionButtons.forEach(btn => btn.disabled = false);
        return;
    }

    updatePvPBattleUI();
    updateUI();

    if (state.opponent.hp <= 0) {
        pvpPlayerVictory();
        return;
    }

    // Store previous turn state for rollback on failure
    const previousTurnNumber = state.turnNumber;

    // Increment turn BEFORE broadcasting
    state.turnNumber++;
    state.isMyTurn = false;

    addPvPBattleLog(`📤 Submitting turn to blockchain...`, 'log-info');

    // Broadcast turn to blockchain with error handling
    try {
        await broadcastPvPTurn(action, playerDamage);
        addPvPBattleLog(`⏳ Waiting for opponent...`, 'log-info');
    } catch (error) {
        console.error('❌ Failed to broadcast turn:', error);
        // Rollback turn state on failure
        state.turnNumber = previousTurnNumber;
        state.isMyTurn = true;
        addPvPBattleLog(`❌ Turn failed to sync! Try again.`, 'log-damage');
        // Re-enable buttons so player can retry
        actionButtons.forEach(btn => btn.disabled = false);
        return;
    }

    // Keep buttons disabled while waiting for opponent
    // They will be re-enabled when it's our turn again (in processPvPOpponentTurn)
}

// Update battle state on blockchain using contract method
async function broadcastPvPTurn(action, damage) {
    if (!account || !contract) {
        throw new Error('Wallet not connected');
    }

    const state = gameState.pvp.currentChallenge;

    // CRITICAL: Load existing battle state and MERGE with new data
    const existingState = await contract.loadBattle(state.battleId);

    if (!existingState) {
        throw new Error('Cannot load battle state from blockchain');
    }

    // Merge new turn data with existing state (preserve wager, challenger, etc.)
    const updatedState = {
        ...existingState,  // Keep all existing fields (wager, challenger, opponent, etc.)
        turnNumber: state.turnNumber,
        action: action,
        damage: damage,
        player1: {
            address: state.iAmChallenger ? account.addr : state.address,
            hp: state.iAmChallenger ? gameState.player.hp : state.opponent.hp,
            maxHp: state.iAmChallenger ? gameState.player.maxHp : (state.opponent.maxHp || 100),
            mp: state.iAmChallenger ? gameState.player.mp : (state.opponent.mp || 100),
            maxMp: state.iAmChallenger ? gameState.player.maxMp : (state.opponent.maxMp || 100)
        },
        player2: {
            address: state.iAmChallenger ? state.address : account.addr,
            hp: state.iAmChallenger ? state.opponent.hp : gameState.player.hp,
            maxHp: state.iAmChallenger ? (state.opponent.maxHp || 100) : gameState.player.maxHp,
            mp: state.iAmChallenger ? (state.opponent.mp || 100) : gameState.player.mp,
            maxMp: state.iAmChallenger ? (state.opponent.maxMp || 100) : gameState.player.maxMp
        },
        status: 'active',
        currentTurn: state.address,  // Next player's turn (opponent)
        lastUpdated: account.addr,
        timestamp: Date.now()
    };

    console.log(`📤 Submitting turn ${updatedState.turnNumber} to blockchain: ${action} (${damage} damage)`);

    // Use blockchain contract method - this will throw on failure
    await contract.submitPvPTurn(
        account,
        state.battleId,
        updatedState
    );

    console.log('✅ Turn submitted successfully to blockchain');
}

// Check for opponent's turns using blockchain state
async function checkPvPBattleUpdates() {
    if (!gameState.pvp.inPvPBattle || !gameState.pvp.currentChallenge) {
        console.log('⏭️ checkPvPBattleUpdates: Not in battle, skipping');
        return;
    }

    const state = gameState.pvp.currentChallenge;
    if (state.isMyTurn) {
        console.log('⏭️ checkPvPBattleUpdates: My turn, waiting for me to act');
        return; // Don't check if it's our turn
    }

    console.log('🔄 checkPvPBattleUpdates: Checking for opponent turn...');

    try {
        // Load battle state directly from blockchain
        const battleState = await contract.loadBattle(state.battleId);

        if (!battleState) {
            console.warn('⚠️ Battle not found on blockchain - opponent likely resigned');
            alert('Battle ended - opponent resigned or battle was deleted.');
            endPvPBattle(false);
            return;
        }

        console.log('📦 Loaded battle state from blockchain:', {
            status: battleState.status,
            turnNumber: battleState.turnNumber,
            currentTurn: battleState.currentTurn?.substring(0, 8) + '...',
            action: battleState.action,
            damage: battleState.damage,
            wager: battleState.wager
        });

        // Check if battle is expired
        const isExpired = await contract.isBattleExpired(state.battleId);
        if (isExpired) {
            console.log('⏰ Battle expired - ending automatically');
            alert('Battle expired due to timeout');
            endPvPBattle(false);
            return;
        }

        // Check for status changes
        if (battleState.status === 'resigned') {
            console.log('🏳️ Opponent resigned!');
            alert('Your opponent has resigned. You win!');
            // Apply victory stats when opponent resigns
            await pvpPlayerVictory();
            return;
        }

        if (battleState.status === 'completed') {
            console.log('✅ Battle completed');
            const won = battleState.winner === account.addr;

            // Apply stat changes based on battle outcome
            if (won) {
                await pvpPlayerVictory();
            } else {
                await pvpPlayerDefeat();
            }
            return;
        }

        // Check if it's now our turn (opponent made a move)
        console.log('📊 Turn check:', {
            currentTurn: battleState.currentTurn?.substring(0, 8) + '...',
            myAddress: account.addr.substring(0, 8) + '...',
            isMyTurnNow: battleState.currentTurn === account.addr,
            blockchainTurn: battleState.turnNumber,
            localTurn: state.turnNumber,
            turnIncreased: battleState.turnNumber > state.turnNumber,
            READY_TO_PROCESS: battleState.currentTurn === account.addr && battleState.turnNumber > state.turnNumber
        });

        if (battleState.currentTurn === account.addr &&
            battleState.turnNumber > state.turnNumber) {

            console.log(`✅ TURN DETECTED! Opponent made move: ${battleState.action} (${battleState.damage} damage)`);

            // Process opponent's turn
            processPvPOpponentTurn(battleState);
            return;
        }

        console.log(`⏳ Still waiting for opponent's turn...`);

    } catch (error) {
        console.error('Failed to check PvP updates:', error);
    }
}

function processPvPOpponentTurn(battleState) {
    const state = gameState.pvp.currentChallenge;

    // Update local battle state
    state.turnNumber = battleState.turnNumber;

    addPvPBattleLog(`⚡ ${state.opponent.name} used ${battleState.action}!`, 'log-damage');

    if (battleState.damage > 0) {
        gameState.player.hp = Math.max(0, gameState.player.hp - battleState.damage);
        addPvPBattleLog(`💔 You took ${battleState.damage} damage!`, 'log-damage');
        flashStatBar('hp', 'damage');
    }

    // Update opponent's HP from blockchain state
    const opponentData = battleState.player1?.address === account.addr ?
        battleState.player2 : battleState.player1;

    if (opponentData) {
        if (opponentData.hp !== undefined) {
            state.opponent.hp = opponentData.hp;
        }
        if (opponentData.maxHp !== undefined) {
            state.opponent.maxHp = opponentData.maxHp;
        }
    }

    updatePvPBattleUI();
    updateUI();

    if (gameState.player.hp <= 0) {
        pvpPlayerDefeat();
        return;
    }

    state.isMyTurn = true;
    addPvPBattleLog(`🎯 Your turn!`, 'log-info');

    // Re-enable action buttons now that it's our turn
    const actionButtons = document.querySelectorAll('#pvpBattleModal button:not(#pvpResignBtn)');
    actionButtons.forEach(btn => btn.disabled = false);
}

async function finalizePvPBattleOnChain(victory) {
    if (!account || !contract || !gameState.pvp.currentChallenge) {
        return;
    }

    const state = gameState.pvp.currentChallenge;

    try {
        const battleState = await contract.loadBattle(state.battleId);

        if (!battleState) {
            console.warn('⚠️ Unable to finalize battle: no blockchain state found');
            return;
        }

        if (battleState.status === 'completed' && battleState.winner) {
            console.log('ℹ️ Battle already finalized on blockchain');
            return;
        }

        const winner = victory ? account.addr : state.address;
        const loser = victory ? state.address : account.addr;

        const completedAt = Date.now();

        const updates = {
            status: 'completed',
            winner,
            loser,
            currentTurn: null,
            completedAt,
            wager: {
                ...(battleState.wager || {}),
                claimedBy: winner,
                resolved: true,
                resolvedAt: completedAt
            }
        };

        const mergedState = contract.mergeBattleState(battleState, updates);
        await contract.writeBattleState(account, state.battleId, mergedState);
        console.log('🏁 Battle finalized on blockchain');

        // Auto-cleanup: Delete battle box to reclaim MBR (cost-effective for players)
        try {
            console.log('🧹 Auto-cleaning battle box...');
            await contract.resignBattle(account, state.battleId);
            console.log('✅ Battle resigned (finalized)');
            await contract.deleteBattle(account, state.battleId);
            console.log('💰 Battle box deleted - MBR refunded (~0.12 ALGO)');
            addPvPBattleLog('💰 Battle cleaned up - MBR refunded!', 'log-heal');
        } catch (cleanupError) {
            // Non-critical error - battle is already finalized
            console.warn('⚠️ Battle cleanup failed (non-critical):', cleanupError.message);
            // Battle is finalized, cleanup can be done manually later if needed
        }
    } catch (error) {
        console.error('Failed to finalize PvP battle on blockchain:', error);
    }
}

async function persistPvPOutcomeState() {
    if (!contract || !account) {
        return;
    }

    try {
        let preparedState = null;

        if (typeof buildPlayerStatePayload === 'function') {
            preparedState = buildPlayerStatePayload(gameState);
            if (!preparedState || typeof preparedState !== 'object') {
                preparedState = null;
            }
        }

        if (preparedState) {
            preparedState.timestamp = Date.now();

            if (typeof refreshPlayerStateCache === 'function') {
                refreshPlayerStateCache(preparedState);
            }

            if (gameState?.player) {
                gameState.player.timestamp = preparedState.timestamp;
                gameState.player.lastSynced = preparedState.timestamp;
            }
        }

        await contract.saveProgress(
            account,
            gameState,
            preparedState ? { prebuiltState: preparedState } : {}
        );
        await contract.updatePosition(
            account,
            Math.floor(gameState.player.x),
            Math.floor(gameState.player.y),
            { force: true, skipLoad: true }
        );
        console.log('💾 PvP outcome saved to blockchain');
    } catch (error) {
        console.warn('Failed to persist PvP outcome:', error.message);
    }
}

async function pvpPlayerVictory() {
    const wager = gameState.pvp.currentChallenge.totalWager;

    gameState.inventory.boats += wager.boats;
    gameState.inventory.keys += wager.keys;
    gameState.inventory.pickaxe += wager.pickaxe;
    gameState.inventory.gold += wager.gold;
    
    const xpGain = Math.floor(gameState.pvp.currentChallenge.opponent.level * 50);
    gameState.player.xp += xpGain;

    if (typeof markPlayerStateDirty === 'function') {
        markPlayerStateDirty('pvp-victory');
    }

    addPvPBattleLog(`🎉 VICTORY! You defeated ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-heal');
    addPvPBattleLog(`💰 You won: ${wager.boats}⛵ ${wager.keys}🗝️ ${wager.pickaxe}⛏️ ${wager.gold}💰`, 'log-heal');
    addPvPBattleLog(`⭐ Gained ${xpGain} XP!`, 'log-heal');

    checkLevelUp();
    updateUI();

    // Broadcast result
    broadcastPvPResult(true);

    await finalizePvPBattleOnChain(true);
    await persistPvPOutcomeState();

    setTimeout(() => endPvPBattle(true), 3000);
}

async function pvpPlayerDefeat() {
    addPvPBattleLog(`💀 DEFEAT! You were bested by ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-damage');
    addPvPBattleLog(`💸 You lost your wager...`, 'log-damage');

    gameState.player.hp = Math.floor(gameState.player.maxHp * 0.25);

    if (typeof markPlayerStateDirty === 'function') {
        markPlayerStateDirty('pvp-defeat');
    }

    updateUI();

    // Broadcast result
    broadcastPvPResult(false);

    await finalizePvPBattleOnChain(false);
    await persistPvPOutcomeState();

    setTimeout(() => endPvPBattle(false), 3000);
}

// DEPRECATED: Battle results now tracked on blockchain via update_battle contract method
async function broadcastPvPResult(victory) {
    // No-op: Transaction notes replaced by blockchain state
    console.log('✓ Battle result tracked on blockchain (update_battle contract method)');
}


// Resign/Exit Battle Function using blockchain
async function resignPvPBattle() {
    console.log('🏳️ resignPvPBattle called');

    if (!gameState.pvp.inPvPBattle) {
        console.log('❌ Not in PvP battle');
        return;
    }

    const confirmResign = confirm(
        '⚠️ Are you sure you want to resign? ' +
        'You will lose your wagered items and the match.'
    );

    if (!confirmResign) {
        console.log('Resignation cancelled by user');
        return;
    }

    try {
        // Submit resignation to blockchain using contract method
        if (account && contract && gameState.pvp.currentChallenge) {
            console.log('🏳️ Submitting resignation to blockchain...');
            console.log('BattleId:', gameState.pvp.currentChallenge.battleId);

            await contract.resignBattle(
                account,
                gameState.pvp.currentChallenge.battleId
            );

            console.log('✅ Resignation recorded on blockchain');
            alert('You resigned from the battle. Your opponent wins the wager.');
        } else {
            console.error('Missing:', {
                account: !!account,
                contract: !!contract,
                challenge: !!gameState.pvp.currentChallenge
            });
        }

    } catch (error) {
        console.error('❌ Failed to resign on blockchain:', error);
        alert('Resigned from battle (local only - network error: ' + error.message + ')');
    } finally {
        // Clean up battle state
        gameState.pvp.inPvPBattle = false;
        gameState.inBattle = false;
        gameState.pvp.currentChallenge = null;

        document.getElementById('pvpBattleModal').style.display = 'none';

        // Restore mobile controls only on actual mobile devices (let CSS media query handle it)
        const mobileControls = document.getElementById('mobile-controls');
        if (mobileControls) {
            // Remove inline style to let CSS media query determine visibility
            mobileControls.style.display = '';
        }

        if (gameState.pvp.isReady) {
            disablePvPReady();
        }

        updateUI();
    }
}

function endPvPBattle(victory) {
    // Capture opponent address before clearing state (for cleanup)
    const opponentAddress = gameState.pvp.currentChallenge?.address;

    gameState.pvp.inPvPBattle = false;
    gameState.inBattle = false;
    gameState.pvp.currentChallenge = null;

    document.getElementById('pvpBattleModal').style.display = 'none';

    // Remove opponent from broadcasts list (cleanup in case they weren't removed earlier)
    if (opponentAddress && pvpBroadcasts.has(opponentAddress)) {
        pvpBroadcasts.delete(opponentAddress);
        updatePvPBroadcastsList();
        console.log('🧹 Removed opponent from broadcasts list (battle ended)');
    }

    // Restore mobile controls only on actual mobile devices (let CSS media query handle it)
    const mobileControls = document.getElementById('mobile-controls');
    if (mobileControls) {
        // Remove inline style to let CSS media query determine visibility
        mobileControls.style.display = '';
    }

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

    if (gameState.pvp.isReady) {
        disablePvPReady();
    }

    // Refresh the waiting list to remove completed battles
    // Do immediate refresh first, then delayed refresh to catch blockchain updates
    if (typeof loadPvPBroadcasts === 'function') {
        loadPvPBroadcasts();
        // Delayed refresh to catch blockchain leaveWaitingList() confirmations
        setTimeout(() => {
            loadPvPBroadcasts();
        }, 5000);
    }

    updateUI();
}

function updatePvPBattleUI() {
    const state = gameState.pvp.currentChallenge;
    if (!state) return;

    // Ensure state.player exists before syncing
    if (!state.player) {
        state.player = {};
    }

    // Sync state.player with live gameState.player data (HP/MP/level only - NOT position or name overwrite)
    // Keep original name and position from snapshot to avoid overwriting opponent data
    const originalPlayerName = state.player.name;
    const originalPlayerX = state.player.x;
    const originalPlayerY = state.player.y;

    state.player.level = gameState.player.level;
    state.player.hp = gameState.player.hp;
    state.player.maxHp = gameState.player.maxHp;
    state.player.mp = gameState.player.mp;
    state.player.maxMp = gameState.player.maxMp;

    // Only update name if it was a placeholder, preserve real names
    if (!originalPlayerName || originalPlayerName === 'You' || originalPlayerName === 'Player') {
        state.player.name = gameState.player.name;
    } else {
        state.player.name = originalPlayerName; // Keep original snapshot name
    }

    // Preserve original position from snapshot (don't overwrite with current gameState position)
    if (originalPlayerX !== undefined) state.player.x = originalPlayerX;
    if (originalPlayerY !== undefined) state.player.y = originalPlayerY;

    if (!state.player.address && account?.addr) {
        state.player.address = account.addr;
    }
    if (state.player.address && !state.player.shortAddress) {
        const addr = state.player.address;
        state.player.shortAddress = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    }

    if (state.opponent?.address && !state.opponent.shortAddress) {
        const addr = state.opponent.address;
        state.opponent.shortAddress = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    }

    const playerHp = Math.max(0, Math.floor(gameState.player.hp || 0));
    const playerMaxHp = Math.max(1, Math.floor(gameState.player.maxHp || 1));
    const opponentMaxHp = Math.max(1, Math.floor(state.opponent.maxHp || state.opponent.hp || 1));
    const opponentHp = Math.max(0, Math.floor(state.opponent.hp || opponentMaxHp));

    const playerHpBar = document.getElementById('pvpPlayerHpBar');
    const opponentHpBar = document.getElementById('pvpOpponentHpBar');
    const playerHpLabel = document.getElementById('pvpPlayerHpLabel');
    const opponentHpLabel = document.getElementById('pvpOpponentHpLabel');
    const playerHpMeta = document.getElementById('pvpPlayerHpMeta');
    const opponentHpMeta = document.getElementById('pvpOpponentHpMeta');
    const playerIdentity = document.getElementById('pvpPlayerIdentity');
    const opponentIdentity = document.getElementById('pvpOpponentIdentity');
    const playerNameEl = document.getElementById('pvpPlayerName');
    const opponentNameEl = document.getElementById('pvpOpponentName');

    const playerPercent = Math.min(100, (playerHp / playerMaxHp) * 100);
    const opponentPercent = Math.min(100, (opponentHp / opponentMaxHp) * 100);

    const applyThresholdClass = (element, percent) => {
        if (!element) return;
        element.classList.remove('is-critical', 'is-warning');
        if (percent <= 25) {
            element.classList.add('is-critical');
        } else if (percent <= 60) {
            element.classList.add('is-warning');
        }
    };

    if (playerHpBar) {
        playerHpBar.style.width = `${playerPercent}%`;
        playerHpBar.setAttribute('data-percent', Math.round(playerPercent));
        applyThresholdClass(playerHpBar, playerPercent);
    }

    if (opponentHpBar) {
        opponentHpBar.style.width = `${opponentPercent}%`;
        opponentHpBar.setAttribute('data-percent', Math.round(opponentPercent));
        applyThresholdClass(opponentHpBar, opponentPercent);
    }

    if (playerHpLabel) {
        playerHpLabel.textContent = `${playerHp} / ${playerMaxHp}`;
        applyThresholdClass(playerHpLabel, playerPercent);
    }

    if (opponentHpLabel) {
        opponentHpLabel.textContent = `${opponentHp} / ${opponentMaxHp}`;
        applyThresholdClass(opponentHpLabel, opponentPercent);
    }

    if (playerHpMeta) {
        playerHpMeta.textContent = `${playerHp} HP • ${Math.round(playerPercent)}%`;
        applyThresholdClass(playerHpMeta, playerPercent);
    }

    if (opponentHpMeta) {
        opponentHpMeta.textContent = `${opponentHp} HP • ${Math.round(opponentPercent)}%`;
        applyThresholdClass(opponentHpMeta, opponentPercent);
    }

    const playerShort = state.player?.shortAddress || (account?.addr ? `${account.addr.slice(0, 4)}…${account.addr.slice(-4)}` : '');
    if (playerIdentity) {
        playerIdentity.textContent = playerShort ? `(${playerShort})` : '(You)';
    }

    if (state.opponent?.address && !state.opponent.shortAddress) {
        state.opponent.shortAddress = `${state.opponent.address.slice(0, 4)}…${state.opponent.address.slice(-4)}`;
    }

    if (opponentIdentity) {
        opponentIdentity.textContent = state.opponent?.shortAddress ? `(${state.opponent.shortAddress})` : '(Opponent)';
    }

    if (playerNameEl) {
        // Use live gameState.player.name for the player (current player)
        const basePlayerName = (gameState.player.name || 'Hero').trim();
        playerNameEl.textContent = `You — ${basePlayerName}`;
    }

    if (opponentNameEl) {
        // Use opponent snapshot name (from waiting list or otherPlayers map)
        const baseName = (state.opponent?.name || 'Opponent').trim();
        const playerName = (gameState.player.name || 'Hero').trim();

        // Check if both have same name (need to differentiate)
        const sameName = baseName === playerName;
        const suffix = sameName ? ' (Opponent)' : '';

        const displayName = baseName && baseName.toLowerCase() !== 'opponent'
            ? `Opponent — ${baseName}${suffix}`
            : 'Opponent';
        opponentNameEl.textContent = displayName;
    }
}

function addPvPBattleLog(message, type) {
    const log = document.getElementById('pvpBattleLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// INTERACTION SYSTEM

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

