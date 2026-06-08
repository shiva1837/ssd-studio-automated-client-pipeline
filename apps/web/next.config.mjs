/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web app talks to the API exclusively over NEXT_PUBLIC_API_BASE_URL.
  // No rewrites needed; CORS is configured on the Express side.
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
