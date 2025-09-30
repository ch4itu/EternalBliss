// EternalBliss Algorand - Smart Contract in PyTeal (Python)
// This generates TEAL bytecode for deployment on Algorand

// ============================================
// PYTEAL SMART CONTRACT
// ============================================

const pyTealContract = `
from pyteal import *
from pyteal.ast.bytes import Bytes

# EternalBliss RPG Smart Contract for Algorand
# This contract manages player data, battles, and items on-chain

def approval_program():
    """
    Main approval program for the EternalBliss RPG application
    """
    
    # Global state schema (stored at application level)
    # 8 uints, 8 bytes
    global_player_count = Bytes("player_count")
    global_total_gold = Bytes("total_gold")
    global_total_battles = Bytes("total_battles")
    global_highest_level = Bytes("highest_level")
    global_admin = Bytes("admin")
    global_fee_address = Bytes("fee_address")
    global_min_stake = Bytes("min_stake")
    global_game_paused = Bytes("game_paused")
    
    # Local state schema (stored per user)
    # 16 uints, 16 bytes
    local_player_name = Bytes("name")
    local_player_level = Bytes("level")
    local_player_xp = Bytes("xp")
    local_player_gold = Bytes("gold")
    local_player_hp = Bytes("hp")
    local_player_max_hp = Bytes("max_hp")
    local_player_mp = Bytes("mp")
    local_player_max_mp = Bytes("max_mp")
    local_player_attack = Bytes("attack")
    local_player_defense = Bytes("defense")
    local_player_magic = Bytes("magic")
    local_player_x = Bytes("x")
    local_player_y = Bytes("y")
    local_player_battles_won = Bytes("battles_won")
    local_player_treasures = Bytes("treasures")
    local_player_nft_id = Bytes("nft_id")
    
    # Operation types
    op_create_player = Bytes("create_player")
    op_update_stats = Bytes("update_stats")
    op_move = Bytes("move")
    op_battle = Bytes("battle")
    op_trade = Bytes("trade")
    op_buy_item = Bytes("buy_item")
    op_save_progress = Bytes("save_progress")
    op_mint_nft = Bytes("mint_nft")
    op_claim_rewards = Bytes("claim_rewards")
    op_admin_pause = Bytes("admin_pause")
    op_admin_update_fee = Bytes("update_fee")
    
    # Helper functions
    @Subroutine(TealType.uint64)
    def is_admin():
        return Txn.sender() == App.globalGet(global_admin)
    
    @Subroutine(TealType.uint64)
    def is_player_registered():
        return App.localGet(Txn.sender(), local_player_level) > Int(0)
    
    @Subroutine(TealType.uint64)
    def calculate_battle_reward(enemy_level: TealType.uint64) -> TealType.uint64:
        return enemy_level * Int(10) + Int(15)
    
    @Subroutine(TealType.uint64)
    def calculate_xp_reward(enemy_level: TealType.uint64) -> TealType.uint64:
        return enemy_level * Int(15) + Int(20)
    
    # Initialize application
    on_creation = Seq([
        App.globalPut(global_player_count, Int(0)),
        App.globalPut(global_total_gold, Int(0)),
        App.globalPut(global_total_battles, Int(0)),
        App.globalPut(global_highest_level, Int(1)),
        App.globalPut(global_admin, Txn.sender()),
        App.globalPut(global_fee_address, Txn.sender()),
        App.globalPut(global_min_stake, Int(100000)),  # 0.1 ALGO minimum
        App.globalPut(global_game_paused, Int(0)),
        Return(Int(1))
    ])
    
    # Opt-in: Create new player
    on_optin = Seq([
        Assert(Txn.application_args.length() >= Int(1)),
        App.localPut(Txn.sender(), local_player_name, Txn.application_args[0]),
        App.localPut(Txn.sender(), local_player_level, Int(1)),
        App.localPut(Txn.sender(), local_player_xp, Int(0)),
        App.localPut(Txn.sender(), local_player_gold, Int(100)),
        App.localPut(Txn.sender(), local_player_hp, Int(100)),
        App.localPut(Txn.sender(), local_player_max_hp, Int(100)),
        App.localPut(Txn.sender(), local_player_mp, Int(50)),
        App.localPut(Txn.sender(), local_player_max_mp, Int(50)),
        App.localPut(Txn.sender(), local_player_attack, Int(15)),
        App.localPut(Txn.sender(), local_player_defense, Int(10)),
        App.localPut(Txn.sender(), local_player_magic, Int(20)),
        App.localPut(Txn.sender(), local_player_x, Int(15)),
        App.localPut(Txn.sender(), local_player_y, Int(10)),
        App.localPut(Txn.sender(), local_player_battles_won, Int(0)),
        App.localPut(Txn.sender(), local_player_treasures, Int(0)),
        App.localPut(Txn.sender(), local_player_nft_id, Int(0)),
        App.globalPut(global_player_count, App.globalGet(global_player_count) + Int(1)),
        Return(Int(1))
    ])
    
    # Update player stats
    update_stats = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(4)),
        App.localPut(Txn.sender(), local_player_level, Btoi(Txn.application_args[1])),
        App.localPut(Txn.sender(), local_player_xp, Btoi(Txn.application_args[2])),
        App.localPut(Txn.sender(), local_player_gold, Btoi(Txn.application_args[3])),
        If(
            Btoi(Txn.application_args[1]) > App.globalGet(global_highest_level),
            App.globalPut(global_highest_level, Btoi(Txn.application_args[1]))
        ),
        Return(Int(1))
    ])
    
    # Move player
    move_player = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(3)),
        App.localPut(Txn.sender(), local_player_x, Btoi(Txn.application_args[1])),
        App.localPut(Txn.sender(), local_player_y, Btoi(Txn.application_args[2])),
        Return(Int(1))
    ])
    
    # Battle system
    battle_enemy = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(2)),
        Assert(App.localGet(Txn.sender(), local_player_hp) > Int(0)),
        App.localPut(
            Txn.sender(), 
            local_player_gold, 
            App.localGet(Txn.sender(), local_player_gold) + calculate_battle_reward(Btoi(Txn.application_args[1]))
        ),
        App.localPut(
            Txn.sender(), 
            local_player_xp, 
            App.localGet(Txn.sender(), local_player_xp) + calculate_xp_reward(Btoi(Txn.application_args[1]))
        ),
        App.localPut(
            Txn.sender(), 
            local_player_battles_won, 
            App.localGet(Txn.sender(), local_player_battles_won) + Int(1)
        ),
        App.globalPut(global_total_battles, App.globalGet(global_total_battles) + Int(1)),
        Return(Int(1))
    ])
    
    # Trade between players
    trade_items = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(3)),
        Assert(Gtxn[1].type_enum() == TxnType.Payment),
        Assert(Gtxn[1].receiver() == Txn.accounts[1]),
        Assert(Gtxn[1].amount() >= Btoi(Txn.application_args[2])),
        Return(Int(1))
    ])
    
    # Buy item from shop
    buy_item = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(2)),
        Assert(App.localGet(Txn.sender(), local_player_gold) >= Btoi(Txn.application_args[1])),
        App.localPut(
            Txn.sender(), 
            local_player_gold, 
            App.localGet(Txn.sender(), local_player_gold) - Btoi(Txn.application_args[1])
        ),
        Return(Int(1))
    ])
    
    # Save progress (update all stats)
    save_progress = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(12)),
        App.localPut(Txn.sender(), local_player_level, Btoi(Txn.application_args[1])),
        App.localPut(Txn.sender(), local_player_xp, Btoi(Txn.application_args[2])),
        App.localPut(Txn.sender(), local_player_gold, Btoi(Txn.application_args[3])),
        App.localPut(Txn.sender(), local_player_hp, Btoi(Txn.application_args[4])),
        App.localPut(Txn.sender(), local_player_max_hp, Btoi(Txn.application_args[5])),
        App.localPut(Txn.sender(), local_player_mp, Btoi(Txn.application_args[6])),
        App.localPut(Txn.sender(), local_player_max_mp, Btoi(Txn.application_args[7])),
        App.localPut(Txn.sender(), local_player_attack, Btoi(Txn.application_args[8])),
        App.localPut(Txn.sender(), local_player_defense, Btoi(Txn.application_args[9])),
        App.localPut(Txn.sender(), local_player_magic, Btoi(Txn.application_args[10])),
        App.localPut(Txn.sender(), local_player_x, Btoi(Txn.application_args[11])),
        App.localPut(Txn.sender(), local_player_y, Btoi(Txn.application_args[12])),
        App.globalPut(global_total_gold, App.globalGet(global_total_gold) + Btoi(Txn.application_args[3])),
        Return(Int(1))
    ])
    
    # Link NFT to player
    mint_nft = Seq([
        Assert(is_player_registered()),
        Assert(Txn.application_args.length() >= Int(2)),
        App.localPut(Txn.sender(), local_player_nft_id, Btoi(Txn.application_args[1])),
        Return(Int(1))
    ])
    
    # Claim daily rewards
    claim_rewards = Seq([
        Assert(is_player_registered()),
        Assert(App.localGet(Txn.sender(), local_player_level) >= Int(5)),
        App.localPut(
            Txn.sender(), 
            local_player_gold, 
            App.localGet(Txn.sender(), local_player_gold) + Int(50)
        ),
        Return(Int(1))
    ])
    
    # Admin functions
    admin_pause = Seq([
        Assert(is_admin()),
        App.globalPut(global_game_paused, Btoi(Txn.application_args[1])),
        Return(Int(1))
    ])
    
    admin_update_fee = Seq([
        Assert(is_admin()),
        Assert(Txn.application_args.length() >= Int(2)),
        App.globalPut(global_fee_address, Txn.application_args[1]),
        Return(Int(1))
    ])
    
    # Handle different operations
    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.OptIn, on_optin],
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_admin())],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_admin())],
        [Txn.application_args[0] == op_update_stats, update_stats],
        [Txn.application_args[0] == op_move, move_player],
        [Txn.application_args[0] == op_battle, battle_enemy],
        [Txn.application_args[0] == op_trade, trade_items],
        [Txn.application_args[0] == op_buy_item, buy_item],
        [Txn.application_args[0] == op_save_progress, save_progress],
        [Txn.application_args[0] == op_mint_nft, mint_nft],
        [Txn.application_args[0] == op_claim_rewards, claim_rewards],
        [Txn.application_args[0] == op_admin_pause, admin_pause],
        [Txn.application_args[0] == op_admin_update_fee, admin_update_fee]
    )
    
    return program

def clear_state_program():
    """
    Clear state program - allows users to opt out
    """
    return Return(Int(1))

# Compile the programs
if __name__ == "__main__":
    import json
    
    # Compile approval program
    approval = compileTeal(approval_program(), mode=Mode.Application, version=8)
    clear = compileTeal(clear_state_program(), mode=Mode.Application, version=8)
    
    # Save to files
    with open("EternalBliss_approval.teal", "w") as f:
        f.write(approval)
    
    with open("EternalBliss_clear.teal", "w") as f:
        f.write(clear)
    
    # Print deployment info
    print("EternalBliss RPG Smart Contract compiled successfully!")
    print("\\nDeployment Schema:")
    print("Global State: 8 uints, 8 bytes")
    print("Local State: 16 uints, 16 bytes")
    print("\\nDeploy using goal CLI or SDK with the compiled TEAL files")
`;

