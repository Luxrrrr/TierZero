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
