/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turns on next/navigation's forbidden()/unauthorized(), which the guild
  // pages use to return an actual 403/401 instead of faking it with notFound().
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
