import type { Metadata } from "next";
import { AuthCard } from "../../components/AuthCard";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Connection not private",
};

// The proxy sends visitors here, so it has to render without a session or a database.
export const dynamic = "force-dynamic";

export default function InsecurePage() {
  return (
    <AuthCard mark={<Logo />} brand={false}>
      <h1 className="auth-title">This connection isn&apos;t private</h1>
      <p className="auth-text">
        You opened the dashboard over plain HTTP at an address that other people can reach. Signing in
        here would send your session in the clear, so sign-in is switched off until the connection uses
        HTTPS.
      </p>
      <p className="auth-text">
        On a server, use a Cloudflare Tunnel or an HTTPS proxy and set <code>DASHBOARD_BIND=127.0.0.1</code> in{" "}
        <code>.env</code>. The install guide has the steps. At home, open the dashboard at the computer&apos;s
        network address or over Tailscale and this screen won&apos;t appear.
      </p>
      <p className="auth-foot">
        Already behind HTTPS and still seeing this? Make the proxy send <code>X-Forwarded-Proto: https</code>. If
        you know the address is private, set <code>ALLOW_INSECURE_HTTP=true</code> in <code>.env</code>.
      </p>
    </AuthCard>
  );
}
