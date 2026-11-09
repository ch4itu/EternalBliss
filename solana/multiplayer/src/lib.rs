//! EternalBliss, no-stakes duels for MagicBlock Devnet.
//! Deployment/account ABI adapted from Magic Over by Chaitanya Kumar (@ch4itu), MIT.
//! Each PDA at ["eb-duel", index] holds one match. Smaran signs the rollup instructions.
#![cfg_attr(target_arch = "bpf", no_std)]
use solana_compiler_builtins as _;
mod shared;

#[cfg(target_arch = "bpf")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unsafe { abort() }
}

// ---------------------------------------------------------------- syscalls
#[repr(C)]
struct SolBytes {
    addr: *const u8,
    len: u64,
}
#[repr(C)]
struct SolAccountMeta {
    pubkey: *const [u8; 32],
    is_writable: bool,
    is_signer: bool,
}
#[repr(C)]
struct SolInstruction {
    program_id: *const [u8; 32],
    accounts: *const SolAccountMeta,
    account_len: u64,
    data: *const u8,
    data_len: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct SolAccountInfo {
    key: *const [u8; 32],
    lamports: *mut u64,
    data_len: u64,
    data: *mut u8,
    owner: *const [u8; 32],
    rent_epoch: u64,
    is_signer: bool,
    is_writable: bool,
    executable: bool,
}
#[repr(C)]
struct SolSignerSeeds {
    addr: *const SolBytes,
    len: u64,
}

extern "C" {
    fn sol_sha256(values: *const SolBytes, length: u64, hash: *mut u8) -> u64;
    fn sol_log_(message: *const u8, len: u64);
    fn sol_try_find_program_address(
        seeds: *const SolBytes,
        seeds_len: u64,
        program_id: *const u8,
        address: *mut u8,
        bump_seed: *mut u8,
    ) -> u64;
    fn sol_invoke_signed_c(
        instruction: *const SolInstruction,
        account_infos: *const SolAccountInfo,
        account_infos_len: u64,
        signers_seeds: *const SolSignerSeeds,
        signers_seeds_len: u64,
    ) -> u64;
    fn sol_get_clock_sysvar(addr: *mut u8) -> u64;
    fn sol_get_rent_sysvar(addr: *mut u8) -> u64;
    fn abort() -> !;
}

fn log(msg: &str) {
    unsafe { sol_log_(msg.as_ptr(), msg.len() as u64) }
}

const SYSTEM_PROGRAM: [u8; 32] = [0u8; 32];
// DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
const DELEGATION_PROGRAM: [u8; 32] = [
    181, 183, 0, 225, 242, 87, 58, 192, 204, 6, 34, 1, 52, 74, 207, 151, 184, 53, 6, 235, 140, 229,
    25, 152, 204, 98, 126, 24, 147, 128, 167, 62,
];
const ER_VALIDATOR: [u8; 32] = [
    5, 42, 71, 171, 131, 122, 182, 12, 61, 216, 159, 196, 200, 74, 97, 158, 42, 140, 82, 47, 63,
    129, 136, 254, 226, 67, 138, 88, 169, 118, 23, 178,
];
// Magic11111111111111111111111111111111111111
const MAGIC_PROGRAM: [u8; 32] = [
    5, 69, 180, 36, 176, 218, 112, 149, 236, 185, 214, 222, 195, 119, 215, 40, 145, 182, 231, 142,
    146, 234, 18, 214, 223, 187, 58, 64, 0, 0, 0, 0,
];
// MagicContext1111111111111111111111111111111
const MAGIC_CONTEXT: [u8; 32] = [
    5, 69, 180, 36, 196, 165, 40, 191, 95, 180, 3, 47, 68, 82, 130, 142, 187, 56, 171, 193, 210,
    220, 151, 247, 63, 139, 148, 84, 128, 0, 0, 0,
];
// HDbeKypeJHXMM5Xs2RHKj8XGQgJeP4jnQ1Jiugf8mXPn: the key that runs Magic Over and Smaran on Devnet
const ADMIN: [u8; 32] = [
    240, 245, 33, 212, 39, 39, 71, 159, 130, 37, 245, 248, 117, 196, 199, 238, 238, 219, 127, 236,
    6, 3, 251, 190, 108, 86, 112, 232, 229, 213, 0, 49,
];
const TABLE_SEED: &[u8] = b"eb-duel";
const EXTERNAL_UNDELEGATE: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];
// No timed saves: MagicBlock did not act on a 1-second commit setting, and saves cost the world's reserve.
// The world is saved by instruction 29 instead; duel tables need no saving.
const COMMIT_MS: u32 = u32::MAX;
const MAX_PERMITTED_DATA_INCREASE: usize = 10_240;
const MAX_ACCOUNTS: usize = 8;

