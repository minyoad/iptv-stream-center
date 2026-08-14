export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers || {});
  
  if (url.startsWith("/api/")) {
    const password = localStorage.getItem("iptv_admin_password") || "";
    if (password && !headers.has("x-admin-password")) {
      headers.set("x-admin-password", password);
    }
  }

  return window.fetch(input, { ...init, headers });
}
