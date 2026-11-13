// RFC 9728: how an MCP client finds where to sign in for /api/mcp.
import { protectedResource } from "../../../lib/connect/metadata"
import { preflight } from "../../../lib/connect/config"
export const dynamic = "force-dynamic"
export const GET = () => protectedResource()
export const OPTIONS = preflight
