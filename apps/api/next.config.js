/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  // The shared packages are TypeScript source, consumed directly.
  transpilePackages: ["@repo/api", "@repo/db"],
  // pdfkit reads its own font metrics from disk at run time: required from
  // node_modules, never bundled (portable/note-pdf.ts).
  serverExternalPackages: ["pdfkit"],
}

export default nextConfig
