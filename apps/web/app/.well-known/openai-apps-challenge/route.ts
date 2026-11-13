// OpenAI plugin directory domain verification: the portal shows a challenge
// token while connecting the MCP server (https://www.thekivo.in/api/mcp), and
// expects this address to return exactly that token as plain text. The token
// is set on Vercel as OPENAI_APPS_CHALLENGE; unset, the address is a 404.
// Docs: https://developers.openai.com/plugins/deploy/submission

export const dynamic = "force-dynamic"

export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim()
  if (!token) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  return new Response(token, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
}
