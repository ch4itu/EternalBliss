"""Stage a verified release buffer for an existing EternalBliss Devnet program."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct

from solders.instruction import Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey

import deploy_devnet as d


def load_key(path):
    return Keypair.from_bytes(bytes(json.loads(path.read_text())))


def read_bytes(key, owner):
    account = d.read_account(key)
    if not account:
        return None
    if account['owner'] != str(owner):
        raise RuntimeError(f'Unexpected owner for {key}.')
    return base64.b64decode(account['data'][0])


def upgrade_ix(program, data, buffer, authority):
    return Instruction(d.LOADER,struct.pack('<I',3),[
        d.meta(data,writable=True), d.meta(program,writable=True), d.meta(buffer,writable=True),
        d.meta(authority,writable=True), d.meta(d.RENT), d.meta(d.CLOCK), d.meta(authority,True)
    ])


def extend_ix(program, data, authority, additional, checked=False):
    accounts=[d.meta(data,writable=True), d.meta(program,writable=True)]
    if checked:
        accounts.append(d.meta(authority,True))
    accounts.extend([d.meta(d.SYSTEM),d.meta(authority,True,True)])
    return Instruction(d.LOADER,struct.pack('<II',9 if checked else 6,additional),accounts)


def verify_extension(program,data,payer,additional):
    failures=[]
    for checked in (False,True):
        instruction=extend_ix(program,data,payer.pubkey(),additional,checked)
        tx=d.signed_transaction([instruction],[payer])
        result=d.rpc('simulateTransaction',[base64.b64encode(bytes(tx)).decode(),{
            'encoding':'base64','commitment':'confirmed','sigVerify':True
        }])['value']
        if not result['err']:
            return instruction
        failures.append(result['err'])
    raise RuntimeError(f'The Devnet loader declined the extension in simulation: {failures}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['stage','upgrade'])
    parser.add_argument('--payer',type=Path,required=True)
    parser.add_argument('--buffer',type=Path,required=True)
    parser.add_argument('--program',type=Pubkey.from_string,required=True)
    parser.add_argument('--elf',type=Path,required=True)
    parser.add_argument('--expected-old-sha',required=True)
    parser.add_argument('--max-test-lamports',type=int,required=True)
    args=parser.parse_args()

    payer,buffer=load_key(args.payer),load_key(args.buffer)
    owner=payer.pubkey()
    if d.rpc('getGenesisHash') != d.DEVNET or d.rpc('getIdentity',url=d.ER)['identity'] != d.VALIDATOR:
        raise RuntimeError('Unexpected network or rollup.')
    data=Pubkey.find_program_address([bytes(args.program)],d.LOADER)[0]
    authority=bytes(owner)
    installed=read_bytes(data,d.LOADER)
    if not installed or installed[:4]!=struct.pack('<I',3) or installed[12:45]!=bytes([1])+authority:
        raise RuntimeError('The existing Devnet program is not controlled by this upgrade authority.')
    elf=args.elf.read_bytes()
    if not elf.startswith(b'\x7fELF'):
        raise RuntimeError('Expected a compiled sBPF ELF.')
    if installed[45:45+len(elf)]==elf and not any(installed[45+len(elf):]):
        print('The exact release is already installed',args.program)
        return
    current=installed[45:]
    # A previous attempt may already have extended ProgramData with zero-filled bytes.
    prior_size=62112
    if hashlib.sha256(current[:prior_size]).hexdigest()!=args.expected_old_sha or any(current[prior_size:]):
        raise RuntimeError('The installed R4 ELF does not match the verified baseline.')

    additional=max(10240, len(elf)-len(current)) if len(elf)>len(current) else 0
    reserve=d.rent(len(elf)+37)+max(0,d.rent(len(installed)+additional)-d.rent(len(installed)))+2_000_000
    print('Release SHA-256',hashlib.sha256(elf).hexdigest(),'maximum test lamports',reserve,flush=True)
    if reserve>args.max_test_lamports:
        raise RuntimeError('The staged upgrade exceeds the allowed test budget.')
    prefix=struct.pack('<I',1)+bytes([1])+authority

    def read_upload():
        raw=read_bytes(buffer.pubkey(),d.LOADER)
        if raw is None:
            return None
        if not raw.startswith(prefix) or len(raw)!=len(elf)+37:
            raise RuntimeError('The staged buffer has a different authority or allocation.')
        return raw[37:]

    if args.mode=='stage':
        d.upload_buffer(d.send,d.rent,payer,buffer,elf,uploaded=read_upload(),
            send_writes=d.send_upload_batch,read_uploaded=read_upload,progress=lambda line:print(line,flush=True))
        print('Verified complete release buffer',buffer.pubkey(),flush=True)
        return

    if read_upload()!=elf:
        raise RuntimeError('Stage and verify the full release buffer before upgrading.')
    if additional:
        d.send([verify_extension(args.program,data,payer,additional)],[payer])
    d.send([upgrade_ix(args.program,data,buffer.pubkey(),owner)],[payer])
    installed=read_bytes(data,d.LOADER)
    if not installed or installed[45:45+len(elf)]!=elf or any(installed[45+len(elf):]):
        raise RuntimeError('The installed Devnet bytes differ from the release.')
    print('Verified upgraded program and exact release bytes',args.program,flush=True)


if __name__=='__main__':
    main()
