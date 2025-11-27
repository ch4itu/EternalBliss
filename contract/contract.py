"""
Universal State Machine

Compatible with:
- py-algorand-sdk 2.7.0+
- Python 3.12+
- AVM v10+
- puyapy 5.3.2+
"""

from algopy import (
    ARC4Contract,
    String,
    Bytes,
    UInt64,
    Account,
    Global,
    Txn,
    gtxn,
    itxn,
    op,
    arc4,
    subroutine,
)


class UniversalStateMachine(ARC4Contract):
    """
    Universal State Machine
    """

    def __init__(self) -> None:
        self.admin = Global.creator_address

    # ============ HELPER SUBROUTINES ============

    @subroutine
    def _verify_mbr_payment(self, amount_needed: UInt64) -> None:
        assert Txn.group_index > 0, "MBR payment transaction required"
        mbr_txn = gtxn.PaymentTransaction(Txn.group_index - 1)
        assert mbr_txn.sender == Txn.sender, "Payment must come from caller"
        assert mbr_txn.receiver == Global.current_application_address, "MBR must be sent to app"
        assert mbr_txn.amount >= amount_needed, "Insufficient MBR payment"

    @subroutine
    def _refund_mbr(self, recipient: Account, total_bytes: UInt64) -> None:
        refund_amount = 2500 + (400 * total_bytes)
        itxn.Payment(
            receiver=recipient,
            amount=refund_amount,
            fee=0,
        ).submit()

    # ============ ENTITY OPERATIONS ============

    @arc4.abimethod
    def save_entity(self, entity_id: arc4.String, entity_data: arc4.String) -> arc4.String:
        entity_id_bytes = entity_id.native.bytes
        entity_data_bytes = entity_data.native.bytes

        assert entity_id_bytes.length <= 62, "Entity ID too long (max 62 bytes)"
        assert entity_data_bytes.length <= 32000, "Entity data exceeds 32KB limit"

        box_key = b"e:" + entity_id_bytes
        new_content = Txn.sender.bytes + entity_data_bytes

        maybe_value, exists = op.Box.get(box_key)

        if exists:
            old_value = maybe_value
            assert old_value.length >= 32, "Corrupted entity box"

            current_owner = Account(old_value[:32])
            assert current_owner.bytes.length == 32, "Invalid owner address"
            assert Txn.sender == current_owner, "Only owner can update entity"

            old_size = old_value.length
            new_size = new_content.length

            if new_size > old_size:
                delta = new_size - old_size
                self._verify_mbr_payment(400 * delta)
                op.Box.resize(box_key, new_size)
            elif new_size < old_size:
                op.Box.resize(box_key, new_size)

            op.Box.put(box_key, new_content)
        else:
            total_size = box_key.length + new_content.length
            min_mbr = 2500 + (400 * total_size)
            self._verify_mbr_payment(min_mbr)
            op.Box.put(box_key, new_content)

        return entity_id

    @arc4.abimethod(readonly=True)
    def load_entity(self, entity_id: arc4.String) -> arc4.String:
        box_key = b"e:" + entity_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Entity does not exist"
        return arc4.String.from_bytes(maybe_value[32:])

    @arc4.abimethod
    def delete_entity(self, entity_id: arc4.String) -> None:
        box_key = b"e:" + entity_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Entity does not exist"
        
        value = maybe_value
        assert value.length >= 32, "Corrupted entity box"
        
        owner = Account(value[:32])
        assert Txn.sender == owner, "Only owner can delete entity"

        total_size = box_key.length + value.length
        op.Box.delete(box_key)
        self._refund_mbr(Txn.sender, total_size)

    # ============ PROCESS OPERATIONS ============

    @arc4.abimethod
    def start_process(
        self,
        process_id: arc4.String,
        other_party: arc4.Address,
        initial_state: arc4.String,
        timeout_rounds: arc4.UInt64
    ) -> arc4.String:
        process_id_bytes = process_id.native.bytes
        initial_state_bytes = initial_state.native.bytes

        assert process_id_bytes.length <= 62, "Process ID too long"
        assert initial_state_bytes.length <= 32000, "State exceeds limit"
        assert other_party.native.bytes.length == 32, "Invalid address"

        box_key = b"p:" + process_id_bytes
        length, exists = op.Box.length(box_key)
        assert not exists, "Process already exists"

        timeout_round = Global.round + timeout_rounds.native if timeout_rounds.native > 0 else UInt64(0)

        # Header: P1(32) + P2(32) + Turn(8) + FinalFlag(1) + TimeoutRound(8)
        new_content = (
            Txn.sender.bytes +
            other_party.native.bytes +
            op.itob(0) +
            b"\x00" +
            op.itob(timeout_round) +
            initial_state_bytes
        )

        total_size = box_key.length + new_content.length
        min_mbr = 2500 + (400 * total_size)

        self._verify_mbr_payment(min_mbr)
        op.Box.put(box_key, new_content)

        return process_id

    @arc4.abimethod
    def update_process(self, process_id: arc4.String, new_state: arc4.String) -> arc4.String:
        new_state_bytes = new_state.native.bytes
        assert new_state_bytes.length <= 32000, "State exceeds limit"

        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        old_value = maybe_value
        assert old_value.length >= 81, "Corrupted process box"

        p1 = Account(old_value[:32])
        p2 = Account(old_value[32:64])
        assert Txn.sender == p1 or Txn.sender == p2, "Caller is not a participant"

        final_flag = old_value[72:73] 
        timeout_round = op.btoi(old_value[73:81])

        assert final_flag == b"\x00", "Cannot update finalized process"
        
        if timeout_round > 0:
            assert Global.round < timeout_round, "Process timed out"

        current_turn = op.btoi(old_value[64:72])
        new_turn = current_turn + 1

        new_content = (
            p1.bytes +
            p2.bytes +
            op.itob(new_turn) +
            old_value[72:81] +
            new_state_bytes
        )

        old_size = old_value.length
        new_size = new_content.length

        if new_size > old_size:
            delta = new_size - old_size
            self._verify_mbr_payment(400 * delta)
            op.Box.resize(box_key, new_size)
        elif new_size < old_size:
            op.Box.resize(box_key, new_size)

        op.Box.put(box_key, new_content)
        return process_id

    @arc4.abimethod
    def resign_process(self, process_id: arc4.String) -> None:
        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        old_value = maybe_value
        assert old_value.length >= 81, "Corrupted process box"

        p1 = Account(old_value[:32])
        p2 = Account(old_value[32:64])
        assert Txn.sender == p1 or Txn.sender == p2, "Caller is not a participant"

        final_flag = old_value[72:73]
        assert final_flag == b"\x00", "Process already finalized"

        new_content = (
            old_value[:72] +
            b"\x01" +
            old_value[73:]
        )
        op.Box.put(box_key, new_content)

    @arc4.abimethod(readonly=True)
    def load_process(self, process_id: arc4.String) -> arc4.String:
        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        value = maybe_value
        assert value.length >= 81, "Corrupted process box"
        return arc4.String.from_bytes(value[81:])

    @arc4.abimethod(readonly=True)
    def get_process_info(self, process_id: arc4.String) -> arc4.Tuple[arc4.Address, arc4.Address, arc4.UInt64, arc4.Bool, arc4.UInt64]:
        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        value = maybe_value
        assert value.length >= 81, "Corrupted process box"

        p1 = arc4.Address(value[:32])
        p2 = arc4.Address(value[32:64])
        turn = arc4.UInt64.from_bytes(value[64:72])
        
        is_finalized = arc4.Bool(value[72:73] != b"\x00")
        
        timeout_round = arc4.UInt64.from_bytes(value[73:81])

        return arc4.Tuple((p1, p2, turn, is_finalized, timeout_round))

    @arc4.abimethod
    def delete_process(self, process_id: arc4.String) -> None:
        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        value = maybe_value
        assert value.length >= 81, "Corrupted process box"

        p1 = Account(value[:32])
        p2 = Account(value[32:64])
        assert Txn.sender == p1 or Txn.sender == p2, "Caller is not a participant"

        final_flag = value[72:73]
        timeout_round = op.btoi(value[73:81])

        is_finalized = final_flag == b"\x01"
        is_timed_out = (timeout_round > 0) and (Global.round >= timeout_round)

        assert is_finalized or is_timed_out, "Can only delete finalized or timed out processes"

        total_size = box_key.length + value.length
        op.Box.delete(box_key)
        self._refund_mbr(Txn.sender, total_size)

    # ============ ADMIN OPERATIONS ============

    @arc4.abimethod
    def admin_delete_entity(self, entity_id: arc4.String) -> None:
        assert Txn.sender == self.admin, "Only admin can force delete"
        box_key = b"e:" + entity_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Entity does not exist"
        
        value = maybe_value
        total_size = box_key.length + value.length
        op.Box.delete(box_key)
        self._refund_mbr(Txn.sender, total_size)

    @arc4.abimethod
    def admin_delete_process(self, process_id: arc4.String) -> None:
        assert Txn.sender == self.admin, "Only admin can force delete"
        box_key = b"p:" + process_id.native.bytes
        maybe_value, exists = op.Box.get(box_key)
        assert exists, "Process does not exist"
        
        value = maybe_value
        total_size = box_key.length + value.length
        op.Box.delete(box_key)
        self._refund_mbr(Txn.sender, total_size)