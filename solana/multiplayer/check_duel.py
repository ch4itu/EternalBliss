"""Exercise compiled BPF using LiteSVM. This script does not use a network."""
from pathlib import Path
from struct import pack, unpack_from
import ast
import hashlib
import re
import sys

from solders.account import Account
from solders.clock import Clock
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.litesvm import LiteSVM
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solders.transaction_metadata import FailedTransactionMetadata, TransactionMetadata

ROOT = Path(__file__).resolve().parent
PROGRAM = Keypair().pubkey()
SYSTEM = Pubkey.default()
DELEGATION = Pubkey.from_string("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh")
REGISTRY = Pubkey.from_string("CW9AQnTKvTnBfsdUChQiYKfCPhWb7FWkUWyVxv1iaN5P")
MANIFEST = (ROOT / "src/manifest.rs").read_text()
SHARDS = [Pubkey.from_bytes(bytes(row)) for row in
          ast.literal_eval(re.search(r"\bREGISTRY_SHARDS: [^=]+=\s*(.*?);", MANIFEST, flags=re.S)[1])]
WORLD_SIZE = int(re.search(r"\bWORLD_SIZE: usize = ([0-9]+);", MANIFEST)[1])
WORLD = Pubkey.find_program_address([b"eb-land", b"\0"], PROGRAM)[0]
svm = LiteSVM()
svm.add_program_from_file(PROGRAM, ROOT / "target/bpfel-unknown-none/release/libeternalbliss_world.so")
operator, host, guest, stranger, nobody = (Keypair() for _ in range(5))
for player in (operator, host, guest, stranger, nobody):
    assert isinstance(svm.airdrop(player.pubkey(), 100_000_000), TransactionMetadata)


def account(key, signer=False, writable=False):
    return AccountMeta(key, signer, writable)


def invoke(payer, keys, data, accepted=True):
    svm.expire_blockhash()
    instruction = Instruction(PROGRAM, data, keys)
    tx = Transaction.new_signed_with_payer([instruction], payer.pubkey(), [payer], svm.latest_blockhash())
    result = svm.send_transaction(tx)
    if accepted:
        assert isinstance(result, TransactionMetadata), result
    else:
        assert isinstance(result, FailedTransactionMetadata), result
    return result


def table(index):
    return Pubkey.find_program_address([b"eb-duel", bytes([index])], PROGRAM)[0]


def initialize(index):
    invoke(operator, [account(operator.pubkey(), True, True), account(table(index), writable=True), account(SYSTEM)],
           pack("<BBQ", 0, index, svm.minimum_balance_for_rent_exemption(112)))
    assert state(index)[:9] == b"EBDUEL01" + bytes([index])


def state(index=0):
    return svm.get_account(table(index)).data


def expect(name, condition):
    assert condition, name
    print("PASS", name)


def registered(name, key):
    """A Smaran registry entry for a test name, written straight into a simulated registry group."""
    name_hash = hashlib.sha256(b"SABHA-CHAINKEY-NAME-V1\0" + name.encode()).digest()
    index = name_hash[0] % 4
    stored = svm.get_account(SHARDS[index])
    data = bytearray(stored.data if stored else 10144)
    data[:8] = b"SABREG01"
    data[8] = index
    start = int.from_bytes(name_hash[1:3], "little") % 35
    for offset in range(35):
        at = 64 + ((start + offset) % 35) * 288
        if data[at] == 0:
            data[at] = 1
            data[at + 8:at + 40] = name_hash
            data[at + 40:at + 72] = bytes(key.pubkey())
            break
    svm.set_account(SHARDS[index], Account(100_000_000, bytes(data), REGISTRY))
    return SHARDS[index]


def join_world(player, name):
    """Create the player's character in the shared world (instruction 18), as the page does after sign-in."""
    invoke(player, [account(player.pubkey(), True, True), account(WORLD, writable=True), account(registered(name, player))],
           pack("<BI", 18, 0) + name.encode())


def code(result):
    found = re.search(r"InstructionError\(\d+, Custom\((\d+)\)\)", str(result))
    return int(found[1]) if found else None


def move(player, opcode, action=0, *, accepted=True, match_id=None, seq=None, index=0, world=None, error=None):
    current = state(index)
    actual_id, actual_seq = unpack_from("<II", current, 24)
    keys = [account(player.pubkey(), True, True), account(table(index), writable=True), account(WORLD if world is None else world)]
    data = pack("<BBIIB", opcode, index, actual_id if match_id is None else match_id, actual_seq if seq is None else seq, action)
    result = invoke(player, keys, data, accepted)
    if not accepted:
        assert state(index) == current, "rejected instruction changed account data"
        assert error is None or code(result) == error, (code(result), error)
    return state(index)


