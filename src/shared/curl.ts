function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isFormData(value: unknown): value is { entries(): Iterable<[string, unknown]> } {
  const ctor = (globalThis as { FormData?: new (...args: never[]) => object }).FormData;
  return typeof ctor === "function" && value instanceof ctor;
}

function withParams(url: string, params: unknown): string {
  if (!params || typeof params !== "object") return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item != null) search.append(key, String(item));
    } else if (typeof value === "object") {
      search.append(key, JSON.stringify(value));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function headerLines(headers: unknown, dropContentType: boolean): string[] {
  if (!headers || typeof headers !== "object") return [];
  const lines: string[] = [];
  for (const [name, raw] of Object.entries(headers as Record<string, unknown>)) {
    if (dropContentType && name.toLowerCase() === "content-type") continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value == null) continue;
      lines.push(`-H ${shellQuote(`${name}: ${String(value)}`)}`);
    }
  }
  return lines;
}

function formLines(body: { entries(): Iterable<[string, unknown]> }): string[] {
  const lines: string[] = [];
  for (const [key, value] of body.entries()) {
    if (typeof value === "string") {
      lines.push(`-F ${shellQuote(`${key}=${value}`)}`);
      continue;
    }
    const file = value as { name?: unknown; type?: unknown };
    const filename = typeof file?.name === "string" && file.name ? file.name : "file";
    const type = typeof file?.type === "string" && file.type ? `;type=${file.type}` : "";
    lines.push(`-F ${shellQuote(`${key}=@${filename}${type}`)}`);
  }
  return lines;
}

/** 生成可在 bash / zsh 里直接执行的 curl，格式对齐浏览器的 Copy as cURL。 */
export function toCurl(input: {
  method?: string;
  url: string;
  headers?: unknown;
  params?: unknown;
  body?: unknown;
}): string {
  const method = (input.method || "GET").toUpperCase();
  const url = withParams(input.url, input.params);
  const form = isFormData(input.body);
  const parts = [`curl ${shellQuote(url)}`];
  const hasBody = form || (input.body != null && input.body !== "");
  if (method !== "GET" || hasBody) parts.push(`-X ${method}`);
  parts.push(...headerLines(input.headers, form));
  if (form) {
    parts.push(...formLines(input.body as { entries(): Iterable<[string, unknown]> }));
  } else if (input.body != null && input.body !== "") {
    let raw = "";
    try {
      raw = typeof input.body === "string" ? input.body : JSON.stringify(input.body) ?? "";
    } catch {
      raw = "";
    }
    if (raw) parts.push(`--data-raw ${shellQuote(raw)}`);
  }
  return parts.join(" \\\n  ");
}
