export interface ToggleResult {
  toAdd: string[];
  toRemove: string[];
}

/**
 * Decides which of a menu's roles to add or remove when `pressed` is picked.
 * An exclusive menu clears every other role the menu grants; a non-exclusive
 * one only ever touches the role that was pressed.
 */
export function computeToggle(
  current: string[],
  pressed: string,
  menuRoleIds: string[],
  exclusive: boolean,
): ToggleResult {
  if (current.includes(pressed)) {
    return { toAdd: [], toRemove: [pressed] };
  }
  if (exclusive) {
    const toRemove = current.filter((id) => id !== pressed && menuRoleIds.includes(id));
    return { toAdd: [pressed], toRemove };
  }
  return { toAdd: [pressed], toRemove: [] };
}
