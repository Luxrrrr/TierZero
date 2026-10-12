import { redirect } from "next/navigation";

/** The message log became the Messages view of Server logs. Old links and bookmarks land there. */
export default async function MessagesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/guilds/${id}/mod/server-logs?view=messages`);
}
