#!/usr/bin/env python3
"""
Simple PyTeal Contract Compiler
Compiles eternal_bliss_contract_fixed.py to TEAL
"""

from pyteal import *

def approval_program():
    """Main approval program for EternalBliss RPG with validation"""
    
    # ============================================
    # GLOBAL STATE KEYS
    # ============================================
    global_player_count = Bytes("player_count")
    global_total_battles = Bytes("total_battles")
    global_pvp_battles = Bytes("pvp_battles")
    global_teleports = Bytes("teleports")
    global_game_active = Bytes("game_active")
    global_admin = Bytes("admin")
    global_teleport_cost = Bytes("tp_cost")
    global_last_update = Bytes("last_update")
    
    # ============================================
    # LOCAL STATE KEYS
    # ============================================
    local_name = Bytes("name")
    local_level = Bytes("level")
    local_xp = Bytes("xp")
    local_gold = Bytes("gold")
    local_hp = Bytes("hp")
    local_max_hp = Bytes("max_hp")
    local_mp = Bytes("mp")
    local_max_mp = Bytes("max_mp")
    local_attack = Bytes("attack")
    local_defense = Bytes("defense")
    local_magic = Bytes("magic")
    local_x = Bytes("x")
    local_y = Bytes("y")
    local_last_move = Bytes("last_move")
    local_pvp_ready = Bytes("pvp_ready")
    local_in_battle = Bytes("in_battle")
    
    # ============================================
    # OPERATION TYPES
    # ============================================
    op_update_position = Bytes("update_pos")
    op_update_stats = Bytes("update_stats")
    op_teleport = Bytes("teleport")
    op_pvp_ready = Bytes("pvp_ready")
    op_pvp_start = Bytes("pvp_start")
    op_pvp_end = Bytes("pvp_end")
    op_battle_action = Bytes("battle_action")
    op_save_progress = Bytes("save_progress")
    op_admin_set_cost = Bytes("set_tp_cost")
    
    # ============================================
    # HELPER SUBROUTINES
    # ============================================
    
    @Subroutine(TealType.uint64)
    def is_admin():
        """Check if sender is admin"""
        return Txn.sender() == App.globalGet(global_admin)
    
    @Subroutine(TealType.uint64)
    def is_registered():
        """Check if player is registered"""
        return App.localGet(Txn.sender(), local_level) > Int(0)
    
    @Subroutine(TealType.uint64)
    def has_enough_gold(cost):
        """Check if player has enough gold"""
        return App.localGet(Txn.sender(), local_gold) >= cost
    
    @Subroutine(TealType.none)
    def deduct_gold(cost):
        """Deduct gold from player"""
        current_gold = App.localGet(Txn.sender(), local_gold)
        App.localPut(Txn.sender(), local_gold, current_gold - cost)
        return Seq([])
    
    @Subroutine(TealType.uint64)
    def is_valid_uint64_arg(arg_index):
        """CRITICAL: Validate that argument is proper uint64 (8 bytes)"""
        return Len(Txn.application_args[arg_index]) == Int(8)
    
    # ============================================
    # APPLICATION CREATION
    # ============================================
    
    on_creation = Seq([
        App.globalPut(global_player_count, Int(0)),
        App.globalPut(global_total_battles, Int(0)),
        App.globalPut(global_pvp_battles, Int(0)),
        App.globalPut(global_teleports, Int(0)),
        App.globalPut(global_game_active, Int(1)),
        App.globalPut(global_admin, Txn.sender()),
        App.globalPut(global_teleport_cost, Int(25)),
        App.globalPut(global_last_update, Global.latest_timestamp()),
        Return(Int(1))
    ])
    
    # ============================================
    # PLAYER REGISTRATION (OPT-IN)
    # ============================================
    
    on_optin = Seq([
        Assert(Txn.application_args.length() >= Int(1)),
        Assert(App.globalGet(global_game_active) == Int(1)),
        Assert(Len(Txn.application_args[0]) <= Int(16)),
        
        App.localPut(Txn.sender(), local_name, Txn.application_args[0]),
        App.localPut(Txn.sender(), local_level, Int(1)),
        App.localPut(Txn.sender(), local_xp, Int(0)),
        App.localPut(Txn.sender(), local_gold, Int(100)),
        App.localPut(Txn.sender(), local_hp, Int(100)),
        App.localPut(Txn.sender(), local_max_hp, Int(100)),
        App.localPut(Txn.sender(), local_mp, Int(50)),
        App.localPut(Txn.sender(), local_max_mp, Int(50)),
        App.localPut(Txn.sender(), local_attack, Int(15)),
        App.localPut(Txn.sender(), local_defense, Int(10)),
        App.localPut(Txn.sender(), local_magic, Int(20)),
        App.localPut(Txn.sender(), local_x, Int(75)),
        App.localPut(Txn.sender(), local_y, Int(75)),
        App.localPut(Txn.sender(), local_last_move, Global.latest_timestamp()),
        App.localPut(Txn.sender(), local_pvp_ready, Int(0)),
        App.localPut(Txn.sender(), local_in_battle, Int(0)),
        
        App.globalPut(global_player_count, App.globalGet(global_player_count) + Int(1)),
        
        Return(Int(1))
    ])
    
    # ============================================
    # UPDATE POSITION
    # ============================================
    
    update_position = Seq([
        Assert(is_registered()),
        Assert(Txn.application_args.length() >= Int(3)),
        Assert(is_valid_uint64_arg(Int(1))),
        Assert(is_valid_uint64_arg(Int(2))),
        
        App.localPut(Txn.sender(), local_x, Btoi(Txn.application_args[1])),
        App.localPut(Txn.sender(), local_y, Btoi(Txn.application_args[2])),
        App.localPut(Txn.sender(), local_last_move, Global.latest_timestamp()),
        
        App.globalPut(global_last_update, Global.latest_timestamp()),
        
        Return(Int(1))
    ])
    
    # ============================================
    # SAVE PROGRESS
    # ============================================
    
    save_progress = Seq([
        Assert(is_registered()),
        Assert(Txn.application_args.length() >= Int(13)),
        Assert(is_valid_uint64_arg(Int(1))),
        Assert(is_valid_uint64_arg(Int(2))),
        Assert(is_valid_uint64_arg(Int(3))),
        Assert(is_valid_uint64_arg(Int(4))),
        Assert(is_valid_uint64_arg(Int(5))),
        Assert(is_valid_uint64_arg(Int(6))),
        Assert(is_valid_uint64_arg(Int(7))),
        Assert(is_valid_uint64_arg(Int(8))),
        Assert(is_valid_uint64_arg(Int(9))),
        Assert(is_valid_uint64_arg(Int(10))),
        Assert(is_valid_uint64_arg(Int(11))),
        Assert(is_valid_uint64_arg(Int(12))),
        
        App.localPut(Txn.sender(), local_level, Btoi(Txn.application_args[1])),
        App.localPut(Txn.sender(), local_xp, Btoi(Txn.application_args[2])),
        App.localPut(Txn.sender(), local_gold, Btoi(Txn.application_args[3])),
        App.localPut(Txn.sender(), local_hp, Btoi(Txn.application_args[4])),
        App.localPut(Txn.sender(), local_max_hp, Btoi(Txn.application_args[5])),
        App.localPut(Txn.sender(), local_mp, Btoi(Txn.application_args[6])),
        App.localPut(Txn.sender(), local_max_mp, Btoi(Txn.application_args[7])),
        App.localPut(Txn.sender(), local_attack, Btoi(Txn.application_args[8])),
        App.localPut(Txn.sender(), local_defense, Btoi(Txn.application_args[9])),
        App.localPut(Txn.sender(), local_magic, Btoi(Txn.application_args[10])),
        App.localPut(Txn.sender(), local_x, Btoi(Txn.application_args[11])),
        App.localPut(Txn.sender(), local_y, Btoi(Txn.application_args[12])),
        App.localPut(Txn.sender(), local_last_move, Global.latest_timestamp()),
        
        Return(Int(1))
    ])
    
    # ============================================
    # MAIN PROGRAM ROUTER
    # ============================================
    
    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.OptIn, on_optin],
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_admin())],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_admin())],
        [Txn.application_args[0] == op_update_position, update_position],
        [Txn.application_args[0] == op_save_progress, save_progress],
    )
    
    return program


def clear_state_program():
    """Clear state program - allows users to opt out"""
    return Return(Int(1))


if __name__ == "__main__":
    # Compile the programs
    approval_teal = compileTeal(approval_program(), mode=Mode.Application, version=8)
    clear_teal = compileTeal(clear_state_program(), mode=Mode.Application, version=8)
    
    # Write to files
    with open("eternal_bliss_approval.teal", "w") as f:
        f.write(approval_teal)
    
    with open("eternal_bliss_clear.teal", "w") as f:
        f.write(clear_teal)
    
    print("✅ Smart contract compiled successfully!")
    print("\n📁 Generated files:")
    print("   - eternal_bliss_approval.teal")
    print("   - eternal_bliss_clear.teal")
    print("\n🚀 Deploy with:")
    print("   goal app create --creator YOUR_ACCOUNT \\")
    print("     --approval-prog eternal_bliss_approval.teal \\")
    print("     --clear-prog eternal_bliss_clear.teal \\")
    print("     --global-byteslices 8 --global-ints 8 \\")
    print("     --local-byteslices 16 --local-ints 16")