// errors
const ERR_ACCOUNTS: u32 = 1;
const ERR_SIGNER: u32 = 2;
const ERR_OWNER: u32 = 3;
const ERR_DATA: u32 = 4;
const ERR_PHASE: u32 = 5;
const ERR_TURN: u32 = 6;
const ERR_SEQ: u32 = 7;
const ERR_EARLY: u32 = 8;
const ERR_PDA: u32 = 9;
const ERR_CPI: u32 = 10;
const ERR_TAG: u32 = 11;
const ERR_RANGE: u32 = 12;
// ---------------------------------------------------------------- input parsing
#[derive(Clone, Copy)]
struct Acc {
    key: *const [u8; 32],
    owner: *mut [u8; 32],
    lamports: *mut u64,
    data_len: *mut u64,
    data: *mut u8,
    rent_epoch: u64,
    is_signer: bool,
    is_writable: bool,
    executable: bool,
}
impl Acc {
    const fn empty() -> Acc {
        Acc {
            key: core::ptr::null(),
            owner: core::ptr::null_mut(),
            lamports: core::ptr::null_mut(),
            data_len: core::ptr::null_mut(),
            data: core::ptr::null_mut(),
            rent_epoch: 0,
            is_signer: false,
            is_writable: false,
            executable: false,
        }
    }
    fn key(&self) -> &[u8; 32] {
        unsafe { &*self.key }
    }
    fn owner(&self) -> &[u8; 32] {
        unsafe { &*self.owner }
    }
    fn len(&self) -> usize {
        unsafe { *self.data_len as usize }
    }
    fn data(&self) -> &mut [u8] {
        unsafe { core::slice::from_raw_parts_mut(self.data, self.len()) }
    }
    fn info(&self) -> SolAccountInfo {
        SolAccountInfo {
            key: self.key,
            lamports: self.lamports,
            data_len: self.len() as u64,
            data: self.data,
            owner: self.owner,
            rent_epoch: self.rent_epoch,
            is_signer: self.is_signer,
            is_writable: self.is_writable,
            executable: self.executable,
        }
    }
}

unsafe fn read_u64(p: *const u8) -> u64 {
    core::ptr::read_unaligned(p as *const u64)
}

unsafe fn parse(
    input: *mut u8,
    accs: &mut [Acc; MAX_ACCOUNTS],
) -> (usize, &'static [u8], &'static [u8; 32]) {
    let mut off: usize = 0;
    let n = read_u64(input) as usize;
    off += 8;
    let mut count = 0;
    for i in 0..n {
        let dup = *input.add(off);
        off += 1;
        if dup != 0xff {
            off += 7;
            if i < MAX_ACCOUNTS {
                accs[i] = accs[dup as usize];
                count = i + 1;
            }
            continue;
        }
        let is_signer = *input.add(off) != 0;
        let is_writable = *input.add(off + 1) != 0;
        let executable = *input.add(off + 2) != 0;
        off += 3 + 4;
        let key = input.add(off) as *const [u8; 32];
        off += 32;
        let owner = input.add(off) as *mut [u8; 32];
        off += 32;
        let lamports = input.add(off) as *mut u64;
        off += 8;
        let data_len_ptr = input.add(off) as *mut u64;
        let data_len = read_u64(input.add(off)) as usize;
        off += 8;
        let data = input.add(off);
        off += data_len + MAX_PERMITTED_DATA_INCREASE;
        off = (off + 7) & !7;
        let rent_epoch = read_u64(input.add(off));
        off += 8;
        if i < MAX_ACCOUNTS {
            accs[i] = Acc {
                key,
                owner,
                lamports,
                data_len: data_len_ptr,
                data,
                rent_epoch,
                is_signer,
                is_writable,
                executable,
            };
            count = i + 1;
        }
    }
    let ix_len = read_u64(input.add(off)) as usize;
    off += 8;
    let ix = core::slice::from_raw_parts(input.add(off), ix_len);
    off += ix_len;
    let program_id = &*(input.add(off) as *const [u8; 32]);
    (count, ix, program_id)
}

