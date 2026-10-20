import { ROLE_LABEL } from "@tier0/shared-moderation";
import { CheckIcon, InfoIcon, TrashIcon } from "../../../../../components/Icons";
import { MATRIX_ROLES, matrixGroups } from "./logic";

/** Server-safe: a reference table, no state. */
export function PermissionMatrix() {
  const groups = matrixGroups();
  return (
    <section className="mod-card" aria-labelledby="access-matrix-title">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title" id="access-matrix-title">
            What each level can do
          </h2>
          <p className="mod-card-desc">Generated from the permission rules the bot enforces.</p>
        </div>
      </div>

      {/* Focusable so a keyboard can scroll the table sideways on a narrow screen. */}
      <div className="access-matrix-wrap" tabIndex={0} role="region" aria-label="Permissions by access level">
        <table className="access-matrix">
          <caption className="visually-hidden">Permissions by access level</caption>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {MATRIX_ROLES.map((role) => (
                <th scope="col" key={role} className="access-cell">
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.title}>
              <tr className="access-group">
                <th scope="rowgroup" colSpan={MATRIX_ROLES.length + 1}>
                  {group.title}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.permission}>
                  <th scope="row" className="access-perm">
                    {row.label}
                  </th>
                  {row.allowed.map((allowed, index) => (
                    <td key={MATRIX_ROLES[index]} className="access-cell" data-allowed={allowed ? "true" : "false"}>
                      <span className="access-mark">
                        {allowed ? <CheckIcon /> : <span aria-hidden="true">&ndash;</span>}
                        <span>{allowed ? "Yes" : "No"}</span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="mod-card-body access-notes">
        <div className="callout callout-attention">
          <TrashIcon />
          <div>
            <strong>Only the owner can purge a record.</strong> A purge erases a member&rsquo;s entry together with its
            whole history and leaves no trace in the logs. Every other removal, by anyone, is recorded.
          </div>
        </div>
        <div className="callout callout-info">
          <InfoIcon />
          <div>
            <strong>Manage Server is not mod access.</strong> Having that permission in Discord does not let anyone
            open this dashboard; only the people listed on this page do. Every change to the list is written to the
            audit trail.
          </div>
        </div>
      </div>
    </section>
  );
}
