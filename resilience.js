/**
 * EternalBliss Resilience & Fault Tolerance Module
 * =================================================
 *
 * Provides robust error handling, retry logic, circuit breakers,
 * and failover capabilities for RPC calls and external dependencies.
 *
 * Features:
 * - Exponential backoff retry (2s, 4s, 8s, 16s)
 * - Configurable timeouts (default 30s)
 * - Multiple RPC endpoint failover
 * - Circuit breaker pattern
 * - Health monitoring
 * - Request deduplication
 *
 * @version 1.0.0
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const RESILIENCE_CONFIG = {
  // Retry configuration
  MAX_RETRIES: 4,
  RETRY_DELAYS: [2000, 4000, 8000, 16000], // milliseconds
  RETRY_STATUS_CODES: [408, 429, 500, 502, 503, 504],

  // Timeout configuration
  DEFAULT_TIMEOUT: 30000, // 30 seconds

  // Circuit breaker configuration
  CIRCUIT_BREAKER_THRESHOLD: 5, // failures before opening
  CIRCUIT_BREAKER_TIMEOUT: 60000, // 60s before retry
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD: 2, // successes to close

  // Health check configuration
  HEALTH_CHECK_INTERVAL: 30000, // 30s
  HEALTH_CHECK_TIMEOUT: 5000, // 5s

  // Request deduplication
  DEDUP_WINDOW: 1000, // 1s window for duplicate requests
};

// ============================================================================
// RPC ENDPOINT CONFIGURATION
// ============================================================================

const RPC_ENDPOINTS = {
  algod: [
    { url: 'https://testnet-api.algonode.cloud', priority: 1, name: 'AlgoNode Primary' },
    { url: 'https://testnet-api.4160.nodely.dev', priority: 2, name: 'Nodely' },
    { url: 'https://testnet-api.algonode.network', priority: 3, name: 'AlgoNode Network' },
  ],
  indexer: [
    { url: 'https://testnet-idx.algonode.cloud', priority: 1, name: 'AlgoNode Indexer Primary' },
    { url: 'https://testnet-idx.algonode.network', priority: 2, name: 'AlgoNode Indexer Network' },
  ]
};

// ============================================================================
// CIRCUIT BREAKER IMPLEMENTATION
// ============================================================================

class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.config = {
      threshold: config.threshold || RESILIENCE_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
      timeout: config.timeout || RESILIENCE_CONFIG.CIRCUIT_BREAKER_TIMEOUT,
      successThreshold: config.successThreshold || RESILIENCE_CONFIG.CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    };
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < this.config.timeout) {
        throw new Error(`Circuit breaker [${this.name}] is OPEN. Retry after ${Math.ceil((this.config.timeout - timeSinceFailure) / 1000)}s`);
      }
      // Transition to HALF_OPEN to test if service recovered
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      console.log(`🔄 Circuit breaker [${this.name}] transitioning to HALF_OPEN (testing recovery)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        console.log(`✅ Circuit breaker [${this.name}] CLOSED (service recovered)`);
      }
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.warn(`⚠️ Circuit breaker [${this.name}] reopened OPEN (service still failing)`);
    } else if (this.failureCount >= this.config.threshold) {
      this.state = 'OPEN';
      console.error(`🚫 Circuit breaker [${this.name}] tripped OPEN (${this.failureCount} failures)`);
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    console.log(`🔄 Circuit breaker [${this.name}] manually reset`);
  }
}

// ============================================================================
// ENDPOINT MANAGER WITH FAILOVER
// ============================================================================

class EndpointManager {
  constructor(type, endpoints) {
    this.type = type; // 'algod' or 'indexer'
    this.endpoints = endpoints.sort((a, b) => a.priority - b.priority);
    this.currentIndex = 0;
    this.circuitBreakers = new Map();

    // Create circuit breaker for each endpoint
    this.endpoints.forEach(ep => {
      this.circuitBreakers.set(ep.url, new CircuitBreaker(`${type}:${ep.name}`));
    });
  }

  getCurrentEndpoint() {
    return this.endpoints[this.currentIndex];
  }

  async executeWithFailover(fn) {
    let lastError = null;

    // Try all endpoints in order
    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const endpoint = this.endpoints[this.currentIndex];
      const breaker = this.circuitBreakers.get(endpoint.url);

      try {
        // Check circuit breaker state
        if (breaker.state === 'OPEN') {
          console.warn(`⚠️ Endpoint [${endpoint.name}] circuit breaker is OPEN, trying next...`);
          this.rotateEndpoint();
          continue;
        }

        // Execute with circuit breaker protection
        const result = await breaker.execute(() => fn(endpoint));

        // Success - keep this endpoint as primary
        if (this.currentIndex !== 0) {
          console.log(`✅ Endpoint [${endpoint.name}] succeeded, keeping as active`);
        }

        return result;
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Endpoint [${endpoint.name}] failed: ${error.message}`);

        // Try next endpoint
        if (attempt < this.endpoints.length - 1) {
          this.rotateEndpoint();
          console.log(`🔄 Failing over to [${this.endpoints[this.currentIndex].name}]...`);
        }
      }
    }

    // All endpoints failed
    throw new Error(`All ${this.type} endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
  }

  rotateEndpoint() {
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
  }

  getHealth() {
    return {
      type: this.type,
      currentEndpoint: this.getCurrentEndpoint(),
      circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([url, breaker]) => ({
        url,
        ...breaker.getState()
      }))
    };
  }
}

// ============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries || RESILIENCE_CONFIG.MAX_RETRIES;
  const delays = options.delays || RESILIENCE_CONFIG.RETRY_DELAYS;
  const retryStatusCodes = options.retryStatusCodes || RESILIENCE_CONFIG.RETRY_STATUS_CODES;
  const operationName = options.name || 'Operation';

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      if (attempt > 0) {
        console.log(`✅ ${operationName} succeeded on retry ${attempt}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableError(error, retryStatusCodes);

      if (!isRetryable || attempt >= maxRetries) {
        if (attempt > 0) {
          console.error(`❌ ${operationName} failed after ${attempt} retries: ${error.message}`);
        }
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = delays[attempt] || delays[delays.length - 1];
      console.warn(`⚠️ ${operationName} attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`);

      await sleep(delay);
    }
  }

  throw lastError;
}

function isRetryableError(error, retryStatusCodes) {
  // Network errors are retryable
  if (error.message?.includes('fetch') ||
      error.message?.includes('network') ||
      error.message?.includes('timeout') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ETIMEDOUT')) {
    return true;
  }

  // HTTP status codes
  if (error.status && retryStatusCodes.includes(error.status)) {
    return true;
  }

  // Algorand-specific errors
  if (error.message?.includes('TransactionPool.Remember') ||
      error.message?.includes('would result negative')) {
    return false; // Don't retry balance/validation errors
  }

  // Default: retry on unknown errors (conservative approach)
  return true;
}

// ============================================================================
// TIMEOUT WRAPPER
// ============================================================================

async function withTimeout(fn, timeoutMs = RESILIENCE_CONFIG.DEFAULT_TIMEOUT, operationName = 'Operation') {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// ============================================================================
// REQUEST DEDUPLICATION
// ============================================================================

class RequestDeduplicator {
  constructor() {
    this.pendingRequests = new Map();
  }

  async execute(key, fn) {
    // Check if identical request is in flight
    if (this.pendingRequests.has(key)) {
      console.log(`🔄 Deduplicating request: ${key}`);
      return this.pendingRequests.get(key);
    }

    // Execute new request
    const promise = fn()
      .finally(() => {
        // Clean up after completion
        setTimeout(() => this.pendingRequests.delete(key), RESILIENCE_CONFIG.DEDUP_WINDOW);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  clear() {
    this.pendingRequests.clear();
  }
}

// ============================================================================
// ALGOD CLIENT WRAPPER WITH RESILIENCE
// ============================================================================

class ResilientAlgodClient {
  constructor(token = '', endpoints = null) {
    this.token = token;
    this.endpointManager = new EndpointManager(
      'algod',
      endpoints || RPC_ENDPOINTS.algod
    );
    this.deduplicator = new RequestDeduplicator();
    this.clients = new Map();

    // Create clients for each endpoint
    this.endpointManager.endpoints.forEach(ep => {
      this.clients.set(ep.url, new algosdk.Algodv2(token, ep.url, ''));
    });
  }

  async executeRPC(method, args = [], options = {}) {
    const operationName = options.name || `Algod.${method}`;
    const timeout = options.timeout || RESILIENCE_CONFIG.DEFAULT_TIMEOUT;
    const dedupKey = options.dedupKey || null;

    const operation = async () => {
      return this.endpointManager.executeWithFailover(async (endpoint) => {
        const client = this.clients.get(endpoint.url);

        // Call the method on the client
        let call = client;
        const methodParts = method.split('.');
        for (const part of methodParts) {
          call = call[part];
          if (typeof call === 'function') {
            call = call.apply(client, args);
          }
        }

        // Execute with timeout
        return withTimeout(
          () => call.do ? call.do() : call,
          timeout,
          operationName
        );
      });
    };

    // Wrap with retry logic
    const operationWithRetry = () => withRetry(operation, {
      name: operationName,
      maxRetries: options.maxRetries || RESILIENCE_CONFIG.MAX_RETRIES
    });

    // Execute with or without deduplication
    if (dedupKey) {
      return this.deduplicator.execute(dedupKey, operationWithRetry);
    }

    return operationWithRetry();
  }

  // Convenience methods matching algosdk API
  async getTransactionParams() {
    return this.executeRPC('getTransactionParams', [], {
      name: 'GetTransactionParams',
      dedupKey: 'txn_params',
      timeout: 10000
    });
  }

  async getApplicationBoxByName(appId, boxName) {
    const boxKey = typeof boxName === 'string' ? boxName : Buffer.from(boxName).toString('base64');
    return this.executeRPC('getApplicationBoxByName', [appId, boxName], {
      name: `GetBox:${boxKey.substring(0, 20)}`,
      dedupKey: `box_${appId}_${boxKey}`
    });
  }

  async sendRawTransaction(signedTxn) {
    return this.executeRPC('sendRawTransaction', [signedTxn], {
      name: 'SendRawTransaction',
      timeout: 15000,
      maxRetries: 2 // Fewer retries for submissions
    });
  }

  async pendingTransactionInformation(txId) {
    return this.executeRPC('pendingTransactionInformation', [txId], {
      name: `PendingTxn:${txId.substring(0, 8)}`,
      timeout: 10000
    });
  }

  async waitForConfirmation(txId, waitRounds) {
    // Don't retry waitForConfirmation - it has built-in polling
    const endpoint = this.endpointManager.getCurrentEndpoint();
    const client = this.clients.get(endpoint.url);

    return withTimeout(
      () => algosdk.waitForConfirmation(client, txId, waitRounds),
      waitRounds * 3000, // ~3s per round
      `WaitForConfirmation:${txId.substring(0, 8)}`
    );
  }

  getHealth() {
    return this.endpointManager.getHealth();
  }

  getCurrentClient() {
    const endpoint = this.endpointManager.getCurrentEndpoint();
    return this.clients.get(endpoint.url);
  }
}

// ============================================================================
// INDEXER CLIENT WRAPPER WITH RESILIENCE
// ============================================================================

class ResilientIndexerClient {
  constructor(token = '', endpoints = null) {
    this.token = token;
    this.endpointManager = new EndpointManager(
      'indexer',
      endpoints || RPC_ENDPOINTS.indexer
    );
    this.deduplicator = new RequestDeduplicator();
    this.clients = new Map();

    // Create clients for each endpoint
    this.endpointManager.endpoints.forEach(ep => {
      this.clients.set(ep.url, new algosdk.Indexer(token, ep.url, ''));
    });
  }

  async executeQuery(queryBuilder, options = {}) {
    const operationName = options.name || 'IndexerQuery';
    const timeout = options.timeout || RESILIENCE_CONFIG.DEFAULT_TIMEOUT;

    const operation = async () => {
      return this.endpointManager.executeWithFailover(async (endpoint) => {
        // Indexer queries are complex - execute directly
        return withTimeout(
          () => queryBuilder.do(),
          timeout,
          operationName
        );
      });
    };

    return withRetry(operation, {
      name: operationName,
      maxRetries: options.maxRetries || RESILIENCE_CONFIG.MAX_RETRIES
    });
  }

  searchForTransactions() {
    const endpoint = this.endpointManager.getCurrentEndpoint();
    const client = this.clients.get(endpoint.url);
    return client.searchForTransactions();
  }

  lookupAccountByID(address) {
    const endpoint = this.endpointManager.getCurrentEndpoint();
    const client = this.clients.get(endpoint.url);
    return client.lookupAccountByID(address);
  }

  getHealth() {
    return this.endpointManager.getHealth();
  }
}

// ============================================================================
// HEALTH MONITORING
// ============================================================================

class HealthMonitor {
  constructor(algodClient, indexerClient) {
    this.algodClient = algodClient;
    this.indexerClient = indexerClient;
    this.lastCheck = null;
    this.status = {
      algod: 'unknown',
      indexer: 'unknown',
      lastUpdate: null
    };
  }

  async checkHealth() {
    const results = {
      timestamp: Date.now(),
      algod: { status: 'unknown', endpoints: [] },
      indexer: { status: 'unknown', endpoints: [] }
    };

    // Check Algod health
    try {
      await withTimeout(
        () => this.algodClient.getTransactionParams(),
        RESILIENCE_CONFIG.HEALTH_CHECK_TIMEOUT,
        'HealthCheck:Algod'
      );
      results.algod.status = 'healthy';
    } catch (error) {
      results.algod.status = 'unhealthy';
      results.algod.error = error.message;
    }
    results.algod.endpoints = this.algodClient.getHealth().circuitBreakers;

    // Check Indexer health
    try {
      const query = this.indexerClient.searchForTransactions().limit(1);
      await withTimeout(
        () => query.do(),
        RESILIENCE_CONFIG.HEALTH_CHECK_TIMEOUT,
        'HealthCheck:Indexer'
      );
      results.indexer.status = 'healthy';
    } catch (error) {
      results.indexer.status = 'unhealthy';
      results.indexer.error = error.message;
    }
    results.indexer.endpoints = this.indexerClient.getHealth().circuitBreakers;

    this.lastCheck = results;
    this.status = {
      algod: results.algod.status,
      indexer: results.indexer.status,
      lastUpdate: results.timestamp
    };

    return results;
  }

  getStatus() {
    return this.status;
  }

  getLastCheck() {
    return this.lastCheck;
  }
}

// ============================================================================
// MNEMONIC VALIDATION
// ============================================================================

function validateMnemonic(mnemonic) {
  if (!mnemonic) {
    throw new Error('Mnemonic is required');
  }

  const words = mnemonic.trim().split(/\s+/);

  if (words.length !== 25) {
    throw new Error(`Invalid mnemonic: expected 25 words, got ${words.length}`);
  }

  // Check for common issues
  if (words.some(word => word.length === 0)) {
    throw new Error('Invalid mnemonic: contains empty words');
  }

  if (words.some(word => /[^a-z]/i.test(word))) {
    throw new Error('Invalid mnemonic: contains non-alphabetic characters');
  }

  // Try to convert to account (algosdk will validate checksum)
  try {
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    return account;
  } catch (error) {
    throw new Error(`Invalid mnemonic: ${error.message}`);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  // Node.js export
  module.exports = {
    RESILIENCE_CONFIG,
    RPC_ENDPOINTS,
    CircuitBreaker,
    EndpointManager,
    ResilientAlgodClient,
    ResilientIndexerClient,
    HealthMonitor,
    withRetry,
    withTimeout,
    validateMnemonic,
    RequestDeduplicator
  };
}

// Browser global export
if (typeof window !== 'undefined') {
  window.EternalBlissResilience = {
    RESILIENCE_CONFIG,
    RPC_ENDPOINTS,
    CircuitBreaker,
    EndpointManager,
    ResilientAlgodClient,
    ResilientIndexerClient,
    HealthMonitor,
    withRetry,
    withTimeout,
    validateMnemonic,
    RequestDeduplicator
  };
}
