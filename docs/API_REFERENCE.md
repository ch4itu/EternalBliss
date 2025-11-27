# Universal State Machine - API Reference

Complete reference documentation for all smart contract methods.

---

## Contract Information

| Property | Value |
|----------|-------|
| **Name** | UniversalStateMachine |
| **Version** | v3.2 |
| **App ID (TestNet)** | 750081112 |
| **Language** | Algorand Python (AlgoPy) |
| **Standard** | ARC-4 ABI |
| **Approval Size** | 1,632 bytes |
| **Clear Size** | 4 bytes |

---

## ABI Contract Definition

```javascript
const CONTRACT_ABI = {
    name: "UniversalStateMachine",
    methods: [
        // Entity Methods
        { name: "save_entity", args: [{ type: "string", name: "entity_id" }, { type: "string", name: "entity_data" }], returns: { type: "string" } },
        { name: "load_entity", args: [{ type: "string", name: "entity_id" }], returns: { type: "string" } },
        { name: "delete_entity", args: [{ type: "string", name: "entity_id" }], returns: { type: "void" } },

        // Process Methods
        { name: "start_process", args: [{ type: "string", name: "process_id" }, { type: "address", name: "other_party" }, { type: "string", name: "initial_state" }, { type: "uint64", name: "timeout_rounds" }], returns: { type: "string" } },
        { name: "update_process", args: [{ type: "string", name: "process_id" }, { type: "string", name: "new_state" }], returns: { type: "string" } },
        { name: "load_process", args: [{ type: "string", name: "process_id" }], returns: { type: "string" } },
        { name: "resign_process", args: [{ type: "string", name: "process_id" }], returns: { type: "void" } },
        { name: "get_process_info", args: [{ type: "string", name: "process_id" }], returns: { type: "(address,address,uint64,bool,uint64)" } },
        { name: "delete_process", args: [{ type: "string", name: "process_id" }], returns: { type: "void" } },

        // Admin Methods
        { name: "admin_delete_entity", args: [{ type: "string", name: "entity_id" }], returns: { type: "void" } },
        { name: "admin_delete_process", args: [{ type: "string", name: "process_id" }], returns: { type: "void" } }
    ]
};
```

---

## Entity Methods

### save_entity

Creates or updates an entity (single-owner data storage).

#### Signature

```python
@arc4.abimethod
def save_entity(entity_id: arc4.String, entity_data: arc4.String) -> arc4.String
```

#### Parameters

| Parameter | Type | Description | Constraints |
|-----------|------|-------------|-------------|
| `entity_id` | string | Unique identifier for the entity | Max 62 bytes |
| `entity_data` | string | JSON data to store | Max 32,000 bytes |

#### Returns

| Type | Description |
|------|-------------|
| string | The entity_id (echo back) |

#### Required Transactions

Must be called as part of an atomic group with a preceding payment transaction:

```javascript
// 1. Payment transaction (MBR)
const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender,
    to: algosdk.getApplicationAddress(APP_ID),
    amount: mbrAmount,  // See MBR calculation
    suggestedParams: params
});

// 2. Application call
atc.addMethodCall({
    appID: APP_ID,
    method: abiContract.getMethodByName('save_entity'),
    methodArgs: [entity_id, entity_data],
    boxes: [{ appIndex: APP_ID, name: boxKey }],
    ...
});
```

#### MBR Calculation

```javascript
// New entity
const keyLength = 2 + entityId.length;  // "e:" prefix
const valueLength = 32 + dataBytes.length;  // owner + data
const mbr = 2500 + (400 * (keyLength + valueLength));

// Update (only pay for growth)
const sizeDiff = Math.max(0, newValueSize - existingValueSize);
const mbr = sizeDiff * 400;
```

#### Box Storage Format

```
Key: "e:" + entity_id_bytes
Value: owner_address(32 bytes) + entity_data_bytes(N bytes)
```

#### Errors