// ============================================
// DEPLOYMENT SCRIPT
// ============================================

const deploymentScript = `
// Algorand Smart Contract Deployment Script
// Run this after compiling the PyTeal contract

async function deployEternalBlissContract() {
    const algosdk = require('algosdk');
    
    // Initialize Algorand client
    const algodClient = new algosdk.Algodv2(
        '',
        'https://testnet-api.algonode.cloud',
        ''
    );
    
    // Load your account (replace with your mnemonic)
    const mnemonic = "YOUR_25_WORD_MNEMONIC_HERE";
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    
    // Read compiled TEAL files
    const fs = require('fs');
    const approvalProgram = fs.readFileSync('EternalBliss_approval.teal', 'utf8');
    const clearProgram = fs.readFileSync('EternalBliss_clear.teal', 'utf8');
    
    // Compile programs
    const approvalCompiled = await algodClient.compile(approvalProgram).do();
    const clearCompiled = await algodClient.compile(clearProgram).do();
    
    // Create application
    const params = await algodClient.getTransactionParams().do();
    
    const txn = algosdk.makeApplicationCreateTxnFromObject({
        from: account.addr,
        suggestedParams: params,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        approvalProgram: new Uint8Array(Buffer.from(approvalCompiled.result, 'base64')),
        clearProgram: new Uint8Array(Buffer.from(clearCompiled.result, 'base64')),
        numLocalInts: 16,
        numLocalByteSlices: 16,
        numGlobalInts: 8,
        numGlobalByteSlices: 8,
    });
    
    // Sign and send transaction
    const signedTxn = txn.signTxn(account.sk);
    const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
    
    // Wait for confirmation
    const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 4);
    
    console.log('Contract deployed successfully!');
    console.log('Application ID:', confirmedTxn['application-index']);
    console.log('Transaction ID:', txId);
    
    return confirmedTxn['application-index'];
}

// Deploy the contract
deployEternalBlissContract().catch(console.error);
`;