// ---------------------------------------------------------------- helpers
const NULL_BYTES: SolBytes = SolBytes {
    addr: core::ptr::null(),
    len: 0,
};

fn find_pda(seeds: &[&[u8]], program_id: &[u8; 32]) -> ([u8; 32], u8) {
    let mut sb: [SolBytes; 4] = [NULL_BYTES, NULL_BYTES, NULL_BYTES, NULL_BYTES];
    for (i, s) in seeds.iter().enumerate() {
        sb[i] = SolBytes {
            addr: s.as_ptr(),
            len: s.len() as u64,
        };
    }
    let mut out = [0u8; 32];
    let mut bump = 0u8;
    unsafe {
        sol_try_find_program_address(
            sb.as_ptr(),
            seeds.len() as u64,
            program_id.as_ptr(),
            out.as_mut_ptr(),
            &mut bump,
        );
    }
    (out, bump)
}

fn eq32(a: &[u8], b: &[u8]) -> bool {
    let mut d = 0u8;
    for i in 0..32 {
        d |= a[i] ^ b[i];
    }
    d == 0
}

fn rd32(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}
fn wr32(d: &mut [u8], o: usize, v: u32) {
    d[o..o + 4].copy_from_slice(&v.to_le_bytes());
}
fn rd64(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes([
        d[o],
        d[o + 1],
        d[o + 2],
        d[o + 3],
        d[o + 4],
        d[o + 5],
        d[o + 6],
        d[o + 7],
    ])
}
fn wr64(d: &mut [u8], o: usize, v: u64) {
    d[o..o + 8].copy_from_slice(&v.to_le_bytes());
}

/// A cross-program call, passed by reference so no call needs more than five registers.
/// `metas` lists (account index into `accs`, writable, signer).
struct Cpi<'a> {
    program: &'a [u8; 32],
    metas: &'a [(usize, bool, bool)],
    data: &'a [u8],
    seeds: &'a [&'a [&'a [u8]]],
}

#[inline(never)]
fn invoke(accs: &[Acc], cpi: &Cpi) -> Result<(), u32> {
    const NULL_META: SolAccountMeta = SolAccountMeta {
        pubkey: core::ptr::null(),
        is_writable: false,
        is_signer: false,
    };
    let mut m: [SolAccountMeta; 8] = [NULL_META; 8];
    let mut infos: [SolAccountInfo; 8] = [accs[0].info(); 8];
    for (i, (idx, w, s)) in cpi.metas.iter().enumerate() {
        m[i] = SolAccountMeta {
            pubkey: accs[*idx].key,
            is_writable: *w,
            is_signer: *s,
        };
        infos[i] = accs[*idx].info();
    }
    let mut seed_bytes: [[SolBytes; 4]; 2] = [
        [NULL_BYTES, NULL_BYTES, NULL_BYTES, NULL_BYTES],
        [NULL_BYTES, NULL_BYTES, NULL_BYTES, NULL_BYTES],
    ];
    let mut signers: [SolSignerSeeds; 2] = [
        SolSignerSeeds {
            addr: core::ptr::null(),
            len: 0,
        },
        SolSignerSeeds {
            addr: core::ptr::null(),
            len: 0,
        },
    ];
    for (si, seeds) in cpi.seeds.iter().enumerate() {
        for (j, s) in seeds.iter().enumerate() {
            seed_bytes[si][j] = SolBytes {
                addr: s.as_ptr(),
                len: s.len() as u64,
            };
        }
        signers[si] = SolSignerSeeds {
            addr: seed_bytes[si].as_ptr(),
            len: seeds.len() as u64,
        };
    }
    let ix = SolInstruction {
        program_id: cpi.program,
        accounts: m.as_ptr(),
        account_len: cpi.metas.len() as u64,
        data: cpi.data.as_ptr(),
        data_len: cpi.data.len() as u64,
    };
    let rc = unsafe {
        sol_invoke_signed_c(
            &ix,
            infos.as_ptr(),
            cpi.metas.len() as u64,
            signers.as_ptr(),
            cpi.seeds.len() as u64,
        )
    };
    if rc != 0 {
        return Err(ERR_CPI);
    }
    Ok(())
}

