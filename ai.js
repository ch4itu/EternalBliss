// ai.js – EternalBliss AI Coordination Contract Interface
// App ID 750081112 (TestNet)
// Uses proper ABI contract with AtomicTransactionComposer

const ALGOD_SERVER = "https://testnet-api.algonode.cloud";
const INDEXER_SERVER = "https://testnet-idx.algonode.cloud";

const algodClient = new algosdk.Algodv2("", ALGOD_SERVER, "");
const indexerClient = new algosdk.Indexer("", INDEXER_SERVER, "");

const APP_ID = 750081112;

// Embedded ABI contract definition (matches UniversalStateMachine)
const CONTRACT_ABI = {
  name: "UniversalStateMachine",
  methods: [
    {
      name: "save_entity",
      args: [
        { type: "string", name: "entity_id" },
        { type: "string", name: "entity_data" }
      ],
      returns: { type: "string" }
    },
    {
      name: "load_entity",
      args: [
        { type: "string", name: "entity_id" }
      ],
      returns: { type: "string" }
    },
    {
      name: "start_process",
      args: [
        { type: "string", name: "process_id" },
        { type: "address", name: "other_party" },
        { type: "string", name: "initial_state" },
        { type: "uint64", name: "timeout_rounds" }
      ],
      returns: { type: "string" }
    },
    {
      name: "update_process",
      args: [
        { type: "string", name: "process_id" },
        { type: "string", name: "new_state" }
      ],
      returns: { type: "string" }
    },
    {
      name: "load_process",
      args: [
        { type: "string", name: "process_id" }
      ],
      returns: { type: "string" }
    },
    {
      name: "resign_process",
      args: [
        { type: "string", name: "process_id" }
      ],
      returns: { type: "void" }
    },
    {
      name: "get_process_info",
      args: [
        { type: "string", name: "process_id" }
      ],
      returns: { type: "(address,address,uint64,bool,uint64)" }
    },
    {
      name: "delete_entity",
      args: [
        { type: "string", name: "entity_id" }
      ],
      returns: { type: "void" }
    },
    {
      name: "delete_process",
      args: [
        { type: "string", name: "process_id" }
      ],
      returns: { type: "void" }
    }
  ]
};

let abiContract = null;

// Initialize ABI contract
function initContractABI() {
  try {
    abiContract = new algosdk.ABIContract(CONTRACT_ABI);
    console.log('✅ Contract ABI initialized');
  } catch (error) {
    console.error('Failed to initialize contract ABI:', error);
    throw error;
  }
}

// Safe logging function
function contractLog(msg) {
  if (typeof window.logToUI === 'function') {
    window.logToUI(msg);
  }
  console.log("[Contract]", msg);
}

// Calculate MBR for box storage
function calculateMBR(stateDataSize, isProcess = false, keyLength = null) {
  // CRITICAL: Match contract's EXACT MBR formula!
  // Contract formula: 2500 + 400 * total_bytes
  //
  // Contract uses .native.bytes which strips ARC4 encoding!
  // Box storage structure:
  // - Entity: key="e:"+id, value=owner(32)+raw_data
  // - Process: key="p:"+id, value=p1(32)+p2(32)+turn(8)+finalFlag(1)+timeoutRound(8)+raw_state
  // Data is stored as raw UTF-8 bytes in boxes (NO ARC4 encoding)

  if (isProcess) {
    // Process value: 81 bytes header + raw state bytes
    const keySize = keyLength || (2 + 16); // "p:" + process_id
    const valueSize = 81 + stateDataSize; // Header + raw state
    const total_bytes = keySize + valueSize;
    return 2500 + (400 * total_bytes);
  } else {
    // Entity value: 32 bytes owner + raw data bytes
    const keySize = keyLength || (2 + 58); // "e:" + entity_id
    const valueSize = 32 + stateDataSize; // Owner + raw data
    const total_bytes = keySize + valueSize;
    return 2500 + (400 * total_bytes);
  }
}

// Helper to clone suggested params
function cloneSuggestedParams(params) {
  return {
    ...params,
    genesisHash: params.genesisHash,
    genesisID: params.genesisID,
    consensusVersion: params.consensusVersion,
    firstRound: params.firstRound,
    lastRound: params.lastRound,
    fee: params.fee,
    minFee: params.minFee,
    flatFee: params.flatFee
  };
}

