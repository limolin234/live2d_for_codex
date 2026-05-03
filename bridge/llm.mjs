export async function polishAction(action) {
  if (process.env.LIVE2D_LLM_ENABLED !== '1') {
    return action;
  }

  const apiKey = process.env.LIVE2D_LLM_API_KEY ?? process.env.YUNWU_API_KEY;
  if (!apiKey) {
    return action;
  }

  const baseUrl = process.env.LIVE2D_LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.LIVE2D_LLM_MODEL ?? 'gpt-4.1-mini';
  const timeoutMs = Number(process.env.LIVE2D_LLM_TIMEOUT_MS ?? 600);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await requestCompletion({
      baseUrl,
      apiKey,
      model,
      action,
      signal: controller.signal,
      jsonMode: true
    });

    if (!response.ok) {
      return action;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return action;
    }

    const patch = parseJsonObject(content);
    return {
      ...action,
      expression: typeof patch.expression === 'string' ? patch.expression : action.expression,
      motion: patch.motion && typeof patch.motion === 'object' ? patch.motion : action.motion,
      bubble: typeof patch.bubble === 'string' ? patch.bubble.slice(0, 48) : action.bubble,
      polished: true
    };
  } catch {
    return action;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestCompletion({ baseUrl, apiKey, model, action, signal, jsonMode }) {
  const body = {
    model,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content:
          'You choose presentation-only Live2D reactions for a coding assistant. Return compact JSON with optional expression, motion, bubble. Do not mention private code. The bubble must be short Chinese text.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          state: action.state,
          eventType: action.eventType,
          tool: action.tool,
          currentBubble: action.bubble
        })
      }
    ]
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  });

  if (response.ok || !jsonMode || ![400, 404, 422].includes(response.status)) {
    return response;
  }

  return requestCompletion({ baseUrl, apiKey, model, action, signal, jsonMode: false });
}

function parseJsonObject(content) {
  const text = String(content).trim();

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}
