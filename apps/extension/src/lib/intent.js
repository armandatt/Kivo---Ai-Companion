// Which way a request goes (server: product/browser-intent.ts):
//   chat      answered from the page in one call (…/ask, with the page's text)
//   task      the browser agent, on the user's own tab
//   research  the browser agent, with tabs of its own for other sites
//   clarify   a question back first
// A screenshot question is always chat (the picture is what is read), and
// when Kivo cannot be reached the surface's own way is used: chat in the
// popup, a task in the side panel. Nothing here guesses from the words.

export function routeOf(intent, { surface = 'panel', hasScreenshot = false } = {}) {
  if (hasScreenshot) return { route: 'chat', kind: 'page_question', scope: intent?.scope ?? null, fallback: !intent }
  if (!intent || !intent.route) return { route: surface === 'popup' ? 'chat' : 'task', kind: null, scope: null, fallback: true }
  return { route: intent.route, kind: intent.kind ?? null, scope: intent.scope ?? null, question: intent.question ?? null, choices: intent.choices ?? [], fallback: intent.fallback === true }
}

/** Asks Kivo; never throws. */
export async function classify(client, { request, page, hasSelection, hasScreenshot, lastAnswer, surface }) {
  if (hasScreenshot) return routeOf(null, { surface, hasScreenshot })
  const res = await client.intent({ request, pageTitle: page?.title ?? '', site: page?.domain ?? '', hasSelection: Boolean(hasSelection), hasScreenshot: false, lastAnswer: String(lastAnswer ?? '').slice(0, 600), surface })
  return routeOf(res.ok && res.data?.success ? res.data : null, { surface })
}