fn rent_minimum(len: usize) -> u64 {
    let mut buf = [0u8; 24];
    unsafe {
        sol_get_rent_sysvar(buf.as_mut_ptr());
    }
    let per_byte = rd64(&buf, 0);
    let thr_bits = rd64(&buf, 8);
    let base = (128 + len as u64) * per_byte;
    if thr_bits == 0x3FF0_0000_0000_0000 {
        base
    } else {
        base * 2
    }
}

// ---------------------------------------------------------------- context
struct Ctx<'a> {
    accs: &'a [Acc],
    n: usize,
    ix: &'a [u8],
    program_id: &'a [u8; 32],
}

#[inline(never)]
fn ix_delegate(c: &Ctx) -> Result<(), u32> {
    // [payer, pda, this program, buffer, record, metadata, delegation program, system]
    let (accs, ix, program_id) = (c.accs, c.ix, c.program_id);
    if c.n < 8 || ix.len() != 2 {
        return Err(ERR_ACCOUNTS);
    }
    let (payer, pda, buffer) = (&accs[0], &accs[1], &accs[3]);
    if !payer.is_signer {
        return Err(ERR_SIGNER);
    }
    if !eq32(accs[2].key(), program_id) || !eq32(accs[6].key(), &DELEGATION_PROGRAM) {
        return Err(ERR_ACCOUNTS);
    }
    let is_world = ix[0] == 17;
    let size = if is_world {
        shared::WORLD_SIZE
    } else {
        STATE_SIZE
    };
    if !pda.is_writable || !eq32(pda.owner(), program_id) || pda.len() != size {
        return Err(ERR_OWNER);
    }
    let idx = ix[1];
    if (is_world && idx != 0) || (!is_world && idx >= NTABLES) {
        return Err(ERR_RANGE);
    }
    let seed = if is_world { shared::SEED } else { TABLE_SEED };
    let idx_b = [idx];
    let (key, bump) = find_pda(&[seed, &idx_b], program_id);
    if !eq32(&key, pda.key()) {
        return Err(ERR_PDA);
    }
    let bump_b = [bump];
    let (buf_key, buf_bump) = find_pda(&[b"buffer", pda.key()], program_id);
    if !eq32(&buf_key, buffer.key()) {
        return Err(ERR_PDA);
    }
    let buf_bump_b = [buf_bump];
    let len = pda.len();
    let mut data = [0u8; 52];
    data[12..20].copy_from_slice(&(len as u64).to_le_bytes());
    data[20..52].copy_from_slice(program_id);
    invoke(
        accs,
        &Cpi {
            program: &SYSTEM_PROGRAM,
            metas: &[(0, true, true), (3, true, true)],
            data: &data,
            seeds: &[&[b"buffer", pda.key(), &buf_bump_b]],
        },
    )?;
    {
        let src = pda.data();
        buffer.data().copy_from_slice(src);
        for x in src.iter_mut() {
            *x = 0;
        }
    }
    unsafe {
        *pda.owner = SYSTEM_PROGRAM;
    }
    let mut assign = [0u8; 36];
    assign[0] = 1;
    assign[4..36].copy_from_slice(&DELEGATION_PROGRAM);
    invoke(
        accs,
        &Cpi {
            program: &SYSTEM_PROGRAM,
            metas: &[(1, true, true)],
            data: &assign,
            seeds: &[&[seed, &idx_b, &bump_b]],
        },
    )?;
    let mut args = [0u8; 8 + 4 + 4 + (4 + 8) + (4 + 1) + 1 + 32];
    let mut o = 8;
    args[o..o + 4].copy_from_slice(&COMMIT_MS.to_le_bytes());
    o += 4;
    args[o..o + 4].copy_from_slice(&2u32.to_le_bytes());
    o += 4;
    args[o..o + 4].copy_from_slice(&(seed.len() as u32).to_le_bytes());
    o += 4;
    args[o..o + seed.len()].copy_from_slice(seed);
    o += seed.len();
    args[o..o + 4].copy_from_slice(&1u32.to_le_bytes());
    o += 4;
    args[o] = idx;
    o += 1;
    args[o] = 1;
    o += 1;
    args[o..o + 32].copy_from_slice(&ER_VALIDATOR);
    o += 32;
    invoke(
        accs,
        &Cpi {
            program: &DELEGATION_PROGRAM,
            metas: &[
                (0, true, true),
                (1, true, true),
                (2, false, false),
                (3, true, false),
                (4, true, false),
                (5, true, false),
                (7, false, false),
            ],
            data: &args[..o],
            seeds: &[&[seed, &idx_b, &bump_b]],
        },
    )?;
    unsafe {
        *payer.lamports += *buffer.lamports;
        *buffer.lamports = 0;
        *buffer.data_len = 0;
        *buffer.owner = SYSTEM_PROGRAM;
    }
    log("eb: delegated");
    Ok(())
}

