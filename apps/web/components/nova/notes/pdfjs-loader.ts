// PDF.js, loaded once on first use, with its worker. Shared by the reader
// (pdf-reader.tsx) and by importing a PDF as a note (note-import.tsx).
type Pdfjs = typeof import('pdfjs-dist')
let loading: Promise<Pdfjs> | null = null
export function pdfjs(): Promise<Pdfjs> {
  loading ??= import('pdfjs-dist').then(m => {
    if (!m.GlobalWorkerOptions.workerPort) {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    }
    return m
  })
  return loading
}
