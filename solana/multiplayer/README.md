# EternalBliss multiplayer (R11)

## What changed in R11

R11 is R10 with five fixes, on a new Devnet program (`6e5ied8gFYVSEoc6wWGwBwVSFAC9DZNYAgKg53M1rGdb`). The test world started fresh; Smaran player names and passphrases are unchanged.

1. **The shared world is saved to Solana.** R10 delegated the world to the rollup and never saved it back. In R11 any player's page asks for a save (instruction 29) once the world has new changes and two minutes have passed since the last save, and again when a player leaves. The program refuses a save with nothing new (error 39) or within two minutes of the last one (34). The world pays MagicBlock's fee for each save from its own reserve, never the player, and a throwaway key signs the request.
2. **Anyone can keep it saving.** Instruction 30 hands the world back to Solana. The admin key can do it at any time. Anyone can do it once the reserve has fewer than 10 paid saves left (below rent + 0.001 SOL); otherwise it is refused (38). Then anyone can send the world SOL on Solana and delegate it again (instruction 17, open to anyone).
3. **Walking.** The program accepts 12 steps per rollup second (R10: 9, close to the 8 steps a second of a held key, so walkers waited on the limit). Other players' walks are played over the time until the next confirmed update, for gaps up to 500 ms (R10: 88% of the gap, up to 400 ms, at most 320 ms).
4. **Duels need a character.** Every duel instruction passes the world account; hosting or joining needs a character in the shared world (37).
5. **Solo autosave** writes 1.8 s after the last change instead of every 1.8 s during a walk (and at least every 30 s on a long walk). The save format is unchanged.

The world header uses bytes 52..60 for the saved revision and the time of the last save; a save also moves the revision on.

## R10 notes

The release HTML opens a menu with **Solo adventure** and **Shared world**. Solo progress saves on this device and restores automatically for the same guest or player account. **Shared world** opens **Sign in** if needed, and the same player name and passphrase used in Magic Over work here. **Leave world** returns to your solo adventure. The status beside the location shows the active mode and the number of online players in the shared world.

The 300 × 300 map keeps the original 150 × 150 area at the same coordinates and reshapes the expansion around its existing settlements. Recognized R2 and R4 saves carry their progress forward in the same browser. The Hero and bottom panels can be minimized. Building models are 18–22% larger than R7 and block their original tiles. Use **Enter building** at an inn, shop, temple, or castle to meet its staff and see its furnishings. The minimap switches to the room until you use **Exit building**. **Leave world** is available outdoors.

The combined program provides a shared world and four two-player, no-wager duel tables. The world holds 32 registered characters, all of whom can be online together. A character keeps its slot and progress when it leaves. Nearby active players appear as avatars. Select **World** on the minimap to see active players across the entire map as blue markers. The minimap has its own zoom buttons and follows your hero in **Local** view.

Use **Duel** inside the shared world. It reads **Duel nearby** when a player is within two tiles in the same location. When you open an invitation, eligible nearby players see your name and can choose **Accept duel** or **Decline**. Duel codes also work when players are apart. Closing the duel returns to the shared world. Reopening it resumes your active match.

Your hero has a gold **YOU** marker. Other people have a cyan **PLAYER · name** marker. A visible idle tab renews its presence after about 20 seconds without a confirmed action. After about 45 seconds without a confirmed action or heartbeat, the avatar drops off the online list and its character stays saved. Returning to the tab resumes presence. **Leave world** clears presence when the rollup confirms the leave.

The client listens for confirmed world changes, duel changes and transaction receipts on one WebSocket. It also reads confirmed state over HTTP to catch up on join, after a gap, and when WebSocket is unavailable. It ignores older snapshots. Remote avatars start moving as soon as a confirmed position arrives and adapt their animation to the pace of updates. The rollup executes signed moves directly. The next queued move can go out as soon as the expected tile, move sequence and step count appear in the confirmed world. NPCs and enemies draw their patrols on animation frames from a smoothed estimate of the shared clock.

Players share the same actor clock, actor state and world leaderboard. Players in the same interior see each other there. A treasure returns 90 seconds after collection. Ground supplies return after 45 seconds, gold after 60 seconds, and defeated enemies after 35 seconds. A shop has three of each supply per rollup minute. The program determines claims and combat. The leaderboard orders players by level and XP, then enemies defeated, treasures found and name. Gold buys supplies. Solo saves and the solo leaderboard stay in your browser.

An in-game day takes eight real minutes. The season changes every four in-game days. Lighting and seasonal colors follow the MagicBlock clock in the shared world and the device's UTC time in solo play. These visual changes use the existing map and save format.

## Verified for R11