#[inline(never)]
fn ix_undelegate_callback(c: &Ctx) -> Result<(), u32> {
    // [pda w, buffer s, payer s w, system]; data: disc, borsh Vec<Vec<u8>> seeds
    let (accs, ix, program_id) = (c.accs, c.ix, c.program_id);
    if c.n < 4 {
        return Err(ERR_ACCOUNTS);
    }
    let (pda, buffer) = (&accs[0], &accs[1]);
    if !buffer.is_signer || !eq32(buffer.owner(), &DELEGATION_PROGRAM) {
        return Err(ERR_SIGNER);
    }
    let (ub, _) = find_pda(&[b"undelegate-buffer", pda.key()], &DELEGATION_PROGRAM);
    if !eq32(&ub, buffer.key()) {
        return Err(ERR_PDA);
    }
    let a = &ix[8..];
    if a.len() < 4 + 4 + 7 + 4 + 1 || rd32(a, 0) != 2 {
        return Err(ERR_DATA);
    }
    let l0 = rd32(a, 4) as usize;
    if a.len() != 8 + l0 + 4 + 1 || rd32(a, 8 + l0) != 1 {
        return Err(ERR_DATA);
    }
    let seed = &a[8..8 + l0];
    if seed != TABLE_SEED && seed != shared::SEED {
        return Err(ERR_DATA);
    }
    let idx_b = [a[a.len() - 1]];
    let (key, bump) = find_pda(&[seed, &idx_b], program_id);
    if !eq32(&key, pda.key()) {
        return Err(ERR_PDA);
    }
    let bump_b = [bump];
    let space = buffer.len();
    let valid = if seed == shared::SEED {
        idx_b[0] == 0 && space == shared::WORLD_SIZE
    } else {
        idx_b[0] < NTABLES && space == STATE_SIZE
    };
    if !valid {
        return Err(ERR_DATA);
    }
    let mut data = [0u8; 52];
    data[4..12].copy_from_slice(&rent_minimum(space).to_le_bytes());
    data[12..20].copy_from_slice(&(space as u64).to_le_bytes());
    data[20..52].copy_from_slice(program_id);
    invoke(
        accs,
        &Cpi {
            program: &SYSTEM_PROGRAM,
            metas: &[(2, true, true), (0, true, true)],
            data: &data,
            seeds: &[&[seed, &idx_b, &bump_b]],
        },
    )?;
    pda.data().copy_from_slice(buffer.data());
    log("eb: returned to Solana");
    Ok(())
}

// Table offsets shared with the browser client.
const STATE_SIZE: usize = 112;
const NTABLES: u8 = 4;
const MAGIC: &[u8; 8] = b"EBDUEL01";
const IDX: usize = 8;
const PHASE: usize = 9;
const TURN: usize = 10;
const WINNER: usize = 11;
const HP: usize = 12;
const MP: usize = 14;
const POTS: usize = 16;
const LAST_ACTION: usize = 18;
const LAST_SIDE: usize = 19;
const VOTES: usize = 20;
const REASON: usize = 21;
const FIRST: usize = 22;
const MATCH: usize = 24;
const SEQ: usize = 28;
const DEADLINE: usize = 32;
const A: usize = 40;
const B: usize = 72;
const OPEN: u8 = 1;
const ACTIVE: u8 = 2;
const DONE: u8 = 3;
const HOST: u8 = 2;
const JOIN: u8 = 3;
const ACT: u8 = 4;
const CONCEDE: u8 = 5;
const TIMEOUT: u8 = 6;
const REMATCH: u8 = 7;
const TURN_SECONDS: u64 = 75;
const LOBBY_SECONDS: u64 = 180;
const RESULT_SECONDS: u64 = 60;

