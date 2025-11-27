# AI Code Review — Encrypted Multi-Agent Coordination
### Grok + ChatGPT Collaborating on the Blockchain

[![Smart Contract](https://img.shields.io/badge/Contract-750081112-blue)](https://lora.algokit.io/testnet/application/750081112)
[![Encryption](https://img.shields.io/badge/Encryption-NaCl%20Box-purple)](https://nacl.cr.yp.to/)

---

## Overview

This tool demonstrates **multi-agent AI coordination** using the Universal State Machine Framework. Two AI agents work together to write and review code:

- **Coder (Grok):** Writes code based on your task description
- **Reviewer (ChatGPT):** Reviews the code for errors and improvements

All communication is **end-to-end encrypted** and stored on Algorand's blockchain. The AIs iterate until the code is approved.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        CODER (You + Grok)                        │
│  1. Enter task: "Write Python to check if number is prime"       │
│  2. Grok generates code                                          │
│  3. Code encrypted with reviewer's public key                    │
│  4. Encrypted code stored on blockchain                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN (Algorand)                         │
│  Process: Turn-based coordination between coder & reviewer       │
│  Entities: Encrypted code chunks + review chunks                 │
│  Box Storage: e:<process_id>_code_0, e:<process_id>_review_0...  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REVIEWER (Partner + ChatGPT)                  │
│  1. Auto-discovers the process from coder's address              │
│  2. Decrypts code with their private key                         │
│  3. ChatGPT reviews the code                                     │
│  4. If issues found: "STATUS: NEEDS_FIXES" → back to coder       │
│  5. If perfect: "STATUS: ERROR_FREE" → done!                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features

### End-to-End Encryption
- **NaCl Box** (public-key cryptography)
- Ed25519 keys converted to Curve25519 (X25519) for encryption
- Only the intended recipient can decrypt messages
- Even blockchain validators can't read the content

### Chunked Storage
- Code split into 1.8KB chunks
- Up to 18 chunks = ~32KB encrypted data (~24KB input)
- Metadata tracks chunk count for reassembly

### Turn-Based Coordination
- Process primitive ensures correct turn order
- Coder writes → Reviewer reviews → repeat
- Automatic turn detection and switching

### Auto-Discovery
- Reviewer automatically finds the newest process
- No need to share process IDs manually
- Just share your wallet address

### MBR Reclaim
- "Delete boxes when complete" option (recommended)
- Reclaims ~0.12 ALGO per session
- Clean up anytime with the cleanup button

---

## Quick Start

### Prerequisites
1. Two Algorand TestNet wallets (one for coder, one for reviewer)
2. TestNet ALGO in both wallets (~0.2 ALGO each)
3. API Keys:
   - **Coder:** Grok API key from [xAI](https://x.ai/)
   - **Reviewer:** OpenAI API key from [OpenAI](https://platform.openai.com/)

### Step 1: Coder Setup
1. Open [auto-code-review.html](./auto-code-review.html)
2. Click **CODER (Grok)**
3. Enter your 25-word mnemonic
4. Enter your Grok API key
5. Enter the **reviewer's wallet address**
6. Describe your coding task
7. Click **START**
8. **Copy your address** and share it with the reviewer

### Step 2: Reviewer Setup
1. Open [auto-code-review.html](./auto-code-review.html) (different browser/device)
2. Click **REVIEWER (ChatGPT)**
3. Enter your 25-word mnemonic
4. Enter your OpenAI API key
5. Enter the **coder's wallet address** (from step 1)
6. Click **JOIN**

### Step 3: Watch the Magic
- Grok writes code based on your task
- ChatGPT reviews it
- If issues found, Grok fixes them
- When ChatGPT approves (STATUS: ERROR_FREE), you get the final code
- Click **SAVE CODE** to download

---

## Technical Details

### Encryption Flow

```javascript
// Sender encrypts for recipient
function encryptForRecipient(data, recipientAddr, myAccount) {
  // Convert Algorand Ed25519 keys to Curve25519
  const recipientCurve25519PubKey = ed2curve.convertPublicKey(recipientEd25519PubKey);
  const myCurve25519SecretKey = ed2curve.convertSecretKey(myEd25519SecretKey);

  // Generate random nonce
  const nonce = nacl.randomBytes(24);

  // Encrypt with NaCl box
  const encrypted = nacl.box(messageBytes, nonce, recipientCurve25519PubKey, myCurve25519SecretKey);

  // Return: nonce + encrypted (base64)
  return base64(nonce + encrypted);
}
```

### Storage Structure

```
Process Box:
  p:cr_<timestamp>
  └── Header (81 bytes): participant1 + participant2 + turn + finalized + timeout
  └── State: {"t": <turn_number>}

Entity Boxes (per turn):
  e:<process_id>_task          → Task description (plaintext)
  e:<process_id>_code_0_meta   → {"chunks": 3}
  e:<process_id>_code_0_0      → {"data": "<encrypted_chunk_1>"}
  e:<process_id>_code_0_1      → {"data": "<encrypted_chunk_2>"}
  e:<process_id>_code_0_2      → {"data": "<encrypted_chunk_3>"}
  e:<process_id>_review_1_meta → {"chunks": 1}
  e:<process_id>_review_1_0    → {"data": "<encrypted_review>"}
```

### AI Prompts

**Grok (Coder):**
```
System: "Code only. Max 25KB."
User: <task_description> OR "Fix: <review_feedback>"
```

**ChatGPT (Reviewer):**
```
System: "Code reviewer. If code is perfect with no issues, you MUST end with
exactly 'STATUS: ERROR_FREE' on its own line. If code needs fixes, end with
'STATUS: NEEDS_FIXES'. Be strict - only approve truly production-ready code."
User: "Review this code: ```<code>```"
```

---

## Configuration

### Chunk Settings (in code)
```javascript
const CHUNK_SIZE = 1800;  // 1.8KB per chunk (safe for transaction limits)
const MAX_CHUNKS = 18;    // Max 18 chunks = ~32KB encrypted
```

### Polling Intervals
- Turn check: 10 seconds
- Retry on error: 15 seconds

### Timeouts
- Process timeout: Not set (runs until complete or stopped)
- Consider adding timeout for abandoned sessions

---

## Cost Analysis

| Operation | Cost |
|-----------|------|
| Create process | ~50,000 microALGO |
| Save task entity | ~5,000-10,000 microALGO |
| Save code chunks (3 chunks) | ~90,000 microALGO |
| Save review chunks (1 chunk) | ~30,000 microALGO |
| **Total per iteration** | ~175,000 microALGO (~0.175 ALGO) |
| **Refund on cleanup** | ~80% recoverable |

**Note:** Costs vary based on data size. MBR is refundable when boxes are deleted.

---

## Troubleshooting

### "No active process found"
- **Cause:** Reviewer started before coder
- **Fix:** Wait for coder to start and share their address

### "Decryption failed"
- **Cause:** Wrong addresses entered
- **Fix:** Verify coder entered reviewer's address and vice versa

### "Chunk too large for transaction"
- **Cause:** AI generated very long code
- **Fix:** Ask for shorter code or reduce task complexity

### "Rate limited"
- **Cause:** Too many API calls
- **Fix:** Wait a few minutes, or use different API keys

### "Transaction failed"
- **Cause:** Insufficient ALGO balance
- **Fix:** Get more TestNet ALGO from [faucet](https://bank.testnet.algorand.network/)

---

## Security Considerations

### What's Encrypted
- Code content
- Review feedback
- All data stored in chunk entities

### What's NOT Encrypted
- Task description (stored in plaintext)
- Process metadata (turn numbers, timestamps)
- Participant addresses (visible on-chain)

### Recommendations
1. Don't include secrets in task descriptions
2. Use separate wallets for testing
3. Clean up after sessions to remove encrypted data
4. API keys are stored in browser localStorage (clear when done)

---

## Why This Matters

This demo shows that **AI agents can coordinate trustlessly on blockchain**:

1. **No Central Server:** AIs communicate via Algorand, not through our servers
2. **Privacy:** End-to-end encryption ensures only participants see content
3. **Verifiable:** All interactions recorded on-chain with timestamps
4. **Censorship-Resistant:** No one can stop the collaboration
5. **Persistent:** Conversation history survives any single point of failure

### Future Applications
- Multi-agent AI workflows (researcher + writer + editor)
- Decentralized AI marketplaces
- Verifiable AI-generated content
- Autonomous AI organizations (DAOs with AI members)

---

## API Keys

### Get Grok API Key (xAI)
1. Visit [x.ai](https://x.ai/)
2. Sign up for API access
3. Generate API key
4. Use model: `grok-code-fast-1`

### Get OpenAI API Key
1. Visit [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Go to API Keys section
4. Create new secret key
5. Uses model: `gpt-4`

---

## Related Documentation

- [Main README](./README.md) — Universal State Machine Framework overview
- [Developer Guide](./docs/DEVELOPER_GUIDE.md) — Integration instructions
- [API Reference](./docs/API_REFERENCE.md) — Contract method documentation
- [Examples](./docs/EXAMPLES.md) — More use case templates

---

## License

MIT License — see [LICENSE](LICENSE) file.

---

*Built with the Universal State Machine Framework — Where AI agents collaborate forever.*
