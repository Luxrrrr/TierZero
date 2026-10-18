import type { FieldDescriptor, FieldTopic } from "./schema.js";

type Fields = Record<string, FieldDescriptor>;

const LAYOUTS = ["messages", "fields"];
const AUDIENCES = ["public", "private", "dm"];

function walk(field: FieldDescriptor, path: string, visit: (field: FieldDescriptor, path: string, inList: boolean) => void, inList = false): void {
  visit(field, path, inList);
  if (field.kind === "object") {
    for (const [key, child] of Object.entries((field.fields ?? {}) as Fields)) walk(child, path ? `${path}.${key}` : key, visit, inList);
  } else if (field.kind === "array") {
    walk(field.of as FieldDescriptor, `${path}[]`, visit, true);
  }
}

/**
 * What is wrong with how a module's settings use `layout`, `topics`, `topic`
 * and `audience`: a layout only on a top-level group, headings that exist and
 * nest one deep, a `topic` that names a heading of the group it is drawn in,
 * and a messages list holding only messages. Empty when all is well.
 */
export function layoutProblems(schema: FieldDescriptor): string[] {
  const problems: string[] = [];
  const top = (schema.fields ?? {}) as Fields;
  const messageTopics = new Set<string>();

  for (const [key, group] of Object.entries(top)) {
    if (group.layout === undefined || group.kind !== "object") continue;
    if (!LAYOUTS.includes(String(group.layout))) {
      problems.push(`${key} has an unknown layout`);
      continue;
    }
    const topics = (group.topics ?? []) as FieldTopic[];
    if (topics.length === 0) problems.push(`${key} has a layout but no topics`);
    const ids = new Set<string>();
    for (const topic of topics) {
      if (ids.has(topic.id)) problems.push(`${key} declares the topic ${topic.id} twice`);
      ids.add(topic.id);
    }
    for (const topic of topics) {
      if (topic.within === undefined) continue;
      const parent = topics.find((other) => other.id === topic.within);
      if (!parent) problems.push(`${key}'s topic ${topic.id} is within ${topic.within}, which it does not declare`);
      else if (parent.within !== undefined) problems.push(`${key}'s topic ${topic.id} is within ${topic.within}, which is itself within another`);
    }
    if (group.layout === "messages") for (const id of ids) messageTopics.add(id);

    for (const [childKey, child] of Object.entries((group.fields ?? {}) as Fields)) {
      walk(child, `${key}.${childKey}`, (field, path) => {
        if (field.topic !== undefined && !ids.has(String(field.topic))) problems.push(`${path} names the topic ${String(field.topic)}, which ${key} does not declare`);
        if (group.layout === "messages" && field.kind !== "message" && field.kind !== "object") {
          problems.push(`${path} is not a message, and a messages list only lists messages`);
        }
        if (group.layout === "fields" && field.kind === "message") problems.push(`${path} is a message in a fields list; put it in a messages list`);
      });
    }
  }

  for (const [key, field] of Object.entries(top)) {
    walk(field, key, (child, path, inList) => {
      if (child !== field && child.layout !== undefined && child.kind === "object") problems.push(`${path} has a layout but is not a top-level group`);
      if (child.topics !== undefined && child.layout === undefined) problems.push(`${path} declares topics but has no layout`);
      if (child.audience !== undefined) {
        if (child.kind !== "message") problems.push(`${path} has an audience but is not a message`);
        else if (!AUDIENCES.includes(String(child.audience))) problems.push(`${path} has an unknown audience`);
      }
      if (field.layout !== undefined || child.topic === undefined) return;
      // Outside a layout group, only a message may borrow a heading, and only from a messages list.
      if (child.kind !== "message") problems.push(`${path} names a topic but is neither in a layout group nor a message`);
      else if (inList) problems.push(`${path} names a topic but sits in a list, which a message list cannot show`);
      else if (!messageTopics.has(String(child.topic))) problems.push(`${path} names the topic ${String(child.topic)}, which no messages list declares`);
    });
  }
  return problems;
}