#[inline(never)]
fn init(c: &Ctx) -> Result<(), u32> {
    if c.n != 3 || c.ix.len() != 10 {
        return Err(ERR_ACCOUNTS);
    }
    let (payer, table, system) = (&c.accs[0], &c.accs[1], &c.accs[2]);
    if !payer.is_signer || !table.is_writable || !eq32(system.key(), &SYSTEM_PROGRAM) {
        return Err(ERR_ACCOUNTS);
    }
    let idx = c.ix[1];
    if idx >= NTABLES {
        return Err(ERR_RANGE);
    }
    let (key, bump) = find_pda(&[TABLE_SEED, &[idx]], c.program_id);
    if !eq32(table.key(), &key) {
        return Err(ERR_PDA);
    }
    let mut data = [0u8; 52];
    data[4..12].copy_from_slice(&c.ix[2..10]);
    data[12..20].copy_from_slice(&(STATE_SIZE as u64).to_le_bytes());
    data[20..52].copy_from_slice(c.program_id);
    invoke(
        c.accs,
        &Cpi {
            program: &SYSTEM_PROGRAM,
            metas: &[(0, true, true), (1, true, true)],
            data: &data,
            seeds: &[&[TABLE_SEED, &[idx], &[bump]]],
        },
    )?;
    let s = table.data();
    s[..8].copy_from_slice(MAGIC);
    s[IDX] = idx;
    Ok(())
}

fn now_seconds() -> Result<u64, u32> {
    let mut clock = [0u8; 40];
    if unsafe { sol_get_clock_sysvar(clock.as_mut_ptr()) } != 0 {
        return Err(ERR_DATA);
    }
    let time = rd64(&clock, 32) as i64;
    if time <= 0 {
        return Err(ERR_DATA);
    }
    Ok(time as u64)
}

fn start(s: &mut [u8], now: u64, first: u8) {
    s[PHASE] = ACTIVE;
    s[FIRST] = first;
    s[TURN] = first;
    s[WINNER] = 0;
    s[REASON] = 0;
    s[VOTES] = 0;
    s[LAST_ACTION] = 0;
    s[HP..HP + 2].fill(100);
    s[MP..MP + 2].fill(48);
    s[POTS..POTS + 2].fill(2);
    wr64(s, DEADLINE, now + TURN_SECONDS);
}

fn finish(s: &mut [u8], now: u64, winner: u8, reason: u8) {
    s[PHASE] = DONE;
    s[WINNER] = winner;
    s[REASON] = reason;
    s[VOTES] = 0;
    wr64(s, DEADLINE, now + RESULT_SECONDS);
}