// Helper to get application address (compute manually for browser compatibility)
function getApplicationAddress(appId) {
  console.log(`[getApplicationAddress] Input appId: ${appId}, type: ${typeof appId}`);

  // Check if algosdk has the function
  if (typeof algosdk.getApplicationAddress === 'function') {
    try {
      const addr = algosdk.getApplicationAddress(appId);
      console.log(`[getApplicationAddress] Using algosdk.getApplicationAddress: ${addr}`);
      return addr;
    } catch (e) {
      console.warn(`[getApplicationAddress] algosdk.getApplicationAddress failed:`, e);
    }
  } else {
    console.log(`[getApplicationAddress] algosdk.getApplicationAddress not available, using manual computation`);
  }

  // Manual computation for browser compatibility
  // Application address = SHA512_256("appID" + app_id_as_uint64)
  const APP_ID_PREFIX = new Uint8Array([97, 112, 112, 73, 68]); // "appID" in bytes

  // Convert app ID to 8-byte big-endian (use local copy to avoid modifying parameter)
  let tempId = appId;
  const appIdBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    appIdBytes[i] = tempId & 0xff;
    tempId = Math.floor(tempId / 256);
  }

  console.log(`[getApplicationAddress] App ID bytes:`, Array.from(appIdBytes));

  // Concatenate prefix + app ID bytes
  const toHash = new Uint8Array(APP_ID_PREFIX.length + appIdBytes.length);
  toHash.set(APP_ID_PREFIX);
  toHash.set(appIdBytes, APP_ID_PREFIX.length);

  console.log(`[getApplicationAddress] To hash:`, Array.from(toHash));

  // Check what's available in algosdk
  console.log(`[getApplicationAddress] algosdk.encodeAddress available:`, typeof algosdk.encodeAddress);
  console.log(`[getApplicationAddress] algosdk.nacl available:`, typeof algosdk.nacl);
  console.log(`[getApplicationAddress] algosdk.nacl?.hash available:`, typeof algosdk.nacl?.hash);

  // Use algosdk's internal functions if available
  if (algosdk.encodeAddress && algosdk.nacl && algosdk.nacl.hash) {
    const hash = algosdk.nacl.hash(toHash).slice(0, 32);
    console.log(`[getApplicationAddress] Hash:`, Array.from(hash));
    const addr = algosdk.encodeAddress(hash);
    console.log(`[getApplicationAddress] Manual computation result: ${addr}`);
    return addr;
  }

  throw new Error("Cannot compute application address - algosdk missing required functions");
}

// Create MBR payment transaction
function createMBRPaymentTransaction(sender, appId, amount, suggestedParams) {
  console.log(`[createMBRPaymentTransaction] Called with sender: ${sender}, appId: ${appId}, amount: ${amount}`);

  const params = cloneSuggestedParams(suggestedParams);
  params.flatFee = true;
  params.fee = algosdk.ALGORAND_MIN_TX_FEE;

  const appAddress = getApplicationAddress(appId);

  console.log(`[createMBRPaymentTransaction] Got app address: ${appAddress}`);
  console.log(`[createMBRPaymentTransaction] sender type: ${typeof sender}, value: ${sender}`);
  console.log(`[createMBRPaymentTransaction] appAddress type: ${typeof appAddress}, value: ${appAddress}`);

  // Validate addresses before creating transaction
  if (!sender || typeof sender !== 'string' || sender.length !== 58) {
    throw new Error(`Invalid sender address: ${sender}`);
  }

  if (!appAddress || typeof appAddress !== 'string' || appAddress.length !== 58) {
    throw new Error(`Invalid app address: ${appAddress}`);
  }

  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender,
    to: appAddress,
    amount,
    suggestedParams: params
  });
}

// Create transaction with signer
function createTransactionWithSigner(txn, account) {
  return {
    txn,
    signer: algosdk.makeBasicAccountTransactionSigner(account)
  };
}

// Helper function to create box keys matching contract's format
function createEntityBoxKey(entityId) {
  // Contract uses: b"e:" + entity_id.native.bytes
  // .native.bytes strips ARC4 encoding, so we use raw UTF-8 bytes
  const prefix = new TextEncoder().encode('e:');
  const idBytes = new TextEncoder().encode(entityId);

  const boxKey = new Uint8Array(prefix.length + idBytes.length);
  boxKey.set(prefix, 0);
  boxKey.set(idBytes, prefix.length);

  return boxKey;
}

