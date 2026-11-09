//! Test stand-in for MagicBlock's magic program in LiteSVM: accepts every call and logs what it was given,
//! so the checks can see the accounts, flags and data of each save. Never deployed.
#![cfg_attr(target_arch = "bpf", no_std)]
use solana_compiler_builtins as _;

extern "C" {
    fn sol_log_64_(a: u64, b: u64, c: u64, d: u64, e: u64);
    fn sol_log_pubkey(key: *const u8);
    fn abort() -> !;
}

#[cfg(target_arch = "bpf")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unsafe { abort() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    let mut p = input;
    let n = *(p as *const u64);
    p = p.add(8);
    for i in 0..n {
        let dup = *p;
        if dup != 0xff {
            // 0x5d = duplicate of an earlier account
            sol_log_64_(0x5d, i, dup as u64, 0, 0);
            p = p.add(8);
            continue;
        }
        sol_log_pubkey(p.add(8));
        // 0xac = account: index, signer, writable
        sol_log_64_(0xac, i, *p.add(1) as u64, *p.add(2) as u64, 0);
        let len = *(p.add(80) as *const u64) as usize;
        p = p.add(88 + len + 10_240);
        p = ((p as usize + 7) & !7) as *mut u8;
        p = p.add(8);
    }
    let len = *(p as *const u64);
    p = p.add(8);
    let word = if len >= 4 { *(p as *const u32) as u64 } else { u64::MAX };
    // 0xda = instruction data: length, first four bytes as a little-endian word
    sol_log_64_(0xda, len, word, 0, 0);
    0
}
