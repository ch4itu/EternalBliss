const PVP_BROADCAST_DURATION = 180000; // 3 minutes
const PVP_MATCH_RANGE = 5;
const POSITION_STALE_THRESHOLD = 300000; // 5 minutes
let pvpChallengeMonitor = null;
let pendingChallenges = new Map(); // Track pending challenges by txId
let processedChallenges = new Set(); // Track processed challenge transaction IDs

const pvpSharedState = window.pvpState || (window.pvpState = {
    broadcasts: new Map(),
    activeBattles: new Map()
});

const pvpBroadcasts = pvpSharedState.broadcasts;
const activePvPBattles = pvpSharedState.activeBattles; // Track ongoing PvP battles

// PVP BATTLE MONITORING & TIMEOUT FUNCTIONS

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
            await contract.updatePosition(account, gameState.player.x, gameState.player.y);
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

function startPvPChallengeMonitoring(opponentAddress, challengeTxId) {
    // Clear any existing monitor
    if (pvpChallengeMonitor) {
        clearInterval(pvpChallengeMonitor);
    }
    
    console.log(`👀 Monitoring for PvP acceptance from ${opponentAddress}...`);
    
    let checkCount = 0;
    const maxChecks = 60; // Monitor for 60 seconds
    
    pvpChallengeMonitor = setInterval(async () => {
        checkCount++;
        
        if (checkCount > maxChecks) {
            clearInterval(pvpChallengeMonitor);
            pvpChallengeMonitor = null;
            console.log('⏰ PvP challenge monitoring timed out');
            showFloatingText('Challenge expired', 
                gameState.player.x * 32 + 16, 
                gameState.player.y * 32 - 40, 
                '#ef4444'
            );
            return;
        }
        
        try {
            // Check for response transactions from opponent
            const txns = await indexerClient.searchForTransactions()
                .address(account.addr)
                .addressRole('receiver')
                .txType('pay')
                .minRound(Math.max(0, (await algodClient.status().do())['last-round'] - 100))
                .do();
            
            // Look for acceptance response in transaction notes
            for (const txn of txns.transactions) {
                if (txn.sender === opponentAddress && txn.note) {
                    try {
                        const noteStr = Buffer.from(txn.note, 'base64').toString();
                        if (noteStr.includes('pvp_response') || noteStr.includes('pvp_accept')) {
                            const responseData = JSON.parse(noteStr.replace(NOTE_PREFIXES.PVP_START, ''));
                            
                            if (responseData.accept) {
                                // Opponent accepted!
                                clearInterval(pvpChallengeMonitor);
                                pvpChallengeMonitor = null;
                                
                                
                                showFloatingText('⚔️ Challenge Accepted!', 
                                    gameState.player.x * 32 + 16, 
                                    gameState.player.y * 32 - 40, 
                                    '#10b981'
                                );
                                
                                // Start the battle
                                const opponent = otherPlayers.get(opponentAddress);
                                if (opponent) {
                                    startPvPBattle(opponent, opponentAddress, false);
                                }
                                return;
                            }
                        }
                    } catch (e) {
                        // Not a valid response, continue
                    }
                }
            }
        } catch (error) {
            console.warn('Error checking for PvP response:', error.message);
        }
    }, 2000); // Check every 2 seconds
}