def tick(seconds):
    svm.set_clock(Clock(0, 0, 0, 0, seconds))


tick(1000)
initialize(0)
initialize(1)
expect("Operator created separate tables", state(0)[8] == 0 and state(1)[8] == 1)
invoke(operator, [account(operator.pubkey(), True, True), account(WORLD, writable=True), account(SYSTEM)],
       pack("<BBQ", 16, 0, svm.minimum_balance_for_rent_exemption(WORLD_SIZE)))
for player, name in ((host, "duel-host"), (guest, "duel-guest"), (stranger, "duel-stranger")):
    join_world(player, name)
empty = state()
move(nobody, 2, accepted=False, error=37)
move(host, 2, accepted=False, world=table(1), error=3)
move(host, 2, accepted=False, world=Pubkey.new_unique(), error=3)
expect("Only players with a character in the shared world can host (checked against the real world account)", state() == empty)
opened = move(host, 2)
expect("Host creates a numbered, joinable match", opened[9] == 1 and unpack_from("<I", opened, 24)[0] == 1)
move(host, 3, accepted=False)
move(guest, 3, accepted=False, match_id=0)
expect("Self join and old codes are rejected", state() == opened)
move(nobody, 3, accepted=False, error=37)
expect("A player without a character cannot join", state() == opened)
active = move(guest, 3)
expect("A second signer joins with equal stats", active[9:11] == bytes([2, 0]) and active[12:18] == bytes([100, 100, 48, 48, 2, 2]))
move(stranger, 4, 1, accepted=False)
move(guest, 4, 1, accepted=False)
move(host, 4, 3, accepted=False)
expect("Outsiders, out-of-turn actions, and full-health healing are rejected", state() == active)
magic = move(host, 4, 2)
expect("Magic consumes mana and advances the turn", magic[10] == 1 and magic[13:16] == bytes([74, 36, 48]))
move(host, 4, 2, seq=unpack_from("<I", active, 28)[0], accepted=False)
healed = move(guest, 4, 3)
expect("Stale writes fail and healing consumes a potion", healed[13] == 100 and healed[17] == 1)
move(host, 4, 1)
move(guest, 4, 1)
move(host, 4, 2)
move(guest, 4, 1)
move(host, 4, 2)
move(guest, 4, 1)
move(host, 4, 2)
move(guest, 4, 1)
move(host, 4, 2, accepted=False)
won = move(host, 4, 1)
expect("Four spells deplete mana and the final attack resolves a win", won[9] == 3 and won[11] == 1 and won[13] == 0 and won[14] == 0)

move(stranger, 7, accepted=False)
voted = move(host, 7)
move(host, 7, accepted=False)
expect("Rematch requires distinct consent from both participants", voted[9] == 3 and voted[20] == 1)
restarted = move(guest, 7)
expect("Rematch keeps the code and reverses the opening turn", restarted[9:11] == bytes([2, 1]) and restarted[12:14] == bytes([100, 100]))
move(host, 6, accepted=False)
tick(1075)
move(guest, 4, 1, accepted=False)
timed = move(host, 6)
expect("Expiry resolves an abandoned turn without client cooperation", timed[9] == 3 and timed[11] == 1 and timed[21] == 3)
move(stranger, 2, accepted=False)
tick(1135)
reused = move(stranger, 2)
expect("Reused table has a new code", reused[9] == 1 and unpack_from("<I", reused, 24)[0] == 2)
move(guest, 3, accepted=False, match_id=1)
move(host, 3)
ended = move(stranger, 5)
expect("Conceding assigns the win to the other participant", ended[9] == 3 and ended[11] == 2 and ended[21] == 2)

move(guest, 2, index=1)
move(guest, 5, index=1)
expect("The host can cancel an open invite", state(1)[9] == 0)
move(host, 2, index=1)
tick(1315)
move(guest, 3, accepted=False, index=1)
expect("Expired invite is rejected and can be replaced", move(stranger, 2, index=1)[9] == 1)

if len(sys.argv) > 1:
    svm.add_program_from_file(DELEGATION, Path(sys.argv[1]).resolve())
    initialize(2)
    key = table(2)
    buffer = Pubkey.find_program_address([b"buffer", bytes(key)], PROGRAM)[0]
    record = Pubkey.find_program_address([b"delegation", bytes(key)], DELEGATION)[0]
    metadata = Pubkey.find_program_address([b"delegation-metadata", bytes(key)], DELEGATION)[0]
    invoke(operator, [
        account(operator.pubkey(), True, True), account(key, writable=True), account(PROGRAM),
        account(buffer, writable=True), account(record, writable=True), account(metadata, writable=True),
        account(DELEGATION), account(SYSTEM),
    ], bytes([1, 2]))
    expect("Public MagicBlock program delegates the table", svm.get_account(key).owner == DELEGATION)
