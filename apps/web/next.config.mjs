/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turns on next/navigation's forbidden()/unauthorized(), which the guild
  // pages use to return an actual 403/401 instead of faking it with notFound().
  experimental: {
    authInterrupts: true,
  },
  // next dev otherwise writes a pair of editor tooling files into this
  // directory on every run. They are generated output, not project files.
  agentRules: false,
};

export default nextConfig;
