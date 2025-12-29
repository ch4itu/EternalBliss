/**
 * EternalBliss Workflow & Multi-Agent SDK v2.0
 * =============================================
 *
 * Implements n8n.io-style workflows and CrewAI-style multi-agent
 * coordination using USM Process primitive for ON-CHAIN execution.
 *
 * KEY CHANGE: All execution uses Process, not just Entity storage.
 *
 * Architecture:
 * - Entity (e:) = Definitions (workflows, agents, crews)
 * - Process (p:) = Execution state (turn-based, resumable, auditable)
 *
 * ENHANCED: Includes AI node timeout protection
 *
 * @version 2.0.0
 * @requires ai.js (USM contract interface)
 * @requires resilience.js (optional - provides timeout utilities)
 */

// ============================================================================
// CONSTANTS & PREFIXES
// ============================================================================

// AI execution timeout (default: 2 minutes)
const AI_NODE_TIMEOUT = 120000; // 120 seconds

const WORKFLOW_PREFIX = 'wf:';
const AGENT_PREFIX = 'ag:';
const CREW_PREFIX = 'cr:';
const EXECUTION_PREFIX = 'ex:';

const NODE_TYPES = {
  TRIGGER: 'trigger',
  ACTION: 'action',
  CONDITION: 'condition',
  CODE: 'code',
  AI: 'ai',
  AGENT: 'agent',
  CREW: 'crew',
  WAIT: 'wait'
};

const EXECUTION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING_INPUT: 'waiting_input',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const PROCESS_TYPES = {
  SEQUENTIAL: 'sequential',
  PARALLEL: 'parallel',
  HIERARCHICAL: 'hierarchical'
};

// ============================================================================
// UTILITIES
// ============================================================================

function generateId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function resolveTemplate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = context;
    for (const key of keys) {
      value = value?.[key];
    }
    return value !== undefined ? (typeof value === 'object' ? JSON.stringify(value) : value) : match;
  });
}

