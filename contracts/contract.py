"""
Universal State Machine

REGULAR METHODS (Secure, no turn enforcement):
- save_entity(id, data, mbr_payment)
- save_player(id, data, mbr_payment)
- start_battle(id, opponent, deadline, state, mbr_payment)
- update_battle(id, new_state)

TURN-BASED METHODS (Secure + on-chain turn enforcement):
- start_battle_turn_based(id, opponent, deadline, state, mbr_payment)
- update_battle_turn_based(id, new_state)
"""

from algopy import (
    ARC4Contract,
    UInt64,
    Bytes,
    Account,
    BoxMap,
    Txn,
    Global,
    arc4,
    op,
    subroutine,
    gtxn,
)

# ========= Constants =========
ENTITY_ID_MIN = 8
ENTITY_ID_MAX = 128
MAX_STATE_SIZE = 4096
MIN_DEADLINE_ROUNDS = 100
MAX_DEADLINE_ROUNDS = 1000000

BOX_BYTE_COST = 400
BOX_FLAT_COST = 2500

# ========= Helpers =========
@subroutine
def _u64_to_bytes(v: UInt64) -> Bytes:
    return op.itob(v)

@subroutine
def _bytes_to_u64(b: Bytes) -> UInt64:
    return op.btoi(b)

@subroutine
def _u64_to_arc4(v: UInt64) -> arc4.UInt64:
    return arc4.UInt64(op.btoi(op.itob(v)))

@subroutine
def _arc4_to_u64(v: arc4.UInt64) -> UInt64:
    return op.btoi(op.itob(v.native))

@subroutine
def _calculate_mbr(state_size: UInt64) -> UInt64:
    """Calculate MBR for regular boxes (40 bytes + state)"""
    total_size = UInt64(40) + state_size
    box_blocks = (total_size + UInt64(7)) // UInt64(8)
    return UInt64(BOX_FLAT_COST) + (UInt64(BOX_BYTE_COST) * box_blocks)

@subroutine
def _calculate_mbr_process(state_size: UInt64) -> UInt64:
    """Calculate MBR for process boxes (72 bytes + state)"""
    total_size = UInt64(72) + state_size
    box_blocks = (total_size + UInt64(7)) // UInt64(8)
    return UInt64(BOX_FLAT_COST) + (UInt64(BOX_BYTE_COST) * box_blocks)

@subroutine
def _calculate_mbr_turn_based(state_size: UInt64) -> UInt64:
    """Calculate MBR for turn-based boxes (104 bytes + state)"""
    total_size = UInt64(104) + state_size
    box_blocks = (total_size + UInt64(7)) // UInt64(8)
    return UInt64(BOX_FLAT_COST) + (UInt64(BOX_BYTE_COST) * box_blocks)

@subroutine
def _validate_entity_id(id_bytes: Bytes) -> None:
    assert id_bytes.length >= UInt64(ENTITY_ID_MIN), "ID too short (min 8)"
    assert id_bytes.length <= UInt64(ENTITY_ID_MAX), "ID too long (max 128)"

@subroutine
def _validate_state_size(state_bytes: Bytes) -> None:
    assert state_bytes.length > UInt64(0), "State cannot be empty"
    assert state_bytes.length <= UInt64(MAX_STATE_SIZE), "State too large (max 4KB)"