| Error | Cause |
|-------|-------|
| `Entity ID too long (max 62 bytes)` | entity_id exceeds 62 bytes |
| `Entity data exceeds 32KB limit` | entity_data exceeds 32,000 bytes |
| `Only owner can update entity` | Caller is not the entity owner |
| `Insufficient MBR payment` | Payment transaction amount too low |
| `MBR payment transaction required` | No payment in transaction group |

#### Example

```javascript
async function saveEntity(account, entityId, data) {
    const params = await algodClient.getTransactionParams().do();
    const dataJson = JSON.stringify(data);
    const boxKey = new TextEncoder().encode(`e:${entityId}`);

    const mbrAmount = await calculateOptimalMBR(algodClient, APP_ID, boxKey, dataJson.length, false);

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: algosdk.getApplicationAddress(APP_ID),
        amount: mbrAmount,
        suggestedParams: params
    });

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addTransaction({ txn: paymentTxn, signer: algosdk.makeBasicAccountTransactionSigner(account) });
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('save_entity'),
        methodArgs: [entityId, dataJson],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

### load_entity

Retrieves entity data (read-only, no transaction required).

#### Signature

```python
@arc4.abimethod(readonly=True)
def load_entity(entity_id: arc4.String) -> arc4.String
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `entity_id` | string | The entity identifier to load |

#### Returns

| Type | Description |
|------|-------------|
| string | The stored JSON data (without owner bytes) |

#### Errors

| Error | Cause |
|-------|-------|
| `Entity does not exist` | No entity with this ID |

#### Example (Direct Box Read)

```javascript
// Preferred: Direct box read (no simulate call needed)
async function loadEntity(entityId) {
    const boxKey = new TextEncoder().encode(`e:${entityId}`);

    try {
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();
        const dataBytes = box.value.slice(32);  // Skip owner bytes
        return JSON.parse(new TextDecoder().decode(dataBytes));
    } catch (error) {
        if (error.message.includes('box not found')) {
            return null;
        }
        throw error;
    }
}
```

#### Example (ABI Simulate)

```javascript
// Alternative: Using ABI simulate
async function loadEntityViaABI(entityId) {
    const boxKey = new TextEncoder().encode(`e:${entityId}`);
    const atc = new algosdk.AtomicTransactionComposer();

    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('load_entity'),
        methodArgs: [entityId],
        sender: someAddress,
        signer: algosdk.makeEmptyTransactionSigner(),
        suggestedParams: await algodClient.getTransactionParams().do(),
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    const result = await atc.simulate(algodClient);
    return JSON.parse(result.methodResults[0].returnValue);
}
```

---

### delete_entity

Deletes an entity and refunds MBR to the caller.

#### Signature

