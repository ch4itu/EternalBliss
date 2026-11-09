"""Exercise the built program with two distinct signed players on one simulated ledger."""
import hashlib
import struct
from pathlib import Path
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
import re
import ast

def constant(name):
    return int(re.search(rf"\b{name}: usize = ([0-9]+);", MANIFEST)[1])

def array(name):
    return ast.literal_eval(re.search(rf"\b{name}: [^=]+=\s*(.*?);", MANIFEST, flags=re.S)[1])

SHARDS = [Pubkey.from_bytes(bytes(row)) for row in array("REGISTRY_SHARDS")]
WORLD = Pubkey.find_program_address([b"eb-land", b"\0"], PROGRAM)[0]
SIZE = constant("WORLD_SIZE")
P_SIZE = constant("PLAYER_SIZE")
H = constant("HEADER")
ITEM_OFFSET = constant("ITEM_OFFSET")
ENEMY_OFFSET = constant("ENEMY_OFFSET")
STOCK_OFFSET = constant("STOCK_OFFSET")
ITEMS = array("ITEMS")
ENEMIES = array("ENEMIES")
BUILDINGS = array("BUILDINGS")
TILES = (ROOT / "src/map.bin").read_bytes()
WIDTH = constant("WIDTH")
HEIGHT = constant("HEIGHT")

svm = LiteSVM()
svm.add_program_from_file(PROGRAM, ROOT / "target/bpfel-unknown-none/release/libeternalbliss_world.so")
operator, ivy, ash, outsider = (Keypair() for _ in range(4))
for player in (operator, ivy, ash, outsider):
    assert isinstance(svm.airdrop(player.pubkey(), 1_000_000_000), TransactionMetadata)


def meta(key, signer=False, writable=False):
    return AccountMeta(key, signer, writable)


def tx(player, keys, data, ok=True):
    svm.expire_blockhash()
    before = svm.get_account(WORLD)
    before_data = before.data if before else None
    ix = Instruction(PROGRAM, data, keys)
    wire = Transaction.new_signed_with_payer([ix], player.pubkey(), [player], svm.latest_blockhash())
    outcome = svm.send_transaction(wire)
    assert isinstance(outcome, TransactionMetadata if ok else FailedTransactionMetadata), outcome
    if not ok and before_data:
        assert svm.get_account(WORLD).data == before_data, "rejected instruction changed state"
    return outcome


def tick(now):
    svm.set_clock(Clock(0, 0, 0, 0, now))


def world():
    return svm.get_account(WORLD).data


def player(key):
    state = world()
    for i in range(constant("PLAYERS")):
        off = H + i*P_SIZE
        if state[off:off+32] == bytes(key.pubkey()):
            return state[off:off+P_SIZE]
    return None


def u16(data, at):
    return struct.unpack_from("<H", data, at)[0]


def u32(data, at):
    return struct.unpack_from("<I", data, at)[0]


def place_for_test(key, x, y):
    """Place a test player near distant world content. The gameplay instruction never permits this."""
    account = svm.get_account(WORLD)
    data = bytearray(account.data)
    for i in range(constant("PLAYERS")):
        off = H + i*P_SIZE
        if data[off:off+32] == bytes(key.pubkey()):
            struct.pack_into("<HHHH", data, off+64, x,y,x,y)
            svm.set_account(WORLD, Account(account.lamports, bytes(data), PROGRAM))
            return
    raise RuntimeError("player missing")


def registered(name, key):
    name_hash = hashlib.sha256(b"SABHA-CHAINKEY-NAME-V1\0"+name.encode()).digest()
    index = name_hash[0] % 4
    shard = SHARDS[index]
    stored = svm.get_account(shard)
    data = bytearray(stored.data if stored else 10144)
    data[:8] = b"SABREG01"
    data[8] = index
    start = int.from_bytes(name_hash[1:3],"little") % 35
    for offset in range(35):
        at = 64 + ((start + offset) % 35) * 288
        if data[at] == 0:
            data[at] = 1
            data[at+8:at+40] = name_hash
            data[at+40:at+72] = bytes(key.pubkey())
            break
    svm.set_account(shard, Account(100_000_000, bytes(data), REGISTRY))
    return shard


def action(key, op, args=b"", *, shard=None, seq=None, ok=True):
    own = player(key)
    nonce = (u32(own,84) if own else 0) if seq is None else seq
    keys = [meta(key.pubkey(),True,True),meta(WORLD,writable=True)]
    if shard is not None:
        keys.append(meta(shard))
    return tx(key, keys, struct.pack("<BI", op,nonce)+args, ok)


def check(label, result):
    assert result, label
    print("PASS", label)


