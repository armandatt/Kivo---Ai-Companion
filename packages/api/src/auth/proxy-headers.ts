// The two headers the web app's auth proxy adds for the API. No imports: both
// apps read these names from here. What they mean is in http.ts.
export const PROXY_PROOF_HEADER = "x-kivo-proxy-proof";
export const PROXY_CLIENT_IP_HEADER = "x-kivo-client-ip";
// The site address the browser used (already checked by the proxy against the
// allowed origins), so links in emails open where the person asked from.
export const PROXY_APP_ORIGIN_HEADER = "x-kivo-app-origin";
