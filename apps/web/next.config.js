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
        source: "/api/dashboard",
        destination: `${apiUrl}/api/dashboard`,
      },
      {
        source: "/api/goals",
        destination: `${apiUrl}/api/goals`,
      },
      {
        source: "/api/planner",
        destination: `${apiUrl}/api/planner`,
      },
      {
        source: "/api/insights",
        destination: `${apiUrl}/api/insights`,
      },
      {
        source: "/api/creature",
        destination: `${apiUrl}/api/creature`,
      },
      {
        source: "/api/creature-rename",
        destination: `${apiUrl}/api/creature-rename`,
      },
      {
        source: "/api/settings",
        destination: `${apiUrl}/api/settings`,
      },
      {
        source: "/api/delete-account",
        destination: `${apiUrl}/api/delete-account`,
      },
      {
        source: "/api/nav",
        destination: `${apiUrl}/api/nav`,
      },
=======
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
>>>>>>> a51671498b1a78c2f5881a550a4f39addaaf076e
    ]
  },
}

export default nextConfig
