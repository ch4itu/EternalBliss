"""Saving the shared world to Solana (instructions 29 and 30), on a simulated ledger. No network.

MagicBlock's magic program only exists on the rollup, so a small stand-in that accepts every call and logs what it was
given is loaded at its address. The checks read those logs to see exactly which accounts, flags and data each save sends.
The stand-in is stub/ in this folder (build it like the program: cd stub && cargo build-bpf).
The program's admin is the fixed Devnet key HDbeKypeJHXMM5Xs2RHKj8XGQgJeP4jnQ1Jiugf8mXPn. Without its keypair file the
admin's transactions are simulated with signature checks switched off in the simulator; nothing else changes.
usage: python3 check_save.py stub/target/bpfel-unknown-none/release/libmagic_stub.so [admin keypair json]
"""
import json
import re
import struct
import sys
from pathlib import Path

from solders.account import Account
from solders.clock import Clock
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction
from solders.transaction_metadata import FailedTransactionMetadata, TransactionMetadata

import check_world as w

ROOT = Path(__file__).resolve().parent
MAGIC = Pubkey.from_string("Magic11111111111111111111111111111111111111")
CONTEXT = Pubkey.from_string("MagicContext1111111111111111111111111111111")
VALIDATOR = Pubkey.from_string("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57")
VAULT = Pubkey.find_program_address([b"magic-fee-vault", bytes(VALIDATOR)], w.DELEGATION)[0]
ADMIN = Pubkey.from_string("HDbeKypeJHXMM5Xs2RHKj8XGQgJeP4jnQ1Jiugf8mXPn")
assert str(VAULT) == "5SRuhQybZ3FqmymaxoipqnieGZ5bNnrQqYwUZSRoCCZQ", "the rollup fee vault the registry uses"
svm = w.svm


class UnsignedAdmin:
    """Stands for the admin when its keypair is not at hand: the simulator then skips signature checks."""
    def pubkey(self):
        return ADMIN


if len(sys.argv) > 2:
    admin = Keypair.from_bytes(bytes(json.loads(Path(sys.argv[2]).read_text())))
    assert admin.pubkey() == ADMIN, "the admin key built into the program"
else:
    admin = UnsignedAdmin()
    svm.with_sigverify(False)
svm.add_program_from_file(MAGIC, Path(sys.argv[1]).resolve())
assert isinstance(svm.airdrop(admin.pubkey(), 1_000_000_000), TransactionMetadata)
RENT = svm.minimum_balance_for_rent_exemption(w.SIZE)
FEE = 100_000
LOW = 10 * FEE


def code(result):
    found = re.search(r"InstructionError\(\d+, Custom\((\d+)\)\)", str(result))
    return int(found[1]) if found else None


def logs_of(result):
    meta = result if isinstance(result, TransactionMetadata) else result.meta()
    return meta.logs() if callable(meta.logs) else meta.logs


def stand_in_saw(result):
    """The accounts (key, signer, writable) and the first data word the stand-in magic program received."""
    seen, key, word = [], None, None
    for line in logs_of(result):
        body = line.removeprefix("Program log: ")
        if body == line:
            continue
        parts = [x.strip() for x in body.split(",")]
        if len(parts) == 5 and parts[0] == "0xac":
            seen.append((key, int(parts[2], 16), int(parts[3], 16)))
        elif len(parts) == 5 and parts[0] == "0x5d":
            seen.append(("same as", int(parts[2], 16)))
        elif len(parts) == 5 and parts[0] == "0xda":
            word = (int(parts[1], 16), int(parts[2], 16))
        elif re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", body):
            key = body
    return seen, word


def save(caller, op=29, *, vault=VAULT, error=None, magic=MAGIC, context=CONTEXT, world_writable=True, payer=None,
         extra=b"", world=None, accounts=None):
    keys = [w.meta(caller.pubkey(), payer is None, True), w.meta(world or w.WORLD, writable=world_writable),
            w.meta(magic), w.meta(context, writable=True)]
    if vault is not None:
        keys.append(w.meta(vault, writable=True))
    if accounts is not None:
        keys = keys[:accounts]
    signer = payer or caller
    svm.expire_blockhash()
    before = svm.get_account(w.WORLD).data
    instruction = Instruction(w.PROGRAM, bytes([op]) + extra, keys)
    if isinstance(signer, UnsignedAdmin):
        message = Message.new_with_blockhash([instruction], ADMIN, svm.latest_blockhash())
        wire = Transaction.populate(message, [Signature.default()])
    else:
        wire = Transaction.new_signed_with_payer([instruction], signer.pubkey(), [signer], svm.latest_blockhash())
    result = svm.send_transaction(wire)
    if error is None:
        assert isinstance(result, TransactionMetadata), result
    else:
        assert isinstance(result, FailedTransactionMetadata), result
        assert code(result) == error, (code(result), error, str(result)[:600])
        assert svm.get_account(w.WORLD).data == before, "a refused save changed the world"
    return result


