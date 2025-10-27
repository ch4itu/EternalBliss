"""
Universal State Machine Contract (Hybrid Version)
Supports both gaming terminology (for compatibility) and generic terminology
Implements the vision from ARCHITECTURE.md
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
)

# ========= Constants =========
MACHINE_ID_MIN = 3
MACHINE_ID_MAX = 64
MAX_STATE_SIZE = 32768

# ========= Helpers =========
@subroutine
def _u64_to_bytes(v: UInt64) -> Bytes:
    return op.itob(v)


@subroutine
def _bytes_to_u64(b: Bytes) -> UInt64:
    return op.btoi(b)


@subroutine
def _u64_to_arc4(v: UInt64) -> arc4.UInt64:
    """Convert UInt64 to arc4.UInt64"""
    return arc4.UInt64(op.btoi(op.itob(v)))


@subroutine
def _arc4_to_u64(v: arc4.UInt64) -> UInt64:
    """Convert arc4.UInt64 to UInt64"""
    return op.btoi(op.itob(v.native))


# ========= Contract =========
class UniversalStateMachine(ARC4Contract):
    """
    Universal State Machine - One framework, infinite possibilities
    
    Gaming: exploring → fighting → won/lost → exploring
    Supply Chain: ordered → shipped → delivered
    AI Agents: pending → assigned → executing → completed
    
    Boxes:
    - p:{id} → player state (gaming compatibility)
    - e:{id} → entity state (generic)
    - b:{id} → battle state (gaming compatibility)  
    - pr:{id} → process state (generic collaboration)
    """

    # Global state (supports both naming conventions)
    admin: Account
    total_players: UInt64    # For gaming compatibility
    total_entities: UInt64   # Generic counter (same value as total_players)
    total_battles: UInt64    # For gaming compatibility
    total_processes: UInt64  # Generic counter (same value as total_battles)

    # ---- Lifecycle ----
    @arc4.baremethod(create="require")
    def create(self) -> None:
        """Initialize contract"""
        self.admin = Global.creator_address
        self.total_players = UInt64(0)
        self.total_entities = UInt64(0)
        self.total_battles = UInt64(0)
        self.total_processes = UInt64(0)

    # ====== GAMING COMPATIBILITY METHODS ======
    
    @arc4.abimethod
    def save_player(
        self,
        player_id: arc4.String,
        state_data: arc4.String
    ) -> arc4.String:
        """Gaming compatibility: Save player state"""
        # Use the same logic but with 'p:' prefix for backward compatibility
        key = player_id.bytes
        assert key.length >= UInt64(MACHINE_ID_MIN), "Player ID too short"
        assert key.length <= UInt64(MACHINE_ID_MAX), "Player ID too long"
        assert state_data.bytes.length <= UInt64(MAX_STATE_SIZE), "State too large"

        caller = Txn.sender
        mb, ok = BoxMap(Bytes, Bytes, key_prefix=b"p:").maybe(key)

        if ok:
            owner = Account(mb[0:32])
            assert caller == owner, "Only owner can update"
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"p:")[key] = packed
            
            arc4.emit("PlayerUpdated(string,address)", player_id, arc4.Address(caller.bytes))
        else:
            packed = caller.bytes + _u64_to_bytes(Global.round) + state_data.bytes
            BoxMap(Bytes, Bytes, key_prefix=b"p:")[key] = packed
            self.total_players = self.total_players + UInt64(1)
            self.total_entities = self.total_entities + UInt64(1)  # Keep both in sync
            
            arc4.emit(
                "PlayerCreated(string,address,uint64)",
                player_id,
                arc4.Address(caller.bytes),
                _u64_to_arc4(self.total_players)
            )

        return arc4.String("Player saved")

    @arc4.abimethod
    def load_player(self, player_id: arc4.String) -> arc4.String:
        """Gaming compatibility: Load player state"""
        key = player_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"p:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[40:]
        return arc4.String.from_bytes(state_json)

    @arc4.abimethod
    def get_player_owner(self, player_id: arc4.String) -> arc4.Address:
        """Gaming compatibility: Get player owner"""
        key = player_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"p:").maybe(key)
        if not exists:
            return arc4.Address(Bytes(b"\x00" * 32))
        return arc4.Address(data[0:32])

    @arc4.abimethod
    def start_battle(
        self,
        battle_id: arc4.String,
        opponent: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String
    ) -> arc4.String:
        """Gaming compatibility: Start battle"""
        key = battle_id.bytes
        assert key.length >= UInt64(MACHINE_ID_MIN), "Battle ID too short"
        assert key.length <= UInt64(MACHINE_ID_MAX), "Battle ID too long"
        assert initial_state.bytes.length <= UInt64(MAX_STATE_SIZE), "State too large"

        existing, exists = BoxMap(Bytes, Bytes, key_prefix=b"b:").maybe(key)
        assert not exists, "Battle already exists"

        caller = Txn.sender
        zero_addr = Bytes(b"\x00" * 32)
        assert opponent.bytes != zero_addr, "Invalid opponent"
        assert opponent.bytes != caller.bytes, "Cannot battle yourself"

        deadline_u64 = _arc4_to_u64(deadline_rounds)
        assert deadline_u64 >= UInt64(10), "Deadline too short"
        assert deadline_u64 <= UInt64(1000000), "Deadline too long"
        deadline = Global.round + deadline_u64

        packed = caller.bytes + opponent.bytes + _u64_to_bytes(deadline) + initial_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"b:")[key] = packed
        self.total_battles = self.total_battles + UInt64(1)
        self.total_processes = self.total_processes + UInt64(1)  # Keep both in sync

        arc4.emit(
            "BattleStarted(string,address,address,uint64)",
            battle_id,
            arc4.Address(caller.bytes),
            opponent,
            _u64_to_arc4(deadline_u64)
        )

        return arc4.String("Battle started")

    @arc4.abimethod
    def update_battle(self, battle_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Gaming compatibility: Update battle"""
        key = battle_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"b:").maybe(key)
        assert exists, "Battle not found"

        p1 = Account(data[0:32])
        p2 = Account(data[32:64])
        deadline = _bytes_to_u64(data[64:72])

        caller = Txn.sender
        assert (caller == p1) or (caller == p2), "Not a participant"
        assert Global.round <= deadline, "Battle expired"

        packed = p1.bytes + p2.bytes + _u64_to_bytes(deadline) + new_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"b:")[key] = packed

        arc4.emit("BattleUpdated(string,address)", battle_id, arc4.Address(caller.bytes))
        return arc4.String("Battle updated")

    @arc4.abimethod
    def load_battle(self, battle_id: arc4.String) -> arc4.String:
        """Gaming compatibility: Load battle"""
        key = battle_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"b:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[72:]
        return arc4.String.from_bytes(state_json)

    # ====== GENERIC METHODS (New Preferred Interface) ======

    @arc4.abimethod
    def save_entity(
        self,
        entity_id: arc4.String,
        state_data: arc4.String
    ) -> arc4.String:
        """Generic: Save entity state (blog posts, shipments, agents, etc)"""
        key = entity_id.bytes
        assert key.length >= UInt64(MACHINE_ID_MIN), "Entity ID too short"
        assert key.length <= UInt64(MACHINE_ID_MAX), "Entity ID too long"
        assert state_data.bytes.length <= UInt64(MAX_STATE_SIZE), "State too large"

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
            self.total_players = self.total_players + UInt64(1)  # Keep both in sync
            
            arc4.emit(
                "EntityCreated(string,address,uint64)",
                entity_id,
                arc4.Address(caller.bytes),
                _u64_to_arc4(self.total_entities)
            )

        return arc4.String("Entity saved")

    @arc4.abimethod
    def load_entity(self, entity_id: arc4.String) -> arc4.String:
        """Generic: Load entity state"""
        key = entity_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[40:]
        return arc4.String.from_bytes(state_json)

    @arc4.abimethod
    def get_entity_owner(self, entity_id: arc4.String) -> arc4.Address:
        """Generic: Get entity owner"""
        key = entity_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"e:").maybe(key)
        if not exists:
            return arc4.Address(Bytes(b"\x00" * 32))
        return arc4.Address(data[0:32])

    @arc4.abimethod
    def start_process(
        self,
        process_id: arc4.String,
        participant_two: arc4.Address,
        deadline_rounds: arc4.UInt64,
        initial_state: arc4.String
    ) -> arc4.String:
        """Generic: Start collaborative process (supply chain, AI coordination, etc)"""
        key = process_id.bytes
        assert key.length >= UInt64(MACHINE_ID_MIN), "Process ID too short"
        assert key.length <= UInt64(MACHINE_ID_MAX), "Process ID too long"
        assert initial_state.bytes.length <= UInt64(MAX_STATE_SIZE), "State too large"

        existing, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        assert not exists, "Process already exists"

        caller = Txn.sender
        zero_addr = Bytes(b"\x00" * 32)
        assert participant_two.bytes != zero_addr, "Invalid participant"
        assert participant_two.bytes != caller.bytes, "Cannot start process with yourself"

        deadline_u64 = _arc4_to_u64(deadline_rounds)
        assert deadline_u64 >= UInt64(10), "Deadline too short"
        assert deadline_u64 <= UInt64(1000000), "Deadline too long"
        deadline = Global.round + deadline_u64

        packed = caller.bytes + participant_two.bytes + _u64_to_bytes(deadline) + initial_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"pr:")[key] = packed
        self.total_processes = self.total_processes + UInt64(1)
        self.total_battles = self.total_battles + UInt64(1)  # Keep both in sync

        arc4.emit(
            "ProcessStarted(string,address,address,uint64)",
            process_id,
            arc4.Address(caller.bytes),
            participant_two,
            _u64_to_arc4(deadline)
        )

        return arc4.String("Process started")

    @arc4.abimethod
    def update_process(self, process_id: arc4.String, new_state: arc4.String) -> arc4.String:
        """Generic: Update process"""
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        assert exists, "Process not found"

        p1 = Account(data[0:32])
        p2 = Account(data[32:64])
        deadline = _bytes_to_u64(data[64:72])

        caller = Txn.sender
        assert (caller == p1) or (caller == p2), "Not a participant"
        assert Global.round <= deadline, "Process expired"

        packed = p1.bytes + p2.bytes + _u64_to_bytes(deadline) + new_state.bytes
        BoxMap(Bytes, Bytes, key_prefix=b"pr:")[key] = packed

        arc4.emit("ProcessUpdated(string,address)", process_id, arc4.Address(caller.bytes))
        return arc4.String("Process updated")

    @arc4.abimethod
    def load_process(self, process_id: arc4.String) -> arc4.String:
        """Generic: Load process"""
        key = process_id.bytes
        data, exists = BoxMap(Bytes, Bytes, key_prefix=b"pr:").maybe(key)
        if not exists:
            return arc4.String("")
        state_json = data[72:]
        return arc4.String.from_bytes(state_json)

    # ====== UNIFIED STATS ======

    @arc4.abimethod(readonly=True)
    def get_stats(self) -> tuple[arc4.UInt64, arc4.UInt64]:
        """Gaming compatibility: Get total players and battles"""
        return (_u64_to_arc4(self.total_players), _u64_to_arc4(self.total_battles))

    @arc4.abimethod(readonly=True)
    def get_state_counts(self) -> tuple[arc4.UInt64, arc4.UInt64]:
        """Generic: Get total entities and processes"""
        return (_u64_to_arc4(self.total_entities), _u64_to_arc4(self.total_processes))

    @arc4.abimethod(readonly=True)
    def get_universal_stats(self) -> tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Get all counters: players, entities, battles, processes"""
        return (
            _u64_to_arc4(self.total_players),
            _u64_to_arc4(self.total_entities),
            _u64_to_arc4(self.total_battles),
            _u64_to_arc4(self.total_processes)
        )
