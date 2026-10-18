import type { ReactNode } from "react";
import { PageEnter } from "../../../../components/PageEnter";

export default function TicketsTemplate({ children }: { children: ReactNode }) {
  return <PageEnter scope="tickets">{children}</PageEnter>;
}