```python
@arc4.abimethod
def delete_entity(entity_id: arc4.String) -> None
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `entity_id` | string | The entity identifier to delete |

#### Returns

None (void)

#### MBR Refund

Upon successful deletion, the contract sends an inner transaction refunding:
```
refund = 2500 + (400 * (key_length + value_length))
```

#### Errors

| Error | Cause |
|-------|-------|
| `Entity does not exist` | No entity with this ID |
| `Only owner can delete entity` | Caller is not the entity owner |

#### Example

```javascript
async function deleteEntity(account, entityId) {
    const params = await algodClient.getTransactionParams().do();
    const boxKey = new TextEncoder().encode(`e:${entityId}`);

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('delete_entity'),
        methodArgs: [entityId],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

## Process Methods

### start_process

Creates a new two-party process.

#### Signature

```python
@arc4.abimethod
def start_process(
    process_id: arc4.String,
    other_party: arc4.Address,
    initial_state: arc4.String,
    timeout_rounds: arc4.UInt64
) -> arc4.String
```

#### Parameters

| Parameter | Type | Description | Constraints |
|-----------|------|-------------|-------------|
| `process_id` | string | Unique process identifier | Max 62 bytes |
| `other_party` | address | The second participant's address | Valid 32-byte address |
| `initial_state` | string | Initial JSON state | Max 32,000 bytes |
| `timeout_rounds` | uint64 | Rounds until timeout (0 = no timeout) | ≥ 0 |

#### Returns

| Type | Description |
|------|-------------|
| string | The process_id (echo back) |

#### Box Storage Format

```
Key: "p:" + process_id_bytes

Value Layout (81 bytes header + state):
┌──────────────────────────────────────────────────────────────┐
│ Bytes 0-31   │ Participant 1 address (creator)               │
│ Bytes 32-63  │ Participant 2 address (other_party)           │
│ Bytes 64-71  │ Turn number (uint64, big-endian)              │
│ Byte 72      │ Finalization flag (0x00 = active, 0x01 = done)│
│ Bytes 73-80  │ Timeout round (uint64, big-endian, 0 = none)  │
│ Bytes 81+    │ JSON state data                               │
└──────────────────────────────────────────────────────────────┘
```

#### MBR Calculation

```javascript
const keyLength = 2 + processId.length;  // "p:" prefix
const valueLength = 81 + stateBytes.length;  // header + state
const mbr = 2500 + (400 * (keyLength + valueLength));
```

#### Errors

| Error | Cause |
|-------|-------|
| `Process ID too long` | process_id exceeds 62 bytes |
| `State exceeds limit` | initial_state exceeds 32,000 bytes |
| `Invalid address` | other_party is not 32 bytes |
| `Process already exists` | A process with this ID exists |
| `Insufficient MBR payment` | Payment amount too low |

#### Example

```javascript
async function startProcess(account, processId, otherParty, initialState, timeoutRounds = 1000) {
    const params = await algodClient.getTransactionParams().do();
    const stateJson = JSON.stringify(initialState);
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    const keyLength = boxKey.length;
    const valueLength = 81 + new TextEncoder().encode(stateJson).length;
    const mbrAmount = 2500 + (400 * (keyLength + valueLength));

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: algosdk.getApplicationAddress(APP_ID),
        amount: mbrAmount,
        suggestedParams: params
    });

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addTransaction({ txn: paymentTxn, signer: algosdk.makeBasicAccountTransactionSigner(account) });
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('start_process'),
        methodArgs: [processId, otherParty, stateJson, timeoutRounds],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

### update_process

Updates the state of an existing process.

#### Signature

```python
@arc4.abimethod
def update_process(process_id: arc4.String, new_state: arc4.String) -> arc4.String
```

#### Parameters

| Parameter | Type | Description | Constraints |
|-----------|------|-------------|-------------|
| `process_id` | string | The process to update | Must exist |
| `new_state` | string | New JSON state | Max 32,000 bytes |

#### Returns

| Type | Description |
|------|-------------|
| string | The process_id (echo back) |

#### Behavior

- Increments the turn counter
- Either participant can call (turn enforcement is application logic)
- Preserves header data (participants, finalization, timeout)
- Only charges MBR for size growth

#### Errors

| Error | Cause |
|-------|-------|
| `Process does not exist` | No process with this ID |
| `Caller is not a participant` | Sender is neither p1 nor p2 |
| `Cannot update finalized process` | Process has been resigned |
| `Process timed out` | Current round > timeout_round |
| `State exceeds limit` | new_state exceeds 32,000 bytes |

#### Example

```javascript
async function updateProcess(account, processId, newState) {
    const params = await algodClient.getTransactionParams().do();
    const stateJson = JSON.stringify(newState);
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    // Calculate optimal MBR (only pay for growth)
    const mbrAmount = await calculateOptimalMBR(algodClient, APP_ID, boxKey, stateJson.length, true);

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: algosdk.getApplicationAddress(APP_ID),
        amount: mbrAmount,
        suggestedParams: params
    });

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addTransaction({ txn: paymentTxn, signer: algosdk.makeBasicAccountTransactionSigner(account) });
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('update_process'),
        methodArgs: [processId, stateJson],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

### load_process

Retrieves process state data (read-only).

#### Signature

