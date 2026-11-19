// Kivo Connect images: the pure parts (captions, sections, Markdown) and the
// checks every image passes before anything is stored, for each way an
// assistant can send one (base64, a public url, a ChatGPT file).

import { deflateSync, crc32 } from "node:zlib";
import { cleanCaption, imageKey, imagesMarkdown, insertAt, readyImages, sectionEnd, IMAGES_PER_WRITE } from "../images";
import { imagesInText } from "../../nova/product/note-images";
import { isClientKey } from "../../nova/product/pdf-highlights";
import { FetchRefused, type Get } from "../../nova/product/paper-fetch";

// A real PNG, w×h, one colour.
export function png(w: number, h: number, rgb: [number, number, number] = [200, 30, 30]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

const fakeGet = (routes: Record<string, { status?: number; body?: Buffer; refuse?: FetchRefused }>): Get => async (url) => {
  const r = routes[url];
  if (!r) throw new FetchRefused("network", "unreachable");
  if (r.refuse) throw r.refuse;
  return { status: r.status ?? 200, type: "image/png", body: r.body ?? Buffer.alloc(0), url };
};

describe("captions and Markdown", () => {
  it("keeps the image's Markdown whole: one line, no brackets, trimmed", () => {
    expect(cleanCaption("  Page [3]\n of the\tdiagram ]")).toBe("Page 3 of the diagram");
    expect(cleanCaption(undefined)).toBe("");
    expect(cleanCaption("x".repeat(400)).length).toBe(200);
  });
  it("round-trips: what is written is read back in order with captions", () => {
    const md = imagesMarkdown([{ id: "ckimage0001", caption: "Page table" }, { id: "ckimage0002", caption: "" }]);
    expect(md).toBe("![Page table](kivo-image:ckimage0001)\n\n![](kivo-image:ckimage0002)");
    const body = `# OS\n\nText with [a link](https://x.y).\n\n${md}\n\nMore ![Page table](kivo-image:ckimage0001) again.`;
    expect(imagesInText(body)).toEqual([{ id: "ckimage0001", caption: "Page table" }, { id: "ckimage0002", caption: "" }]);
  });
});

describe("sections", () => {
  const body = "# Operating Systems\n\nIntro.\n\n## Paging\n\nPages are fixed size.\n\n### TLB\n\nCache.\n\n## Scheduling\n\nRound robin.\n\n```\n# not a heading\n```";
  it("finds the end of a section, including its sub-sections, and only that one", () => {
    const s = sectionEnd(body, "paging");
    expect(s.at).toBe(body.indexOf("## Scheduling"));
    const out = insertAt(body, s.at!, "![](kivo-image:ckimage0001)");
    expect(out).toContain("Cache.\n\n![](kivo-image:ckimage0001)\n\n## Scheduling");
    expect(out.replace("\n\n![](kivo-image:ckimage0001)", "")).toBe(body);
  });
  it("the last section ends at the end; headings inside code are not headings", () => {
    expect(sectionEnd(body, "## Scheduling").at).toBe(body.length);
    const missing = sectionEnd(body, "not a heading");
    expect(missing.at).toBeNull();
    expect(missing.headings).toEqual(["Operating Systems", "Paging", "TLB", "Scheduling"]);
  });
});

describe("readyImages: checked before anything is stored", () => {
  const a = png(4, 3), b = png(2, 2, [0, 0, 255]);
  it("takes base64 (with or without a data: prefix), a url and a ChatGPT file, in order", async () => {
    const r = await readyImages(
      [{ data: a.toString("base64"), caption: "First" }, { data: `data:image/png;base64,${b.toString("base64")}` }, { url: "https://img.example/x.png", caption: "Third" }],
      [{ download_url: "https://files.example/abc", file_id: "file_1" }], ["Fourth [chat]"],
      fakeGet({ "https://img.example/x.png": { body: b }, "https://files.example/abc": { body: a } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map(i => [i.from, i.width, i.height, i.caption])).toEqual([["data", 4, 3, "First"], ["data", 2, 2, ""], ["url", 2, 2, "Third"], ["file", 4, 3, "Fourth chat"]]);
    expect(r.images[0]!.hash).toBe(r.images[3]!.hash);
  });
  it("refuses the whole call, naming the image, when any one can't be used", async () => {
    const get = fakeGet({ "https://img.example/404": { status: 404 }, "https://img.example/big": { refuse: new FetchRefused("too_large", "x") }, "https://img.example/text": { body: Buffer.from("<html>") } });
    const ok = { data: a.toString("base64") };
    expect(await readyImages([ok, { url: "https://img.example/404" }], [], [], get)).toEqual({ ok: false, index: 1, message: "Image 2: The image address answered 404." });
    expect(await readyImages([{ url: "https://img.example/big" }], [], [], get)).toMatchObject({ ok: false, message: expect.stringContaining("larger than 2.5 MB") });
    expect(await readyImages([{ url: "https://img.example/text" }], [], [], get)).toMatchObject({ ok: false, message: expect.stringContaining("PNG, JPEG or WebP") });
    expect(await readyImages([{ data: Buffer.from("GIF89a....").toString("base64") }], [], [], get)).toMatchObject({ ok: false });
    expect(await readyImages([{ data: ok.data, url: "https://img.example/x" }], [], [], get)).toMatchObject({ ok: false, message: expect.stringContaining("either data") });
    expect(await readyImages([{}], [], [], get)).toMatchObject({ ok: false });
    expect(await readyImages(Array.from({ length: IMAGES_PER_WRITE }, () => ok), [{ download_url: "https://f", file_id: "f" }], [], get)).toMatchObject({ ok: false, message: expect.stringContaining(`At most ${IMAGES_PER_WRITE}`) });
  });
  it("a private address is refused by the real fetcher before any request", async () => {
    expect(await readyImages([{ url: "https://127.0.0.1/a.png" }])).toMatchObject({ ok: false, message: expect.stringContaining("public internet") });
    expect(await readyImages([{ url: "http://example.com/a.png" }])).toMatchObject({ ok: false, message: expect.stringContaining("https://") });
  });
});

describe("image keys", () => {
  it("are valid client keys, stable for the same note and bytes, different across notes", () => {
    const k = imageKey("note1", "abc");
    expect(isClientKey(k)).toBe(true);
    expect(imageKey("note1", "abc")).toBe(k);
    expect(imageKey("note2", "abc")).not.toBe(k);
  });
});