async function challengePlayerToPvP(playerAddress, wager = 0) {
    if (!account || !algodClient) {
        showFloatingText('Please connect your wallet first', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }
    
    if (!playerAddress || playerAddress === account.addr) {
        showFloatingText('Invalid opponent', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    // COLLISION DETECTION: Check if challenge already exists with this opponent
    const existingChallenge = Array.from(activePvPBattles.values()).find(
        battle => (battle.challenger === account.addr && battle.receiver === playerAddress) ||
                  (battle.receiver === account.addr && battle.challenger === playerAddress)
    );
    
    if (existingChallenge) {
        showFloatingText('Challenge already active with this player', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

    try {
        showFloatingText('⚔️ Sending PvP challenge...', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#3b82f6'
        );
        
        const params = await algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const challengeData = {
            type: 'pvp_challenge',
            from: account.addr,
            to: playerAddress,
            wager: wager,

                battleId: `battle_${Date.now()}_${account.addr.substring(0, 8)}`,
                
            timestamp: Date.now()
        };
        
        const noteText = JSON.stringify(challengeData);
        const note = encoder.encode(NOTE_PREFIXES.PVP_START + noteText);
        
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: account.addr,
            to: playerAddress,
            amount: 0,
            note: note,
            suggestedParams: params
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
        
        // Track pending challenge
        pendingChallenges.set(txId, {
            challenger: account.addr,
            receiver: playerAddress,
            wager: wager,
            timestamp: Date.now(),
            status: 'pending'
        });
        
        await algosdk.waitForConfirmation(algodClient, txId, 4);
        
        showFloatingText(`PvP challenge sent! Waiting for response...`, 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#10b981'
        );
        
        // Monitor for acceptance
        startChallengeAcceptanceMonitor(txId, playerAddress);
        
    } catch (error) {
        console.error('Failed to send PvP challenge:', error);
        showFloatingText('Challenge failed!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
    }
}

function startChallengeAcceptanceMonitor(challengeTxId, opponentAddress) {
    const checkInterval = setInterval(async () => {
        try {
            const challenge = pendingChallenges.get(challengeTxId);
            if (!challenge || challenge.status !== 'pending') {
                clearInterval(checkInterval);
                return;
            }
            
            // Check for acceptance transaction
            const currentRound = (await algodClient.status().do())['last-round'];
            const response = await indexerClient
                .searchForTransactions()
                .address(opponentAddress)
                .txType('pay')
                .addressRole('sender')
                .minRound(Math.max(0, currentRound - 100))
                .do();
            
            for (const txn of response.transactions) {
                if (!txn.note) continue;
                
                try {
                    const noteBytes = Uint8Array.from(atob(txn.note), c => c.charCodeAt(0));
                    const noteStr = new TextDecoder().decode(noteBytes);
                    const noteData = JSON.parse(noteStr);
                    
                    if (noteData.type === 'pvp_accept' && 
                        noteData.challengeTxId === challengeTxId &&
                        noteData.from === opponentAddress) {
                        
                        challenge.status = 'accepted';
                        pendingChallenges.set(challengeTxId, challenge);
                        
                        showFloatingText('🎮 Challenge accepted! Starting PvP battle...', 
                            gameState.player.x * 32 + 16, 
                            gameState.player.y * 32 - 40, 
                            '#10b981'
                        );
                        
                        // Get opponent info
                        const opponent = otherPlayers.get(opponentAddress) || {
                            address: opponentAddress,
                            name: 'Opponent',
                            level: 1,
                            hp: 100,
                            maxHp: 100
                        };
                        
                        // Start the battle - challenger goes first
                        setTimeout(() => {
                            startPvPBattle(opponent, opponentAddress, true);
                        }, 1000);
                        
                        clearInterval(checkInterval);
                        return;
                    }
                    
                    if (noteData.type === 'pvp_decline' && 
                        noteData.challengeTxId === challengeTxId &&
                        noteData.from === opponentAddress) {
                        
                        challenge.status = 'declined';
                        pendingChallenges.set(challengeTxId, challenge);
                        
                        showFloatingText('Challenge declined by opponent', 
                            gameState.player.x * 32 + 16, 
                            gameState.player.y * 32 - 40, 
                            '#ef4444'
                        );
                        
                        clearInterval(checkInterval);
                        return;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            // Timeout after 3 minutes
            if (Date.now() - challenge.timestamp > 180000) {
                challenge.status = 'timeout';
                pendingChallenges.set(challengeTxId, challenge);
                showFloatingText('Challenge timed out', 
                    gameState.player.x * 32 + 16, 
                    gameState.player.y * 32 - 40, 
                    '#ef4444'
                );
                clearInterval(checkInterval);
            }
            
        } catch (error) {
            console.error('Error monitoring challenge acceptance:', error);
        }
    }, 3000); // Check every 3 seconds
}

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
    }, 10000); // Check every 10 seconds (reduced RPC calls)
    
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
                // start_battle has: method_selector, battle_id, opponent, deadline_rounds, initial_state
                if (appCall['application-args'].length === 5) {
                    // Decode battleId (arg 1) - skip ARC4 length prefix
                    const battleIdBytes = Uint8Array.from(atob(appCall['application-args'][1]), c => c.charCodeAt(0));
                    const battleId = new TextDecoder().decode(battleIdBytes.slice(2));

                    // Decode opponent address (arg 2)
                    const opponentBytes = Uint8Array.from(atob(appCall['application-args'][2]), c => c.charCodeAt(0));
                    const opponentAddress = algosdk.encodeAddress(opponentBytes);

                    // Check if I'm the opponent being challenged
                    if (opponentAddress === account.addr) {
                        // Check if already processed
                        if (processedChallenges.has(battleId)) {
                            continue;  // Silently skip already processed
                        }

                        // Load battle state to check age and status
                        const battleState = await contract.loadBattle(battleId);

                        if (!battleState || battleState.status !== 'active') {
                            processedChallenges.add(battleId);
                            continue;
                        }

                        // Check age BEFORE logging
                        const battleAge = Date.now() - (battleState.timestamp || 0);
                        const MAX_CHALLENGE_AGE = 5 * 60 * 1000; // 5 minutes

                        if (battleAge > MAX_CHALLENGE_AGE) {
                            processedChallenges.add(battleId);
                            continue;  // Silently skip old battles
                        }

                        // Only log if battle is valid and recent
                        console.log('✅ New PvP challenge! BattleId:', battleId.substring(0, 20) + '...');

                        const challengerAddress = txn.sender;
                        processedChallenges.add(battleId);

                        if (!gameState.challengeNotificationShown) {
                            gameState.challengeNotificationShown = true;
                            gameState.pvp.pendingChallenge = {
                                from: challengerAddress,
                                wager: 0,
                                battleId: battleId,
                                txId: txn.id,
                                timestamp: Date.now()
                            };

                            const challengeData = {
                                type: 'pvp_challenge',
                                from: challengerAddress,
                                to: account.addr,
                                battleId: battleId,
                                wager: 0
                            };

                            showPvPChallengeModal(challengeData, challengerAddress);
                        }
                    }
                }
            } catch (e) {
                console.warn('Error processing transaction:', e.message);
                continue;
            }
        }
    } catch (error) {
        console.error('Error checking for challenges:', error);
    }
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
            <p style="margin-bottom: 20px;">Wager: <strong>${challengeData.wager || 0} gold</strong></p>
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
        console.log('📝 Accepting battle on blockchain:', challenge.battleId);

        // Load battle state to get wager and opponent info
        const battleState = await contract.loadBattle(challenge.battleId);

        if (!battleState) {
            throw new Error('Battle not found on blockchain');
        }

        console.log('📊 Battle state loaded:', battleState);

        // NEW: Accept battle on blockchain using contract method
        await contract.acceptBattle(account, challenge.battleId);

        console.log('✅ Battle accepted on blockchain!');

        // Close modal
        document.getElementById('pvpChallengeModal')?.remove();

        // Show notification
        showFloatingText('Challenge accepted! Starting battle...',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#10b981'
        );

        // Get opponent info and wager from battle state
        let opponent = pvpBroadcasts.get(challenge.from) || otherPlayers.get(challenge.from) || {
            address: challenge.from,
            name: 'Challenger',
            level: 1,
            hp: 100,
            maxHp: 100
        };

        // Use wager from battle state (single source of truth!)
        opponent.wager = battleState.wager || { boats: 0, keys: 0, pickaxe: 0, gold: 0 };

        console.log('💎 Wager from blockchain:', opponent.wager);

        console.log('🎯 Starting battle as receiver with battleId:', challenge.battleId);

        // Start the battle - receiver goes second
        await startPvPBattle(opponent, challenge.from, false, challenge.battleId);

        // Clear challenge
        gameState.pvp.pendingChallenge = null;
        gameState.challengeNotificationShown = false;

    } catch (error) {
        console.error('Failed to accept challenge:', error);
        showFloatingText('Failed to accept challenge: ' + error.message,
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#ef4444'
        );
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
        await algodClient.sendRawTransaction(signedTxn).do();
        
        console.log('❌ Declined PvP challenge');
        
        processedChallenges.add(challenge.txId);
        
        document.getElementById('pvpChallengeModal')?.remove();
        
        gameState.pvp.pendingChallenge = null;
        gameState.challengeNotificationShown = false;
        
        showFloatingText('Challenge declined', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#94a3b8'
        );
    } catch (error) {
        console.error('Failed to decline challenge:', error);
    }
}

async function broadcastPvPStatus() {
    if (!account || !algodClient) return;

    try {
        const pvpData = {
            type: 'PVP_READY',
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

        const note = new TextEncoder().encode(
            NOTE_PREFIXES.PVP_READY + JSON.stringify(pvpData)
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
        console.error('Failed to broadcast PvP status:', error);
    }
}

async function loadPvPBroadcasts() {
    if (!indexerClient) return;

    try {
        const minRound = (await algodClient.status().do())['last-round'] - 2000;
        
        const txns = await indexerClient
            .searchForTransactions()
            .notePrefix(createNotePrefix(NOTE_PREFIXES.PVP_READY))
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
                    const jsonStr = noteText.replace(NOTE_PREFIXES.PVP_READY, '');
                    const pvpData = JSON.parse(jsonStr);

                    const age = now - pvpData.timestamp;
                    if (age < PVP_BROADCAST_DURATION) {
                        pvpBroadcasts.set(txn.sender, pvpData);
                    }
                } catch (e) {
                    // Ignore
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
    const opponent = pvpBroadcasts.get(targetAddress);
    
    if (!opponent) {
        showFloatingText('Challenge expired!', 
            gameState.player.x * 32 + 16, 
            gameState.player.y * 32 - 40, 
            '#ef4444'
        );
        return;
    }

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

        // Create battle on blockchain using contract method - pass battleId AND wager data
        const txId = await contract.startPvPBattle(account, targetAddress, true, battleId, opponent.wager);

        console.log('✅ Battle created on blockchain with wager:', opponent.wager);
        console.log('TxID:', txId);
        console.log('Receiver will detect this via blockchain polling (no notification tx needed!)');

        showFloatingText('Challenge sent! Opponent will be notified...',
            gameState.player.x * 32 + 16,
            gameState.player.y * 32 - 40,
            '#10b981'
        );

        // Start monitoring for acceptance via blockchain state
        startWaitingForChallengeAcceptance(targetAddress, opponent, battleId);

    } catch (error) {
        console.error('Failed to create battle:', error);
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
    if (acceptanceCheckInterval) {
        clearInterval(acceptanceCheckInterval);
    }

    let timeWaited = 0;
    const maxWaitTime = 60000; // 60 seconds

    console.log('👀 Waiting for acceptance from', opponentAddress, 'for battle:', battleId);

    acceptanceCheckInterval = setInterval(async () => {
        timeWaited += 2000;

        if (timeWaited >= maxWaitTime) {
            clearInterval(acceptanceCheckInterval);
            showFloatingText('Challenge expired - no response',
                gameState.player.x * 32 + 16,
                gameState.player.y * 32 - 40,
                '#94a3b8'
            );
            return;
        }

        try {
            // NEW: Check battle state directly on blockchain (no indexer delay!)
            const battleState = await contract.loadBattle(battleId);

            if (battleState) {
                console.log('📊 Battle state:', battleState.status);

                // Check if opponent accepted
                if (battleState.status === 'accepted') {
                    console.log('✅ ACCEPTANCE DETECTED via blockchain battle state!');
                    clearInterval(acceptanceCheckInterval);

                    showFloatingText('Challenge accepted! Starting battle...',
                        gameState.player.x * 32 + 16,
                        gameState.player.y * 32 - 40,
                        '#10b981'
                    );

                    // Use wager from battle state
                    opponentData.wager = battleState.wager || { boats: 0, keys: 0, pickaxe: 0, gold: 0 };
                    console.log('💎 Wager from blockchain:', opponentData.wager);

                    // Start battle - challenger goes first
                    console.log('Starting battle with Battle ID:', battleId);
                    await startPvPBattle(opponentData, opponentAddress, true, battleId);
                    return;
                }
            } else {
                console.log('🔍 Battle not found yet, waiting...');
            }
        } catch (error) {
            console.error('Error checking battle state:', error);
        }
    }, 2000); // Check every 2 seconds
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

        gameState.pvp.currentChallenge = {
            opponent: opponent,
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
            iAmChallenger: iAmChallenger
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
        showPvPBattleModal(opponent);
        console.log('✅ startPvPBattle completed successfully');

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

async function broadcastPvPBattleStart(opponentAddress) {
    if (!account || !algodClient) return;

    try {
        const battleData = {
            type: 'BATTLE_START',
            battleId: gameState.pvp.currentChallenge.battleId,
            opponent: opponentAddress,
            wager: gameState.pvp.currentChallenge.totalWager,
            timestamp: Date.now()
        };

        const note = new TextEncoder().encode(
            NOTE_PREFIXES.PVP_START + JSON.stringify(battleData)
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
        console.error('Failed to broadcast battle start:', error);
    }
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

    document.getElementById('pvpOpponentName').textContent = opponent.name;
    document.getElementById('pvpOpponentLevel').textContent = opponent.level;
    document.getElementById('pvpOpponentHp').textContent = opponent.hp;
    document.getElementById('pvpOpponentMaxHp').textContent = opponent.maxHp;
    document.getElementById('pvpOpponentHpBar').style.width = `${(opponent.hp / opponent.maxHp) * 100}%`;

    const wager = gameState.pvp.currentChallenge.totalWager;
    console.log('💎 Displaying wager:', wager);

    document.getElementById('pvpWagerDisplay').innerHTML = `
        <strong>Winner Takes All:</strong><br>
        ⛵ ${wager.boats} Boats | 🗝️ ${wager.keys} Keys | ⛏️ ${wager.pickaxe} Pickaxe Uses | 💰 ${wager.gold} Gold
    `;

    document.getElementById('pvpBattleLog').innerHTML = '';
    addPvPBattleLog(`⚔️ PvP Battle: ${gameState.player.name} vs ${opponent.name}!`, 'log-info');
    addPvPBattleLog(`💎 Fighting for ${wager.gold}g, ${wager.boats} boats, ${wager.keys} keys, ${wager.pickaxe} pickaxe!`, 'log-info');

    // Show correct turn message
    if (gameState.pvp.currentChallenge.isMyTurn) {
        addPvPBattleLog(`🎯 It's YOUR turn! Choose your action.`, 'log-info');
    } else {
        addPvPBattleLog(`⏳ Opponent's turn - waiting...`, 'log-info');
    }

    modal.style.display = 'flex';
    console.log('✅ Modal displayed');

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

// FIX #4: Hide mobile controls when modal opens
    document.getElementById('mobile-controls').style.display = 'none';

    createParticleEffect(gameState.player.x * 32 + 16, gameState.player.y * 32, '#dc2626');
}

function pvpBattleAction(action) {
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

    if (!actionValid) return;

    updatePvPBattleUI();
    updateUI();

    if (state.opponent.hp <= 0) {
        pvpPlayerVictory();
        return;
    }

    // Increment turn BEFORE broadcasting
    state.turnNumber++;
    state.isMyTurn = false;

    // Broadcast turn to blockchain with updated turn number
    broadcastPvPTurn(action, playerDamage);

    addPvPBattleLog(`⏳ Waiting for opponent...`, 'log-info');
}

// Update battle state on blockchain using contract method
async function broadcastPvPTurn(action, damage) {
    if (!account || !contract) return;

    try {
        const state = gameState.pvp.currentChallenge;

        // CRITICAL: Load existing battle state and MERGE with new data
        const existingState = await contract.loadBattle(state.battleId);

        if (!existingState) {
            console.error('❌ Cannot load battle state from blockchain');
            addPvPBattleLog(`⚠️ Network error - turn not saved`, 'log-info');
            return;
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
                mp: state.iAmChallenger ? gameState.player.mp : (state.opponent.mp || 100)
            },
            player2: {
                address: state.iAmChallenger ? state.address : account.addr,
                hp: state.iAmChallenger ? state.opponent.hp : gameState.player.hp,
                mp: state.iAmChallenger ? (state.opponent.mp || 100) : gameState.player.mp
            },
            status: 'active',
            currentTurn: state.address,  // Next player's turn (opponent)
            lastUpdated: account.addr,
            timestamp: Date.now()
        };

        console.log(`📤 Submitting turn ${updatedState.turnNumber} to blockchain: ${action} (${damage} damage)`);

        // Use blockchain contract method
        await contract.submitPvPTurn(
            account,
            state.battleId,
            updatedState
        );

        console.log('✅ Turn submitted successfully to blockchain');

    } catch (error) {
        console.error('Failed to submit turn to blockchain:', error);
        addPvPBattleLog(`⚠️ Network error - turn not saved`, 'log-info');
    }
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
            console.warn('⚠️ Battle not found on blockchain');
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
            endPvPBattle(true);
            return;
        }

        if (battleState.status === 'completed') {
            console.log('✅ Battle completed');
            const won = battleState.winner === account.addr;
            endPvPBattle(won);
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
        state.opponent.hp = opponentData.hp || state.opponent.hp;
    }

    updatePvPBattleUI();
    updateUI();

    if (gameState.player.hp <= 0) {
        pvpPlayerDefeat();
        return;
    }

    state.isMyTurn = true;
    addPvPBattleLog(`🎯 Your turn!`, 'log-info');
}

function pvpPlayerVictory() {
    const wager = gameState.pvp.currentChallenge.totalWager;
    
    gameState.inventory.boats += wager.boats;
    gameState.inventory.keys += wager.keys;
    gameState.inventory.pickaxe += wager.pickaxe;
    gameState.inventory.gold += wager.gold;
    
    const xpGain = Math.floor(gameState.pvp.currentChallenge.opponent.level * 50);
    gameState.player.xp += xpGain;

    addPvPBattleLog(`🎉 VICTORY! You defeated ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-heal');
    addPvPBattleLog(`💰 You won: ${wager.boats}⛵ ${wager.keys}🗝️ ${wager.pickaxe}⛏️ ${wager.gold}💰`, 'log-heal');
    addPvPBattleLog(`⭐ Gained ${xpGain} XP!`, 'log-heal');

    checkLevelUp();
    updateUI();

    // Broadcast result
    broadcastPvPResult(true);

    setTimeout(() => endPvPBattle(true), 3000);
}

function pvpPlayerDefeat() {
    addPvPBattleLog(`💀 DEFEAT! You were bested by ${gameState.pvp.currentChallenge.opponent.name}!`, 'log-damage');
    addPvPBattleLog(`💸 You lost your wager...`, 'log-damage');
    
    gameState.player.hp = Math.floor(gameState.player.maxHp * 0.25);
    updateUI();

    // Broadcast result
    broadcastPvPResult(false);

    setTimeout(() => endPvPBattle(false), 3000);
}

async function broadcastPvPResult(victory) {
    if (!account || !algodClient) return;

    try {
        const resultData = {
            battleId: gameState.pvp.currentChallenge.battleId,
            winner: victory ? account.addr : gameState.pvp.currentChallenge.address,
            timestamp: Date.now()
        };

        const note = new TextEncoder().encode(
            NOTE_PREFIXES.PVP_END + JSON.stringify(resultData)
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
        console.error('Failed to broadcast result:', error);
    }
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
        document.getElementById('mobile-controls').style.display = 'flex';

        if (gameState.pvp.isReady) {
            disablePvPReady();
        }

        updateUI();
    }
}

function endPvPBattle(victory) {
    gameState.pvp.inPvPBattle = false;
    gameState.inBattle = false;
    gameState.pvp.currentChallenge = null;

    document.getElementById('pvpBattleModal').style.display = 'none';
    // FIX #4: Restore mobile controls when modal closes
    document.getElementById('mobile-controls').style.display = 'flex';
    // FIX #4: Restore mobile controls when modal closes
    document.getElementById('mobile-controls').style.display = 'flex';

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

    updateUI();
}

function updatePvPBattleUI() {
    const state = gameState.pvp.currentChallenge;
    if (!state) return;

    document.getElementById('pvpOpponentHp').textContent = Math.max(0, Math.floor(state.opponent.hp));
    document.getElementById('pvpOpponentHpBar').style.width = `${Math.max(0, (state.opponent.hp / state.opponent.maxHp) * 100)}%`;
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

