import type { Metadata } from "next";
import { HostedSettings, hostedMetadata } from "./hosted";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return hostedMetadata(id);
}

export default async function ModerationSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <HostedSettings guildId={id} />;
}