// Timeout wrapper for AI operations
async function withAITimeout(fn, timeoutMs = AI_NODE_TIMEOUT, operationName = 'AI Operation') {
  // Use resilience module if available
  if (typeof window !== 'undefined' && window.EternalBlissResilience && window.EternalBlissResilience.withTimeout) {
    return window.EternalBlissResilience.withTimeout(fn, timeoutMs, operationName);
  }

  // Fallback implementation
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// ============================================================================
// WORKFLOW BUILDER (Definition only - stored in Entity)
// ============================================================================

class WorkflowBuilder {
  constructor(name) {
    this.workflow = {
      type: 'workflow',
      version: '2.0',
      id: generateId(WORKFLOW_PREFIX),
      name: name || 'Untitled Workflow',
      description: '',
      nodes: [],
      edges: [],
      created_at: Date.now()
    };
  }

  setId(id) {
    this.workflow.id = id.startsWith(WORKFLOW_PREFIX) ? id : WORKFLOW_PREFIX + id;
    return this;
  }

  setDescription(desc) {
    this.workflow.description = desc;
    return this;
  }

  /**
   * Add a node to the workflow
   */
  addNode(id, type, config = {}) {
    this.workflow.nodes.push({
      id,
      type,
      name: config.name || id,
      config: { ...config }
    });
    return this;
  }

  addTrigger(id, triggerType, config = {}) {
    return this.addNode(id, NODE_TYPES.TRIGGER, { triggerType, ...config });
  }

  addAction(id, action, config = {}) {
    return this.addNode(id, NODE_TYPES.ACTION, { action, ...config });
  }

  addCondition(id, condition, config = {}) {
    return this.addNode(id, NODE_TYPES.CONDITION, { condition, ...config });
  }

  addCode(id, code, config = {}) {
    return this.addNode(id, NODE_TYPES.CODE, { code, ...config });
  }

  addAI(id, prompt, config = {}) {
    return this.addNode(id, NODE_TYPES.AI, { prompt, model: config.model || 'gpt-4', ...config });
  }

  addAgentTask(id, agentId, task, config = {}) {
    return this.addNode(id, NODE_TYPES.AGENT, { agent_id: agentId, task, ...config });
  }

  addCrewTask(id, crewId, config = {}) {
    return this.addNode(id, NODE_TYPES.CREW, { crew_id: crewId, ...config });
  }

  /**
   * Connect nodes
   */
  connect(fromId, toId, condition = null) {
    const edge = { from: fromId, to: toId };
    if (condition !== null) edge.condition = String(condition);
    this.workflow.edges.push(edge);
    return this;
  }

  /**
   * Get the workflow definition
   */
  build() {
    return deepClone(this.workflow);
  }

  /**
   * Save workflow definition to Entity
   */
  async save() {
    const workflow = this.build();
    const entityId = workflow.id;
    const data = JSON.stringify(workflow);

    try {
      await createEntity(entityId, data);
      console.log(`[Workflow] Created: ${entityId}`);
    } catch (e) {
      if (e.message?.includes('Only owner')) {
        await updateEntity(entityId, data);
        console.log(`[Workflow] Updated: ${entityId}`);
      } else {
        throw e;
      }
    }
    return entityId;
  }

  /**
   * Load workflow from Entity
   */
  static async load(workflowId) {
    const id = workflowId.startsWith(WORKFLOW_PREFIX) ? workflowId : WORKFLOW_PREFIX + workflowId;
    const data = await readEntity(id);
    if (!data) throw new Error(`Workflow not found: ${id}`);

    const workflow = JSON.parse(data);
    const builder = new WorkflowBuilder(workflow.name);
    builder.workflow = workflow;
    return builder;
  }
}

// ============================================================================
// AGENT BUILDER (Definition only - stored in Entity)
// ============================================================================

class AgentBuilder {
  constructor(role) {
    this.agent = {
      type: 'agent',
      version: '2.0',
      id: generateId(AGENT_PREFIX),
      role: role || 'Assistant',
      goal: '',
      backstory: '',
      llm: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
      tools: [],
      max_iterations: 10,
      created_at: Date.now()
    };
  }

  setId(id) {
    this.agent.id = id.startsWith(AGENT_PREFIX) ? id : AGENT_PREFIX + id;
    return this;
  }

  setGoal(goal) {
    this.agent.goal = goal;
    return this;
  }

  setBackstory(backstory) {
    this.agent.backstory = backstory;
    return this;
  }

  setLLM(provider, model, options = {}) {
    this.agent.llm = { provider, model, temperature: options.temperature || 0.7, ...options };
    return this;
  }

  addTools(tools) {
    this.agent.tools = [...this.agent.tools, ...tools];
    return this;
  }

  setMaxIterations(max) {
    this.agent.max_iterations = max;
    return this;
  }

  build() {
    return deepClone(this.agent);
  }

  async save() {
    const agent = this.build();
    const entityId = agent.id;
    const data = JSON.stringify(agent);

    try {
      await createEntity(entityId, data);
      console.log(`[Agent] Created: ${entityId}`);
    } catch (e) {
      if (e.message?.includes('Only owner')) {
        await updateEntity(entityId, data);
        console.log(`[Agent] Updated: ${entityId}`);
      } else {
        throw e;
      }
    }
    return entityId;
  }

  static async load(agentId) {
    const id = agentId.startsWith(AGENT_PREFIX) ? agentId : AGENT_PREFIX + agentId;
    const data = await readEntity(id);
    if (!data) throw new Error(`Agent not found: ${id}`);

    const agent = JSON.parse(data);
    const builder = new AgentBuilder(agent.role);
    builder.agent = agent;
    return builder;
  }
}

// ============================================================================
// CREW BUILDER (Definition only - stored in Entity)
// ============================================================================

class CrewBuilder {
  constructor(name) {
    this.crew = {
      type: 'crew',
      version: '2.0',
      id: generateId(CREW_PREFIX),
      name: name || 'Untitled Crew',
      description: '',
      agents: [],
      process: PROCESS_TYPES.SEQUENTIAL,
      tasks: [],
      created_at: Date.now()
    };
  }

  setId(id) {
    this.crew.id = id.startsWith(CREW_PREFIX) ? id : CREW_PREFIX + id;
    return this;
  }

  setDescription(desc) {
    this.crew.description = desc;
    return this;
  }

  setProcess(processType) {
    this.crew.process = processType;
    return this;
  }

  addAgent(agentId) {
    const id = agentId.startsWith(AGENT_PREFIX) ? agentId : AGENT_PREFIX + agentId;
    if (!this.crew.agents.includes(id)) this.crew.agents.push(id);
    return this;
  }

  addAgents(agentIds) {
    agentIds.forEach(id => this.addAgent(id));
    return this;
  }

  /**
   * Add a task to the crew
   */
  addTask(taskId, description, agentId, options = {}) {
    this.crew.tasks.push({
      id: taskId,
      description,
      expected_output: options.expected_output || 'Task output',
      agent: agentId.startsWith(AGENT_PREFIX) ? agentId : AGENT_PREFIX + agentId,
      context: options.context || []  // IDs of tasks whose output is needed
    });
    return this;
  }

  build() {
    return deepClone(this.crew);
  }

  async save() {
    const crew = this.build();
    const entityId = crew.id;
    const data = JSON.stringify(crew);

    try {
      await createEntity(entityId, data);
      console.log(`[Crew] Created: ${entityId}`);
    } catch (e) {
      if (e.message?.includes('Only owner')) {
        await updateEntity(entityId, data);
        console.log(`[Crew] Updated: ${entityId}`);
      } else {
        throw e;
      }
    }
    return entityId;
  }

  static async load(crewId) {
    const id = crewId.startsWith(CREW_PREFIX) ? crewId : CREW_PREFIX + crewId;
    const data = await readEntity(id);
    if (!data) throw new Error(`Crew not found: ${id}`);

    const crew = JSON.parse(data);
    const builder = new CrewBuilder(crew.name);
    builder.crew = crew;
    return builder;
  }
}

// ============================================================================
// WORKFLOW EXECUTOR (Uses Process for on-chain execution tracking)
// ============================================================================

/**
 * WorkflowExecutor - Executes workflows using Process primitive
 *
 * CRITICAL: Each workflow execution creates a Process that tracks:
 * - Current node being executed
 * - Turn number (increments with each step)
 * - All intermediate outputs
 * - Execution status
 *
 * This provides:
 * - On-chain audit trail
 * - Resumability (can continue from any turn)
 * - Verifiable execution history
 * - Timeout protection
 */
class WorkflowExecutor {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || null;
    this.executorAddress = options.executorAddress || null;
    this.timeoutRounds = options.timeoutRounds || 2000; // ~100 minutes
    this.onNodeStart = options.onNodeStart || (() => {});
    this.onNodeComplete = options.onNodeComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  setLLMProvider(provider) {
    this.llmProvider = provider;
    return this;
  }

  /**
   * Execute a workflow - creates Process for tracking
   *
   * @param {string} workflowId - Entity ID of workflow definition
   * @param {object} input - Input data for the workflow
   * @param {string} partnerAddress - Address of execution partner (for Process)
   * @returns {object} Final execution state
   */
  async execute(workflowId, input = {}, partnerAddress = null) {
    // Load workflow definition from Entity
    const builder = await WorkflowBuilder.load(workflowId);
    const workflow = builder.build();

    // Generate execution ID
    const execId = generateId(EXECUTION_PREFIX);

    // If no partner specified, generate a deterministic one
    // (Process requires two parties)
    if (!partnerAddress) {
      const dummyAccount = algosdk.generateAccount();
      partnerAddress = typeof dummyAccount.addr === 'string'
        ? dummyAccount.addr
        : algosdk.encodeAddress(dummyAccount.addr.publicKey);
    }

    // Initial execution state
    const initialState = {
      workflow_id: workflowId,
      workflow_name: workflow.name,
      status: EXECUTION_STATUS.RUNNING,
      current_node_index: 0,
      current_node_id: workflow.nodes[0]?.id || null,
      turn: 0,
      input: input,
      outputs: {},  // { nodeId: output }
      started_at: Date.now(),
      updated_at: Date.now()
    };

    // Create Process for execution tracking (ON-CHAIN!)
    console.log(`[Executor] Creating Process: ${execId}`);
    await createProcess(execId, partnerAddress, JSON.stringify(initialState));

    // Execute nodes sequentially
    let state = initialState;

    try {
      // Find starting nodes (nodes with no incoming edges, or first node)
      const startNodes = this._findStartNodes(workflow);

      for (const startNodeId of startNodes) {
        state = await this._executeFromNode(workflow, state, startNodeId, execId);
      }

      // Mark as completed
      state.status = EXECUTION_STATUS.COMPLETED;
      state.updated_at = Date.now();
      state.turn++;

      await advanceProcess(execId, state.turn, JSON.stringify(state));
      console.log(`[Executor] Workflow completed: ${execId}`);

    } catch (error) {
      // Mark as failed
      state.status = EXECUTION_STATUS.FAILED;
      state.error = error.message;
      state.updated_at = Date.now();
      state.turn++;

      await advanceProcess(execId, state.turn, JSON.stringify(state));
      this.onError({ execId, error, state });

      throw error;
    }

    return { execId, state };
  }

  /**
   * Resume a paused or failed execution
   */
  async resume(execId) {
    // Read current state from Process
    const stateJson = await readProcess(execId);
    if (!stateJson) throw new Error(`Execution not found: ${execId}`);

    const state = typeof stateJson === 'string' ? JSON.parse(stateJson) : stateJson;

    if (state.status === EXECUTION_STATUS.COMPLETED) {
      console.log(`[Executor] Execution already completed: ${execId}`);
      return { execId, state };
    }

    // Load workflow
    const builder = await WorkflowBuilder.load(state.workflow_id);
    const workflow = builder.build();

    // Resume from current node
    const currentNodeId = state.current_node_id;

    try {
      state.status = EXECUTION_STATUS.RUNNING;
      const newState = await this._executeFromNode(workflow, state, currentNodeId, execId);

      newState.status = EXECUTION_STATUS.COMPLETED;
      newState.updated_at = Date.now();
      newState.turn++;

      await advanceProcess(execId, newState.turn, JSON.stringify(newState));
      console.log(`[Executor] Resumed and completed: ${execId}`);

      return { execId, state: newState };

    } catch (error) {
      state.status = EXECUTION_STATUS.FAILED;
      state.error = error.message;
      state.turn++;
      await advanceProcess(execId, state.turn, JSON.stringify(state));
      throw error;
    }
  }

  /**
   * Execute from a specific node, following edges
   */
  async _executeFromNode(workflow, state, nodeId, execId) {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return state;

    // Skip if already executed
    if (state.outputs[nodeId] !== undefined) {
      return this._executeNextNodes(workflow, state, nodeId, execId);
    }

    // Update state: starting this node
    state.current_node_id = nodeId;
    state.current_node_index = workflow.nodes.findIndex(n => n.id === nodeId);
    state.updated_at = Date.now();
    state.turn++;

    // Save state to Process (ON-CHAIN checkpoint!)
    await advanceProcess(execId, state.turn, JSON.stringify(state));
    this.onNodeStart({ node, state, execId });

    // Execute the node
    const context = {
      input: state.input,
      outputs: state.outputs,
      data: state.outputs  // Alias for template resolution
    };

    const output = await this._executeNode(node, context);

    // Update state with output
    state.outputs[nodeId] = output;
    state.updated_at = Date.now();
    state.turn++;

    // Save state to Process (ON-CHAIN checkpoint!)
    await advanceProcess(execId, state.turn, JSON.stringify(state));
    this.onNodeComplete({ node, output, state, execId });

    // Execute next nodes
    return this._executeNextNodes(workflow, state, nodeId, execId);
  }

  /**
   * Find and execute next nodes based on edges
   */
  async _executeNextNodes(workflow, state, fromNodeId, execId) {
    const edges = workflow.edges.filter(e => e.from === fromNodeId);

    for (const edge of edges) {
      // Check condition if present
      if (edge.condition !== undefined) {
        const fromOutput = state.outputs[fromNodeId];
        const result = fromOutput?.result ?? fromOutput;

        // Match condition
        if (String(result) !== String(edge.condition)) {
          continue;  // Skip this edge
        }
      }

      // Execute the target node
      state = await this._executeFromNode(workflow, state, edge.to, execId);
    }

    return state;
  }

  /**
   * Execute a single node
   */
  async _executeNode(node, context) {
    console.log(`[Executor] Executing node: ${node.id} (${node.type})`);

    switch (node.type) {
      case NODE_TYPES.TRIGGER:
        return context.input;

      case NODE_TYPES.ACTION:
        return this._executeAction(node, context);

      case NODE_TYPES.CONDITION:
        return this._executeCondition(node, context);

      case NODE_TYPES.CODE:
        return this._executeCode(node, context);

      case NODE_TYPES.AI:
        return this._executeAI(node, context);

      case NODE_TYPES.AGENT:
        return this._executeAgentTask(node, context);

      case NODE_TYPES.CREW:
        return this._executeCrewTask(node, context);

      case NODE_TYPES.WAIT:
        await new Promise(r => setTimeout(r, node.config.duration || 1000));
        return { waited: node.config.duration || 1000 };

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  _executeAction(node, context) {
    const action = node.config.action;
    const resolved = {};

    for (const [key, value] of Object.entries(node.config)) {
      if (key !== 'action' && key !== 'name') {
        resolved[key] = resolveTemplate(value, context);
      }
    }

    // Built-in actions
    switch (action) {
      case 'create_entity':
        // This would call createEntity - for now return the intent
        return { action: 'create_entity', ...resolved };

      case 'log':
        console.log('[Action:log]', resolved.message || resolved);
        return { logged: true };

      default:
        return { action, params: resolved };
    }
  }

  _executeCondition(node, context) {
    const condition = resolveTemplate(node.config.condition, context);

    try {
      // Safe evaluation
      const fn = new Function('input', 'outputs', 'data', `return Boolean(${condition})`);
      const result = fn(context.input, context.outputs, context.outputs);
      return { result, condition };
    } catch (e) {
      console.error(`[Condition] Error evaluating: ${condition}`, e);
      return { result: false, error: e.message };
    }
  }

  _executeCode(node, context) {
    const code = node.config.code;

    try {
      const fn = new Function('input', 'outputs', 'data', code);
      const result = fn(context.input, context.outputs, context.outputs);
      return { result };
    } catch (e) {
      throw new Error(`Code execution failed: ${e.message}`);
    }
  }

  async _executeAI(node, context) {
    if (!this.llmProvider) {
      return { response: '[No LLM provider configured]', mock: true };
    }

    const prompt = resolveTemplate(node.config.prompt, context);
    const timeout = node.config.timeout || AI_NODE_TIMEOUT;

    try {
      const response = await withAITimeout(
        async () => {
          return await this.llmProvider.complete({
            model: node.config.model || 'gpt-4',
            prompt,
            temperature: node.config.temperature || 0.7
          });
        },
        timeout,
        `AI Node [${node.id}]`
      );

      return { response: response.content || response, prompt };
    } catch (error) {
      console.error(`[AI Node ${node.id}] Execution failed:`, error);
      throw new Error(`AI node execution failed: ${error.message}`);
    }
  }

  async _executeAgentTask(node, context) {
    const agentId = node.config.agent_id;
    const task = resolveTemplate(node.config.task, context);

    // Load agent definition
    const agentBuilder = await AgentBuilder.load(agentId);
    const agent = agentBuilder.build();

    if (!this.llmProvider) {
      return {
        response: `[Agent: ${agent.role}] Task: ${task}\n[No LLM provider - mock response]`,
        mock: true
      };
    }

    // Build agent prompt
    const systemPrompt = `You are ${agent.role}.\n\nGoal: ${agent.goal}\n\nBackstory: ${agent.backstory}`;
    const timeout = node.config.timeout || AI_NODE_TIMEOUT;

    try {
      const response = await withAITimeout(
        async () => {
          return await this.llmProvider.complete({
            model: agent.llm.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: task }
            ],
            temperature: agent.llm.temperature
          });
        },
        timeout,
        `Agent Node [${node.id}: ${agent.role}]`
      );

      return {
        response: response.content || response,
        agent: agent.role,
        task
      };
    } catch (error) {
      console.error(`[Agent Node ${node.id}] Execution failed:`, error);
      throw new Error(`Agent task execution failed: ${error.message}`);
    }
  }

  async _executeCrewTask(node, context) {
    const crewId = node.config.crew_id;

    // Load crew and execute using CrewExecutor
    const crewExecutor = new CrewExecutor({
      llmProvider: this.llmProvider,
      timeoutRounds: this.timeoutRounds
    });

    // Map input for crew
    const crewInput = {};
    if (node.config.input_mapping) {
      for (const [key, value] of Object.entries(node.config.input_mapping)) {
        crewInput[key] = resolveTemplate(value, context);
      }
    } else {
      Object.assign(crewInput, context.input);
    }

    const result = await crewExecutor.execute(crewId, crewInput);
    return result.state.task_outputs;
  }

  _findStartNodes(workflow) {
    const targetNodes = new Set(workflow.edges.map(e => e.to));
    const startNodes = workflow.nodes
      .filter(n => !targetNodes.has(n.id))
      .map(n => n.id);

    return startNodes.length > 0 ? startNodes : [workflow.nodes[0]?.id].filter(Boolean);
  }
}

// ============================================================================
// CREW EXECUTOR (Uses Process for agent handoffs)
// ============================================================================

/**
 * CrewExecutor - Executes crews using Process primitive
 *
 * Each task handoff is a Process turn:
 * - Turn 0: Initial state with all tasks
 * - Turn 1: Agent A completes task 1
 * - Turn 2: Agent B completes task 2 (with context from task 1)
 * - etc.
 */
class CrewExecutor {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || null;
    this.timeoutRounds = options.timeoutRounds || 2000;
    this.onTaskStart = options.onTaskStart || (() => {});
    this.onTaskComplete = options.onTaskComplete || (() => {});
  }

  setLLMProvider(provider) {
    this.llmProvider = provider;
    return this;
  }

  /**
   * Execute a crew
   */
  async execute(crewId, input = {}, partnerAddress = null) {
    // Load crew definition
    const builder = await CrewBuilder.load(crewId);
    const crew = builder.build();

    // Generate execution ID
    const execId = generateId(EXECUTION_PREFIX);

    // Partner address for Process
    if (!partnerAddress) {
      const dummyAccount = algosdk.generateAccount();
      partnerAddress = typeof dummyAccount.addr === 'string'
        ? dummyAccount.addr
        : algosdk.encodeAddress(dummyAccount.addr.publicKey);
    }

    // Initial state
    const initialState = {
      crew_id: crewId,
      crew_name: crew.name,
      process: crew.process,
      status: EXECUTION_STATUS.RUNNING,
      current_task_index: 0,
      current_task_id: crew.tasks[0]?.id || null,
      turn: 0,
      input: input,
      task_outputs: {},
      started_at: Date.now(),
      updated_at: Date.now()
    };

    // Create Process for crew execution (ON-CHAIN!)
    console.log(`[CrewExecutor] Creating Process: ${execId}`);
    await createProcess(execId, partnerAddress, JSON.stringify(initialState));

    // Load all agent definitions
    const agents = new Map();
    for (const agentId of crew.agents) {
      const agentBuilder = await AgentBuilder.load(agentId);
      agents.set(agentId, agentBuilder.build());
    }

    let state = initialState;

    try {
      if (crew.process === PROCESS_TYPES.SEQUENTIAL) {
        state = await this._executeSequential(crew, agents, state, execId);
      } else if (crew.process === PROCESS_TYPES.PARALLEL) {
        state = await this._executeParallel(crew, agents, state, execId);
      } else if (crew.process === PROCESS_TYPES.HIERARCHICAL) {
        state = await this._executeHierarchical(crew, agents, state, execId);
      }

      // Mark completed
      state.status = EXECUTION_STATUS.COMPLETED;
      state.updated_at = Date.now();
      state.turn++;
      await advanceProcess(execId, state.turn, JSON.stringify(state));

      console.log(`[CrewExecutor] Crew completed: ${execId}`);

    } catch (error) {
      state.status = EXECUTION_STATUS.FAILED;
      state.error = error.message;
      state.turn++;
      await advanceProcess(execId, state.turn, JSON.stringify(state));
      throw error;
    }

    return { execId, state };
  }

  /**
   * Sequential execution - tasks run one after another
   */
  async _executeSequential(crew, agents, state, execId) {
    for (let i = 0; i < crew.tasks.length; i++) {
      const task = crew.tasks[i];
      state.current_task_index = i;
      state.current_task_id = task.id;
      state.updated_at = Date.now();
      state.turn++;

      // Checkpoint: starting task
      await advanceProcess(execId, state.turn, JSON.stringify(state));
      this.onTaskStart({ task, state, execId });

      // Get agent
      const agent = agents.get(task.agent);
      if (!agent) throw new Error(`Agent not found: ${task.agent}`);

      // Build context from previous tasks
      const taskContext = this._buildTaskContext(task, state);

      // Execute task
      const output = await this._executeAgentTask(agent, task, taskContext);

      // Update state
      state.task_outputs[task.id] = {
        output,
        agent: task.agent,
        timestamp: Date.now()
      };
      state.updated_at = Date.now();
      state.turn++;

      // Checkpoint: task completed
      await advanceProcess(execId, state.turn, JSON.stringify(state));
      this.onTaskComplete({ task, output, state, execId });
    }

    return state;
  }

  /**
   * Parallel execution - all tasks run simultaneously
   */
  async _executeParallel(crew, agents, state, execId) {
    // Start all tasks
    state.updated_at = Date.now();
    state.turn++;
    await advanceProcess(execId, state.turn, JSON.stringify(state));

    const promises = crew.tasks.map(async (task) => {
      const agent = agents.get(task.agent);
      if (!agent) throw new Error(`Agent not found: ${task.agent}`);

      const taskContext = this._buildTaskContext(task, state);
      const output = await this._executeAgentTask(agent, task, taskContext);

      return { task, output };
    });

    const results = await Promise.all(promises);

    // Update state with all results
    for (const { task, output } of results) {
      state.task_outputs[task.id] = {
        output,
        agent: task.agent,
        timestamp: Date.now()
      };
    }

    state.turn++;
    await advanceProcess(execId, state.turn, JSON.stringify(state));

    return state;
  }

  /**
   * Hierarchical execution - manager delegates to workers
   */
  async _executeHierarchical(crew, agents, state, execId) {
    // First agent is the manager
    const managerAgentId = crew.agents[0];
    const manager = agents.get(managerAgentId);

    for (const task of crew.tasks) {
      state.current_task_id = task.id;
      state.turn++;
      await advanceProcess(execId, state.turn, JSON.stringify(state));

      // Manager decides which agent handles the task
      // (In practice, task.agent specifies, but manager reviews)
      const workerAgentId = task.agent || crew.agents[1];
      const worker = agents.get(workerAgentId);

      if (!worker) throw new Error(`Worker not found: ${workerAgentId}`);

      const taskContext = this._buildTaskContext(task, state);
      taskContext.manager = manager.role;

      const output = await this._executeAgentTask(worker, task, taskContext);

      state.task_outputs[task.id] = {
        output,
        agent: workerAgentId,
        delegated_by: managerAgentId,
        timestamp: Date.now()
      };

      state.turn++;
      await advanceProcess(execId, state.turn, JSON.stringify(state));
    }

    return state;
  }

  /**
   * Build context for a task from previous task outputs
   */
  _buildTaskContext(task, state) {
    const context = {
      input: state.input,
      previous_outputs: {}
    };

    // Add outputs from context tasks
    for (const contextTaskId of task.context || []) {
      if (state.task_outputs[contextTaskId]) {
        context.previous_outputs[contextTaskId] = state.task_outputs[contextTaskId].output;
      }
    }

    return context;
  }

  /**
   * Execute a single agent task
   */
  async _executeAgentTask(agent, task, context) {
    // Resolve task description with context
    let description = task.description;
    for (const [key, value] of Object.entries(context.input)) {
      description = description.replace(`{${key}}`, value);
    }

    if (!this.llmProvider) {
      return {
        response: `[Agent: ${agent.role}]\nTask: ${description}\n[No LLM provider - mock response]`,
        mock: true
      };
    }

    const systemPrompt = `You are ${agent.role}.

Goal: ${agent.goal}

Backstory: ${agent.backstory}

${Object.keys(context.previous_outputs).length > 0 ?
  `Previous work:\n${JSON.stringify(context.previous_outputs, null, 2)}` : ''}`;

    const response = await this.llmProvider.complete({
      model: agent.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description }
      ],
      temperature: agent.llm.temperature
    });

    return {
      response: response.content || response,
      agent: agent.role,
      task: task.id
    };
  }
}

