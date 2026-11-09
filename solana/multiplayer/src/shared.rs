// EternalBliss shared world. One writable account makes collection and combat atomic.
#[path = "manifest.rs"]
mod manifest;
use super::*;
pub(super) use manifest::WORLD_SIZE;
use manifest::*;

pub(super) const SEED: &[u8] = b"eb-land";
const WORLD_MAGIC: &[u8; 8] = b"EBWRLD01";
const TILES: &[u8] = include_bytes!("map.bin");
const NAME_DOMAIN: &[u8] = b"SABHA-CHAINKEY-NAME-V1\0";
const WORLD_FULL: u32 = 30;
const OUT_OF_REACH: u32 = 31;
const RESPAWNING: u32 = 32;
const NO_SUPPLIES: u32 = 33;
const RATE_LIMIT: u32 = 34;
const NOT_REGISTERED: u32 = 35;
const BLOCKED: u32 = 36;
pub(super) const NO_CHARACTER: u32 = 37;
const NOT_ADMIN: u32 = 38;
const UNCHANGED: u32 = 39;
// Header bytes 52..60: the revision and the time of the last save scheduled to Solana.
const SAVED_REVISION: usize = 52;
const SAVED_AT: usize = 56;
const SAVE_SECONDS: u32 = 120; // anyone may save new changes at most this often
const LIVE_COMMIT_FEE: u64 = 100_000; // MagicBlock's charge per save once the world pays for its own saves
const LOW_RESERVE: u64 = 10 * LIVE_COMMIT_FEE; // below this above rent, anyone may hand the world back to refill it
const STEPS_PER_SECOND: usize = 12; // above the 8.3 steps a second of a held key, so walking never waits on it
const LEAVE: u8 = 24;
const HEARTBEAT: u8 = 25;
const BUILDING_ROOM: u8 = 26;
const MIGRATE: u8 = 27;
const RELEASE_FRESH: u8 = 28;
const WORLD_COORD_MASK: u16 = 0x1ff;
const SPAWN: (u16, u16) = (75, 75);
const BUY_COST: [u32; 4] = [15, 10, 50, 75];

const PX: usize = 64;
const PY: usize = 66;
const SAFE_X: usize = 68;
const SAFE_Y: usize = 70;
const HP: usize = 72;
const MP: usize = 74;
const GOLD: usize = 76;
const XP: usize = 80;
const SEQ: usize = 84;
const SEEN: usize = 88;
const ACTION_TIME: usize = 92;
const MOVE_TIME: usize = 96;
const WINS: usize = 100;
const FINDS: usize = 102;
const HEALS: usize = 104;
const MANA: usize = 105;
const BOATS: usize = 106;
const PICKS: usize = 107;
const KEYS: usize = 108;
const SAIL: usize = 109;
const MOVES: usize = 110;
const COMMISSION: usize = 111;