# ========= Contract =========
class UniversalStateMachineUltimate(ARC4Contract):

    admin: Account
    total_entities: UInt64
    total_processes: UInt64
    total_turn_based: UInt64
    paused: UInt64

    @arc4.baremethod(create="require")
    def create(self) -> None:
        """Initialize contract"""
        self.admin = Global.creator_address
        self.total_entities = UInt64(0)
        self.total_processes = UInt64(0)
        self.total_turn_based = UInt64(0)
        self.paused = UInt64(0)

    @subroutine
    def _require_not_paused(self) -> None:
        assert self.paused == UInt64(0), "Contract is paused"

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin, "Only admin"

    # ====== ENTITY METHODS (Secure with MBR) ======

    @arc4.abimethod
    def save_entity(
        self,
        entity_id: arc4.String,
        state_data: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:

        self._require_not_paused()
        
        key = entity_id.bytes
        _validate_entity_id(key)
        _validate_state_size(state_data.bytes)

        # Validate MBR payment
        required_mbr = _calculate_mbr(state_data.bytes.length)
        assert mbr_payment.receiver == Global.current_application_address, "Wrong receiver"
        assert mbr_payment.amount >= required_mbr, "Insufficient MBR payment"

        caller = Txn.sender
        mb, ok = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)

        if ok:
            owner = Account(mb[0:32])
            assert caller == owner, "Only owner can update"
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
            arc4.emit("EntityUpdated(string,address,uint64)", 
                      entity_id, arc4.Address(caller.bytes), _u64_to_arc4(Global.round))
        else:
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
            self.total_entities = self.total_entities + UInt64(1)
            arc4.emit("EntityCreated(string,address,uint64,uint64)", 
                      entity_id, arc4.Address(caller.bytes), 
                      _u64_to_arc4(self.total_entities), _u64_to_arc4(Global.round))

        return arc4.String("Entity saved (secure)")

    @arc4.abimethod
    def save_player(
        self,
        player_id: arc4.String,
        state_data: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        return self.save_entity(player_id, state_data, mbr_payment)

    @arc4.abimethod
    def load_entity(self, entity_id: arc4.String) -> arc4.String:
        """Load entity state"""
        key = entity_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[40:]
        return arc4.String.from_bytes(state_json)

    @arc4.abimethod
    def load_player(self, player_id: arc4.String) -> arc4.String:
        """Load player state"""
        return self.load_entity(player_id)

    @arc4.abimethod
    def get_entity_owner(self, entity_id: arc4.String) -> arc4.Address:
        """Get entity owner"""
        key = entity_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        if not exists:
            return arc4.Address(Bytes(b"\x00" * 32))
        return arc4.Address(data[0:32])

    @arc4.abimethod
    def transfer_entity(self, entity_id: arc4.String, new_owner: arc4.Address) -> arc4.String:
        """Transfer entity ownership"""
        self._require_not_paused()
        
        key = entity_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        assert exists, "Entity not found"
        
        current_owner = Account(data[0:32])
        assert Txn.sender == current_owner, "Only owner can transfer"
        
        zero_addr = Bytes(b"\x00" * 32)
        assert new_owner.bytes != zero_addr, "Invalid new owner"
        
        packed = new_owner.bytes + data[32:]
        BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
        
        arc4.emit("EntityTransferred(string,address,address)", 
                  entity_id, arc4.Address(current_owner.bytes), new_owner)
        return arc4.String("Entity transferred")

    @arc4.abimethod
    def delete_entity(self, entity_id: arc4.String) -> arc4.String:
        """Delete entity and reclaim MBR"""
        self._require_not_paused()
        
        key = entity_id.bytes
        box_map = BoxMap(Bytes, Bytes, key_prefix=b"e:")
        data, exists = box_map.maybe(key)
        assert exists, "Entity not found"
        
        owner = Account(data[0:32])
        assert Txn.sender == owner, "Only owner can delete"
        
        del box_map[key]
        
        arc4.emit("EntityDeleted(string,address)", entity_id, arc4.Address(owner.bytes))
        return arc4.String("Entity deleted")

    # ====== REGULAR PROCESS/BATTLE METHODS (Secure, No Turn Enforcement) ======

    @arc4.abimethod
    def start_process(
        self,
        process_id: arc4.String,
        participant_two: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """
        Start process - SECURE (requires MBR) - NO turn enforcement
        
        Migration: Just add mbr_payment parameter to your existing call!
        Either participant can update anytime.
        """
        self._require_not_paused()
        
        key = process_id.bytes
        _validate_entity_id(key)
        _validate_state_size(initial_state.bytes)

        # Validate MBR payment
        required_mbr = _calculate_mbr_process(initial_state.bytes.length)
        assert mbr_payment.receiver == Global.current_application_address, "Wrong receiver"
        assert mbr_payment.amount >= required_mbr, "Insufficient MBR payment"

        existing, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        assert not exists, "Process already exists"

        caller = Txn.sender
        zero_addr = Bytes(b"\x00" * 32)
        assert participant_two.bytes != zero_addr, "Invalid participant"
        assert participant_two.bytes != caller.bytes, "Cannot start with yourself"

        deadline_u64 = _arc4_to_u64(deadline_rounds)
        assert deadline_u64 >= UInt64(MIN_DEADLINE_ROUNDS), "Deadline too short"
        assert deadline_u64 <= UInt64(MAX_DEADLINE_ROUNDS), "Deadline too long"
        deadline = Global.round + deadline_u64

        packed = caller.bytes + participant_two.bytes + _u64_to_bytes(deadline) + initial_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"pr:")[key] = packed
        self.total_processes = self.total_processes + UInt64(1)

        arc4.emit("ProcessStarted(string,address,address,uint64)", 
                  process_id, arc4.Address(caller.bytes), participant_two, _u64_to_arc4(deadline))

        return arc4.String("Process started (secure, no turn enforcement)")

    @arc4.abimethod
    def start_battle(
        self,
        battle_id: arc4.String,
        opponent: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """
        Start battle - SECURE (requires MBR) - NO turn enforcement
        """
        return self.start_process(battle_id, opponent, deadline_rounds, initial_state, mbr_payment)

    @arc4.abimethod
    def update_process(self, process_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Update process - Either participant can update anytime"""
        self._require_not_paused()
        
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        assert exists, "Process not found"

        p1 = Account(data[0:32])
        p2 = Account(data[32:64])
        deadline = _bytes_to_u64(data[64:72])

        caller = Txn.sender
        assert (caller == p1) or (caller == p2), "Not a participant"
        assert Global.round < deadline, "Process expired"

        _validate_state_size(new_state.bytes)

        packed = p1.bytes + p2.bytes + _u64_to_bytes(deadline) + new_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"pr:")[key] = packed

        arc4.emit("ProcessUpdated(string,address,uint64)", 
                  process_id, arc4.Address(caller.bytes), _u64_to_arc4(Global.round))
        return arc4.String("Process updated (no turn check)")

    @arc4.abimethod
    def update_battle(self, battle_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Update battle - Either player can update anytime"""
        return self.update_process(battle_id, new_state)

    @arc4.abimethod
    def load_process(self, process_id: arc4.String) -> arc4.String:
        """Load process state"""
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[72:]
        return arc4.String.from_bytes(state_json)

    @arc4.abimethod
    def load_battle(self, battle_id: arc4.String) -> arc4.String:
        """Load battle state"""
        return self.load_process(battle_id)

    @arc4.abimethod
    def cleanup_expired_process(self, process_id: arc4.String) -> arc4.String:
        """Cleanup expired process"""
        key = process_id.bytes
        box_map = BoxMap(Bytes, Bytes, key_prefix=b"pr:")
        data, exists = box_map.maybe(key)
        assert exists, "Process not found"
        
        deadline = _bytes_to_u64(data[64:72])
        assert Global.round > deadline, "Process not yet expired"
        
        del box_map[key]
        
        arc4.emit("ProcessCleaned(string,address)", process_id, arc4.Address(Txn.sender.bytes))
        return arc4.String("Expired process cleaned")

    # ====== TURN-BASED METHODS (Secure + On-Chain Turn Enforcement) ======

    @arc4.abimethod
    def start_battle_turn_based(
        self,
        battle_id: arc4.String,
        opponent: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """
        Start battle with ON-CHAIN turn enforcement
        
        Box structure: p1 (32) + p2 (32) + deadline (8) + last_player (32) + state
        Blockchain enforces alternating turns - impossible to cheat!
        """
        self._require_not_paused()
        
        key = battle_id.bytes
        _validate_entity_id(key)
        _validate_state_size(initial_state.bytes)

        # Validate MBR payment (turn-based needs extra 32 bytes)
        required_mbr = _calculate_mbr_turn_based(initial_state.bytes.length)
        assert mbr_payment.receiver == Global.current_application_address, "Wrong receiver"
        assert mbr_payment.amount >= required_mbr, "Insufficient MBR payment"

        existing_regular, exists_regular = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        existing_turn, exists_turn = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        assert not exists_regular, "Battle already exists (regular)"
        assert not exists_turn, "Battle already exists (turn-based)"

        caller = Txn.sender
        zero_addr = Bytes(b"\x00" * 32)
        assert opponent.bytes != zero_addr, "Invalid opponent"
        assert opponent.bytes != caller.bytes, "Cannot battle yourself"

        deadline_u64 = _arc4_to_u64(deadline_rounds)
        assert deadline_u64 >= UInt64(MIN_DEADLINE_ROUNDS), "Deadline too short"
        assert deadline_u64 <= UInt64(MAX_DEADLINE_ROUNDS), "Deadline too long"
        deadline = Global.round + deadline_u64

        # Pack with last_player = zero (either can move first)
        packed = (
            caller.bytes + 
            opponent.bytes + 
            _u64_to_bytes(deadline) + 
            zero_addr +  # last_player
            initial_state.bytes
        )
        
        BoxMap(Bytes, Bytes, key_prefix=b"tb:")[key] = packed
        self.total_turn_based = self.total_turn_based + UInt64(1)

        arc4.emit(
            "BattleTurnBasedStarted(string,address,address,uint64)",
            battle_id,
            arc4.Address(caller.bytes),
            opponent,
            _u64_to_arc4(deadline)
        )

        return arc4.String("Turn-based battle started (secure + enforced)")

    @arc4.abimethod
    def update_battle_turn_based(
        self, 
        battle_id: arc4.String, 
        new_state: arc4.String
    ) -> arc4.String:
        """
        Update battle with ON-CHAIN turn enforcement
        
        Contract enforces alternating turns:
        - First move: Either player
        - Subsequent moves: MUST be the OTHER player
        - Transaction FAILS if same player tries twice!
        """
        self._require_not_paused()
        
        key = battle_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        assert exists, "Turn-based battle not found"

        p1 = Account(data[0:32])
        p2 = Account(data[32:64])
        deadline = _bytes_to_u64(data[64:72])
        last_player = data[72:104]

        caller = Txn.sender
        assert (caller == p1) or (caller == p2), "Not a participant"
        assert Global.round < deadline, "Battle expired"

        _validate_state_size(new_state.bytes)

        # On-chain turn enforcement
        zero_addr = Bytes(b"\x00" * 32)
        
        if last_player == zero_addr:
            # First move - either player can go
            pass
        else:
            # Not first move - MUST be the OTHER player
            assert caller.bytes != last_player, "Not your turn! Other player must move."

        # Update with new last_player
        packed = (
            p1.bytes + 
            p2.bytes + 
            _u64_to_bytes(deadline) + 
            caller.bytes +  # Update last_player
            new_state.bytes
        )
        
        BoxMap(Bytes, Bytes, key_prefix=b"tb:")[key] = packed

        arc4.emit(
            "BattleTurnBasedUpdated(string,address,uint64)",
            battle_id,
            arc4.Address(caller.bytes),
            _u64_to_arc4(Global.round)
        )
        
        return arc4.String("Turn-based battle updated (enforced)")

    @arc4.abimethod
    def start_process_turn_based(
        self,
        process_id: arc4.String,
        participant_two: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """
        Start process with ON-CHAIN turn enforcement
        Perfect for AI agents that need guaranteed alternation
        """
        self._require_not_paused()
        
        key = process_id.bytes
        _validate_entity_id(key)
        _validate_state_size(initial_state.bytes)

        required_mbr = _calculate_mbr_turn_based(initial_state.bytes.length)
        assert mbr_payment.receiver == Global.current_application_address, "Wrong receiver"
        assert mbr_payment.amount >= required_mbr, "Insufficient MBR payment"

        existing_regular, exists_regular = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        existing_turn, exists_turn = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        assert not exists_regular, "Process already exists (regular)"
        assert not exists_turn, "Process already exists (turn-based)"

        caller = Txn.sender
        zero_addr = Bytes(b"\x00" * 32)
        assert participant_two.bytes != zero_addr, "Invalid participant"
        assert participant_two.bytes != caller.bytes, "Cannot start with yourself"

        deadline_u64 = _arc4_to_u64(deadline_rounds)
        assert deadline_u64 >= UInt64(MIN_DEADLINE_ROUNDS), "Deadline too short"
        assert deadline_u64 <= UInt64(MAX_DEADLINE_ROUNDS), "Deadline too long"
        deadline = Global.round + deadline_u64

        packed = (
            caller.bytes + 
            participant_two.bytes + 
            _u64_to_bytes(deadline) + 
            zero_addr +
            initial_state.bytes
        )
        
        BoxMap(Bytes, Bytes, key_prefix=b"tb:")[key] = packed
        self.total_turn_based = self.total_turn_based + UInt64(1)

        arc4.emit(
            "ProcessTurnBasedStarted(string,address,address,uint64)",
            process_id,
            arc4.Address(caller.bytes),
            participant_two,
            _u64_to_arc4(deadline)
        )

        return arc4.String("Turn-based process started (secure + enforced)")

    @arc4.abimethod
    def update_process_turn_based(
        self, 
        process_id: arc4.String, 
        new_state: arc4.String
    ) -> arc4.String:
        """Update process with ON-CHAIN turn enforcement"""
        self._require_not_paused()
        
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        assert exists, "Turn-based process not found"

        p1 = Account(data[0:32])
        p2 = Account(data[32:64])
        deadline = _bytes_to_u64(data[64:72])
        last_actor = data[72:104]

        caller = Txn.sender
        assert (caller == p1) or (caller == p2), "Not a participant"
        assert Global.round < deadline, "Process expired"

        _validate_state_size(new_state.bytes)

        zero_addr = Bytes(b"\x00" * 32)
        
        if last_actor == zero_addr:
            pass
        else:
            assert caller.bytes != last_actor, "Not your turn! Other participant must act."

        packed = (
            p1.bytes + 
            p2.bytes + 
            _u64_to_bytes(deadline) + 
            caller.bytes +
            new_state.bytes
        )
        
        BoxMap(Bytes, Bytes, key_prefix=b"tb:")[key] = packed

        arc4.emit(
            "ProcessTurnBasedUpdated(string,address,uint64)",
            process_id,
            arc4.Address(caller.bytes),
            _u64_to_arc4(Global.round)
        )
        
        return arc4.String("Turn-based process updated (enforced)")

    @arc4.abimethod
    def load_battle_turn_based(self, battle_id: arc4.String) -> arc4.String:
        """Load turn-based battle state"""
        key = battle_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[104:]  # Skip metadata
        return arc4.String.from_bytes(state_json)

    @arc4.abimethod
    def load_process_turn_based(self, process_id: arc4.String) -> arc4.String:
        """Load turn-based process state"""
        return self.load_battle_turn_based(process_id)

    @arc4.abimethod
    def get_turn_info(self, battle_id: arc4.String) -> tuple[arc4.Address, arc4.Address, arc4.Address, arc4.Bool]:
        """
        Get turn information for turn-based battle/process
        
        Returns: (player1, player2, last_player, is_first_move)
        - If last_player is zero: first move, either can go
        - Otherwise: the OTHER player should move next
        """
        key = battle_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"tb:").maybe(key)
        
        zero_addr = Bytes(b"\x00" * 32)
        if not exists:
            return (
                arc4.Address(zero_addr),
                arc4.Address(zero_addr),
                arc4.Address(zero_addr),
                arc4.Bool(False)
            )
        
        p1 = arc4.Address(data[0:32])
        p2 = arc4.Address(data[32:64])
        last_player = arc4.Address(data[72:104])
        is_first_move = arc4.Bool(data[72:104] == zero_addr)
        
        return (p1, p2, last_player, is_first_move)

    @arc4.abimethod
    def cleanup_expired_battle_turn_based(self, battle_id: arc4.String) -> arc4.String:
        """Cleanup expired turn-based battle"""
        key = battle_id.bytes
        box_map = BoxMap(Bytes, Bytes, key_prefix=b"tb:")
        data, exists = box_map.maybe(key)
        assert exists, "Battle not found"
        
        deadline = _bytes_to_u64(data[64:72])
        assert Global.round > deadline, "Battle not yet expired"
        
        del box_map[key]
        
        arc4.emit("BattleTurnBasedCleaned(string,address)", 
                  battle_id, arc4.Address(Txn.sender.bytes))
        return arc4.String("Expired turn-based battle cleaned")

    # ====== ADMIN & UTILITY ======

    @arc4.abimethod
    def emergency_pause(self) -> arc4.String:
        """Admin can pause contract"""
        self._require_admin()
        self.paused = UInt64(1)
        arc4.emit("ContractPaused(address)", arc4.Address(Txn.sender.bytes))
        return arc4.String("Contract paused")

    @arc4.abimethod
    def emergency_unpause(self) -> arc4.String:
        """Admin can unpause"""
        self._require_admin()
        self.paused = UInt64(0)
        arc4.emit("ContractUnpaused(address)", arc4.Address(Txn.sender.bytes))
        return arc4.String("Contract unpaused")

    @arc4.abimethod
    def update_admin(self, new_admin: arc4.Address) -> arc4.String:
        """Transfer admin rights"""
        self._require_admin()
        zero_addr = Bytes(b"\x00" * 32)
        assert new_admin.bytes != zero_addr, "Invalid admin"
        old_admin = self.admin
        self.admin = Account(new_admin.bytes)
        arc4.emit("AdminUpdated(address,address)", 
                  arc4.Address(old_admin.bytes), new_admin)
        return arc4.String("Admin updated")

    @arc4.abimethod(readonly=True)
    def get_stats(self) -> tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Get statistics: entities, processes, turn_based, paused"""
        return (
            _u64_to_arc4(self.total_entities),
            _u64_to_arc4(self.total_processes),
            _u64_to_arc4(self.total_turn_based),
            _u64_to_arc4(self.paused)
        )

    @arc4.abimethod(readonly=True)
    def get_admin(self) -> arc4.Address:
        """Get current admin address"""
        return arc4.Address(self.admin.bytes)
