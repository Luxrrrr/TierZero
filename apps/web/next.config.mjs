import fs from "node:fs";
import { URL } from "node:url";

// The installed version is the root package's version, which is bumped for each release. It is read at build
// time, since the runtime image has no git history to ask.
const root = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turns on next/navigation's forbidden()/unauthorized(), which the guild
  // pages use to return an actual 403/401 instead of faking it with notFound().
  experimental: {
    authInterrupts: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: root.version ?? "0.0.0",
  },
  // next dev otherwise writes a pair of editor tooling files into this
  // directory on every run. They are generated output, not project files.
  agentRules: false,
};

export default nextConfig;