fn duel_action(s: &mut [u8], who: &[u8; 32], data: &[u8], now: u64) -> Result<(), u32> {
    if data.len() != 11 {
        return Err(ERR_DATA);
    }
    let tag = data[0];
    let action = data[10];
    let match_id = rd32(s, MATCH);
    let seq = rd32(s, SEQ);
    if rd32(data, 2) != match_id || rd32(data, 6) != seq {
        return Err(ERR_SEQ);
    }
    let next_seq = seq.checked_add(1).ok_or(ERR_RANGE)?;
    let phase = s[PHASE];
    let expired = now >= rd64(s, DEADLINE);
    let side = if eq32(who, &s[A..A + 32]) {
        Some(0usize)
    } else if eq32(who, &s[B..B + 32]) {
        Some(1usize)
    } else {
        None
    };

    match tag {
        HOST => {
            if phase != 0 && !(expired && matches!(phase, OPEN | DONE)) {
                return Err(ERR_PHASE);
            }
            let next_match = match_id.checked_add(1).ok_or(ERR_RANGE)?;
            s[PHASE..MATCH].fill(0);
            s[PHASE] = OPEN;
            s[A..A + 32].copy_from_slice(who);
            s[B..B + 32].fill(0);
            wr32(s, MATCH, next_match);
            wr64(s, DEADLINE, now + LOBBY_SECONDS);
        }
        JOIN => {
            if phase != OPEN || expired {
                return Err(ERR_PHASE);
            }
            if side.is_some() {
                return Err(ERR_SIGNER);
            }
            s[B..B + 32].copy_from_slice(who);
            start(s, now, 0);
        }
        ACT => {
            if phase != ACTIVE || expired {
                return Err(ERR_PHASE);
            }
            let me = side.ok_or(ERR_SIGNER)?;
            if me != s[TURN] as usize {
                return Err(ERR_TURN);
            }
            let rival = 1 - me;
            match action {
                1 => s[HP + rival] = s[HP + rival].saturating_sub(16),
                2 if s[MP + me] >= 12 => {
                    s[MP + me] -= 12;
                    s[HP + rival] = s[HP + rival].saturating_sub(26);
                }
                3 if s[POTS + me] > 0 && s[HP + me] < 100 => {
                    s[POTS + me] -= 1;
                    s[HP + me] = (s[HP + me] + 30).min(100);
                }
                _ => return Err(ERR_DATA),
            }
            s[LAST_ACTION] = action;
            s[LAST_SIDE] = me as u8;
            if s[HP + rival] == 0 {
                finish(s, now, me as u8 + 1, 1);
            } else {
                s[TURN] = rival as u8;
                wr64(s, DEADLINE, now + TURN_SECONDS);
            }
        }
        CONCEDE => {
            let me = side.ok_or(ERR_SIGNER)?;
            if phase == OPEN && me == 0 {
                s[PHASE] = 0;
            } else if phase == ACTIVE && !expired {
                finish(s, now, 2 - me as u8, 2);
            } else {
                return Err(ERR_PHASE);
            }
        }
        TIMEOUT => {
            if phase != ACTIVE {
                return Err(ERR_PHASE);
            }
            if !expired {
                return Err(ERR_EARLY);
            }
            // Permissionless expiry prevents an abandoned table from staying occupied.
            finish(s, now, 2 - s[TURN], 3);
        }
        REMATCH => {
            if phase != DONE || expired {
                return Err(ERR_PHASE);
            }
            let me = side.ok_or(ERR_SIGNER)?;
            let vote = 1 << me;
            if s[VOTES] & vote != 0 {
                return Err(ERR_PHASE);
            }
            s[VOTES] |= vote;
            if s[VOTES] == 3 {
                start(s, now, 1 - s[FIRST]);
            }
        }
        _ => return Err(ERR_TAG),
    }
    wr32(s, SEQ, next_seq);
    Ok(())
}

#[inline(never)]
fn play(c: &Ctx) -> Result<(), u32> {
    // [player s, table w, world]: hosting or joining a duel needs a character in the shared world
    if c.n != 3 || c.ix.len() != 11 || c.ix[1] >= NTABLES {
        return Err(ERR_ACCOUNTS);
    }
    let player = c.accs[0];
    let table = c.accs[1];
    if !player.is_signer {
        return Err(ERR_SIGNER);
    }
    if (c.ix[0] == HOST || c.ix[0] == JOIN) && !shared::has_character(&c.accs[2], c.program_id, player.key())? {
        return Err(shared::NO_CHARACTER);
    }
    if !table.is_writable || !eq32(table.owner(), c.program_id) {
        return Err(ERR_OWNER);
    }
    let (key, _) = find_pda(&[TABLE_SEED, &[c.ix[1]]], c.program_id);
    if !eq32(table.key(), &key) || eq32(player.key(), &key) {
        return Err(ERR_PDA);
    }
    if table.len() != STATE_SIZE {
        return Err(ERR_DATA);
    }
    let state = table.data();
    if &state[..8] != MAGIC || state[IDX] != c.ix[1] || state[TURN] > 1 || state[FIRST] > 1 {
        return Err(ERR_DATA);
    }
    duel_action(state, player.key(), c.ix, now_seconds()?)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    let mut accs = [Acc::empty(); MAX_ACCOUNTS];
    let (n, ix, program_id) = parse(input, &mut accs);
    let c = Ctx {
        accs: &accs,
        n,
        ix,
        program_id,
    };
    let result = if ix.starts_with(&EXTERNAL_UNDELEGATE) {
        ix_undelegate_callback(&c)
    } else {
        match ix.first() {
            Some(0) => init(&c),
            Some(1) => ix_delegate(&c),
            Some(2..=7) => play(&c),
            Some(16) => shared::initialize(&c),
            Some(17) => ix_delegate(&c),
            Some(18..=28) => shared::play_world(&c),
            Some(29) => shared::save(&c, false),
            Some(30) => shared::save(&c, true),
            _ => Err(ERR_TAG),
        }
    };
    result.err().unwrap_or(0) as u64
}