if __name__ == "__main__":
    tick(1000)
    tx(operator,[meta(operator.pubkey(),True,True),meta(WORLD,writable=True),meta(SYSTEM)],
       struct.pack("<BBQ",16,0,svm.minimum_balance_for_rent_exemption(SIZE)))
    check("Shared map header and layout are initialized", world()[:8]==b"EBWRLD01" and world()[8:40]==bytes(array("MAP_HASH")))
    a_shard = registered("ivy-hero",ivy)
    b_shard = registered("ash-hero",ash)
    action(outsider,18,b"ivy-hero",shard=a_shard,ok=False)
    action(ivy,18,b"ivy-hero",shard=b_shard if b_shard != a_shard else Pubkey.new_unique(),ok=False)
    action(ivy,18,b"ivy-hero",shard=a_shard)
    action(ash,18,b"ash-hero",shard=b_shard)
    check("Only matching Smaran signers join, with the original spawn",
          player(outsider) is None and u16(player(ivy),64)==75 and u16(player(ash),66)==75)
    before = u32(player(ivy),84)
    action(ivy,19,b"\x01")
    action(ivy,19,b"\x01",seq=before,ok=False)
    check("Signed cardinal movement advances position once", u16(player(ivy),64)==76 and u16(player(ash),64)==75)

    def ground(x,y):
        at=y*WIDTH+x
        return ((TILES[at//4]>>((at%4)*2))&3)==0

    loot = next(i for i,a in enumerate(ITEMS) if a[2]==1 and 0<a[0]<WIDTH-1 and 0<a[1]<HEIGHT-1 and ground(a[0],a[1]))
    x,y,_,value = ITEMS[loot]
    action(ivy,20,struct.pack("<H",loot),ok=False)
    place_for_test(ivy,x,y)
    place_for_test(ash,x,y)
    action(ivy,20,struct.pack("<H",loot))
    action(ash,20,struct.pack("<H",loot),ok=False)
    check("Both players see the same taken treasure and only its winner is credited",
          u32(world(),ITEM_OFFSET+loot*4)==1090 and u32(player(ivy),76)==100+value and u32(player(ash),76)==100)
    tick(1089)
    action(ash,20,struct.pack("<H",loot),ok=False)
    tick(1090)
    action(ash,20,struct.pack("<H",loot))
    check("Treasure recharges at its original tile for the other player",
          u16(player(ash),102)==1 and u32(player(ash),76)==100+value)

    victim = next(i for i,a in enumerate(ENEMIES) if 16<a[4]<=32)
    x,y,_,_,full,_,reward,_ = ENEMIES[victim]
    place_for_test(ivy,x,y)
    place_for_test(ash,x,y)
    action(ivy,21,struct.pack("<HB",victim,1))
    check("Both players read damage to the same enemy", u16(world(),ENEMY_OFFSET+victim*8)==full-16)
    action(ivy,21,struct.pack("<HB",victim,1),ok=False)
    action(ash,21,struct.pack("<HB",victim,1))
    action(ivy,21,struct.pack("<HB",victim,1),ok=False)
    check("Only the finishing player receives the win and XP",
          u16(player(ash),100)==1 and u32(player(ash),80)==reward and u16(player(ivy),100)==0)
    tick(1125)
    action(ivy,21,struct.pack("<HB",victim,1))
    check("Enemy respawns with full health on the shared timer", u16(world(),ENEMY_OFFSET+victim*8)==full-16)

    shop = next(i for i,b in enumerate(BUILDINGS) if b[2]==2)
    x,y,_,idx = BUILDINGS[shop]
    place_for_test(ivy,x,y)
    place_for_test(ash,x,y)
    buy=struct.pack("<HB",shop,0)
    action(ivy,22,buy)
    action(ash,22,buy)
    action(ivy,22,buy)
    action(ash,22,buy,ok=False)
    check("All players deplete the same shop stock", u32(world(),STOCK_OFFSET+idx*16)&3==3)
    tick(1140)
    action(ash,22,buy)
    check("Shared shop stock recharges", u32(world(),STOCK_OFFSET+idx*16)&3==1)

    before = u32(player(ivy),84)
    action(ivy,24)
    action(ivy,25,ok=False)
    action(ivy,18,b"ivy-hero",shard=a_shard)
    action(ivy,25,seq=before,ok=False)
    check("Reconnect preserves progress and invalidates earlier writes", u16(player(ivy),102)==1 and u32(player(ivy),88)==1140)
    place_for_test(ivy,0,0)
    action(ivy,19,b"\x03",ok=False)
    check("Movement outside the world is rejected", u16(player(ivy),64)==0)

    def clear(x,y):
        spots=[(b[0],b[1]) for b in BUILDINGS]+[(a[0],a[1]) for a in ITEMS]
        spots+=[(e[0],e[1]) for e in ENEMIES]+[(e[2],e[3]) for e in ENEMIES]
        return ground(x,y) and (x,y) not in spots
    sx,sy = next((x,y) for y in range(1,HEIGHT-1) for x in range(1,WIDTH-15) if all(clear(x+i,y) for i in range(14)))
    place_for_test(ivy,sx,sy)
    tick(1200)
    action(ivy,19,b"\x01"*8)
    action(ivy,19,b"\x01"*4)
    action(ivy,19,b"\x01",ok=False)
    check("Twelve steps a second are accepted (a held key makes about 8), the thirteenth waits", u16(player(ivy),64)==sx+12)
    tick(1201)
    action(ivy,19,b"\x01")
    check("The next second walking continues", u16(player(ivy),64)==sx+13)

    if len(sys.argv) > 1:
        svm.add_program_from_file(DELEGATION,Path(sys.argv[1]).resolve())
        buffer=Pubkey.find_program_address([b"buffer",bytes(WORLD)],PROGRAM)[0]
        record=Pubkey.find_program_address([b"delegation",bytes(WORLD)],DELEGATION)[0]
        metadata=Pubkey.find_program_address([b"delegation-metadata",bytes(WORLD)],DELEGATION)[0]
        tx(operator,[meta(operator.pubkey(),True,True),meta(WORLD,writable=True),meta(PROGRAM),meta(buffer,writable=True),
                     meta(record,writable=True),meta(metadata,writable=True),meta(DELEGATION),meta(SYSTEM)],bytes([17,0]))
        check("The official MagicBlock delegation program accepts the world account",svm.get_account(WORLD).owner==DELEGATION)
