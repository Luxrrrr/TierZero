import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@tier0/db";

// `guilds` is what lets the dashboard read the caller's permissions per guild
// later, in lib/discord.ts; `identify` is the minimum Discord requires for
// any provider at all.
const SCOPES = "identify guilds";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // Self-hosted behind whatever domain or port the operator chose, never a
  // fixed Vercel-style URL, so the request's own Host header is trusted
  // so there is no second environment variable to keep in step with it.
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: SCOPES } },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
