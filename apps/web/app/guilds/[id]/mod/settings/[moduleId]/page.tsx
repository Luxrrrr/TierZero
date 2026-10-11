import type { Metadata } from "next";
import { HostedSettings, hostedMetadata } from "../hosted";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}): Promise<Metadata> {
  const { id, moduleId } = await params;
  return hostedMetadata(id, moduleId);
}

export default async function HostedModuleSettingsPage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;
  return <HostedSettings guildId={id} moduleId={moduleId} />;
}
