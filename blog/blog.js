const APP_ID = 748592697;
let algodClient = null;
let abiContract = null;
let account = null;
let accountAddress = null;
let recentPostIds = [];

const CONTRACT_ABI = {
    name: "UniversalStateMachine",
    methods: [
        {
            name: "save_player",
            args: [
                { type: "string", name: "player_id" },
                { type: "string", name: "state_data" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_player",
            args: [
                { type: "string", name: "player_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_player_owner",
            args: [
                { type: "string", name: "player_id" }
            ],
            returns: { type: "address" }
        },
        {
            name: "start_battle",
            args: [
                { type: "string", name: "battle_id" },
                { type: "address", name: "opponent" },
                { type: "uint64", name: "deadline_rounds" },
                { type: "string", name: "initial_state" }
            ],
            returns: { type: "string" }
        },
        {
            name: "update_battle",
            args: [
                { type: "string", name: "battle_id" },
                { type: "string", name: "new_state" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_battle",
            args: [
                { type: "string", name: "battle_id" }
            ],
            returns: { type: "string" }
        },
        {
            name: "get_stats",
            args: [],
            returns: { type: "(uint64,uint64)" }
        },
        {
            name: "save_entity",
            args: [
                { type: "string", name: "entity_id" },
                { type: "string", name: "state_data" }
            ],
            returns: { type: "string" }
        },
        {
            name: "load_entity",
            args: [
                { type: "string", name: "entity_id" }
            ],
            returns: { type: "string" }
        }
    ]
};

function initializeAlgodClient() {
    if (typeof algosdk !== 'undefined') {
        algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
        
        try {
            abiContract = new algosdk.ABIContract(CONTRACT_ABI);
            return true;
        } catch (error) {
            console.error('Failed to initialize contract:', error);
            return false;
        }
    }
    return false;
}

function createPostBoxKey(postId) {
    const idBytes = new TextEncoder().encode(postId);
    const idLength = idBytes.length;

    const arc4Encoded = new Uint8Array(2 + idLength);
    arc4Encoded[0] = (idLength >> 8) & 0xFF;
    arc4Encoded[1] = idLength & 0xFF;
    arc4Encoded.set(idBytes, 2);

    const boxKey = new Uint8Array(2 + arc4Encoded.length);
    boxKey.set(new TextEncoder().encode('p:'), 0);
    boxKey.set(arc4Encoded, 2);

    return boxKey;
}

function showStatus(msg, type) {
    const el = document.getElementById('status');
    if (el) {
        el.textContent = msg;
        el.className = 'status ' + type;
        el.style.display = 'block';
        
        if (type === 'success') {
            setTimeout(() => {
                el.style.display = 'none';
            }, 5000);
        }
    }
}

window.connectWallet = async function() {
    if (!initializeAlgodClient()) {
        showStatus('Unable to initialize. Please refresh.', 'error');
        return;
    }
    
    const mnemonic = document.getElementById('mnemonic').value.trim();
    
    if (!mnemonic) {
        showStatus('Please enter your mnemonic', 'error');
        return;
    }
    
    try {
        const words = mnemonic.split(/\s+/);
        if (words.length !== 24 && words.length !== 25) {
            throw new Error('Mnemonic must be 24 or 25 words');
        }
        
        account = algosdk.mnemonicToSecretKey(mnemonic);
        
        if (account.addr && typeof account.addr === 'string') {
            accountAddress = account.addr;
        } else if (account.addr && account.addr.toString) {
            accountAddress = account.addr.toString();
        } else {
            accountAddress = algosdk.encodeAddress(account.addr.publicKey || account.addr);
        }
        
        const accountInfo = await algodClient.accountInformation(accountAddress).do();
        const balance = Number(accountInfo.amount) / 1000000;
        
        if (typeof accountAddress === 'string') {
            document.getElementById('address').textContent = `Connected: ${accountAddress.substring(0, 8)}...${accountAddress.substring(50)} (${balance.toFixed(2)} ALGO)`;
        } else {
            document.getElementById('address').textContent = `Connected (${balance.toFixed(2)} ALGO)`;
        }
        document.getElementById('walletInfo').style.display = 'block';
        
        document.getElementById('mnemonic').disabled = true;
        document.getElementById('connectBtn').disabled = true;
        
        showStatus('Connected successfully!', 'success');
        
        await loadStats();
        await loadRecentPosts();
        
    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
        console.error('Connect error:', error);
    }
}

window.loadStats = async function() {
    if (!algodClient) {
        if (!initializeAlgodClient()) return;
    }
    
    try {
        const appInfo = await algodClient.getApplicationByID(APP_ID).do();
        
        let totalPlayers = 0;
        let totalBattles = 0;
        
        if (appInfo.params && appInfo.params['global-state']) {
            appInfo.params['global-state'].forEach(state => {
                const key = atob(state.key);
                
                if (key === 'total_players') {
                    totalPlayers = state.value.uint || 0;
                } else if (key === 'total_battles') {
                    totalBattles = state.value.uint || 0;
                }
            });
        }
        
        document.getElementById('totalEntities').textContent = totalPlayers;
        document.getElementById('totalProcesses').textContent = totalBattles;
        
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

window.createPost = async function() {
    if (!account || !accountAddress) {
        showStatus('Please connect wallet first', 'error');
        return;
    }
    
    const title = document.getElementById('title').value.trim();
    const content = document.getElementById('content').value.trim();
    
    if (!title || !content) {
        showStatus('Please enter both title and content', 'error');
        return;
    }
    
    if (title.length > 200) {
        showStatus('Title too long (max 200 characters)', 'error');
        return;
    }
    
    document.getElementById('createBtn').disabled = true;
    showStatus('Publishing to blockchain...', 'info');
    
    try {
        const timestamp = Date.now();
        const postId = `post_${accountAddress.substring(0, 8)}_${timestamp}`;
        
        const postData = {
            id: postId,
            title: title,
            content: content,
            author: accountAddress,
            timestamp: new Date().toISOString(),
            type: 'blog_post'
        };
        
        const params = await algodClient.getTransactionParams().do();
        const method = abiContract.getMethodByName('save_player');
        const boxKey = createPostBoxKey(postId);
        
        const stateDataStr = JSON.stringify(postData);
        const boxValueSize = 40 + stateDataStr.length;
        const mbrCost = 2500 + 400 * (boxKey.length + boxValueSize);
        
        const accountInfo = await algodClient.accountInformation(accountAddress).do();
        const balance = Number(accountInfo.amount) / 1000000;
        
        if (balance < (mbrCost / 1000000 + 0.1)) {
            showStatus(`Insufficient balance. Need ${((mbrCost / 1000000) + 0.1).toFixed(3)} ALGO`, 'error');
            document.getElementById('createBtn').disabled = false;
            return;
        }
        
        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: accountAddress,
            receiver: algosdk.getApplicationAddress(APP_ID),
            amount: mbrCost,
            suggestedParams: params
        });
        
        const atc = new algosdk.AtomicTransactionComposer();
        
        atc.addTransaction({
            txn: paymentTxn,
            signer: algosdk.makeBasicAccountTransactionSigner(account)
        });
        
        atc.addMethodCall({
            appID: APP_ID,
            method: method,
            methodArgs: [
                postId,
                JSON.stringify(postData)
            ],
            sender: accountAddress,
            signer: algosdk.makeBasicAccountTransactionSigner(account),
            suggestedParams: params,
            boxes: [
                { appIndex: APP_ID, name: boxKey }
            ]
        });
        
        const result = await atc.execute(algodClient, 4);
        const txId = result.txIDs[0];
        
        showStatus(`Post published successfully!`, 'success');
        
        document.getElementById('title').value = '';
        document.getElementById('content').value = '';
        
        recentPostIds.unshift(postId);
        if (recentPostIds.length > 10) {
            recentPostIds = recentPostIds.slice(0, 10);
        }
        
        alert(`✓ Post Published\n\nYour post has been stored on the Algorand blockchain.\n\nTransaction: ${txId}`);
        
        await loadStats();
        await loadRecentPosts();
        
    } catch (error) {
        console.error('Create post error:', error);
        
        let errorMsg = 'Unknown error occurred';
        
        if (error.message) {
            if (error.message.includes('logic eval error')) {
                errorMsg = 'Transaction rejected by contract';
            } else if (error.message.includes('overspend')) {
                errorMsg = 'Insufficient funds';
            } else if (error.message.includes('below min')) {
                errorMsg = 'Account balance too low';
            } else {
                errorMsg = error.message;
            }
        }
        
        showStatus('Error: ' + errorMsg, 'error');
        
    } finally {
        document.getElementById('createBtn').disabled = false;
    }
}

window.loadRecentPosts = async function() {
    const postsDiv = document.getElementById('recentPosts');
    
    if (recentPostIds.length === 0) {
        postsDiv.innerHTML = '<div class="empty-state">No posts yet. Write your first post!</div>';
        return;
    }
    
    postsDiv.innerHTML = '<div class="empty-state">Loading posts...</div>';
    
    let html = '';
    
    for (const postId of recentPostIds.slice(0, 5)) {
        try {
            const method = abiContract.getMethodByName('load_player');
            const params = await algodClient.getTransactionParams().do();
            const boxKey = createPostBoxKey(postId);
            
            const atc = new algosdk.AtomicTransactionComposer();
            atc.addMethodCall({
                appID: APP_ID,
                method: method,
                methodArgs: [postId],
                sender: accountAddress,
                signer: algosdk.makeBasicAccountTransactionSigner(account),
                suggestedParams: params,
                boxes: [
                    { appIndex: APP_ID, name: boxKey }
                ]
            });
            
            const result = await atc.execute(algodClient, 4);
            
            if (result.methodResults && result.methodResults[0]) {
                const returnValue = result.methodResults[0].returnValue;
                const postData = JSON.parse(returnValue);
                
                const date = new Date(postData.timestamp);
                const formattedDate = date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
                
                html += `
                    <div class="post-item">
                        <div class="post-title">${postData.title || postId}</div>
                        <div class="post-meta">${formattedDate} · By ${postData.author ? postData.author.substring(0, 8) + '...' : 'Anonymous'}</div>
                        <div class="post-content">${postData.content || ''}</div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading post:', postId);
        }
    }
    
    if (html) {
        postsDiv.innerHTML = html;
    } else {
        postsDiv.innerHTML = '<div class="empty-state">Unable to load posts</div>';
    }
}

window.initApp = function() {
    if (typeof algosdk === 'undefined') {
        setTimeout(initApp, 100);
        return;
    }
    
    if (initializeAlgodClient()) {
        loadStats();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.addEventListener('load', () => {
    if (!algodClient) {
        initApp();
    }
});