```python
@arc4.abimethod(readonly=True)
def load_process(process_id: arc4.String) -> arc4.String
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `process_id` | string | The process to load |

#### Returns

| Type | Description |
|------|-------------|
| string | The JSON state data (without header) |

#### Example (Direct Box Read)

```javascript
async function loadProcess(processId) {
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    try {
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();
        const stateBytes = box.value.slice(81);  // Skip 81-byte header
        return JSON.parse(new TextDecoder().decode(stateBytes));
    } catch (error) {
        if (error.message.includes('box not found')) {
            return null;
        }
        throw error;
    }
}
```

---

### get_process_info

Retrieves process metadata (participants, turn, status).

#### Signature

```python
@arc4.abimethod(readonly=True)
def get_process_info(process_id: arc4.String) -> arc4.Tuple[
    arc4.Address,  # participant1
    arc4.Address,  # participant2
    arc4.UInt64,   # turn_number
    arc4.Bool,     # is_finalized
    arc4.UInt64    # timeout_round
]
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `process_id` | string | The process to query |

#### Returns

| Index | Type | Description |
|-------|------|-------------|
| 0 | address | Participant 1 (creator) |
| 1 | address | Participant 2 (other party) |
| 2 | uint64 | Current turn number |
| 3 | bool | True if finalized |
| 4 | uint64 | Timeout round (0 = no timeout) |

#### Example (Direct Box Read)

```javascript
async function getProcessInfo(processId) {
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    try {
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();
        const value = box.value;

        return {
            participant1: algosdk.encodeAddress(value.slice(0, 32)),
            participant2: algosdk.encodeAddress(value.slice(32, 64)),
            turnNumber: readBigUint64BE(value, 64),
            isFinalized: value[72] !== 0,
            timeoutRound: readBigUint64BE(value, 73)
        };
    } catch (error) {
        if (error.message.includes('box not found')) {
            return null;
        }
        throw error;
    }
}

function readBigUint64BE(buffer, offset) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
    return view.getBigUint64(0, false);  // big-endian
}
```

---

### resign_process

Marks a process as finalized. Either participant can call this.

#### Signature

```python
@arc4.abimethod
def resign_process(process_id: arc4.String) -> None
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `process_id` | string | The process to finalize |

#### Behavior

- Sets the finalization flag to 0x01
- Prevents further updates
- Enables deletion by either party

#### Errors

| Error | Cause |
|-------|-------|
| `Process does not exist` | No process with this ID |
| `Caller is not a participant` | Sender is neither p1 nor p2 |
| `Process already finalized` | Already resigned |

#### Example

```javascript
async function resignProcess(account, processId) {
    const params = await algodClient.getTransactionParams().do();
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('resign_process'),
        methodArgs: [processId],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

### delete_process

Deletes a finalized or timed-out process, refunding MBR.

#### Signature

```python
@arc4.abimethod
def delete_process(process_id: arc4.String) -> None
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `process_id` | string | The process to delete |

#### Requirements

Process must be either:
- Finalized (resign_process was called), OR
- Timed out (current_round ≥ timeout_round)

#### Errors

| Error | Cause |
|-------|-------|
| `Process does not exist` | No process with this ID |
| `Caller is not a participant` | Sender is neither p1 nor p2 |
| `Can only delete finalized or timed out processes` | Process is still active |

#### Example

```javascript
async function deleteProcess(account, processId) {
    const params = await algodClient.getTransactionParams().do();
    const boxKey = new TextEncoder().encode(`p:${processId}`);

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
        appID: APP_ID,
        method: abiContract.getMethodByName('delete_process'),
        methodArgs: [processId],
        sender: account.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(account),
        suggestedParams: params,
        boxes: [{ appIndex: APP_ID, name: boxKey }]
    });

    return await atc.execute(algodClient, 4);
}
```

---

## Admin Methods

These methods are restricted to the contract creator (admin).

### admin_delete_entity

Force-deletes any entity, regardless of owner.

#### Signature

```python
@arc4.abimethod
def admin_delete_entity(entity_id: arc4.String) -> None
```

#### Restrictions

- Only callable by contract creator
- MBR refunded to admin (not original owner)

#### Errors

| Error | Cause |
|-------|-------|
| `Only admin can force delete` | Caller is not contract creator |
| `Entity does not exist` | No entity with this ID |

---

### admin_delete_process

Force-deletes any process, regardless of participants or state.

#### Signature

```python
@arc4.abimethod
def admin_delete_process(process_id: arc4.String) -> None
```

#### Restrictions

- Only callable by contract creator
- MBR refunded to admin
- Can delete active (non-finalized, non-timed-out) processes

#### Errors

| Error | Cause |
|-------|-------|
| `Only admin can force delete` | Caller is not contract creator |
| `Process does not exist` | No process with this ID |

---

## Box Key Reference

### Entity Box Keys

```
Format: "e:" + entity_id_utf8_bytes
Example: "e:ABC123...XYZ" (for address-based ID)
Max Key Length: 2 + 62 = 64 bytes
```

### Process Box Keys

```
Format: "p:" + process_id_utf8_bytes
Example: "p:battle-12345"
Max Key Length: 2 + 62 = 64 bytes
```

### Creating Box Keys in JavaScript

```javascript
function createEntityBoxKey(entityId) {
    const prefix = new TextEncoder().encode('e:');
    const idBytes = new TextEncoder().encode(entityId);
    const boxKey = new Uint8Array(prefix.length + idBytes.length);
    boxKey.set(prefix, 0);
    boxKey.set(idBytes, prefix.length);
    return boxKey;
}

