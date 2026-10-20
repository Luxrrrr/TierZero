"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActionTargetDto, EvidenceRef, ModActionKind } from "@tier0/shared-moderation";
import { ActionFormDialog } from "../../app/guilds/[id]/mod/members/[userId]/ActionForm";
import { memberState, successTitle } from "../../app/guilds/[id]/mod/members/[userId]/actions";
import type { ContextState } from "../../app/guilds/[id]/mod/members/[userId]/useActionContext";
import { menuName, type MenuUser } from "../../lib/person-menu";
import "../../app/mod.css";
import "../../app/guilds/[id]/mod/members/[userId]/profile.css";
import "../../app/guilds/[id]/mod/members/[userId]/actions.css";

interface Props {
  guildId: string;
  kind: ModActionKind;
  user: MenuUser;
  /** The message the action started from, kept with the case. */
  evidence?: EvidenceRef[];
  messageLink?: string;
  /** What the bot said about the person when the menu opened. Without it the dialog goes by whether they are known to be in the server. */
  standing: ActionTargetDto | null;
  contextState: ContextState;
  onRetry(): void;
  canConfigure: boolean;
  onClose(): void;
  onDone(result: { caseNumber: number | null; notes: string[]; title: string }): void;
}

/**
 * The same action dialog as on a member's record, opened over whatever page the
 * menu was used on. It is loaded only when an action is chosen, so the pages
 * that merely offer the menu do not carry the form with them.
 */
export function ActionDialogHost({ guildId, kind, user, evidence, messageLink, standing, contextState, onRetry, canConfigure, onClose, onDone }: Props) {
  const [timeZone, setTimeZone] = useState("UTC");
  const [now] = useState(() => new Date());
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  // No record is read here, so the person's state comes from what Discord said, or from the chip when it said nothing.
  const member = useMemo(() => memberState({ user: { inServer: user.inServer }, infractions: [] }, now, standing), [user.inServer, now, standing]);
  const name = menuName(user);

  return (
    <ActionFormDialog
      key={kind}
      kind={kind}
      guildId={guildId}
      userId={user.userId}
      name={name}
      member={member}
      contextState={contextState}
      onRetry={onRetry}
      canConfigure={canConfigure}
      timeZone={timeZone}
      fallbackFocus={() => null}
      onClose={onClose}
      onDone={({ caseNumber, notes }) => onDone({ caseNumber, notes, title: successTitle(kind, name, caseNumber, kind === "timeout" && member.timedOut) })}
      evidence={evidence}
      messageLink={messageLink}
    />
  );
}
