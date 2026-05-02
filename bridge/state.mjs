const DEFAULT_ACTIONS = {
  idle: {
    state: 'idle',
    expression: 'exp_01',
    motion: { group: 'Idle', index: 0 },
    bubble: ''
  },
  listening: {
    state: 'listening',
    expression: 'exp_02',
    motion: { group: 'TapBody', index: 0 },
    bubble: '收到任务。'
  },
  reading: {
    state: 'reading',
    expression: 'exp_03',
    motion: { group: 'Idle', index: 1 },
    bubble: '正在查看相关文件。'
  },
  coding: {
    state: 'coding',
    expression: 'exp_04',
    motion: { group: 'TapBody', index: 1 },
    bubble: '正在修改代码。'
  },
  running: {
    state: 'running',
    expression: 'exp_04',
    motion: { group: 'TapBody', index: 2 },
    bubble: '正在执行命令。'
  },
  asking: {
    state: 'asking',
    expression: 'exp_06',
    motion: { group: 'TapBody', index: 3 },
    bubble: '需要你确认权限。'
  },
  succeeded: {
    state: 'succeeded',
    expression: 'exp_08',
    motion: { group: 'TapBody', index: 4 },
    bubble: '这一步完成了。'
  },
  failed: {
    state: 'failed',
    expression: 'exp_07',
    motion: { group: 'TapBody', index: 5 },
    bubble: '这一步失败了，我在看原因。'
  }
};

export function initialState() {
  return {
    ...DEFAULT_ACTIONS.idle,
    source: 'bridge',
    ts: Date.now()
  };
}

export function eventToAction(event) {
  const normalized = normalizeEvent(event);
  const state = classifyState(normalized);
  const action = {
    ...DEFAULT_ACTIONS[state],
    state,
    source: 'codex',
    ts: Date.now(),
    eventType: normalized.type,
    tool: normalized.tool
  };

  if (normalized.error) {
    action.error = normalized.error;
  }

  return action;
}

function normalizeEvent(event) {
  const payload = event && typeof event === 'object' ? event : {};
  const type = String(
    payload.type ??
      payload.event ??
      payload.hook_event_name ??
      payload.hookEventName ??
      payload.name ??
      ''
  );

  const toolPayload = payload.tool ?? payload.tool_call ?? payload.toolCall ?? {};
  const tool = String(
    payload.tool_name ??
      payload.toolName ??
      toolPayload.name ??
      toolPayload.tool_name ??
      toolPayload.type ??
      ''
  );

  const command = String(
    payload.command ??
      payload.cmd ??
      payload.arguments?.command ??
      toolPayload.command ??
      toolPayload.arguments?.command ??
      ''
  );

  const status = String(
    payload.status ??
      payload.result?.status ??
      payload.result?.exit_code ??
      payload.exit_code ??
      payload.exitCode ??
      ''
  );

  const ok =
    payload.ok === true ||
    payload.success === true ||
    status === '0' ||
    status.toLowerCase() === 'success' ||
    status.toLowerCase() === 'ok';

  const failed =
    payload.ok === false ||
    payload.success === false ||
    payload.error != null ||
    payload.result?.error != null ||
    (status !== '' && status !== '0' && status.toLowerCase() !== 'success' && status.toLowerCase() !== 'ok');

  return {
    raw: payload,
    type,
    typeKey: type.toLowerCase(),
    tool,
    toolKey: tool.toLowerCase(),
    command,
    commandKey: command.toLowerCase(),
    ok,
    failed,
    error: payload.error ?? payload.result?.error
  };
}

function classifyState(event) {
  const type = event.typeKey;

  if (type.includes('permission')) return 'asking';
  if (type.includes('userprompt') || type.includes('prompt_submit') || type.includes('turn.started')) {
    return 'listening';
  }
  if (type.includes('sessionstart') || type.includes('session.started') || type.includes('thread.started')) {
    return 'idle';
  }
  if (type.includes('stop') || type.includes('turn.completed')) return 'idle';
  if (type.includes('failed') || type === 'error') return 'failed';

  if (type.includes('posttool') || type.includes('tool.completed') || type.includes('item.completed')) {
    return event.failed ? 'failed' : 'succeeded';
  }

  if (type.includes('pretool') || type.includes('tool.started') || type.includes('item.started')) {
    return classifyTool(event);
  }

  return classifyTool(event);
}

function classifyTool(event) {
  const haystack = `${event.toolKey} ${event.commandKey}`;

  if (/(apply_patch|edit|write|create|replace|insert|delete|patch)/.test(haystack)) {
    return 'coding';
  }
  if (/(read|open|sed|cat|rg|grep|ls|find|tree|show)/.test(haystack)) {
    return 'reading';
  }
  if (/(bash|shell|exec|command|test|npm|pnpm|yarn|cargo|pytest|make|node|python|git)/.test(haystack)) {
    return 'running';
  }

  return 'running';
}
