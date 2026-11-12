import { NextResponse } from "next/server"
//@ts-ignore
import { loadLibrary, readLibraryQuery } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { listCollections } from "@repo/api/nova/product/resource-collections"
import { requireWebLearner } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/saved?q=&type=&collection=&tag=&status=&domain=&days=&sort=&cursor=&limit=
// The saved-pages library, a page at a time: searched, filtered and sorted
// on the server, with the counts the filters show (product/learning-events.ts
// loadLibrary) and the learner's collections (product/resource-collections.ts).
// The learner is the session's own; nothing in the query names one.
// Response: LibraryResponse.
export async function GET(req: Request) {
  try {
    const access = await requireWebLearner()
    if (access.denied) {
      if (access.status !== "unauthenticated") return NextResponse.json({ status: access.status })
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    const library = await loadLibrary(access.platformChatId, readLibraryQuery(new URL(req.url).searchParams))
    if (library.status !== "ready") return NextResponse.json(library)
    return NextResponse.json({ ...library, facets: { ...library.facets, collections: await listCollections(access.profileId) } }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/saved]", err)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}
