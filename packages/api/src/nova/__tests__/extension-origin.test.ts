// Which origins the extension routes answer across origins: a browser
// extension's own, in Chrome and in Safari, and nothing else. The rule lives
// in apps/api (it needs the request), so it is read from there and run here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

const source = read("apps/api/lib/nova/extension-access.ts");

// The origin rule itself: from the list of schemes to the headers it gives.
// It uses nothing but the request, so it runs as it is written.
const rule = source.slice(source.indexOf("const EXTENSION_ORIGINS"), source.indexOf("export function withCors"));
const compiled = ts.transpileModule(rule, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded: {
  fromExtensionOrigin: (req: Request) => boolean;
  extensionCors: (req: Request) => Record<string, string>;
} = { fromExtensionOrigin: () => false, extensionCors: () => ({}) };
new Function("exports", compiled)(loaded);
const { fromExtensionOrigin, extensionCors } = loaded;

const from = (origin: string | null) =>
  ({ headers: new Headers(origin === null ? {} : { origin }) }) as unknown as Request;

const CHROME = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const SAFARI = "safari-web-extension://0A1B2C3D-0000-4000-8000-123456789ABC";

describe("which origins the extension routes answer", () => {
  it("names two schemes, one for each browser family, and no others", () => {
    const list = source.match(/const EXTENSION_ORIGINS = (\[[^\]]*\])/);
    expect(list).not.toBeNull();
    expect(JSON.parse(list![1]!)).toEqual(["chrome-extension://", "safari-web-extension://"]);
  });

  it("answers a Chrome extension as before", () => {
    expect(fromExtensionOrigin(from(CHROME))).toBe(true);
    expect(extensionCors(from(CHROME))).toEqual({
      "access-control-allow-origin":  CHROME,
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age":       "600",
      "vary":                         "origin",
    });
  });

  it("answers a Safari extension the same way, with its own origin", () => {
    expect(fromExtensionOrigin(from(SAFARI))).toBe(true);
    expect(extensionCors(from(SAFARI))).toEqual({ ...extensionCors(from(CHROME)), "access-control-allow-origin": SAFARI });
  });

  it("answers no web page, no missing origin and nothing that only looks like an extension", () => {
    const refused = [
      null, "", "null", "*",
      "https://evil.test", "http://localhost:3000", "https://kivo.example",
      "https://safari-web-extension://x", "https://evil.test/safari-web-extension://x",
      "safari-web-extension:evil.test", "safari-web-extension.evil.test", "Safari-Web-Extension://x",
      "safari-extension://x", "moz-extension://x", "chrome://settings", "file://",
    ];
    for (const origin of refused) {
      expect(fromExtensionOrigin(from(origin))).toBe(false);
      expect(extensionCors(from(origin))).toEqual({});
    }
  });

  it("answers no origin longer than an extension's can be", () => {
    expect(extensionCors(from(`safari-web-extension://${"a".repeat(100)}`))).toEqual({});
    expect(extensionCors(from(`chrome-extension://${"a".repeat(100)}`))).toEqual({});
  });

  it("never allows cookies or every origin with these headers", () => {
    for (const origin of [CHROME, SAFARI]) {
      const headers = extensionCors(from(origin));
      expect(Object.keys(headers)).not.toContain("access-control-allow-credentials");
      expect(Object.values(headers)).not.toContain("*");
    }
    expect(source).not.toMatch(/access-control-allow-credentials/i);
  });
});

describe("which routes give those headers", () => {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(repo, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(repo, path)).isDirectory()) walk(path);
      else if (name === "route.ts") routes.push(path);
    }
  };
  walk("apps/api/app/api");
  const answering = routes.filter(path => /withCors|preflight|extensionCors/.test(read(path))).sort();

  it("only the five the extension calls", () => {
    expect(answering).toEqual([
      "apps/api/app/api/nova/extension/ask/route.ts",
      "apps/api/app/api/nova/extension/connect/route.ts",
      "apps/api/app/api/nova/extension/context/route.ts",
      "apps/api/app/api/nova/extension/disconnect/route.ts",
      "apps/api/app/api/nova/learning-events/route.ts",
    ]);
  });

  it("each answers its preflight and puts the headers on its reply", () => {
    for (const path of answering) {
      const route = read(path);
      expect(route).toContain("export const OPTIONS = preflight");
      expect(route).toContain("return withCors(req,");
    }
  });
});
