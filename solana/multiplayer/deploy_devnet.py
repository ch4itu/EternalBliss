"""Plan or deploy EternalBliss to Solana Devnet and delegate its accounts to MagicBlock."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import struct
import time
import urllib.error
import urllib.request

from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.system_program import CreateAccountParams, create_account
from solders.transaction import Transaction

BASE = "https://api.devnet.solana.com"
ER = "https://devnet-as.magicblock.app"
DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
LOADER = Pubkey.from_string("BPFLoaderUpgradeab1e11111111111111111111111")
DELEGATION = Pubkey.from_string("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh")
SYSTEM = Pubkey.default()
RENT = Pubkey.from_string("SysvarRent111111111111111111111111111111111")
CLOCK = Pubkey.from_string("SysvarC1ock11111111111111111111111111111111")
ROOT = Path(__file__).resolve().parent
WORLD_SIZE = 5380
CHUNK = 850
UPLOAD_BATCH_SIZE = 8


def rpc(method, params=(), *, url=BASE):
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":list(params)}).encode()
    request = urllib.request.Request(url,body,{"Content-Type":"application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                reply = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 4:
                raise
            if error.code == 429:
                after = error.headers.get("Retry-After", "")
                time.sleep(max(10, int(after)) if after.isdecimal() else 10)
                continue
        except (TimeoutError, urllib.error.URLError):
            if attempt == 4:
                raise
        time.sleep(1.2 * (attempt + 1))
    if "error" in reply:
        raise RuntimeError(method + " failed: " + str(reply["error"]["message"]))
    return reply["result"]


def meta(key, signer=False, writable=False):
    return AccountMeta(key, signer, writable)


def create(payer, account, amount, space):
    return create_account(CreateAccountParams(from_pubkey=payer, to_pubkey=account,
        lamports=amount, space=space, owner=LOADER))


def upload_buffer(send, rent, payer, buffer, elf, *, uploaded=None, send_writes=None,
                  read_uploaded=None, progress=None):
    payer_key = payer.pubkey()
    buffer_key = buffer.pubkey()
    if uploaded is None:
        send([
            create(payer_key,buffer_key,rent(len(elf)+37),len(elf)+37),
            Instruction(LOADER,struct.pack("<I",0),[meta(buffer_key,writable=True),meta(payer_key)])
        ],[payer,buffer])
        uploaded = bytes(len(elf))
    batch_bytes = CHUNK * UPLOAD_BATCH_SIZE
    for start in range(0,len(elf),batch_bytes):
        end = min(start+batch_bytes,len(elf))
        writes = []
        for offset in range(start,end,CHUNK):
            part = elf[offset:offset+CHUNK]
            existing = uploaded[offset:offset+len(part)]
            if existing == part:
                continue
            if any(existing):
                raise RuntimeError(f"Existing buffer bytes differ at offset {offset}.")
            writes.append(Instruction(LOADER,struct.pack("<IIQ",1,offset,len(part))+part,
                [meta(buffer_key,writable=True),meta(payer_key,True)]))
        if writes and send_writes:
            send_writes(writes,payer)
        else:
            for instruction in writes:
                send([instruction],[payer])
        if progress:
            progress(f"Buffer upload verified through byte {end}/{len(elf)}")
    if read_uploaded and read_uploaded() != elf:
        raise RuntimeError("Upload buffer does not contain the exact release bytecode.")


def upload_program(send, rent, payer, program, buffer, elf, **upload_options):
    upload_buffer(send,rent,payer,buffer,elf,**upload_options)
    payer_key = payer.pubkey()
    buffer_key = buffer.pubkey()
    program_key = program.pubkey()
    data_key = Pubkey.find_program_address([bytes(program_key)], LOADER)[0]
    send([
        create(payer_key,program_key,rent(36),36),
        Instruction(LOADER,struct.pack("<IQ",2,len(elf)),[
            meta(payer_key,True,True),meta(data_key,writable=True),meta(program_key,writable=True),
            meta(buffer_key,writable=True),meta(RENT),meta(CLOCK),meta(SYSTEM),meta(payer_key,True)
        ])
    ],[payer,program])
    return data_key


def game_accounts():
    yield b"eb-land",0,16,17,WORLD_SIZE
    for index in range(4):
        yield b"eb-duel",index,0,1,112


def accounts_for(program):
    for seed,index,initialize,delegate,size in game_accounts():
        pda = Pubkey.find_program_address([seed,bytes([index])],program)[0]
        yield pda,index,initialize,delegate,size


def setup_instructions(program,payer,pda,index,initialize,delegate,rent_amount):
    init = Instruction(program,struct.pack("<BBQ",initialize,index,rent_amount),
        [meta(payer,True,True),meta(pda,writable=True),meta(SYSTEM)])
    buffer = Pubkey.find_program_address([b"buffer",bytes(pda)],program)[0]
    record = Pubkey.find_program_address([b"delegation",bytes(pda)],DELEGATION)[0]
    metadata = Pubkey.find_program_address([b"delegation-metadata",bytes(pda)],DELEGATION)[0]
    delegation = Instruction(program,bytes([delegate,index]),[
        meta(payer,True,True),meta(pda,writable=True),meta(program),meta(buffer,writable=True),
        meta(record,writable=True),meta(metadata,writable=True),meta(DELEGATION),meta(SYSTEM)
    ])
    return init, delegation


_recent = None


def signed_transaction(instructions, signers):
    global _recent
    now = time.monotonic()
    if _recent is None or now - _recent[0] > 13:
        blockhash = rpc("getLatestBlockhash",[{"commitment":"confirmed"}])["value"]["blockhash"]
        _recent = (now, blockhash)
    recent = _recent[1]
    return Transaction.new_signed_with_payer(instructions, signers[0].pubkey(), signers, Hash.from_string(recent))


def submit(transaction):
    return rpc("sendTransaction",[base64.b64encode(bytes(transaction)).decode(),
        {"encoding":"base64","preflightCommitment":"confirmed","maxRetries":5}])


def confirm(signatures, seconds):
    pending = list(signatures)
    stop = time.monotonic()+seconds
    while time.monotonic()<stop and pending:
        statuses = rpc("getSignatureStatuses",[pending])["value"]
        waiting = []
        for sig, receipt in zip(pending,statuses,strict=True):
            if receipt and receipt["err"]:
                raise RuntimeError(f"Transaction {sig} failed: {receipt['err']}")
            if not receipt or receipt["confirmationStatus"] not in ("confirmed","finalized"):
                waiting.append(sig)
        pending = waiting
        if pending:
            time.sleep(.65)
    return pending


def send(instructions, signers):
    sig = submit(signed_transaction(instructions,signers))
    if confirm([sig],55):
        raise RuntimeError(f"Confirmation pending for {sig}. Check its status before retrying.")


def send_upload_batch(writes, payer):
    transactions = [signed_transaction([instruction],[payer]) for instruction in writes]
    # These writes cover disjoint ranges, so they can land in either order.
    with ThreadPoolExecutor(max_workers=4) as pool:
        signatures = list(pool.map(submit, transactions))
    pending = confirm(signatures,55)
    if pending:
        raise RuntimeError(f"Bytecode writes still pending: {', '.join(pending)}. Check the buffer before resuming.")


def read_account(key, url=BASE):
    return rpc("getAccountInfo",[str(key),{"encoding":"base64","commitment":"confirmed"}],url=url)["value"]


def rent(space):
    return rpc("getMinimumBalanceForRentExemption",[space,{"commitment":"confirmed"}])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elf", type=Path, default=ROOT/"libeternalbliss_world.so")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--payer", type=Path)
    parser.add_argument("--program", type=Path)
    parser.add_argument("--buffer", type=Path, help="Persistent keypair for a new program upload")
    parser.add_argument("--max-test-lamports", type=int)
    parser.add_argument("--world-reserve", type=int, default=0,
                        help="Lamports above rent for the world, which pays for its own saves to Solana from them")
    args = parser.parse_args()
    elf = args.elf.read_bytes()
    if not elf.startswith(b"\x7fELF"): raise RuntimeError("Expected a compiled sBPF ELF.")
    if rpc("getGenesisHash") != DEVNET or rpc("getIdentity",url=ER)["identity"] != VALIDATOR:
        raise RuntimeError("Unexpected network or rollup.")
    size = len(elf)
    program_rent = rent(36) + rent(45+size)
    temporary_buffer = rent(37+size)
    game_rent = rent(WORLD_SIZE) + args.world_reserve + 4*rent(112)
    # Conservative allowance for five delegation accounts and their fees, plus the bytecode writes.
    setup_margin = 50_000_000 + 10_000 * ((size+CHUNK-1)//CHUNK+12)
    bound = max(program_rent+temporary_buffer,program_rent+game_rent)+setup_margin
    print(json.dumps({"elf_sha256":hashlib.sha256(elf).hexdigest(),"program_rent_lamports":program_rent,
        "buffer_rent_lamports":temporary_buffer,"game_state_rent_lamports":game_rent,
        "conservative_operator_limit_lamports":bound},indent=2))
    if not args.apply:
        return
    if not all((args.payer,args.program,args.buffer,args.max_test_lamports)):
        parser.error("--apply requires the payer, program and buffer keypairs, and --max-test-lamports")
    load = lambda path: Keypair.from_bytes(bytes(json.loads(path.read_text())))
    payer,program,buffer = map(load,[args.payer,args.program,args.buffer])
    key = program.pubkey()
    balance = rpc("getBalance",[str(payer.pubkey()),{"commitment":"confirmed"}])["value"]
    if bound > args.max_test_lamports:
        raise RuntimeError("The conservative estimate exceeds the allowed Devnet test budget.")
    info = read_account(key)
    existing_buffer = None if info else read_account(buffer.pubkey())
    committed = program_rent if info and info["executable"] else (existing_buffer["lamports"] if existing_buffer else 0)
    if balance + committed < bound:
        raise RuntimeError(f"Devnet operator has {balance} available lamports. Estimated reserve is {bound} test lamports.")
    if not info:
        uploaded = None
        if existing_buffer:
            contents = base64.b64decode(existing_buffer["data"][0])
            expected = struct.pack("<I",1) + bytes([1]) + bytes(payer.pubkey())
            if existing_buffer["owner"] != str(LOADER) or contents[:37] != expected or len(contents) != size+37:
                raise RuntimeError("The upload buffer does not match the release and operator.")
            uploaded = contents[37:]
        def read_uploaded():
            return base64.b64decode(read_account(buffer.pubkey())["data"][0])[37:]

        upload_program(send,rent,payer,program,buffer,elf,uploaded=uploaded,
                       send_writes=send_upload_batch,read_uploaded=read_uploaded,progress=print)
        info = read_account(key)
    if not info or not info["executable"] or info["owner"] != str(LOADER):
        raise RuntimeError("The program did not become executable on Devnet.")
    program_data = Pubkey.find_program_address([bytes(key)],LOADER)[0]
    deployed = base64.b64decode(read_account(program_data)["data"][0])[45:]
    if deployed[:size] != elf or any(deployed[size:]):
        raise RuntimeError("Devnet bytecode does not match the release.")
    print("Verified executable program and exact bytecode",key)
    expected = []
    for pda,index,initialize,delegate,space in accounts_for(key):
        state = read_account(pda)
        amount = rent(space) + (args.world_reserve if initialize == 16 else 0)
        init, delegation = setup_instructions(key,payer.pubkey(),pda,index,initialize,delegate,amount)
        if not state:
            send([init],[payer])
            state = read_account(pda)
        if state and state["owner"] == str(key):
            send([delegation],[payer])
        elif not state or state["owner"] != str(DELEGATION):
            raise RuntimeError(f"Unexpected owner at {pda}.")
        expected.append((pda,space,initialize))
        print("Prepared Devnet account",pda)
    for pda,space,initialize in expected:
        for _ in range(20):
            account = read_account(pda,ER)
            if account and account["owner"] == str(key):
                bytes_on_er = base64.b64decode(account["data"][0])
                if len(bytes_on_er)==space and bytes_on_er[:8] == (b"EBWRLD01" if initialize==16 else b"EBDUEL01"):
                    break
            time.sleep(1)
        else:
            raise RuntimeError(f"Rollup has not accepted {pda}. Wait before configuring the client.")
    print("Verified Devnet program and delegated accounts",key)


if __name__ == "__main__":
    main()
