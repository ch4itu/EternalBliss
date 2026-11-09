# EternalBliss on Solana (R11)

Play: https://ch4itu.github.io/EternalBliss/solana/

This folder is the Solana version of EternalBliss: the same world and map, with a shared world and duels that run on Solana Devnet through a MagicBlock rollup. The Algorand version in the rest of this repository is unchanged.

- **Solo adventure** saves on your device.
- **Shared world**: sign in with a Smaran player name and passphrase (Magic Over accounts work here). Up to 32 characters, with shared enemies, treasure and shops. A character keeps its slot and progress when it leaves.
- **Duels**: turn-based, no stakes, with a nearby player or by code. Duels are for players with a character in the shared world.
- **Saved to Solana**: the rollup runs the world, and every few minutes, and when a player leaves, the page asks for it to be saved to Solana. The world pays MagicBlock's fee from its own reserve, not the player. If the reserve runs low, anyone can take the world off the rollup, top it up on Solana and put it back.

## On chain (Devnet)

| | Address |
|---|---|
| Program | `6e5ied8gFYVSEoc6wWGwBwVSFAC9DZNYAgKg53M1rGdb` |
| Shared world | `GjYsCcq2r5KkVab7suzvStwYkAcJ3nTe9yXN8EcC5T9E` |
| Duel tables 0 to 3 | `HEy1reJephj1xp9WbFqbDFyb961AYeja1k3hKYAqexob`, `9vHQe2dvjcj6zyCPTWzuJyQZZpBeapJMe8uWcSmT9yh7`, `8yVx1guQXr2GnapNagQtftSq3JZyTvZ5tDZwkwXaRWkx`, `5ZzANFsX5B65rWQXVKmXjVgR23wEjYXPUTm2rLtGFfRg` |
| Rollup | MagicBlock `devnet-as` (validator `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`) |

The program's source, its checks and the build that is deployed are in [multiplayer/](multiplayer/). A clean build gives sha256 `cee82f6a2d5838a8fb153a9584fb107cbe1ad7488ab20451b519d1fe9fd2c0b3`, which you can compare with `solana program dump 6e5ied8gFYVSEoc6wWGwBwVSFAC9DZNYAgKg53M1rGdb out.so --url devnet`. [multiplayer/README.md](multiplayer/README.md) lists what changed from R10 and what was tested.

Everything here is on Devnet, with test SOL only.
