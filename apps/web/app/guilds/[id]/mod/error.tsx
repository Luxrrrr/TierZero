"use client";

import { RouteError } from "../../../../components/mod/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <RouteError error={error} reset={reset} what="the overview" />;
}