fn read16(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn write16(bytes: &mut [u8], at: usize, n: u16) {
    bytes[at..at + 2].copy_from_slice(&n.to_le_bytes());
}

fn gain32(bytes: &mut [u8], at: usize, n: u32) {
    wr32(bytes, at, rd32(bytes, at).saturating_add(n));
}

fn gain16(bytes: &mut [u8], at: usize) {
    write16(bytes, at, read16(bytes, at).saturating_add(1));
}

fn position(p: &[u8]) -> (u16, u16) {
    (read16(p, PX) & WORLD_COORD_MASK, read16(p, PY) & WORLD_COORD_MASK)
}

fn set_position(p: &mut [u8], x: u16, y: u16) {
    write16(p, PX, x);
    write16(p, PY, y);
}

// Keep the exterior return tile in the lower nine bits of each coordinate.
// The old world has zeroes in the upper bits. They encode room number and two four-bit axes.
fn room(p: &[u8]) -> (usize, u16, u16) {
    let packed = (read16(p, PX) >> 9) | ((read16(p, PY) >> 9) << 7);
    ((packed & 63) as usize, (packed >> 6) & 15, packed >> 10)
}

fn set_room(p: &mut [u8], id: usize, x: u16, y: u16) {
    let (outside_x, outside_y) = position(p);
    let packed = id as u16 | (x << 6) | (y << 10);
    write16(p, PX, outside_x | ((packed & 127) << 9));
    write16(p, PY, outside_y | ((packed >> 7) << 9));
}

fn building_at(x: u16, y: u16) -> bool {
    BUILDINGS.iter().any(|building| building[0] == x && building[1] == y)
}

fn toggle_room(p: &mut [u8], id: usize) -> Result<(), u32> {
    let building = BUILDINGS.get(id).ok_or(ERR_RANGE)?;
    let current = room(p).0;
    if current == id + 1 {
        let (x,y) = position(p);
        set_position(p,x,y);
        return Ok(());
    }
    if current != 0 || building[2] == 0 || p[SAIL] != 0 || !nearby(p, building[0], building[1], 2) {
        return Err(OUT_OF_REACH);
    }
    let [x,y] = ROOM_ENTRIES[building[2] as usize - 1];
    set_room(p,id+1,x,y);
    Ok(())
}

fn level(p: &[u8]) -> u16 {
    (1 + rd32(p, XP) / 100).min(50) as u16
}

fn max_health(p: &[u8]) -> u16 {
    100 + (level(p) - 1) * 15
}
fn max_mana(p: &[u8]) -> u16 {
    50 + (level(p) - 1) * 8
}

fn restore(p: &mut [u8]) {
    write16(p, HP, max_health(p));
    write16(p, MP, max_mana(p));
}

fn fresh_player(p: &mut [u8], owner: &[u8; 32], name: &[u8]) {
    p[..32].copy_from_slice(owner);
    p[32..32 + name.len()].copy_from_slice(name);
    set_position(p, SPAWN.0, SPAWN.1);
    write16(p, SAFE_X, SPAWN.0);
    write16(p, SAFE_Y, SPAWN.1);
    wr32(p, GOLD, 100);
    p[HEALS] = 3;
    p[MANA] = 2;
    restore(p);
}

#[inline(never)]
pub(super) fn initialize(c: &Ctx) -> Result<(), u32> {
    if c.n != 3 || c.ix.len() != 10 || c.ix[1] != 0 {
        return Err(ERR_ACCOUNTS);
    }
    let (payer, state, system) = (&c.accs[0], &c.accs[1], &c.accs[2]);
    if !payer.is_signer || !state.is_writable || !eq32(system.key(), &SYSTEM_PROGRAM) {
        return Err(ERR_ACCOUNTS);
    }
    let (expected, bump) = find_pda(&[SEED, &[0]], c.program_id);
    if !eq32(state.key(), &expected) {
        return Err(ERR_PDA);
    }
    let mut data = [0u8; 52];
    data[4..12].copy_from_slice(&c.ix[2..10]);
    data[12..20].copy_from_slice(&(WORLD_SIZE as u64).to_le_bytes());
    data[20..52].copy_from_slice(c.program_id);
    invoke(
        c.accs,
        &Cpi {
            program: &SYSTEM_PROGRAM,
            metas: &[(0, true, true), (1, true, true)],
            data: &data,
            seeds: &[&[SEED, &[0], &[bump]]],
        },
    )?;
    let state = state.data();
    state[..8].copy_from_slice(WORLD_MAGIC);
    state[8..40].copy_from_slice(&MAP_HASH);
    Ok(())
}

fn authorize_name(registry: &Acc, owner: &[u8; 32], name: &[u8]) -> Result<(), u32> {
    let alnum = |ch: u8| ch.is_ascii_lowercase() || ch.is_ascii_digit();
    if !(3..=32).contains(&name.len())
        || !alnum(name[0])
        || name
            .iter()
            .any(|&ch| !alnum(ch) && ch != b'-' && ch != b'_')
    {
        return Err(NOT_REGISTERED);
    }
    if !eq32(registry.owner(), &REGISTRY) || registry.len() != 10144 {
        return Err(NOT_REGISTERED);
    }
    let data = registry.data();
    if &data[..8] != b"SABREG01" || data[15] > 5 {
        return Err(NOT_REGISTERED);
    }
    let parts = [
        SolBytes {
            addr: NAME_DOMAIN.as_ptr(),
            len: NAME_DOMAIN.len() as u64,
        },
        SolBytes {
            addr: name.as_ptr(),
            len: name.len() as u64,
        },
    ];
    let mut hash = [0u8; 32];
    if unsafe { sol_sha256(parts.as_ptr(), 2, hash.as_mut_ptr()) } != 0 {
        return Err(ERR_DATA);
    }
    let generation = data[15];
    let index = if generation == 0 {
        hash[0] % 4
    } else {
        hash[2 + generation as usize] % (4 << generation)
    };
    let expected = if generation == 0 {
        REGISTRY_SHARDS[index as usize]
    } else {
        find_pda(&[b"sabha-reg", &[generation], &[index]], &REGISTRY).0
    };
    if data[8] != index || !eq32(registry.key(), &expected) {
        return Err(NOT_REGISTERED);
    }
    let initial = (hash[1] as usize | (hash[2] as usize) << 8) % 35;
    for offset in 0..35 {
        let entry = 64 + ((initial + offset) % 35) * 288;
        if data[entry] == 0 {
            break;
        }
        if eq32(&data[entry + 8..entry + 40], &hash) && eq32(&data[entry + 40..entry + 72], owner) {
            return Ok(());
        }
    }
    Err(NOT_REGISTERED)
}

fn nearby(p: &[u8], x: u16, y: u16, range: u16) -> bool {
    let (px, py) = position(p);
    px.abs_diff(x) + py.abs_diff(y) <= range
}

fn actor_position(spec: &[u16; 8], id: usize, now: u32) -> (u16, u16) {
    let phase = (now / 2 + id as u32) & 3;
    if phase < 2 {
        (spec[0], spec[1])
    } else {
        (spec[2], spec[3])
    }
}

fn alive(state: &[u8], index: usize, now: u32) -> bool {
    rd32(state, ENEMY_OFFSET + index * 8 + 4) <= now
}

fn get_tile(state: &[u8], x: u16, y: u16) -> (usize, u8) {
    let tile = y as usize * WIDTH + x as usize;
    let kind = (TILES[tile / 4] >> ((tile % 4) * 2)) & 3;
    if kind < 2 {
        return (tile, kind);
    }
    let count = read16(state, 48) as usize;
    for i in 0..count {
        if rd32(state, OPENED_OFFSET + i * 4) == tile as u32 + 1 {
            return (tile, 0);
        }
    }
    (tile, kind)
}

fn restore_safe_tile(state: &[u8], p: &mut [u8]) {
    let (x,y) = position(p);
    let safe = |x: u16,y: u16| x < WIDTH as u16 && y < HEIGHT as u16 &&
        !building_at(x,y) && get_tile(state,x,y).1 == 0;
    if safe(x,y) || (p[SAIL] > 0 && x < WIDTH as u16 && y < HEIGHT as u16 &&
        !building_at(x,y) && get_tile(state,x,y).1 == 1) {
        return;
    }
    let old_safe = (read16(p,SAFE_X), read16(p,SAFE_Y));
    let (x,y) = if safe(old_safe.0,old_safe.1) { old_safe } else { SPAWN };
    set_position(p,x,y);
    write16(p,SAFE_X,x);
    write16(p,SAFE_Y,y);
    p[SAIL] = 0;
}

fn open_tile(state: &mut [u8], tile: usize) -> Result<(), u32> {
    let count = read16(state, 48) as usize;
    if count >= OPENED_CAPACITY {
        return Err(WORLD_FULL);
    }
    wr32(state, OPENED_OFFSET + count * 4, tile as u32 + 1);
    write16(state, 48, count as u16 + 1);
    gain32(state, 44, 1);
    Ok(())
}

fn collect(
    state: &mut [u8; WORLD_SIZE],
    p: &mut [u8; PLAYER_SIZE],
    id: usize,
    now: u32,
) -> Result<(), u32> {
    let item = ITEMS.get(id).ok_or(ERR_RANGE)?;
    if !nearby(p, item[0], item[1], 0) {
        return Err(OUT_OF_REACH);
    }
    let at = ITEM_OFFSET + id * 4;
    if rd32(state, at) > now {
        return Err(RESPAWNING);
    }
    let value = item[3];
    match item[2] {
        0 | 1 => gain32(p, GOLD, value as u32),
        2 => p[HEALS] = p[HEALS].saturating_add(value.min(255) as u8),
        3 => p[MANA] = p[MANA].saturating_add(value.min(255) as u8),
        4 => p[KEYS] = p[KEYS].saturating_add(value.min(255) as u8),
        _ => return Err(ERR_DATA),
    }
    gain16(p, FINDS);
    let seconds = if item[2] == 1 {
        90
    } else if item[2] == 0 {
        60
    } else {
        45
    };
    wr32(state, at, now.saturating_add(seconds));
    Ok(())
}

#[inline(never)]
fn move_steps(
    state: &mut [u8; WORLD_SIZE],
    p: &mut [u8; PLAYER_SIZE],
    steps: &[u8],
    now: u32,
) -> Result<(), u32> {
    if steps.is_empty() || steps.len() > 8 {
        return Err(ERR_DATA);
    }
    if rd32(p, MOVE_TIME) != now {
        wr32(p, MOVE_TIME, now);
        p[MOVES] = 0;
    }
    if p[MOVES] as usize + steps.len() > STEPS_PER_SECOND {
        return Err(RATE_LIMIT);
    }
    for direction in steps {
        let (dx, dy) = match direction {
            0 => (0, -1),
            1 => (1, 0),
            2 => (0, 1),
            3 => (-1, 0),
            _ => return Err(ERR_DATA),
        };
        let (id, rx, ry) = room(p);
        if id != 0 {
            let kind = BUILDINGS[id-1][2] as usize;
            let nx = rx as i32 + dx;
            let ny = ry as i32 + dy;
            if !(0..16).contains(&nx) || !(0..16).contains(&ny) ||
                ROOM_MASKS[kind-1][ny as usize] & (1 << nx) == 0 {
                return Err(BLOCKED);
            }
            set_room(p, id, nx as u16, ny as u16);
            p[MOVES] += 1;
            continue;
        }
        let (x, y) = position(p);
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        if nx < 0 || ny < 0 || nx >= WIDTH as i32 || ny >= HEIGHT as i32 {
            return Err(BLOCKED);
        }
        let (nx, ny) = (nx as u16, ny as u16);
        if building_at(nx,ny) {
            return Err(BLOCKED);
        }
        if ENEMIES
            .iter()
            .enumerate()
            .any(|(i, spec)| alive(state, i, now) && actor_position(spec, i, now) == (nx, ny))
        {
            return Err(BLOCKED);
        }
        let (tile, kind) = get_tile(state, nx, ny);
        match kind {
            1 => {
                if p[SAIL] == 0 {
                    if p[BOATS] == 0 {
                        return Err(NO_SUPPLIES);
                    }
                    p[BOATS] -= 1;
                    p[SAIL] = 15;
                } else {
                    p[SAIL] -= 1;
                    if p[SAIL] == 0 {
                        let x = read16(p, SAFE_X);
                        let y = read16(p, SAFE_Y);
                        let hp = read16(p, HP).saturating_sub(20).max(10);
                        let gold = rd32(p, GOLD).saturating_sub(10);
                        set_position(p, x, y);
                        write16(p, HP, hp);
                        wr32(p, GOLD, gold);
                        p[MOVES] += 1;
                        return Ok(());
                    }
                }
            }
            2 | 3 => {
                let inventory = if kind == 2 { PICKS } else { KEYS };
                if p[inventory] == 0 {
                    return Err(NO_SUPPLIES);
                }
                open_tile(state, tile)?;
                p[inventory] -= 1;
            }
            _ => {}
        }
        if kind != 1 {
            p[SAIL] = 0;
            write16(p, SAFE_X, nx);
            write16(p, SAFE_Y, ny);
        }
        set_position(p, nx, ny);
        p[MOVES] += 1;
        for (i, spec) in ITEMS.iter().enumerate() {
            if spec[0] == nx && spec[1] == ny && rd32(state, ITEM_OFFSET + i * 4) <= now {
                collect(state, p, i, now)?;
            }
        }
    }
    Ok(())
}

#[inline(never)]
fn fight(
    state: &mut [u8; WORLD_SIZE],
    p: &mut [u8; PLAYER_SIZE],
    id: usize,
    action: u8,
    now: u32,
) -> Result<(), u32> {
    let spec = ENEMIES.get(id).ok_or(ERR_RANGE)?;
    let (x, y) = actor_position(spec, id, now);
    if !nearby(p, x, y, 2) {
        return Err(OUT_OF_REACH);
    }
    if !alive(state, id, now) {
        return Err(RESPAWNING);
    }
    let old = rd32(p, ACTION_TIME);
    if old >= now {
        return Err(RATE_LIMIT);
    }
    wr32(p, ACTION_TIME, now);
    let at = ENEMY_OFFSET + id * 8;
    let hp = read16(state, at);
    let hp = if hp == 0 { spec[4] } else { hp };
    let lv = level(p);
    let damage = match action {
        1 => 16 + (lv - 1) * 2,
        2 => {
            if read16(p, MP) < 12 {
                return Err(NO_SUPPLIES);
            }
            let mp = read16(p, MP) - 12;
            write16(p, MP, mp);
            24 + (lv - 1) * 3
        }
        3 => {
            if p[HEALS] == 0 || read16(p, HP) == max_health(p) {
                return Err(NO_SUPPLIES);
            }
            p[HEALS] -= 1;
            let hp = (read16(p, HP) + 38).min(max_health(p));
            write16(p, HP, hp);
            0
        }
        _ => return Err(ERR_TAG),
    };
    let remaining = hp.saturating_sub(damage);
    write16(state, at, remaining);
    if remaining == 0 {
        wr32(state, at + 4, now.saturating_add(35));
        gain32(p, GOLD, spec[7] as u32);
        gain32(p, XP, spec[6] as u32);
        gain16(p, WINS);
        if level(p) > lv {
            restore(p);
        }
    } else {
        let received = spec[5].saturating_sub(5 + lv / 2).max(3);
        let hp = read16(p, HP).saturating_sub(received);
        write16(p, HP, hp);
        if hp == 0 {
            set_position(p, SPAWN.0, SPAWN.1);
            write16(p, SAFE_X, SPAWN.0);
            write16(p, SAFE_Y, SPAWN.1);
            let hp = max_health(p) * 3 / 10;
            let gold = (rd32(p, GOLD) as u64 * 85 / 100) as u32;
            write16(p, HP, hp);
            wr32(p, GOLD, gold);
            p[SAIL] = 0;
        }
    }
    Ok(())
}

fn service(
    state: &mut [u8; WORLD_SIZE],
    p: &mut [u8; PLAYER_SIZE],
    id: usize,
    option: u8,
    now: u32,
) -> Result<(), u32> {
    let spec = BUILDINGS.get(id).ok_or(ERR_RANGE)?;
    let current = room(p).0;
    if (current != 0 && current != id + 1) || !nearby(p, spec[0], spec[1], 2) {
        return Err(OUT_OF_REACH);
    }
    let gold = rd32(p, GOLD);
    match spec[2] {
        1 if gold >= 20 && option == 0 => {
            wr32(p, GOLD, gold - 20);
            restore(p);
        }
        3 if option == 0 => restore(p),
        4 if option == 0 && p[COMMISSION] == 0 => {
            let lv = level(p);
            gain32(p, GOLD, 50);
            gain32(p, XP, 60);
            p[COMMISSION] = 1;
            if level(p) > lv {
                restore(p);
            }
        }
        2 => {
            let n = option as usize;
            let cost = *BUY_COST.get(n).ok_or(ERR_RANGE)?;
            if gold < cost {
                return Err(NO_SUPPLIES);
            }
            let at = STOCK_OFFSET + (spec[3] as usize * 4 + n) * 4;
            let bucket = now / 60;
            let previous = rd32(state, at);
            let used = if previous >> 2 == bucket {
                previous & 3
            } else {
                0
            };
            if used >= 3 {
                return Err(RESPAWNING);
            }
            wr32(state, at, (bucket << 2) | (used + 1));
            wr32(p, GOLD, gold - cost);
            let field = [HEALS, MANA, BOATS, PICKS][n];
            p[field] = p[field].saturating_add(if n == 3 { 10 } else { 1 });
        }
        _ => return Err(NO_SUPPLIES),
    }
    Ok(())
}

#[inline(never)]
pub(super) fn play_world(c: &Ctx) -> Result<(), u32> {
    let ix = c.ix;
    let op = ix[0];
    if c.n != (if op == 18 { 3 } else { 2 }) || ix.len() < 5 {
        return Err(ERR_ACCOUNTS);
    }
    let signer = &c.accs[0];
    let account = &c.accs[1];
    if !signer.is_signer
        || !account.is_writable
        || !eq32(account.owner(), c.program_id)
        || account.len() != WORLD_SIZE
    {
        return Err(ERR_OWNER);
    }
    let (key, _) = find_pda(&[SEED, &[0]], c.program_id);
    if !eq32(account.key(), &key) || eq32(signer.key(), &key) {
        return Err(ERR_PDA);
    }
    let state: &mut [u8; WORLD_SIZE] = account.data().try_into().map_err(|_| ERR_DATA)?;
    if &state[..8] != WORLD_MAGIC || read16(state, 48) as usize > OPENED_CAPACITY {
        return Err(ERR_DATA);
    }
    if op == MIGRATE && ix.len() == 5 {
        if eq32(&state[8..40], &MAP_HASH) { return Ok(()); }
        if !eq32(&state[8..40], &PREVIOUS_MAP_HASH) { return Err(ERR_DATA); }
        state[8..40].copy_from_slice(&MAP_HASH);
        for index in 0..PLAYERS {
            wr32(state, HEADER + index * PLAYER_SIZE + SEEN, 0);
        }
        gain32(state,40,1);
        return Ok(());
    }
    if !eq32(&state[8..40], &MAP_HASH) { return Err(ERR_DATA); }
    let now = now_seconds()?.min(u32::MAX as u64) as u32;
    let mut existing = None;
    let mut empty = None;
    for index in 0..PLAYERS {
        let at = HEADER + index * PLAYER_SIZE;
        let owner = &state[at..at + 32];
        if eq32(owner, signer.key()) {
            existing = Some(at);
            break;
        }
        if empty.is_none() && owner.iter().all(|&b| b == 0) {
            empty = Some(at);
        }
    }
    let at = if op == 18 {
        authorize_name(&c.accs[2], signer.key(), &ix[5..])?;
        existing.or(empty).ok_or(WORLD_FULL)?
    } else {
        existing.ok_or(NOT_REGISTERED)?
    };
    let mut p = [0u8; PLAYER_SIZE];
    p.copy_from_slice(&state[at..at + PLAYER_SIZE]);
    if op == 18 {
        if existing.is_none() {
            fresh_player(&mut p, signer.key(), &ix[5..]);
        } else if &p[32..32 + ix.len() - 5] != &ix[5..]
            || p[32 + ix.len() - 5..64].iter().any(|&b| b != 0)
        {
            return Err(NOT_REGISTERED);
        }
        restore_safe_tile(state,&mut p);
    } else {
        if rd32(ix, 1) != rd32(&p, SEQ) {
            return Err(ERR_SEQ);
        }
        if op == RELEASE_FRESH && ix.len() == 5 {
            // A signer can release only its own unused slot after leaving. No earned progress is discarded.
            if rd32(&p, SEEN) != 0 || rd32(&p, GOLD) != 100 || rd32(&p, XP) != 0 ||
                read16(&p,WINS) != 0 || read16(&p,FINDS) != 0 || p[HEALS] != 3 || p[MANA] != 2 ||
                p[BOATS..=SAIL].iter().any(|&value| value != 0) || p[COMMISSION] != 0 {
                return Err(ERR_PHASE);
            }
            state[at..at + PLAYER_SIZE].fill(0);
            gain32(state,40,1);
            return Ok(());
        }
        if rd32(&p, SEEN) == 0 {
            return Err(ERR_PHASE);
        }
    }
    match op {
        18 => {}
        19 => move_steps(state, &mut p, &ix[5..], now)?,
        20 if ix.len() == 7 && room(&p).0 == 0 => collect(state, &mut p, read16(ix, 5) as usize, now)?,
        21 if ix.len() == 8 && room(&p).0 == 0 => fight(state, &mut p, read16(ix, 5) as usize, ix[7], now)?,
        22 if ix.len() == 8 => service(state, &mut p, read16(ix, 5) as usize, ix[7], now)?,
        23 if ix.len() == 5 && p[MANA] > 0 && read16(&p, MP) < max_mana(&p) => {
            p[MANA] -= 1;
            let mp = (read16(&p, MP) + 25).min(max_mana(&p));
            write16(&mut p, MP, mp);
        }
        LEAVE | HEARTBEAT if ix.len() == 5 => {}
        BUILDING_ROOM if ix.len() == 7 => toggle_room(&mut p,read16(ix,5) as usize)?,
        _ => return Err(ERR_DATA),
    }
    wr32(&mut p, SEEN, if op == LEAVE { 0 } else { now });
    let seq = rd32(&p, SEQ).checked_add(1).ok_or(ERR_RANGE)?;
    wr32(&mut p, SEQ, seq);
    state[at..at + PLAYER_SIZE].copy_from_slice(&p);
    gain32(state, 40, 1);
    Ok(())
}

/// The world account, checked: program-owned, the right size and address, and this release's world.
fn world_state<'a>(world: &'a Acc, program_id: &[u8; 32]) -> Result<(&'a mut [u8], u8), u32> {
    if !eq32(world.owner(), program_id) || world.len() != WORLD_SIZE {
        return Err(ERR_OWNER);
    }
    let (key, bump) = find_pda(&[SEED, &[0]], program_id);
    if !eq32(world.key(), &key) {
        return Err(ERR_PDA);
    }
    let state = world.data();
    if &state[..8] != WORLD_MAGIC {
        return Err(ERR_DATA);
    }
    Ok((state, bump))
}

