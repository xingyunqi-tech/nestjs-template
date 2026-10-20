export function llmConfigFromEnv(env = process.env) {
  return {
    apiKey: env.LLM_API_KEY ?? '',
    baseUrl: env.LLM_BASE_URL ?? 'https://api.deepseek.com',
    model: env.LLM_MODEL ?? 'deepseek-chat',
    maxTokens: Number(env.LLM_MAX_TOKENS ?? 8192),
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 180000),
    priceInputPerM: env.LLM_PRICE_INPUT_PER_M ? Number(env.LLM_PRICE_INPUT_PER_M) : null,
    priceCachedInputPerM: env.LLM_PRICE_CACHED_INPUT_PER_M ? Number(env.LLM_PRICE_CACHED_INPUT_PER_M) : null,
    priceOutputPerM: env.LLM_PRICE_OUTPUT_PER_M ? Number(env.LLM_PRICE_OUTPUT_PER_M) : null,
  };
}

export async function completeJson(config, { system, user, label }) {
  const started = Date.now();
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: config.maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`LLM ${label} HTTP ${response.status}: ${detail.slice(0, 300)}`), {
      durationMs: Date.now() - started,
    });
  }
  const body = await response.json();
  const durationMs = Date.now() - started;
  const choice = body.choices?.[0];
  const usage = {
    label,
    model: body.model ?? config.model,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    cachedInputTokens: body.usage?.prompt_cache_hit_tokens ?? body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    finishReason: choice?.finish_reason ?? 'unknown',
    durationMs,
  };
  let json = null;
  let parseError = null;
  if (usage.finishReason !== 'length') {
    const content = choice?.message?.content ?? '';
    try {
      if (!content.trim()) throw new Error('empty content');
      json = JSON.parse(content);
      if (json === null || typeof json !== 'object' || Array.isArray(json)) {
        json = null;
        throw new Error('content is not a JSON object');
      }
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  return { json, usage, parseError };
}

export function estimateCost(config, totals) {
  if (config.priceInputPerM === null || config.priceOutputPerM === null) return null;
  const cachedPrice = config.priceCachedInputPerM ?? config.priceInputPerM;
  const uncached = totals.inputTokens - totals.cachedInputTokens;
  return (
    (uncached * config.priceInputPerM +
      totals.cachedInputTokens * cachedPrice +
      totals.outputTokens * config.priceOutputPerM) /
    1e6
  );
}
