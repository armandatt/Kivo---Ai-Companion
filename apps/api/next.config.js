/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  // The shared packages are TypeScript source, consumed directly.
  transpilePackages: ["@repo/api", "@repo/db"],
}

export default nextConfig
