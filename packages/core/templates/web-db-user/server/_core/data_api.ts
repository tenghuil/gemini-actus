/**
 * Minimal Data API client for web projects
 *
 * - Reads project-scoped credentials from ENV
 *   - BUILT_IN_DATA_API_URL: base URL (e.g., "https://forge.butterfly-effect.dev")
 *   - BUILT_IN_DATA_API_KEY: bearer token
 * - Builds full URL by appending "dataapi.v1.DataAPIService/CallApi" to base URL
 * - Sends Authorization and Connect-Protocol-Version headers
 * - For non-2xx responses, throws an Error with status text/body
 * - If server returns { jsonData: string }, it parses and returns that JSON; otherwise returns the raw JSON body
 *
 * Quick example (matches curl usage):
 *   await callDataApi("Youtube/search", {
 *     query: { gl: "US", hl: "en", q: "manus" },
 *   })
 */
import { ENV } from "./env";

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  options: DataApiCallOptions = {}
): Promise<unknown> {
  if (!ENV.dataApiUrl) {
    throw new Error("BUILT_IN_DATA_API_URL is not configured");
  }
  if (!ENV.dataApiKey) {
    throw new Error("BUILT_IN_DATA_API_KEY is not configured");
  }

  // Build the full URL by appending the service path to the base URL
  const baseUrl = ENV.dataApiUrl.endsWith("/")
    ? ENV.dataApiUrl
    : `${ENV.dataApiUrl}/`;
  const fullUrl = new URL(
    "dataapi.v1.DataAPIService/CallApi",
    baseUrl
  ).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.dataApiKey}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
      multipart_form_data: options.formData,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Data API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try {
      return JSON.parse((payload as Record<string, string>).jsonData ?? "{}");
    } catch {
      return (payload as Record<string, unknown>).jsonData;
    }
  }
  return payload;
}