Local (LiteSVM, solders 0.29.0): `check_world.py` 15/15 and `check_duel.py` 18/18, both also with the live MagicBlock delegation program loaded; `check_save.py` 14/14 against `stub/`, a stand-in for MagicBlock's magic program that logs the accounts and data it receives.

On Devnet and the rollup: an admin save paid by the world reached Solana byte for byte; a stranger's empty save (39), a stranger's hand-back of a healthy world (38) and a duel host without a character (37) were refused; the admin handed the world back, it arrived on Solana intact with its reserve, and a stranger delegated it again (0.0029 SOL). Two browsers with two Smaran players: sign-in, a declined and an accepted duel, walking with no refusals, the page's own saves reaching Solana, leaving, and the Solana copy equal to the rollup copy after both left. The 3D view entered the shared world and walked. Measured from a test machine about 235 ms from the rollup, a walker's confirmed updates arrived about every 380 ms; replaying those arrivals, another player's view of the walk stood still in 7 to 8% of frames with R11's playback, against 25 to 27% with R10's.

## Verified locally for R10

The R10 sBPF binary passed the world, duel, room collision and R4 migration checks in LiteSVM. In the local capacity check, 32 signed players each moved eight times and the 33rd new character was rejected. The previous release tested four live Devnet clients over six rounds of simultaneous moves. R10 was compared against R9 with two live clients on isolated moves and a continuous walking route. The live duel check covered proximity, accepting and declining an invitation, resuming a match and seeing its result. It also passed with the receiving client limited to HTTP. Full-capacity live latency remains unmeasured.

Rebuild using the pinned Rust toolchain and sbpf-linker 0.2.5. Run these commands from this directory with solders available for the checks (R11 used 0.29.0). A clean build of this folder gives sha256 `cee82f6a2d5838a8fb153a9584fb107cbe1ad7488ab20451b519d1fe9fd2c0b3`, the bytes deployed on Devnet.

    cargo install --locked sbpf-linker --version 0.2.5
    cargo build-bpf
    python check_world.py
    python check_duel.py
    (cd stub && cargo build-bpf)
    python check_save.py stub/target/bpfel-unknown-none/release/libmagic_stub.so

The checks accept an optional path to the public MagicBlock delegation program ELF to exercise the delegation CPI locally.

## Devnet deployment

The R11 page uses program `6e5ied8gFYVSEoc6wWGwBwVSFAC9DZNYAgKg53M1rGdb` on Solana Devnet (upgrade authority `HDbeKypeJHXMM5Xs2RHKj8XGQgJeP4jnQ1Jiugf8mXPn`, the key that runs Magic Over and Smaran) and the MagicBlock Asia rollup (`devnet-as`).

| Account | Address |
|---|---|
| World `["eb-land", 0]` | `GjYsCcq2r5KkVab7suzvStwYkAcJ3nTe9yXN8EcC5T9E` (rent + 0.05 SOL save reserve) |
| Duel table 0 | `HEy1reJephj1xp9WbFqbDFyb961AYeja1k3hKYAqexob` |
| Duel table 1 | `9vHQe2dvjcj6zyCPTWzuJyQZZpBeapJMe8uWcSmT9yh7` |
| Duel table 2 | `8yVx1guQXr2GnapNagQtftSq3JZyTvZ5tDZwkwXaRWkx` |
| Duel table 3 | `5ZzANFsX5B65rWQXVKmXjVgR23wEjYXPUTm2rLtGFfRg` |

R10 used program `qaVThKeU6aoVfNz5egb5CPKchXS4XGksNsh93XwjpB6`, whose upgrade key is lost; it is left as it was.

## Deploy your own copy on Devnet

Check the current Devnet reserve estimate without sending a transaction.

    python deploy_devnet.py

Run the installer with an operator funded with Devnet test SOL and dedicated program and buffer keypairs. The upper limit is expressed in Devnet test lamports.

    python deploy_devnet.py --apply --payer PAYER.json --program PROGRAM.json --buffer BUFFER.json --max-test-lamports LIMIT --world-reserve 50000000

`--world-reserve` gives the world lamports above rent to pay for its own saves (MagicBlock charges 0.0001 SOL a save after the first 25 of each delegation). Without it, saves fall back to sponsored saves, which MagicBlock limits to 10 per delegation.

Keep keypair files private. The installer checks the Devnet genesis and the expected MagicBlock Asia validator, checks the operator balance and requested cap, uploads the exact ELF, initializes five accounts, and waits for all five on the rollup. A funded operator is required for setup. The game client signs play actions with the player account.

Enable Shared world and Duel after the installer verifies the deployment.

    python configure_game.py DEVNET_PROGRAM_ID ../EternalBliss-GUI-R11.html EternalBliss-Devnet.html
