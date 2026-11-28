import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeInternalPath } from './after-signup'

test('only internal page paths are kept', () => {
  assert.equal(safeInternalPath('/map/import'), '/map/import')
  assert.equal(safeInternalPath('/map?explore=subject%3Aabc'), '/map?explore=subject%3Aabc')
  for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil', 'map/import', '/api/nova/subjects', '/signin?from=/x', '/onboarding', '', null, undefined, '/x://y']) {
    assert.equal(safeInternalPath(bad as string | null), null, String(bad))
  }
})