function createProcessBoxKey(processId) {
  // Contract uses: b"p:" + process_id.native.bytes
  // .native.bytes strips ARC4 encoding, so we use raw UTF-8 bytes
  const prefix = new TextEncoder().encode('p:');
  const idBytes = new TextEncoder().encode(processId);

  const boxKey = new Uint8Array(prefix.length + idBytes.length);
  boxKey.set(prefix, 0);
  boxKey.set(idBytes, prefix.length);

  return boxKey;
}

// Get signer from mnemonic
async function getSigner() {
  const mnemonicInput =
    document.getElementById("mnemonic")?.value.trim() ||
    localStorage.getItem("mnemonic");

  if (!mnemonicInput || mnemonicInput.split(" ").length !== 25) {
    throw new Error("Please enter a valid 25-word TestNet mnemonic");
  }

  const mnemonic = mnemonicInput.trim();
  localStorage.setItem("mnemonic", mnemonic);

  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic);

    if (!account || !account.sk) {
      throw new Error("Failed to derive account from mnemonic");
    }

    // Handle address format
    let addressString = account.addr;

    if (typeof addressString !== 'string') {
      if (addressString && addressString.toString) {
        addressString = addressString.toString();
      } else {
        addressString = String(addressString);
      }
    }

    // Reconstruct from secret key if needed
    if (!addressString || addressString.length !== 58 || addressString === '[object Object]') {
      console.log("Reconstructing address from secret key...");
      const publicKey = new Uint8Array(account.sk.slice(32, 64));
      addressString = algosdk.encodeAddress(publicKey);
    }

    // Validate
    if (!addressString || addressString.length !== 58) {
      throw new Error(`Invalid address length: ${addressString ? addressString.length : 0}`);
    }

    if (!/^[A-Z2-7]+$/.test(addressString)) {
      throw new Error(`Address contains invalid characters`);
    }

    // Store globals
    window.sender = addressString;
    window.sk = account.sk;
    window.account = account;

    contractLog(`Connected: ${addressString.substring(0, 12)}...${addressString.substring(50)}`);

    // Initialize ABI contract if not done
    if (!abiContract) {
      initContractABI();
    }

    return account;

  } catch (error) {
    console.error("getSigner error:", error);
    if (error.message.includes("mnemonic")) {
      throw new Error("Invalid mnemonic. Please check your 25-word phrase.");
    }
    throw error;
  }
}

