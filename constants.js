// Shared constants used across EternalBliss scripts
const NOTE_PREFIXES = {
    CHAT_MESSAGE: 'CHRPG:CHAT:',

    // DEPRECATED: The following now use blockchain box storage instead of transaction notes
    PLAYER_DATA: 'CHRPG:PLAYER:',  // Replaced by: contract.save_entity() / contract.load_entity()
    POSITION: 'CHRPG:POS:',        // Replaced by: contract.updatePosition() -> save_entity()
    BATTLE: 'CHRPG:BATTLE:',       // (Not currently used)
    TRADE: 'CHRPG:TRADE:',         // (Not currently used)

    // DEPRECATED: PvP now uses blockchain-based matchmaking (waiting_list in contract)
    // Transaction notes replaced with on-chain state to prevent spam/spoofing attacks
    PVP_READY: 'CHRPG:PVP:',      // Replaced by: contract.joinWaitingList()
    PVP_START: 'CHRPG:PVP_START:', // Replaced by: contract.start_battle()
    PVP_TURN: 'CHRPG:PVP_TURN:',  // Replaced by: contract.update_battle()
    PVP_END: 'CHRPG:PVP_END:'     // Replaced by: contract.update_battle()
};
