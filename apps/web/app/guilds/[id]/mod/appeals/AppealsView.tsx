import Link from "next/link";
import type { AppealDetailDto, AppealDto, AppealListDto } from "@tier0/shared-moderation";
import { AlertIcon, InboxIcon } from "../../../../../components/Icons";
import { Avatar, EmptyState, Pager, PastEnd, Pill, RelativeTime, displayName, isPastEnd } from "../../../../../components/mod/ModUi";
import { PersonMenuArea } from "../../../../../components/mod/PersonMenuArea";
import {
  APPEAL_FILTERS,
  APPEAL_STATUS_LABEL,
  APPEAL_STATUS_TONE,
  appealPreview,
  appealsHref,
  emptyAppealsTitle,
  type AppealsQuery,
} from "../../../../../lib/mod-appeals";
import { AppealDetail } from "./AppealDetail";

export type DetailState =
  | null
  | { ok: true; data: AppealDetailDto }
  | { ok: false; id: number; status: number; message: string };

interface Props {
  guildId: string;
  query: AppealsQuery;
  list: AppealListDto;
  detail: DetailState;
  canConfigure: boolean;
}

/** The list of appeals with the open one beside it. Server-rendered; only the open appeal's decisions run in the browser. */
export function AppealsView({ guildId, query, list, detail, canConfigure }: Props) {
  const hrefFor = (page: number) => appealsHref(guildId, { status: query.status, page });
  const closeHref = appealsHref(guildId, { status: query.status, page: query.page });

  return (
    <div className="mod-root mod-page appeals-page">
      <section className="mod-section" aria-labelledby="appeals-heading">
        <div className="mod-section-head">
          <div className="mod-section-text">
            <h2 className="mod-section-title" id="appeals-heading">
              Ban appeals
            </h2>
            <p className="mod-section-desc">
              Banned members can ask for their ban to be lifted. Read each appeal with their record, then accept or deny it.
            </p>
          </div>
        </div>

        <div className="mod-toolbar">
          <div className="mod-toolbar-group" suppressHydrationWarning role="group" aria-label="Status">
            {APPEAL_FILTERS.map((chip) => (
              <Link
                key={chip.value}
                className="mod-chip"
                href={appealsHref(guildId, { status: chip.value })}
                aria-current={query.status === chip.value ? "true" : undefined}
              >
                {chip.label}
                {chip.value === "pending" && list.pending > 0 ? (
                  <span className="mod-chip-count">
                    {list.pending.toLocaleString("en")}
                    <span className="visually-hidden"> waiting</span>
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </div>

        <div className="appeals-layout" data-open={detail ? "true" : undefined}>
          <div className="appeals-list-col">
            <AppealList guildId={guildId} query={query} list={list} canConfigure={canConfigure} hrefFor={hrefFor} />
          </div>
          {detail ? (
            <div className="appeals-detail-col">
              {detail.ok ? (
                <AppealDetail key={detail.data.appeal.id} guildId={guildId} detail={detail.data} closeHref={closeHref} status={query.status} />
              ) : (
                <div className="mod-card">
                  <EmptyState
                    icon={<AlertIcon />}
                    title={detail.status === 404 ? `Appeal #${detail.id} was not found` : `Appeal #${detail.id} could not be loaded`}
                    tone={detail.status === 404 ? "attention" : "danger"}
                    role="alert"
                    action={
                      <Link className="btn btn-secondary btn-sm" href={closeHref}>
                        Close
                      </Link>
                    }
                  >
                    {detail.status === 404 ? "It may have been deleted with the member's record. Pick another appeal from the list." : detail.message}
                  </EmptyState>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AppealList({
  guildId,
  query,
  list,
  canConfigure,
  hrefFor,
}: {
  guildId: string;
  query: AppealsQuery;
  list: AppealListDto;
  canConfigure: boolean;
  hrefFor(page: number): string;
}) {
  if (list.items.length === 0 && isPastEnd(list.page, list.pageSize, list.total)) {
    return (
      <div className="mod-card">
        <PastEnd total={list.total} pageSize={list.pageSize} noun="appeals" hrefFor={hrefFor} />
      </div>
    );
  }

  if (list.items.length === 0) {
    const waiting = query.status === "pending" || query.status === "all";
    return (
      <div className="mod-card">
        <EmptyState icon={<InboxIcon />} title={emptyAppealsTitle(query.status)}>
          {waiting ? (
            <>
              To let banned members appeal, turn appeals on in the Moderation settings, under{" "}
              {canConfigure ? <Link href={`/guilds/${guildId}/mod/settings#section-appeals`}>Ban appeals</Link> : "Ban appeals"}.
            </>
          ) : (
            "Appeals are listed here once someone decides them."
          )}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mod-card">
      <ul className="appeals-list" aria-label="Appeals, newest first">
        {list.items.map((appeal) => (
          <AppealRow key={appeal.id} guildId={guildId} query={query} appeal={appeal} />
        ))}
      </ul>
      <div className="appeals-pager">
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={hrefFor} />
      </div>
    </div>
  );
}

function AppealRow({ guildId, query, appeal }: { guildId: string; query: AppealsQuery; appeal: AppealDto }) {
  const open = query.appeal === appeal.id;
  return (
    <li>
      <PersonMenuArea user={appeal.user}>
        <Link
          className="appeals-row"
          href={appealsHref(guildId, { status: query.status, page: query.page, appeal: appeal.id })}
          aria-current={open ? "true" : undefined}
          scroll={false}
        >
          <Avatar user={appeal.user} menu={false} />
          <span className="appeals-row-main">
            <span className="appeals-row-line">
              <span className="appeals-row-name">{displayName(appeal.user)}</span>
              <span className="appeals-row-case">Case #{appeal.caseNumber}</span>
              <Pill tone={APPEAL_STATUS_TONE[appeal.status]}>{APPEAL_STATUS_LABEL[appeal.status]}</Pill>
              <RelativeTime className="appeals-row-when" iso={appeal.createdAt} />
            </span>
            <span className="appeals-row-text">{appealPreview(appeal.text)}</span>
          </span>
        </Link>
      </PersonMenuArea>
    </li>
  );
}
