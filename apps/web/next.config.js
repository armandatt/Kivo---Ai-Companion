/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const apiUrl = process.env.API_URL ?? "http://localhost:3001"

    return [
      {
        source: "/api/signup",
        destination: `${apiUrl}/api/signup`,
      },
      {
        source: "/api/login",
        destination: `${apiUrl}/api/login`,
      },
      {
        source: "/api/logout",
        destination: `${apiUrl}/api/logout`,
      },
      {
        source: "/api/me",
        destination: `${apiUrl}/api/me`,
      },
      {
        source: "/api/onboarding",
        destination: `${apiUrl}/api/onboarding`,
      },
      {
        source: "/api/auth/google",
        destination: `${apiUrl}/api/auth/google`,
      },
      {
        source: "/api/auth/google/callback",
        destination: `${apiUrl}/api/auth/google/callback`,
      },
<<<<<<< HEAD
      {
        source: "/api/forgot-password",
        destination: `${apiUrl}/api/forgot-password`,
      },
      {
        source: "/api/reset-password",
        destination: `${apiUrl}/api/reset-password`,
      },
=======
>>>>>>> ccde3615727554342c1b928ce849dfc73a2c482b
    ]
  },
}

export default nextConfig