def set_lamports(amount):
    account = svm.get_account(w.WORLD)
    svm.set_account(w.WORLD, Account(amount, account.data, account.owner))


def header():
    state = w.world()
    return w.u32(state, 40), w.u32(state, 52), w.u32(state, 56)


ok = w.check
w.tick(5000)
w.tx(w.operator, [w.meta(w.operator.pubkey(), True, True), w.meta(w.WORLD, writable=True), w.meta(w.SYSTEM)],
     struct.pack("<BBQ", 16, 0, RENT + 5_000_000))
shard = w.registered("save-ivy", w.ivy)
w.action(w.ivy, 18, b"save-ivy", shard=shard)
outsider = w.outsider

revision = header()[0]
result = save(outsider)
saw, word = stand_in_saw(result)
ok("Anyone may save new changes; with a reserve the world pays: it signs, with the fee vault, data [1,0,0,0]",
   saw == [(str(w.WORLD), 1, 1), (str(CONTEXT), 0, 1), (str(VAULT), 0, 1), ("same as", 0)] and word == (4, 1))
ok("The save is recorded in the header: revision moved on by one, saved revision and time set",
   header() == (revision + 1, revision + 1, 5000))
save(outsider, error=39)
ok("Nothing new to save is refused (39)", True)
w.action(w.ivy, 25)
save(outsider, error=34)
w.tick(5119)
save(outsider, error=34)
ok("New changes are saved at most once every 120 seconds by others (34)", True)
w.tick(5120)
save(outsider)
ok("After 120 seconds the next save goes through", header()[1:] == (header()[0], 5120))
save(admin)
ok("The admin may save at any time, even with nothing new", header()[2] == 5120)

save(outsider, 30, error=38)
set_lamports(RENT + LOW)
save(outsider, 30, error=38)
ok("Handing the world back is refused to others while 10 or more paid saves are left (38)", True)
set_lamports(RENT + 5_000_000)
result = save(admin, 30)
saw, word = stand_in_saw(result)
ok("The admin may hand it back at any time: the caller signs, data [2,0,0,0]",
   saw == [(str(admin.pubkey()), 1, 1), (str(CONTEXT), 0, 1), (str(w.WORLD), 0, 1)] and word == (4, 2))
set_lamports(RENT + LOW - 1)
result = save(outsider, 30)
saw, word = stand_in_saw(result)
ok("With fewer than 10 paid saves left, anyone may hand it back (to refill it and delegate it again)",
   saw[0] == (str(outsider.pubkey()), 1, 1) and word == (4, 2))

set_lamports(RENT + FEE - 1)
w.action(w.ivy, 25)
w.tick(5400)
result = save(outsider)
saw, word = stand_in_saw(result)
ok("Without enough for one fee, the caller sponsors the save instead (MagicBlock allows 10 per delegation)",
   saw == [(str(outsider.pubkey()), 1, 1), (str(CONTEXT), 0, 1), (str(w.WORLD), 0, 1)] and word == (4, 1))
set_lamports(RENT + 5_000_000)
w.action(w.ivy, 25)
w.tick(5600)
saw, _ = stand_in_saw(save(outsider, vault=None))
ok("Without the fee vault the caller sponsors", saw[0] == (str(outsider.pubkey()), 1, 1))
w.action(w.ivy, 25)
w.tick(5800)
saw, _ = stand_in_saw(save(outsider, vault=Pubkey.new_unique()))
ok("A wrong fee vault is never used for a paid save", saw[0] == (str(outsider.pubkey()), 1, 1))

w.action(w.ivy, 25)
w.tick(6000)
save(outsider, magic=Pubkey.new_unique(), error=1)
save(outsider, context=Pubkey.new_unique(), error=1)
save(outsider, accounts=3, error=1)
save(outsider, extra=b"\0", error=1)
save(outsider, world_writable=False, error=3)
save(outsider, world=Pubkey.find_program_address([b"eb-duel", b"\0"], w.PROGRAM)[0], error=3)
save(outsider, payer=w.ash, error=2)
ok("Wrong accounts, extra data and an unsigned caller are refused and change nothing", True)
save(outsider)
ok("After all that, a normal save still works", header()[2] == 6000)
