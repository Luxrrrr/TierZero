import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { prisma } from "@tier0/db";
import { sealedTokenFields } from "./token-crypto";

// `guilds` is what lets the dashboard read the caller's permissions per guild
// later, in lib/discord.ts; `identify` is the minimum Discord requires for
// any provider at all.
const SCOPES = "identify guilds";

// A warning and not a refusal, so an install with a short secret keeps working. The same secret seals the stored Discord tokens.
const sessionSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
if (sessionSecret.length > 0 && sessionSecret.length < 32) {
  console.warn("AUTH_SECRET is shorter than 32 characters. Set a long random one in .env, for example with: openssl rand -hex 32");
}

/** The tokens Discord hands over at sign-in are stored sealed, so a copy of the database holds nothing that works. */
function sealAccount(account: AdapterAccount): AdapterAccount {
  return { ...account, ...sealedTokenFields(account) };
}

const prismaAdapter = PrismaAdapter(prisma);
const adapter: Adapter = {
  ...prismaAdapter,
  linkAccount: (account) => prismaAdapter.linkAccount?.(sealAccount(account)),
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database" },
  // Self-hosted behind whatever domain or port the operator chose, never a
  // fixed Vercel-style URL, so the request's own Host header is trusted
  // so there is no second environment variable to keep in step with it.
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // Discord returns `iss` on the callback (RFC 9207) and the provider's
      // default issuer is a placeholder, so without this every sign-in is
      // rejected as an issuer mismatch.
      issuer: "https://discord.com",
      authorization: { params: { scope: SCOPES } },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  events: {
    // An account that is already linked keeps the tokens it was first given, so each sign-in stores the fresh ones.
    // It is also how someone whose tokens could not be opened, after AUTH_SECRET changed, gets working ones again.
    async signIn({ account }) {
      if (account?.provider !== "discord" || !account.access_token) return;
      await prisma.account.updateMany({
        where: { provider: "discord", providerAccountId: account.providerAccountId },
        data: { ...sealedTokenFields(account), ...(typeof account.expires_at === "number" ? { expires_at: account.expires_at } : {}) },
      });
    },
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
