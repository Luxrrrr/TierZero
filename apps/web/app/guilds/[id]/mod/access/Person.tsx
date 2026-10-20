import type { UserRef } from "@tier0/shared-moderation";
import { Avatar, displayName } from "../../../../../components/mod/ModUi";

/** Avatar, name and id on two lines. The id matters here: it is what the owner would paste to add the same person. */
export function Person({ user, size }: { user: UserRef; size?: "sm" | "lg" | "xl" }) {
  return (
    <span className="mod-user">
      <Avatar user={user} size={size} />
      <span className="mod-user-text">
        <span className="mod-user-name">
          {displayName(user)}
          {!user.inServer && user.name !== null ? <span className="mod-user-left"> left</span> : null}
        </span>
        <span className="mod-user-sub mod-id">{user.userId}</span>
      </span>
    </span>
  );
}
