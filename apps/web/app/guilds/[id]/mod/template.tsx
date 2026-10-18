import type { ReactNode } from "react";
import { PageEnter } from "../../../../components/PageEnter";

export default function ModTemplate({ children }: { children: ReactNode }) {
  return <PageEnter scope="mod">{children}</PageEnter>;
}
