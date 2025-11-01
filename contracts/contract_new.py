"""
Universal State Machine Contract - BACKWARD COMPATIBLE VERSION
Supports BOTH old (vulnerable) and new (secure) method signatures

This allows gradual migration:
1. Deploy this contract
2. Change APP_ID in JavaScript  
3. Old code keeps working (but still vulnerable)
4. Migrate to new methods gradually
5. Eventually deprecate old methods

WARNING: Old methods still have storage spam vulnerability!
Only use this for migration period, then switch to secure-only version.
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

# Box storage calculation constants
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
    """Calculate minimum balance requirement for box storage"""
    total_size = UInt64(40) + state_size
    box_blocks = (total_size + UInt64(7)) // UInt64(8)
    return UInt64(BOX_FLAT_COST) + (UInt64(BOX_BYTE_COST) * box_blocks)

@subroutine
def _validate_entity_id(id_bytes: Bytes) -> None:
    """Validate entity ID length"""
    assert id_bytes.length >= UInt64(ENTITY_ID_MIN), "ID too short"
    assert id_bytes.length <= UInt64(ENTITY_ID_MAX), "ID too long"

@subroutine
def _validate_state_size(state_bytes: Bytes) -> None:
    """Validate state data size"""
    assert state_bytes.length > UInt64(0), "State cannot be empty"
    assert state_bytes.length <= UInt64(MAX_STATE_SIZE), "State too large"

# ========= Contract =========
class UniversalStateMachineCompatible(ARC4Contract):
    """
    Backward Compatible Version
    
    OLD METHODS (Vulnerable but compatible):
    - save_entity(id, data)
    - save_player(id, data)
    - start_process(id, participant, deadline, state)
    - start_battle(id, opponent, deadline, state)
    
    NEW METHODS (Secure with MBR):
    - save_entity_secure(id, data, mbr_payment)
    - save_player_secure(id, data, mbr_payment)
    - start_process_secure(id, participant, deadline, state, mbr_payment)
    - start_battle_secure(id, opponent, deadline, state, mbr_payment)
    """

    admin: Account
    total_entities: UInt64
    total_processes: UInt64
    paused: UInt64

    @arc4.baremethod(create="require")
    def create(self) -> None:
        """Initialize contract"""
        self.admin = Global.creator_address
        self.total_entities = UInt64(0)
        self.total_processes = UInt64(0)
        self.paused = UInt64(0)

    @subroutine
    def _require_not_paused(self) -> None:
        assert self.paused == UInt64(0), "Contract is paused"

    @subroutine
    def _require_admin(self) -> None:
        assert Txn.sender == self.admin, "Only admin"

    # ====== OLD METHODS (BACKWARD COMPATIBLE - VULNERABLE) ======

    @arc4.abimethod
    def save_entity(
        self,
        entity_id: arc4.String,
        state_data: arc4.String
    ) -> arc4.String:
        """
        OLD METHOD - Backward compatible but VULNERABLE
        Contract pays for storage - can be abused
        Use save_entity_secure() for new code
        """
        self._require_not_paused()
        
        key = entity_id.bytes
        _validate_entity_id(key)
        _validate_state_size(state_data.bytes)

        caller = Txn.sender
        mb, ok = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)

        if ok:
            owner = Account(mb[0:32])
            assert caller == owner, "Only owner can update"
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
            arc4.emit("EntityUpdated(string,address)", entity_id, arc4.Address(caller.bytes))
        else:
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
            self.total_entities = self.total_entities + UInt64(1)
            arc4.emit("EntityCreated(string,address,uint64)", 
                      entity_id, arc4.Address(caller.bytes), _u64_to_arc4(self.total_entities))

        return arc4.String("Entity saved (old method - contract paid)")

    @arc4.abimethod
    def save_player(
        self,
        player_id: arc4.String,
        state_data: arc4.String
    ) -> arc4.String:
        """OLD METHOD - Backward compatible wrapper"""
        return self.save_entity(player_id, state_data)

    @arc4.abimethod
    def start_process(
        self,
        process_id: arc4.String,
        participant_two: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String
    ) -> arc4.String:
        """
        OLD METHOD - Backward compatible but VULNERABLE
        Use start_process_secure() for new code
        """
        self._require_not_paused()
        
        key = process_id.bytes
        _validate_entity_id(key)
        _validate_state_size(initial_state.bytes)

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

        return arc4.String("Process started (old method - contract paid)")

    @arc4.abimethod
    def start_battle(
        self,
        battle_id: arc4.String,
        opponent: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String
    ) -> arc4.String:
        """OLD METHOD - Backward compatible wrapper"""
        return self.start_process(battle_id, opponent, deadline_rounds, initial_state)

    # ====== NEW METHODS (SECURE WITH MBR) ======

    @arc4.abimethod
    def save_entity_secure(
        self,
        entity_id: arc4.String,
        state_data: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """
        NEW SECURE METHOD - User pays for storage
        Recommended for all new code
        """
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
            arc4.emit("EntityUpdatedSecure(string,address,uint64)", 
                      entity_id, arc4.Address(caller.bytes), _u64_to_arc4(Global.round))
        else:
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"e:")[key] = packed
            self.total_entities = self.total_entities + UInt64(1)
            arc4.emit("EntityCreatedSecure(string,address,uint64,uint64)", 
                      entity_id, arc4.Address(caller.bytes), 
                      _u64_to_arc4(self.total_entities), _u64_to_arc4(Global.round))

        return arc4.String("Entity saved securely (user paid)")

    @arc4.abimethod
    def save_player_secure(
        self,
        player_id: arc4.String,
        state_data: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """NEW SECURE METHOD - Wrapper for save_entity_secure"""
        return self.save_entity_secure(player_id, state_data, mbr_payment)

    @arc4.abimethod
    def start_process_secure(
        self,
        process_id: arc4.String,
        participant_two: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """NEW SECURE METHOD - User pays for storage"""
        self._require_not_paused()
        
        key = process_id.bytes
        _validate_entity_id(key)
        _validate_state_size(initial_state.bytes)

        # Validate MBR payment
        required_mbr = _calculate_mbr(initial_state.bytes.length)
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

        arc4.emit("ProcessStartedSecure(string,address,address,uint64,uint64)", 
                  process_id, arc4.Address(caller.bytes), participant_two, 
                  _u64_to_arc4(deadline), _u64_to_arc4(Global.round))

        return arc4.String("Process started securely (user paid)")

    @arc4.abimethod
    def start_battle_secure(
        self,
        battle_id: arc4.String,
        opponent: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String,
        mbr_payment: gtxn.PaymentTransaction
    ) -> arc4.String:
        """NEW SECURE METHOD - Wrapper for start_process_secure"""
        return self.start_process_secure(battle_id, opponent, deadline_rounds, initial_state, mbr_payment)

    # ====== READ METHODS (UNCHANGED) ======

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
    def update_process(self, process_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Update process state (works for both old and new methods)"""
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
        return arc4.String("Process updated")

    @arc4.abimethod
    def update_battle(self, battle_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Update battle state"""
        return self.update_process(battle_id, new_state)

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
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        assert exists, "Entity not found"
        
        owner = Account(data[0:32])
        assert Txn.sender == owner, "Only owner can delete"
        
        BoxMap(Bytes, Bytes, key_prefix=b"e:").delete(key)
        
        arc4.emit("EntityDeleted(string,address)", entity_id, arc4.Address(owner.bytes))
        return arc4.String("Entity deleted")

    @arc4.abimethod
    def cleanup_expired_process(self, process_id: arc4.String) -> arc4.String:
        """Cleanup expired process"""
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        assert exists, "Process not found"
        
        deadline = _bytes_to_u64(data[64:72])
        assert Global.round > deadline, "Process not yet expired"
        
        BoxMap(Bytes, Bytes, key_prefix=b"pr:").delete(key)
        
        arc4.emit("ProcessCleaned(string,address,uint64)", 
                  process_id, arc4.Address(Txn.sender.bytes), _u64_to_arc4(Global.round))
        return arc4.String("Expired process cleaned")

    @arc4.abimethod(readonly=True)
    def get_stats(self) -> tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Get statistics"""
        return (
            _u64_to_arc4(self.total_entities),
            _u64_to_arc4(self.total_processes),
            _u64_to_arc4(self.paused)
        )
