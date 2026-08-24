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
