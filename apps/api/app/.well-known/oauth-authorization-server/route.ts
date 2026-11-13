// RFC 8414: Kivo Connect's authorization server metadata.
import { authorizationServer } from "../../../lib/connect/metadata"
import { preflight } from "../../../lib/connect/config"
export const dynamic = "force-dynamic"
export const GET = () => authorizationServer()
export const OPTIONS = preflight