/// Whether `key` has a character in the shared world (duels are for players with one).
#[inline(never)]
pub(super) fn has_character(world: &Acc, program_id: &[u8; 32], key: &[u8; 32]) -> Result<bool, u32> {
    let (state, _) = world_state(world, program_id)?;
    Ok((0..PLAYERS).any(|index| {
        let at = HEADER + index * PLAYER_SIZE;
        eq32(&state[at..at + 32], key)
    }))
}

/// 29: save the world to Solana. 30: hand it back to Solana (save, then leave the rollup).
/// Anyone may save new changes, at most once every SAVE_SECONDS; the admin may save at any time. Handing back is for
/// the admin, and for anyone once the world's reserve has fewer than 10 paid saves left: then anyone can send the world
/// SOL on Solana and put it back on the rollup with instruction 17, so saving never depends on our key.
#[inline(never)]
pub(super) fn save(c: &Ctx, undelegate: bool) -> Result<(), u32> {
    // [caller s, world w, magic program, magic context w (, rollup fee vault w)]
    if c.n < 4 || c.ix.len() != 1 {
        return Err(ERR_ACCOUNTS);
    }
    let (caller, world) = (&c.accs[0], &c.accs[1]);
    if !caller.is_signer {
        return Err(ERR_SIGNER);
    }
    if !world.is_writable || eq32(caller.key(), world.key()) {
        return Err(ERR_OWNER);
    }
    if !eq32(c.accs[2].key(), &MAGIC_PROGRAM) || !eq32(c.accs[3].key(), &MAGIC_CONTEXT) {
        return Err(ERR_ACCOUNTS);
    }
    let (state, bump) = world_state(world, c.program_id)?;
    let admin = eq32(caller.key(), &ADMIN);
    let lamports = unsafe { *world.lamports };
    if undelegate && !admin && lamports >= rent_minimum(WORLD_SIZE) + LOW_RESERVE {
        return Err(NOT_ADMIN);
    }
    let now = now_seconds()?.min(u32::MAX as u64) as u32;
    if !undelegate && !admin {
        // saves are limited and can cost the reserve, so a save needs a change, and not too often
        if rd32(state, 40) == rd32(state, SAVED_REVISION) {
            return Err(UNCHANGED);
        }
        if now < rd32(state, SAVED_AT).saturating_add(SAVE_SECONDS) {
            return Err(RATE_LIMIT);
        }
    }
    gain32(state, 40, 1);
    let revision = rd32(state, 40);
    wr32(state, SAVED_REVISION, revision);
    wr32(state, SAVED_AT, now);
    let (vault, _) = find_pda(&[b"magic-fee-vault", &ER_VALIDATOR], &DELEGATION_PROGRAM);
    let paid = lamports >= rent_minimum(WORLD_SIZE) + LIVE_COMMIT_FEE;
    if !undelegate && c.n >= 5 && eq32(c.accs[4].key(), &vault) && paid {
        // the world is the delegated fee payer: any save fee comes from its own reserve, never from the player
        invoke(
            c.accs,
            &Cpi {
                program: &MAGIC_PROGRAM,
                metas: &[(1, true, true), (3, true, false), (4, true, false), (1, true, false)],
                data: &[1, 0, 0, 0],
                seeds: &[&[SEED, &[0], &[bump]]],
            },
        )?;
        log("eb: save scheduled, paid by the world");
        return Ok(());
    }
    // sponsored by the caller: MagicBlock accepts 10 of these per delegation, and handing back is always allowed
    let data: [u8; 4] = if undelegate { [2, 0, 0, 0] } else { [1, 0, 0, 0] };
    invoke(
        c.accs,
        &Cpi {
            program: &MAGIC_PROGRAM,
            metas: &[(0, caller.is_writable, true), (3, true, false), (1, true, false)],
            data: &data,
            seeds: &[],
        },
    )?;
    log(if undelegate { "eb: handed back to Solana" } else { "eb: save scheduled" });
    Ok(())
}
