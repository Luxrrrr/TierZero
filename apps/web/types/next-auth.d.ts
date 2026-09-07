import type { DefaultSession } from "next-auth";

// The database session strategy hands the session callback a `user` row with
// an id, but the library's own Session type doesn't carry it through. Every
// authorization check keys off session.user.id, so it needs to be there.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
