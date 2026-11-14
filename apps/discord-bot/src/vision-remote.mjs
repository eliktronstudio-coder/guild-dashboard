import { createHmac } from "node:crypto";
export function signVisionRequest(secret, timestamp, requestId, body) {
  return createHmac("sha256", secret)
    .update(timestamp + "\n" + requestId + "\n" + body)
    .digest("hex");
}
// Deliberately not an OpenAI baseURL override: our API key never leaves its host.
export function remoteVisionClient(
  env = process.env,
  { fetchImpl = fetch, clock = Date.now } = {},
) {
  let url;
  try {
    url = new URL(env.VISION_SERVICE_URL);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".onrender.com") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname) ||
      url.port
    )
      throw Error();
    if (
      typeof env.VISION_SERVICE_SECRET !== "string" ||
      env.VISION_SERVICE_SECRET.length < 32
    )
      throw Error();
  } catch {
    throw Error("GPT_SERVICE_CONFIG");
  }
  return async (payload, timeout) => {
    const { requestId, ...input } = payload;
    const body = JSON.stringify({ version: 1, ...input }),
      timestamp = String(clock());
    let response;
    try {
      response = await fetchImpl(new URL("/v1/roster", url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.VISION_SERVICE_SECRET,
          "X-XD-Timestamp": timestamp,
          "X-XD-Request-Id": requestId,
          "X-XD-Signature": signVisionRequest(
            env.VISION_SERVICE_SECRET,
            timestamp,
            requestId,
            body,
          ),
        },
        body,
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError")
        throw Object.assign(Error("GPT_TIMEOUT"), {
          name: "APIConnectionTimeoutError",
        });
      throw Error("GPT_ERROR");
    }
    const text = await response.text();
    if (text.length > 250000) throw Error("GPT_ERROR");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error("GPT_ERROR");
    }
    if (!response.ok) {
      const code = data?.error?.code;
      const known = new Set([
        "GPT_SERVICE_AUTH",
        "GPT_SERVICE_CONFIG",
        "GPT_BUSY",
        "GPT_DAILY_LIMIT",
        "GPT_MONTHLY_LIMIT",
        "GPT_ERROR",
      ]);
      const error = Error(
        known.has(code) && code !== "GPT_ERROR" ? code : "REMOTE_ERROR",
      );
      // Provider categories are matched against fixed identifiers by visionFailure.
      if (
        [
          "unsupported_country_region_territory",
          "insufficient_quota",
          "billing_hard_limit_reached",
        ].includes(code)
      )
        error.code = code;
      error.status = [
        400, 401, 403, 404, 408, 422, 429, 500, 502, 503, 504,
      ].includes(data?.error?.status)
        ? data.error.status
        : response.status;
      if (data?.usage) error.visionUsage = data.usage;
      throw error;
    }
    return data;
  };
}