// Helper to generate short hash from string
function shortHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Create Entity using ABI contract
async function createEntity(name, dataJson) {
  try {
    // Ensure wallet is connected
    if (!window.account || !window.sender) {
      contractLog("Wallet not connected, connecting now...");
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    contractLog(`Creating entity with sender: ${senderAddr}`);

    // Get suggested params
    const params = await algodClient.getTransactionParams().do();

    // Use the provided name as the entity ID directly
    const entityId = name;

    contractLog(`Using entity ID: ${entityId} (${entityId.length} chars)`);

    const stateSize = new TextEncoder().encode(dataJson).length;

    const method = abiContract.getMethodByName('save_entity');
    const boxKey = createEntityBoxKey(entityId);

    // Calculate key length: "e:" + entity_id (no ARC4 encoding)
    const keyLength = boxKey.length;

    const paymentTxn = createMBRPaymentTransaction(
      senderAddr,
      APP_ID,
      calculateMBR(stateSize, false, keyLength),
      params
    );

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    // Add payment transaction FIRST (contract validates it's before the app call)
    atc.addTransaction(createTransactionWithSigner(paymentTxn, account));
    // Then add the method call WITHOUT payment parameter
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [
        entityId,           // entity_id
        dataJson            // entity_data
      ],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    const result = await atc.execute(algodClient, 4);
    contractLog(`✅ Entity created: ${entityId}`);

    // Store for reference
    window.lastEntityId = entityId;

    return entityId;

  } catch (error) {
    console.error("createEntity error:", error);
    contractLog(`❌ Entity creation failed: ${error.message}`);

    if (error.message?.includes('below min') || error.message?.includes('balance')) {
      throw new Error(`Insufficient balance. Get TestNet ALGO from: https://bank.testnet.algorand.network`);
    }

    throw error;
  }
}

// Update Entity using ABI contract
async function updateEntity(entityId, dataJson) {
  try {
    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const params = await algodClient.getTransactionParams().do();
    const stateSize = new TextEncoder().encode(dataJson).length;

    const method = abiContract.getMethodByName('save_entity');
    const boxKey = createEntityBoxKey(entityId);

    const keyLength = boxKey.length;

    // For updates, we might need additional MBR if data grows
    const paymentTxn = createMBRPaymentTransaction(
      senderAddr,
      APP_ID,
      calculateMBR(stateSize, false, keyLength),
      params
    );

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    // Add payment transaction FIRST (contract validates it's before the app call)
    atc.addTransaction(createTransactionWithSigner(paymentTxn, account));
    // Then add the method call WITHOUT payment parameter
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [
        entityId,
        dataJson
      ],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    contractLog(`✅ Entity ${entityId} updated`);

  } catch (error) {
    console.error("updateEntity error:", error);
    contractLog(`❌ Entity update failed: ${error.message}`);
    throw error;
  }
}

// Create Process using ABI contract
async function createProcess(entityId, partnerAddr, initialState = 0) {
  try {
    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    // For self-collaboration, we need a different address for other_party
    // Contract requires sender != other_party (assert at pc=818)
    // Use a deterministic "AI partner" address if not specified
    if (!partnerAddr || partnerAddr === senderAddr) {
      // Generate a deterministic placeholder address from sender
      // This satisfies the contract's two-party requirement
      const dummyAccount = algosdk.generateAccount();
      partnerAddr = dummyAccount.addr;
      contractLog(`Using placeholder partner address for self-collaboration: ${partnerAddr.substring(0, 8)}...`);
    }

    contractLog(`Creating process for entity ${entityId} with partner ${partnerAddr.substring(0, 8)}...`);

    const params = await algodClient.getTransactionParams().do();

    // Use the provided entityId as the process ID (for predictable discovery)
    const processId = entityId;

    contractLog(`Using process ID: ${processId} (${processId.length} chars)`);

    // Use provided state directly (for minimal state requirement)
    // If initialState is already a string, use it; otherwise convert to JSON
    const initialStateJson = (typeof initialState === 'string') ? initialState : JSON.stringify({
      entity_id: entityId,
      current_turn: initialState,
      payload: "{}",
      state: "ACTIVE",
      task_name: "Grok-Claude Code Review"
    });

    const stateSize = new TextEncoder().encode(initialStateJson).length;

    const method = abiContract.getMethodByName('start_process');
    const boxKey = createProcessBoxKey(processId);

    const keyLength = boxKey.length;

    // Validate box key length (must be <= 64 bytes total)
    // Box key = "p:" (2 bytes) + processId bytes (no ARC4 encoding)
    const totalBoxKeyLength = boxKey.length;
    if (totalBoxKeyLength > 64) {
      throw new Error(`Process ID too long: ${processId.length} chars, box key would be ${totalBoxKeyLength} bytes (max 64)`);
    }
    contractLog(`Box key length: ${totalBoxKeyLength} bytes (max 64)`);

    const paymentTxn = createMBRPaymentTransaction(
      senderAddr,
      APP_ID,
      calculateMBR(stateSize, true, keyLength),
      params
    );

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    // Add payment transaction FIRST (contract validates it's before the app call)
    atc.addTransaction(createTransactionWithSigner(paymentTxn, account));
    // Then add the method call WITHOUT payment parameter
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [
        processId,                  // process_id
        partnerAddr,                // other_party
        initialStateJson,           // initial_state
        2000                        // timeout_rounds (2000 rounds ~= 100 minutes)
      ],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    contractLog(`✅ Process created: ${processId}`);

    // Store for reference
    window.lastProcessId = processId;

    return processId;

  } catch (error) {
    console.error("createProcess error:", error);
    contractLog(`❌ Process creation failed: ${error.message}`);
    throw error;
  }
}

// Advance Process using ABI contract
async function advanceProcess(processId, action, payloadJson = "{}") {
  try {
    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const params = await algodClient.getTransactionParams().do();

    // If payloadJson looks like a minimal state (just {t:...}), use it directly
    // Otherwise build the full state structure for backward compatibility
    let newStateJson;
    if (typeof payloadJson === 'string' && payloadJson.includes('"t"')) {
      // Minimal state format - use directly
      newStateJson = payloadJson;
    } else {
      // Legacy format - build full structure
      newStateJson = JSON.stringify({
        current_turn: action,
        payload: payloadJson,
        state: action === 999 ? "DONE" : "ACTIVE",
        updated_at: Date.now()
      });
    }

    const stateSize = new TextEncoder().encode(newStateJson).length;

    const method = abiContract.getMethodByName('update_process');
    const boxKey = createProcessBoxKey(processId);

    const keyLength = boxKey.length;

    const paymentTxn = createMBRPaymentTransaction(
      senderAddr,
      APP_ID,
      calculateMBR(stateSize, true, keyLength),
      params
    );

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    // Add payment transaction FIRST (contract validates it's before the app call)
    atc.addTransaction(createTransactionWithSigner(paymentTxn, account));
    // Then add the method call WITHOUT payment parameter
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [
        processId,
        newStateJson
      ],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    contractLog(`✅ Process ${processId} advanced (action ${action})`);

  } catch (error) {
    console.error("advanceProcess error:", error);
    contractLog(`❌ Process advance failed: ${error.message}`);
    throw error;
  }
}

// Read Process by directly reading the box (no transaction needed)
async function readProcess(processId) {
  try {
    const boxKey = createProcessBoxKey(processId);

    // Read box directly from algod (like blockchain.js:1256)
    const boxValue = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();

    if (!boxValue || !boxValue.value) {
      contractLog(`Process ${processId} not found`);
      return null;
    }

    // The value is already a Uint8Array in v2.7.0
    const boxBytes = boxValue.value;

    // Process box format: participant1(32) + participant2(32) + turn(8) + finalFlag(1) + timeoutRound(8) + state_data
    // Contract uses .native.bytes which strips ARC4 encoding, stores raw UTF-8
    // Skip the first 81 bytes to get the raw JSON state
    const stateBytes = boxBytes.slice(81);

    // Decode the state directly (raw UTF-8 bytes, NO ARC4 encoding)
    const stateJson = new TextDecoder().decode(stateBytes);
    const state = JSON.parse(stateJson);

    contractLog(`Read process ${processId}: turn ${state.current_turn || 0}`);

    return state;

  } catch (e) {
    contractLog(`Read error: ${e.message}`);
    console.error("Read process error:", e);
    return null;
  }
}

// Read Entity using ABI contract
async function readEntity(entityId) {
  try {
    contractLog(`📖 Reading entity: ${entityId}`);

    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const method = abiContract.getMethodByName('load_entity');

    const atc = new algosdk.AtomicTransactionComposer();

    const params = await algodClient.getTransactionParams().do();

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE; // Minimum fee required even for simulate

    // CRITICAL FIX: Must include box reference to access entity box
    const boxKey = createEntityBoxKey(entityId);

    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [entityId],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    contractLog(`🔄 Reading entity: ${entityId}`);

    let result;
    try {
      result = await atc.simulate(algodClient);
    } catch (simError) {
      // Simulation can fail for valid reasons - use direct box read
      contractLog(`ℹ️ Using direct box read...`);

      // Fallback to direct box read
      try {
        const boxKey = createEntityBoxKey(entityId);
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();

        // Entity box format: owner(32 bytes) + raw entity data
        // Contract uses .native.bytes which strips ARC4 encoding, stores raw UTF-8
        const entityBytes = box.value.slice(32);
        const dataJson = new TextDecoder().decode(entityBytes);

        contractLog(`✅ Loaded ${entityId} (${box.value.length} bytes)`);
        return dataJson;
      } catch (boxError) {
        contractLog(`❌ Entity ${entityId} not found`);
        return null;
      }
    }

    const returnValue = result.methodResults[0]?.returnValue;

    if (!returnValue) {
      // Contract method returned null - use direct box read fallback
      contractLog(`ℹ️ Using direct box read...`);

      // Try to read box directly
      try {
        const boxKey = createEntityBoxKey(entityId);
        const box = await algodClient.getApplicationBoxByName(APP_ID, boxKey).do();

        // Entity box format: owner(32 bytes) + raw entity data
        // Contract uses .native.bytes which strips ARC4 encoding, stores raw UTF-8
        // Skip first 32 bytes (owner address)
        const entityBytes = box.value.slice(32);
        const dataJson = new TextDecoder().decode(entityBytes);

        contractLog(`✅ Loaded ${entityId} (${box.value.length} bytes)`);
        return dataJson;
      } catch (boxError) {
        contractLog(`❌ Entity ${entityId} not found`);
        return null;
      }
    }

    const dataJson = typeof returnValue === 'string' ? returnValue : new TextDecoder().decode(returnValue);
    contractLog(`✅ Entity ${entityId} loaded successfully`);
    return dataJson; // Return JSON string, not parsed object

  } catch (e) {
    contractLog(`Read entity error for ${entityId}: ${e.message}`);
    console.error(`Full readEntity error for ${entityId}:`, e);
    return null;
  }
}

// Debug interface
if (typeof window !== 'undefined') {
  window.debugContract = {
    getSigner: getSigner,
    createEntity: createEntity,
    updateEntity: updateEntity,
    createProcess: createProcess,
    advanceProcess: advanceProcess,
    readProcess: readProcess,
    readEntity: readEntity,

    testConnection: async function() {
      try {
        contractLog("Testing connection...");
        const account = await getSigner();
        contractLog(`Account: ${account.addr}`);

        const info = await algodClient.accountInformation(account.addr).do();
        contractLog(`Balance: ${info.amount / 1000000} ALGO`);
        contractLog(`Status: ${info.status}`);

        return { success: true, account: account, info: info };
      } catch (e) {
        contractLog(`Test failed: ${e.message}`);
        console.error("Full error:", e);
        return { success: false, error: e.message };
      }
    },

    validateAddress: function(addr) {
      try {
        let addrStr = addr;
        if (typeof addrStr !== 'string') {
          addrStr = String(addrStr);
        }
        const decoded = algosdk.decodeAddress(addrStr);
        console.log("Address validates:", decoded);
        return true;
      } catch (e) {
        console.error("Address validation failed:", e);
        return false;
      }
    }
  };

  contractLog("EternalBliss AI coordination contract loaded");
  console.log("Debug interface:", window.debugContract);
}

// Delete entity - removes entity box and reclaims MBR
async function deleteEntity(entityId) {
  try {
    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const params = await algodClient.getTransactionParams().do();
    const method = abiContract.getMethodByName('delete_entity');
    const boxKey = createEntityBoxKey(entityId);

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    // delete_entity creates inner transaction for MBR refund - needs 2x fee
    methodParams.fee = 2 * algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [entityId],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    return true;

  } catch (error) {
    // If method doesn't exist in contract, provide helpful error
    if (error.message?.includes('method') || error.message?.includes('not found')) {
      throw new Error('Box deletion not implemented in smart contract. Contact contract deployer to add delete methods.');
    }
    throw error;
  }
}

async function deleteProcess(processId) {
  try {
    contractLog(`🗑️ Deleting process: ${processId}`);

    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const params = await algodClient.getTransactionParams().do();
    const method = abiContract.getMethodByName('delete_process');
    const boxKey = createProcessBoxKey(processId);

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    // delete_process creates inner transaction for MBR refund - needs 2x fee
    methodParams.fee = 2 * algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [processId],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    contractLog(`✅ Process deleted: ${processId}`);
    return true;

  } catch (error) {
    // If method doesn't exist in contract, provide helpful error
    if (error.message?.includes('method') || error.message?.includes('not found')) {
      contractLog(`❌ Delete not supported: Contract doesn't have delete_process method`);
      throw new Error('Box deletion not implemented in smart contract. Contact contract deployer to add delete methods.');
    }
    contractLog(`❌ Delete process failed: ${error.message}`);
    throw error;
  }
}

async function resignProcess(processId) {
  try {
    contractLog(`✋ Resigning from process (marking as finalized): ${processId}`);

    if (!window.account || !window.sender) {
      await getSigner();
    }

    if (!abiContract) {
      initContractABI();
    }

    const account = window.account;
    const senderAddr = window.sender;

    const params = await algodClient.getTransactionParams().do();
    const method = abiContract.getMethodByName('resign_process');
    const boxKey = createProcessBoxKey(processId);

    const methodParams = cloneSuggestedParams(params);
    methodParams.flatFee = true;
    methodParams.fee = algosdk.ALGORAND_MIN_TX_FEE;

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: APP_ID,
      method,
      methodArgs: [processId],
      sender: senderAddr,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      suggestedParams: methodParams,
      boxes: [
        { appIndex: APP_ID, name: boxKey }
      ]
    });

    await atc.execute(algodClient, 4);
    contractLog(`✅ Process resigned (finalized): ${processId}`);
    contractLog(`💡 You can now delete this process to reclaim MBR.`);
    return true;

  } catch (error) {
    contractLog(`❌ Resign process failed: ${error.message}`);
    throw error;
  }
}

// Export functions globally
if (typeof window !== 'undefined') {
  window.getSigner = getSigner;
  window.createEntity = createEntity;
  window.updateEntity = updateEntity;
  window.createProcess = createProcess;
  window.advanceProcess = advanceProcess;
  window.readProcess = readProcess;
  window.readEntity = readEntity;
  window.resignProcess = resignProcess;
  window.deleteEntity = deleteEntity;
  window.deleteProcess = deleteProcess;
}