// ============================================
// INTERACTION FUNCTIONS
// ============================================

const interactionFunctions = `
// JavaScript functions to interact with the deployed smart contract

class EternalBlissContract {
    constructor(algodClient, appId) {
        this.algodClient = algodClient;
        this.appId = appId;
    }
    
    // Opt-in to the application (create player)
    async optIn(account, playerName) {
        const params = await this.algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const txn = algosdk.makeApplicationOptInTxnFromObject({
            from: account.addr,
            appIndex: this.appId,
            appArgs: [encoder.encode(playerName)],
            suggestedParams: params,
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await this.algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, txId, 4);
        
        return txId;
    }
    
    // Update player stats
    async updateStats(account, level, xp, gold) {
        const params = await this.algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            from: account.addr,
            appIndex: this.appId,
            appArgs: [
                encoder.encode("update_stats"),
                algosdk.encodeUint64(level),
                algosdk.encodeUint64(xp),
                algosdk.encodeUint64(gold)
            ],
            suggestedParams: params,
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await this.algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, txId, 4);
        
        return txId;
    }
    
    // Move player
    async movePlayer(account, x, y) {
        const params = await this.algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            from: account.addr,
            appIndex: this.appId,
            appArgs: [
                encoder.encode("move"),
                algosdk.encodeUint64(x),
                algosdk.encodeUint64(y)
            ],
            suggestedParams: params,
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await this.algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, txId, 4);
        
        return txId;
    }
    
    // Battle enemy
    async battleEnemy(account, enemyLevel) {
        const params = await this.algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            from: account.addr,
            appIndex: this.appId,
            appArgs: [
                encoder.encode("battle"),
                algosdk.encodeUint64(enemyLevel)
            ],
            suggestedParams: params,
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await this.algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, txId, 4);
        
        return txId;
    }
    
    // Save full progress
    async saveProgress(account, playerData) {
        const params = await this.algodClient.getTransactionParams().do();
        const encoder = new TextEncoder();
        
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            from: account.addr,
            appIndex: this.appId,
            appArgs: [
                encoder.encode("save_progress"),
                algosdk.encodeUint64(playerData.level),
                algosdk.encodeUint64(playerData.xp),
                algosdk.encodeUint64(playerData.gold),
                algosdk.encodeUint64(playerData.hp),
                algosdk.encodeUint64(playerData.maxHp),
                algosdk.encodeUint64(playerData.mp),
                algosdk.encodeUint64(playerData.maxMp),
                algosdk.encodeUint64(playerData.attack),
                algosdk.encodeUint64(playerData.defense),
                algosdk.encodeUint64(playerData.magic),
                algosdk.encodeUint64(playerData.x),
                algosdk.encodeUint64(playerData.y)
            ],
            suggestedParams: params,
        });
        
        const signedTxn = txn.signTxn(account.sk);
        const { txId } = await this.algodClient.sendRawTransaction(signedTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, txId, 4);
        
        return txId;
    }
    
    // Read player state
    async getPlayerState(address) {
        const accountInfo = await this.algodClient.accountApplicationInformation(address, this.appId).do();
        
        if (!accountInfo['app-local-state']) {
            return null;
        }
        
        const localState = accountInfo['app-local-state']['key-value'];
        const playerData = {};
        
        localState.forEach(kv => {
            const key = Buffer.from(kv.key, 'base64').toString();
            const value = kv.value.type === 1 ? kv.value.bytes : kv.value.uint;
            
            switch(key) {
                case 'name':
                    playerData.name = Buffer.from(value, 'base64').toString();
                    break;
                case 'level':
                    playerData.level = value;
                    break;
                case 'xp':
                    playerData.xp = value;
                    break;
                case 'gold':
                    playerData.gold = value;
                    break;
                case 'hp':
                    playerData.hp = value;
                    break;
                case 'max_hp':
                    playerData.maxHp = value;
                    break;
                case 'mp':
                    playerData.mp = value;
                    break;
                case 'max_mp':
                    playerData.maxMp = value;
                    break;
                case 'attack':
                    playerData.attack = value;
                    break;
                case 'defense':
                    playerData.defense = value;
                    break;
                case 'magic':
                    playerData.magic = value;
                    break;
                case 'x':
                    playerData.x = value;
                    break;
                case 'y':
                    playerData.y = value;
                    break;
                case 'battles_won':
                    playerData.battlesWon = value;
                    break;
                case 'treasures':
                    playerData.treasures = value;
                    break;
                case 'nft_id':
                    playerData.nftId = value;
                    break;
            }
        });
        
        return playerData;
    }
    
    // Get global state
    async getGlobalState() {
        const appInfo = await this.algodClient.getApplicationByID(this.appId).do();
        const globalState = appInfo.params['global-state'];
        const state = {};
        
        globalState.forEach(kv => {
            const key = Buffer.from(kv.key, 'base64').toString();
            const value = kv.value.type === 1 ? kv.value.bytes : kv.value.uint;
            
            switch(key) {
                case 'player_count':
                    state.playerCount = value;
                    break;
                case 'total_gold':
                    state.totalGold = value;
                    break;
                case 'total_battles':
                    state.totalBattles = value;
                    break;
                case 'highest_level':
                    state.highestLevel = value;
                    break;
                case 'game_paused':
                    state.gamePaused = value;
                    break;
            }
        });
        
        return state;
    }
}

// Export for use in the game
window.EternalBlissContract = EternalBlissContract;
`;