function fieldAtPath(fields: Fields, path: string): FieldDescriptor | undefined {
  const [key, ...rest] = path.split(".");
  const field = key === undefined ? undefined : fields[key];
  if (!field || rest.length === 0) return field;
  return field.kind === "object" ? fieldAtPath((field.fields ?? {}) as Fields, rest.join(".")) : undefined;
}

/**
 * What is wrong with how a module's settings use the metadata that shapes a
 * list of rows and the controls in it: `layout: "sheet"` with its `card`, a
 * group's `steps` and the `step` that names one, `section` and `tabLabels`
 * inside a sheet row, `nudge`, `control` and a choice's `swatch`, and the
 * `hide` of a condition. Empty when all is well.
 */
export function formLayoutProblems(schema: FieldDescriptor): string[] {
  const problems: string[] = [];

  const visit = (field: FieldDescriptor, path: string, inSheetRow: boolean, top: boolean): void => {
    if (field.section !== undefined && !top && !inSheetRow) {
      problems.push(`${path} has a section but is neither a top-level setting nor inside a sheet row, so the dashboard ignores it`);
    }
    if (field.nudge !== undefined && (typeof field.nudge !== "string" || field.nudge.trim() === "" || field.kind === "object")) {
      problems.push(`${path} has a nudge that is empty or sits on a group`);
    }
    if (field.control !== undefined) {
      const options = (field.options ?? []) as { swatch?: unknown }[];
      if (field.kind !== "choice") problems.push(`${path} has a control but is not a choice`);
      else if (field.control === "segmented") {
        if (options.length < 2 || options.length > 4) problems.push(`${path} is segmented but has ${options.length} options, and a segmented control holds two to four`);
      } else if (field.control === "swatches") {
        if (options.some((option) => typeof option.swatch !== "string" || option.swatch === "")) problems.push(`${path} draws swatches but an option has no swatch`);
      } else problems.push(`${path} has an unknown control`);
    }
    const when = field.when as { field?: unknown; hide?: unknown } | undefined;
    if (when?.hide !== undefined && typeof when.hide !== "boolean") problems.push(`${path} has a condition whose hide is not true or false`);

    if (field.layout === "sheet" || field.card !== undefined) {
      const row = field.kind === "array" ? (field.of as FieldDescriptor) : undefined;
      if (field.layout !== "sheet") problems.push(`${path} has a card but is not drawn as a sheet`);
      else if (row?.kind !== "object") problems.push(`${path} is a sheet but is not a list of rows`);
      else {
        const rowFields = (row.fields ?? {}) as Fields;
        const card = (field.card ?? {}) as { emoji?: string; swatch?: string; chips?: string; facts?: string[] };
        const expect = (ref: string | undefined, what: string, kinds: string[]) => {
          if (ref === undefined) return;
          const target = fieldAtPath(rowFields, ref);
          if (!target) problems.push(`${path}'s card ${what} names ${ref}, which is not a setting of the row`);
          else if (!kinds.includes(target.kind)) problems.push(`${path}'s card ${what} names ${ref}, which is a ${target.kind}`);
        };
        expect(card.emoji, "emoji", ["emoji"]);
        expect(card.swatch, "swatch", ["choice"]);
        expect(card.chips, "chips", ["array"]);
        for (const fact of card.facts ?? []) expect(fact, "fact", ["choice", "array", "string", "integer", "boolean", "duration"]);
        const swatch = card.swatch === undefined ? undefined : fieldAtPath(rowFields, card.swatch);
        if (swatch && ((swatch.options ?? []) as { swatch?: unknown }[]).some((option) => typeof option.swatch !== "string")) {
          problems.push(`${path}'s card swatch ${card.swatch} has options without a swatch`);
        }
      }
    }
    if (field.formPreview !== undefined) {
      const row = field.kind === "array" ? (field.of as FieldDescriptor) : undefined;
      const preview = field.formPreview as { kind?: unknown; label?: string; placeholder?: string; style?: string; required?: string };
      if (row?.kind !== "object") problems.push(`${path} has a form preview but is not a list of rows`);
      else if (preview.kind !== "modal") problems.push(`${path} has an unknown form preview`);
      else {
        const rowFields = (row.fields ?? {}) as Fields;
        const need = (ref: string | undefined, what: string, kind: string) => {
          if (ref === undefined) return;
          const target = fieldAtPath(rowFields, ref);
          if (!target || target.kind !== kind) problems.push(`${path}'s form preview ${what} names ${ref}, which is not a ${kind} setting of the row`);
        };
        if (typeof preview.label !== "string") problems.push(`${path}'s form preview names no label`);
        need(preview.label, "label", "string");
        need(preview.placeholder, "placeholder", "string");
        need(preview.style, "style", "choice");
        need(preview.required, "required", "boolean");
      }
    }
    if (field.layout === "sheet" && field.kind === "array" && (field.of as FieldDescriptor).kind === "object") {
      const rowField = field.of as FieldDescriptor;
      const rowFields = (rowField.fields ?? {}) as Fields;
      for (const [key, child] of Object.entries(rowFields)) {
        const title = (child.formPreview as { title?: string } | undefined)?.title;
        if (title !== undefined && rowFields[title]?.kind !== "string") problems.push(`${path}[].${key}'s form preview title names ${title}, which is not a text setting beside it`);
        visit(child, `${path}[].${key}`, true, false);
      }
      return;
    }

    if (field.kind === "array") {
      visit(field.of as FieldDescriptor, `${path}[]`, false, false);
      return;
    }
    if (field.kind !== "object") return;

    const fields = (field.fields ?? {}) as Fields;
    const steps = field.steps as { id?: unknown; title?: unknown }[] | undefined;
    const stepIds = new Set<string>();
    if (steps !== undefined) {
      if (!Array.isArray(steps) || steps.length === 0) problems.push(`${path} declares steps but lists none`);
      for (const step of Array.isArray(steps) ? steps : []) {
        if (typeof step.id !== "string" || step.id === "" || typeof step.title !== "string" || step.title === "") {
          problems.push(`${path} has a step without an id or a title`);
        } else if (stepIds.has(step.id)) problems.push(`${path} declares the step ${step.id} twice`);
        else stepIds.add(step.id);
      }
    }
    const sections = new Set<string>();
    for (const [key, child] of Object.entries(fields)) {
      const title = (child.formPreview as { title?: string } | undefined)?.title;
      if (title !== undefined && fields[title]?.kind !== "string") problems.push(`${path}.${key}'s form preview title names ${title}, which is not a text setting beside it`);
      if (child.step !== undefined) {
        if (steps === undefined) problems.push(`${path}.${key} names the step ${String(child.step)}, but ${path} declares no steps`);
        else if (!stepIds.has(String(child.step))) problems.push(`${path}.${key} names the step ${String(child.step)}, which ${path} does not declare`);
      }
      if (typeof child.section === "string") sections.add(child.section);
      if (child.kind === "object") {
        for (const grand of Object.values((child.fields ?? {}) as Fields)) if (typeof grand.section === "string") sections.add(grand.section);
      }
    }
    const labels = field.tabLabels as Record<string, unknown> | undefined;
    if (labels !== undefined) {
      if (!inSheetRow) problems.push(`${path} has tabLabels but is not inside a sheet row`);
      for (const [id, text] of Object.entries(labels)) {
        if (!sections.has(id)) problems.push(`${path}'s tabLabels names ${id}, a tab none of its settings are in`);
        if (typeof text !== "string" || text === "") problems.push(`${path}'s tabLabels gives ${id} no heading`);
      }
    }
    for (const [key, child] of Object.entries(fields)) visit(child, path ? `${path}.${key}` : key, inSheetRow, false);
  };

  for (const [key, field] of Object.entries((schema.fields ?? {}) as Fields)) visit(field, key, false, true);
  return problems;
}