// ============================================================================
// LLM PROVIDERS
// ============================================================================

class OpenAIProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async complete({ model, prompt, messages, temperature }) {
    const body = {
      model: model || 'gpt-4',
      temperature: temperature || 0.7,
      max_tokens: 2000
    };

    if (messages) {
      body.messages = messages;
    } else {
      body.messages = [{ role: 'user', content: prompt }];
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return { content: data.choices[0].message.content };
  }
}

class AnthropicProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async complete({ model, prompt, messages, temperature }) {
    const body = {
      model: model || 'claude-3-opus-20240229',
      max_tokens: 2000,
      temperature: temperature || 0.7
    };

    if (messages) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg) body.system = systemMsg.content;
      body.messages = messages.filter(m => m.role !== 'system');
    } else {
      body.messages = [{ role: 'user', content: prompt }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return { content: data.content[0].text };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.EternalBliss = {
    // Builders (definitions)
    WorkflowBuilder,
    AgentBuilder,
    CrewBuilder,

    // Executors (use Process!)
    WorkflowExecutor,
    CrewExecutor,

    // LLM Providers
    OpenAIProvider,
    AnthropicProvider,

    // Constants
    NODE_TYPES,
    EXECUTION_STATUS,
    PROCESS_TYPES,
    WORKFLOW_PREFIX,
    AGENT_PREFIX,
    CREW_PREFIX,
    EXECUTION_PREFIX,

    // Utils
    generateId,
    resolveTemplate
  };

  console.log('EternalBliss SDK v2.0 loaded (Process-based execution)');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WorkflowBuilder,
    AgentBuilder,
    CrewBuilder,
    WorkflowExecutor,
    CrewExecutor,
    OpenAIProvider,
    AnthropicProvider,
    NODE_TYPES,
    EXECUTION_STATUS,
    PROCESS_TYPES
  };
}
