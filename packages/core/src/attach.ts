import type { FieldDescriptor, MessageAttach } from "./schema.js";

type Fields = Record<string, FieldDescriptor>;

function fieldAt(fields: Fields, path: string): FieldDescriptor | undefined {
  const [key, ...rest] = path.split(".");
  const field = key === undefined ? undefined : fields[key];
  if (!field || rest.length === 0) return field;
  return field.kind === "object" ? fieldAt((field.fields ?? {}) as Fields, rest.join(".")) : undefined;
}

/**
 * What is wrong with a message's `attach`: every path must name a setting of
 * the kind the dashboard edits it as. `parentFields` are the fields beside the
 * message, `rootFields` the module's top level. Empty when all is well.
 */
export function messageAttachProblems(attach: MessageAttach, parentFields: Fields, rootFields: Fields): string[] {
  const problems: string[] = [];
  const need = (ref: string | undefined, kind: string, what: string, fields: Fields = parentFields) => {
    if (ref === undefined) return;
    const field = ref.startsWith("/") ? fieldAt(rootFields, ref.slice(1)) : fieldAt(fields, ref);
    if (!field) problems.push(`${what} names ${ref}, which is not a setting`);
    else if (field.kind !== kind) problems.push(`${what} names ${ref}, which is a ${field.kind} rather than a ${kind}`);
  };

  if (attach.kind === "list") {
    const list = attach.list.startsWith("/") ? undefined : parentFields[attach.list];
    const row = list?.kind === "array" ? (list.of as FieldDescriptor) : undefined;
    if (row?.kind !== "object") {
      problems.push(`the list ${attach.list} is not a list of rows beside the message`);
      return problems;
    }
    const rowFields = (row.fields ?? {}) as Fields;
    need(attach.label, "string", "the label", rowFields);
    need(attach.labelFallback, "string", "the label fallback", rowFields);
    need(attach.emoji, "emoji", "the emoji", rowFields);
    need(attach.style, "choice", "the colour", rowFields);
    need(attach.description, "string", "the description", rowFields);
    need(attach.mode?.field, "choice", "the mode");
    need(attach.placeholder, "string", "the placeholder");
    if (attach.noun.trim() === "") problems.push("the noun is empty");
    return problems;
  }

  if (attach.buttons.length === 0) problems.push("no buttons are listed");
  for (const button of attach.buttons) {
    need(button.label, "string", `the ${button.name} button's text`);
    need(button.style, "choice", `the ${button.name} button's colour`);
    need(button.when, "boolean", `the ${button.name} button's condition`);
  }
  return problems;
}
