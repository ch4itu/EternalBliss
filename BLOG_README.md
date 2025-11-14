# OnChain Blog - Universal State Machine

A fully decentralized blog built on Algorand's Universal State Machine smart contract.

## 🌟 Features

- **Fully OnChain** - All blog posts stored directly on Algorand blockchain
- **Permanent Storage** - Posts persist forever using box storage
- **Decentralized** - No backend servers required
- **Censorship Resistant** - Only authors can delete their own posts
- **Transparent** - All posts publicly readable on-chain

## 🔗 Live Demo

- **Blog Interface**: [blog.html](./blog.html)
- **Smart Contract**: [749599252](https://lora.algokit.io/testnet/application/749599252)
- **Network**: Algorand TestNet

## 🏗️ How It Works

### Architecture

The blog uses the Universal State Machine's **Entity** storage system:

```
Entity ID Format: blog:<author_address>:<timestamp>
Entity Data: {
  "title": "Post Title",
  "content": "Post content...",
  "author": "ALGORAND_ADDRESS",
  "timestamp": 1234567890
}
```

### Storage Mechanism

1. **Write Post**: Calls `save_entity()` with MBR payment
2. **Read Posts**: Scans all boxes with prefix `e:blog:`
3. **Delete Post**: Calls `delete_entity()` (owner only)

### MBR (Minimum Balance Requirement)

- **First Post**: ~2,500 + 400 × (key + data) microAlgos
- **Typical Cost**: ~1,500-2,500 microAlgos per post (~0.0015-0.0025 ALGO)
- **Updates**: Only pay for data growth (usually 0)

## 📝 Usage

### 1. Connect Wallet

Enter your 25-word Algorand mnemonic phrase. The blog uses:
- **Network**: TestNet
- **Contract**: 749599252
- **Storage**: Box storage with `e:blog:` prefix

### 2. Write a Post

1. Click "✍️ Write New Post"
2. Enter title and content
3. Click "📤 Publish to Blockchain"
4. Post is permanently stored on Algorand

### 3. Read Posts

1. Click "📚 View All Posts"
2. See all posts from all users
3. Posts sorted by newest first
4. Author addresses displayed

### 4. Delete Your Posts

- Only you can delete your own posts
- Click "🗑️ Delete Post" on your posts
- MBR is freed back to contract

## 🔐 Security

- **Ownership Verification**: Smart contract enforces author-only updates/deletes
- **Data Validation**: Max 4KB per post
- **MBR Protection**: Contract validates all payments
- **XSS Prevention**: HTML escaped on display

## 🎯 Features

### ✅ Implemented

- [x] Wallet connection with mnemonic
- [x] Create posts on blockchain
- [x] View all posts
- [x] Delete own posts
- [x] Author verification
- [x] Timestamp display
- [x] Character count (3500 limit)
- [x] Responsive UI
- [x] MBR calculation

### 🚧 Potential Enhancements

- [ ] Markdown support for rich text
- [ ] Comments system (using Processes)
- [ ] Upvote/like system
- [ ] Tag/category system
- [ ] Search functionality
- [ ] Author profiles
- [ ] Post editing (new entity version)
- [ ] IPFS integration for images
- [ ] Pagination for large post lists

## 💡 Technical Details

### Smart Contract Methods Used

```python
# Write/Update Post
save_entity(
    entity_id: "blog:<author>:<timestamp>",
    entity_data: JSON_STRING,
    mbr_payment: PAYMENT_TXN
)

# Read Post
load_entity(entity_id: "blog:<author>:<timestamp>")

# Delete Post
delete_entity(entity_id: "blog:<author>:<timestamp>")

# Get Author
get_entity_owner(entity_id: "blog:<author>:<timestamp>")
```

### Box Naming Convention

- **Prefix**: `e:` (entity)
- **Full Key**: `e:blog:<author_address>:<unix_timestamp>`
- **Example**: `e:blog:YSB5WAB3Y2VBPCU36RAX3ERB4GOOPJXPKK4FPLT7YAMBNHRK4246VP7INY:1732468800000`

### Data Structure

```json
{
  "title": "My First OnChain Post",
  "content": "This is stored forever on Algorand blockchain!",
  "author": "YSB5WAB3Y2VBPCU36RAX3ERB4GOOPJXPKK4FPLT7YAMBNHRK4246VP7INY",
  "timestamp": 1732468800000
}
```

## 🚀 Deployment

### Option 1: Static Hosting

```bash
# Host blog.html on any static server
python -m http.server 8000
# Visit http://localhost:8000/blog.html
```

### Option 2: GitHub Pages

Already included in the repository. Access via:
```
https://ch4itu.github.io/EternalBliss/blog.html
```

## 🔧 Development

### Prerequisites

- Modern web browser
- Algorand TestNet wallet with ~0.1 ALGO
- 25-word mnemonic phrase

### Local Testing

1. Open `blog.html` in browser
2. Connect with TestNet wallet
3. Write and publish test posts
4. Verify on blockchain explorer

### Verification

View posts on-chain:
1. Visit https://lora.algokit.io/testnet/application/749599252
2. Check "Boxes" tab
3. Look for boxes starting with `e:blog:`
4. Decode base64 data to see JSON

## 📊 Cost Analysis

| Operation | MBR Cost | Transaction Fee | Total |
|-----------|----------|-----------------|-------|
| First Post (200 chars) | ~1,800 μALGO | 1,000 μALGO | ~2,800 μALGO |
| Medium Post (1000 chars) | ~3,500 μALGO | 1,000 μALGO | ~4,500 μALGO |
| Large Post (3500 chars) | ~6,000 μALGO | 1,000 μALGO | ~7,000 μALGO |
| Delete Post | 0 μALGO | 1,000 μALGO | ~1,000 μALGO |

*Note: 1 ALGO = 1,000,000 μALGO*

## 🎓 Educational Value

This blog demonstrates:

1. **Decentralized Storage** - No database or server required
2. **Immutable Records** - Posts cannot be altered (only deleted)
3. **Ownership** - Cryptographic proof of authorship
4. **Economic Model** - Pay-once for permanent storage
5. **Universal Framework** - Same contract powers games, blogs, and more

## 📜 License

MIT License - Same as parent project

## 🙏 Credits

Built using:
- **Algorand Python (AlgoPy)** - Smart contract framework
- **AlgoSDK** - JavaScript Algorand integration
- **Universal State Machine** - Generic storage framework
- **Box Storage** - Efficient on-chain data storage

---

**Repository**: [EternalBliss](https://github.com/ch4itu/EternalBliss)
**Smart Contract**: [749599252](https://lora.algokit.io/testnet/application/749599252)
**Network**: Algorand TestNet
