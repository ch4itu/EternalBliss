# Eternal Storage

### Permanent File Storage on Algorand Blockchain

Store files permanently on the Algorand blockchain using the Universal State Machine Framework. No servers, no expiration, no data loss.

---

## Features

| Feature | Description |
|---------|-------------|
| **Permanent Storage** | Files stored on 3,000+ validator nodes worldwide |
| **File Browser** | Visual interface to browse, view, and manage uploaded files |
| **Image Support** | Upload PNG, JPG, GIF, SVG with automatic base64 encoding |
| **One-Click View** | Click any file to preview content instantly |
| **Individual Delete** | Delete specific files and reclaim MBR |
| **Manifest Merge** | New uploads add to existing files, not overwrite |
| **Download Files** | Reconstruct and download any uploaded file |

---

## How It Works

### Storage Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Files                            │
│  index.html, style.css, app.js, logo.png                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼ (chunked @ 1.5KB each)
┌─────────────────────────────────────────────────────────┐
│              Universal State Machine                     │
│                   App ID: 750081112                      │
├─────────────────────────────────────────────────────────┤
│  e:app:manifest    → {"files": [...], "totalChunks": N} │
│  e:app:index:0     → chunk 0 of index.html              │
│  e:app:index:1     → chunk 1 of index.html              │
│  e:app:style:0     → chunk 0 of style.css               │
│  e:app:logo:0      → base64 chunk 0 of logo.png         │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Algorand Box Storage                        │
│           3,000+ validator nodes worldwide               │
└─────────────────────────────────────────────────────────┘
```

### Chunk Size

Files are split into **1,500 byte chunks** due to Algorand's application arguments limit (2048 bytes total per transaction).

| File Size | Chunks Required |
|-----------|-----------------|
| 1.5 KB | 1 chunk |
| 15 KB | 10 chunks |
| 150 KB | 100 chunks |

---

## Usage

### 1. Upload Files

1. Open `eternal-storage.html`
2. Connect your wallet (25-word mnemonic)
3. Drag & drop files or click to select
4. Review file analysis (size, chunks, estimated MBR)
5. Click "Upload All Files"
6. Wait for all chunks to upload

### 2. Browse Files

1. Switch to "Browse Files" tab
2. Click "Load Files" to fetch manifest
3. See all uploaded files with:
   - File type icons (JS, HTML, CSS, IMG, etc.)
   - Size and chunk count
   - Binary indicator for images

### 3. View Files

- **Click** any file in the list to preview
- **Images** display visually
- **Text files** show content with syntax highlighting
- **Download** button available for all files

### 4. Delete Files

- **Individual delete**: Hover over file → click "Delete"
- **Delete all**: Click "Delete All" button
- **MBR refunded** automatically when files deleted

---

## Supported File Types

| Type | Extensions | Storage Method |
|------|------------|----------------|
| Text | .html, .js, .css, .json, .txt, .md, .xml | UTF-8 text |
| Binary | .png, .jpg, .jpeg, .gif, .webp, .ico, .bmp | Base64 encoded |
| Vector | .svg | UTF-8 text |

---

## Cost Breakdown

### MBR (Minimum Balance Requirement)

```
MBR per chunk = 2500 + 400 × (key_length + 32 + chunk_size) microAlgos
             ≈ 2500 + 400 × (20 + 32 + 1500)
             ≈ 623,300 microAlgos
             ≈ 0.62 ALGO per chunk
```

### Example Costs

| File Size | Chunks | MBR Locked | Refundable? |
|-----------|--------|------------|-------------|
| 15 KB | 10 | ~6.2 ALGO | Yes, on delete |
| 150 KB | 100 | ~62 ALGO | Yes, on delete |
| 1.5 MB | 1000 | ~620 ALGO | Yes, on delete |

**Note:** MBR is locked, not spent. You get it back when you delete files.

### Transaction Fees

- **Upload**: 0.002 ALGO per chunk (payment + app call)
- **Delete**: 0.002 ALGO per chunk (covers inner refund txn)

---

## Technical Details

### Manifest Structure

```json
{
  "version": "1.0",
  "files": [
    {
      "name": "index.html",
      "chunks": 45,
      "size": 67500,
      "isBase64": false,
      "mimeType": "text/html"
    },
    {
      "name": "logo.png",
      "chunks": 12,
      "size": 18000,
      "isBase64": true,
      "mimeType": "image/png"
    }
  ],
  "totalChunks": 57,
  "uploadedAt": "2024-01-15T10:30:00.000Z"
}
```

### Entity ID Format

```
app:manifest        → File manifest (JSON)
app:<basename>:<n>  → File chunk n
```

Examples:
- `app:manifest` → manifest JSON
- `app:index:0` → first chunk of index.html
- `app:index:44` → 45th chunk of index.html
- `app:logo:0` → first chunk of logo.png (base64)

### Box Key Format

All entities stored with `e:` prefix:
```
e:app:manifest
e:app:index:0
e:app:logo:0
```

---

## Bootstrap Loading

Files uploaded via Eternal Storage can be loaded by `bootstrap.html`:

1. User opens `bootstrap.html`
2. Bootstrap reads `app:manifest` from blockchain
3. For each file, reconstructs from chunks
4. Injects CSS/JS inline into HTML
5. Replaces document with loaded app

**Result:** Entire web app served from blockchain with zero servers!

---

## Limitations

| Limitation | Details |
|------------|---------|
| Chunk size | 1,500 bytes (Algorand app args limit) |
| Box size | 32 KB max per box |
| Key length | 64 bytes max |
| Single owner | Files owned by uploading wallet |
| Public data | Box contents publicly readable |

### For Sensitive Data

Encrypt files client-side before uploading if privacy is needed.

---

## API Reference

### Upload Flow

```javascript
// 1. Analyze file into chunks
const chunks = Math.ceil(content.length / 1500);

// 2. For each chunk, create entity
for (let i = 0; i < chunks; i++) {
  const chunk = content.slice(i * 1500, (i + 1) * 1500);
  await createEntity(`app:${baseName}:${i}`, chunk);
}

// 3. Save/update manifest
await createEntity('app:manifest', JSON.stringify(manifest));
```

### Load Flow

```javascript
// 1. Load manifest
const manifest = JSON.parse(await loadEntity('app:manifest'));

// 2. For each file, reconstruct from chunks
for (const file of manifest.files) {
  let content = '';
  for (let i = 0; i < file.chunks; i++) {
    content += await loadEntity(`app:${baseName}:${i}`);
  }
  // content is now the full file
}
```

---

## Use Cases

| Use Case | Description |
|----------|-------------|
| **Decentralized Hosting** | Host web apps entirely on blockchain |
| **Permanent Archives** | Store documents that must never disappear |
| **NFT Metadata** | Store images/metadata on-chain (not just URLs) |
| **Backup** | Immutable backup of critical files |
| **Censorship Resistance** | Content that can't be taken down |

---

## Related Files

| File | Purpose |
|------|---------|
| `eternal-storage.html` | Upload, browse, and manage files |
| `bootstrap.html` | Load and run apps from blockchain |

---

*Part of the Universal State Machine Framework — Where data lives forever.*