function createProcessBoxKey(processId) {
    const prefix = new TextEncoder().encode('p:');
    const idBytes = new TextEncoder().encode(processId);
    const boxKey = new Uint8Array(prefix.length + idBytes.length);
    boxKey.set(prefix, 0);
    boxKey.set(idBytes, prefix.length);
    return boxKey;
}
```

---

## MBR Quick Reference

### Formulas

```javascript
// Base formula
MBR = 2500 + (400 * total_bytes)  // in microALGO

// Entity
total_bytes = key_length + 32 + data_length
key_length = 2 + entity_id.length

// Process
total_bytes = key_length + 81 + state_length
key_length = 2 + process_id.length

// Update (optimal)
mbr = Math.max(0, new_total - old_total) * 400
```

### Cost Examples

| Operation | Data Size | Approx. Cost |
|-----------|-----------|--------------|
| Entity (100 bytes) | ~192 bytes total | ~79,300 μALGO |
| Entity (1 KB) | ~1,092 bytes total | ~439,300 μALGO |
| Entity (10 KB) | ~10,092 bytes total | ~4,039,300 μALGO |
| Process (500 bytes) | ~601 bytes total | ~242,900 μALGO |
| Update (+10 bytes) | 10 bytes delta | ~4,000 μALGO |

---

## Timeout Reference

Algorand produces approximately 1 block every 3-4 seconds.

| Duration | Rounds (approx.) |
|----------|------------------|
| 5 minutes | 100 |
| 30 minutes | 600 |
| 1 hour | 1,200 |
| 6 hours | 7,200 |
| 24 hours | 28,800 |
| 1 week | 201,600 |

---

## Error Codes Summary

| Error Message | Method(s) | Resolution |
|---------------|-----------|------------|
| `Entity ID too long (max 62 bytes)` | save_entity | Shorten entity_id |
| `Entity data exceeds 32KB limit` | save_entity | Reduce data size |
| `Only owner can update entity` | save_entity | Use owner's account |
| `Only owner can delete entity` | delete_entity | Use owner's account |
| `Entity does not exist` | load/delete_entity | Check entity_id |
| `Process ID too long` | start_process | Shorten process_id |
| `State exceeds limit` | start/update_process | Reduce state size |
| `Invalid address` | start_process | Verify address format |
| `Process already exists` | start_process | Use unique process_id |
| `Process does not exist` | all process methods | Check process_id |
| `Caller is not a participant` | update/resign/delete_process | Use participant account |
| `Cannot update finalized process` | update_process | Process is done |
| `Process already finalized` | resign_process | Already resigned |
| `Process timed out` | update_process | Process expired |
| `Can only delete finalized or timed out processes` | delete_process | Resign first or wait |
| `Insufficient MBR payment` | save_entity, start/update_process | Increase payment |
| `MBR payment transaction required` | save_entity, start/update_process | Add payment txn |
| `Only admin can force delete` | admin_* | Only creator allowed |

---

*Universal State Machine v3.2 - API Reference*
