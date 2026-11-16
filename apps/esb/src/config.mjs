export function loadConfig(env) {
  if (!env.ESB_API_KEY || env.ESB_API_KEY.length < 32)
    throw new Error('ESB_API_KEY requires at least 32 characters');
  const positive = (name, fallback, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const entries = JSON.parse(env.ESB_PROVIDERS ?? '[]');
  if (!Array.isArray(entries) || !entries.length) throw new Error('ESB_PROVIDERS must be a nonempty array');
  const providers = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.serviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.serviceId) || providers.has(entry.serviceId))
      throw new Error('Invalid or duplicate provider serviceId');
    const url = new URL(entry.baseUrlRest);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /%|\/\//.test(url.pathname))
      throw new Error('Invalid provider baseUrlRest');
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production providers require HTTPS');
    const apiKey = env[entry.apiKeyEnv];
    if (typeof apiKey !== 'string' || apiKey.length < 32 || /[\r\n]/.test(apiKey))
      throw new Error(`Missing provider credential for ${entry.serviceId}`);
    providers.set(entry.serviceId, { baseUrlRest: url.href.replace(/\/$/, ''), apiKey });
  }
  return {
    apiKey: env.ESB_API_KEY, providers,
    port: positive('PORT', 3010, 65535),
    timeoutMs: positive('ESB_TIMEOUT_MS', 10000, 120000),
    maxBodyBytes: positive('ESB_MAX_BODY_BYTES', 1048576, 10485760),
  };
}
