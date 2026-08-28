export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers || {});
  
  if (url.startsWith("/api/") || url.includes("/api/")) {
    const password = localStorage.getItem("iptv_admin_password") || "";
    if (password && !headers.has("x-admin-password")) {
      headers.set("x-admin-password", password);
    }
  }

  const response = await window.fetch(input, { ...init, headers });
  
  if (response.status === 401 && !url.includes("/api/auth/verify") && !url.includes("/api/auth/status")) {
    window.dispatchEvent(new CustomEvent("iptv_auth_required"));
  }

  return response;
}

export async function safeJson<T = any>(res: Response, fallback: T = {} as T): Promise<any> {
  try {
    const text = await res.text();
    if (!text || !text.trim()) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return { ...fallback, error: text || `HTTP ${res.status} ${res.statusText}` };
    }
  } catch (err: any) {
    return { ...fallback, error: err?.message || "网络请求异常" };
  }
}

