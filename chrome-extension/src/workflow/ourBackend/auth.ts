const STORAGE_KEY = "ourBackend";

export interface OurBackendConfig {
  baseUrl: string;
  accessToken: string;
  hotelCode: string;
}

export async function getOurBackendConfig(): Promise<OurBackendConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (stored[STORAGE_KEY] ?? {}) as Record<string, unknown>;
  const baseUrl = String(raw.baseUrl ?? "").replace(/\/$/, "");
  const accessToken = String(raw.accessToken ?? "");
  const hotelCode = String(raw.hotelCode ?? "");
  if (!baseUrl || !accessToken) {
    throw new Error("未配置产品后端（chrome.storage.ourBackend.baseUrl / accessToken），无法 call_bot / call_backend");
  }
  return { baseUrl, accessToken, hotelCode };
}

export function ourBackendHeaders(cfg: OurBackendConfig, hotelCode?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.accessToken}`,
    "Hotel-Code": hotelCode || cfg.hotelCode || "",
  };
}
