"use client";

import { useEffect, useState } from "react";
import type { StaffDto } from "@tier0/shared-moderation";
import { AlertIcon } from "../../../../../components/Icons";
import { RoleBadge } from "../../../../../components/mod/ModUi";
import { AddStaff } from "./AddStaff";
import { PermissionMatrix } from "./PermissionMatrix";
import { StaffTable } from "./StaffTable";
import { ROLE_SUMMARY, tallyRoles } from "./logic";
import "./access.css";

export interface AccessViewProps {
  guildId: string;
  /** Null when the list could not be loaded; loadError then says why. */
  staff: StaffDto[] | null;
  loadError?: string;
}

export function AccessView({ guildId, staff, loadError }: AccessViewProps) {
  const [freshId, setFreshId] = useState<string | null>(null);
  const staffUrl = (userId: string) => `/api/guilds/${guildId}/mod/staff/${encodeURIComponent(userId)}`;

  useEffect(() => {
    if (freshId === null) return;
    const timer = setTimeout(() => setFreshId(null), 3200);
    return () => clearTimeout(timer);
  }, [freshId]);

  const tally = staff ? tallyRoles(staff) : null;

  return (
    <div className="mod-root" role="region" aria-labelledby="access-title">
      <div className="mod-page">
        <header className="mod-section">
          <div className="mod-section-head">
            <div className="mod-section-text">
              <h2 className="mod-section-title" id="access-title">
                Access
              </h2>
              <p className="mod-section-desc">
                Choose who can open this server&rsquo;s moderation records and what each person can do. Everyone signs in
                with Discord. Only the people listed here and the instance owner have access.
              </p>
            </div>
          </div>
          <div className="mod-kpis access-room">
            <div className="mod-kpi">
              <span className="mod-kpi-label">
                <RoleBadge role="owner" />
              </span>
              <span className="mod-kpi-value">You</span>
              <span className="mod-kpi-foot access-kpi-note">Has access to every server. Not shown in the list.</span>
            </div>
            <div className="mod-kpi">
              <span className="mod-kpi-label">
                <RoleBadge role="admin" />
              </span>
              <span className="mod-kpi-value">{tally ? tally.admin : "–"}</span>
              <span className="mod-kpi-foot access-kpi-note">{ROLE_SUMMARY.admin}</span>
            </div>
            <div className="mod-kpi">
              <span className="mod-kpi-label">
                <RoleBadge role="mod" />
              </span>
              <span className="mod-kpi-value">{tally ? tally.mod : "–"}</span>
              <span className="mod-kpi-foot access-kpi-note">{ROLE_SUMMARY.mod}</span>
            </div>
          </div>
        </header>

        {staff === null ? (
          <div className="callout callout-error" role="alert">
            <AlertIcon />
            <div>
              <strong>The staff list could not be loaded.</strong> {loadError ?? "The bot did not answer."} Reload the
              page once the bot is back; nothing has been changed.
            </div>
          </div>
        ) : (
          <>
            <StaffTable staff={staff} staffUrl={staffUrl} freshId={freshId} />
            <AddStaff
              guildId={guildId}
              existing={new Set(staff.map((member) => member.user.userId))}
              staffUrl={staffUrl}
              onAdded={setFreshId}
            />
          </>
        )}

        <PermissionMatrix />
      </div>
    </div>
  );
}
