export { s } from "./schema.js";
export type {
  ChannelType,
  Field,
  FieldCondition,
  FieldDescriptor,
  FieldError,
  FieldKind,
  FieldMeta,
  Infer,
  MessageFieldOptions,
  MessageVariable,
  ObjectField,
  ParseResult,
  Shape,
  ShapeValues,
} from "./schema.js";

export { customId, defineModule, parseCustomId } from "./module.js";
export type {
  CommandDefinition,
  ContextCommandDefinition,
  EventHandlers,
  ModuleCategory,
  ModuleContext,
  ModuleDefinition,
  ComponentEvent,
  ComponentHandler,
  ModalHandler,
  RowAction,
  RowActionResult,
  RowHooks,
  RowRef,
  RowStatus,
  ScheduledWork,
  SendMessageOptions,
  EditMessageOptions,
  ReplyMessageOptions,
  TaskHandler,
  TaskPayload,
} from "./module.js";

export { dashboardLinks, viewCaseButton } from "./dashboard-links.js";
export type { DashboardLinks } from "./dashboard-links.js";

export { plainReply, embedReply, REPLY_COLOR, type ReplyKind } from "./response.js";
export type { ReplyPlaceholder, ReplyValues, ResponseTemplate } from "./response.js";

export { isRoleAssignable } from "./roles.js";

export { ModuleRegistry } from "./registry.js";
export type { CommandSummary, ModuleSummary, RowDescription } from "./registry.js";
export { resolveList, resolveRow, schemaPathOf } from "./rows.js";

export {
  EVIDENCE_LIMITS,
  MESSAGE_LOG_STATES,
  evidenceRefFromLink,
  parseEvidenceRefs,
  readEvidence,
  AUDIT_KIND_LABEL,
  AUTOMOD_ACTOR_NAME,
  AUTOMOD_NAME,
  automodRef,
  isAutomodActor,
  actorRoleWord,
  auditActorRole,
  isAutomodRole,
  ROLE_LABEL,
  STAFF_ROLES,
  can,
  canDeleteNote,
  canEditNote,
  canEditInfraction,
  canVoidAction,
  MOD_ACTION_KINDS,
  canTakeAction,
  isInForce,
  isModActionKind,
  isStaffRole,
  permissionForAction,
} from "./mod.js";
export type {
  ActionContextDto,
  EvidenceAttachment,
  EvidenceMessage,
  EvidenceRef,
  LoggedMessageDto,
  MessageLogState,
  MessageVersion,
  ActionRequest,
  ActionResult,
  AuditActorRole,
  Actor,
  AuditDto,
  AuditKind,
  InfractionDto,
  ListedRole,
  ModActionKind,
  MemberProfile,
  MemberSearchHit,
  MemberSummary,
  ModError,
  ModPermission,
  NoteDto,
  Page,
  RestrictionState,
  StaffDto,
  StaffRole,
  StatsDto,
  StatsTotals,
  UserRef,
} from "./mod.js";

export {
  ACTION_VARIABLES,
  BUTTON_STYLES,
  CHANNEL_TYPES,
  SELECT_KINDS,
  checkAction,
  emptyButton,
  emptyOption,
  emptyReply,
  emptySelect,
  readAction,
  readButtons,
  readSelects,
  rowsUsed,
} from "./components.js";
export type {
  ButtonStyleName,
  ComponentAction,
  MessageButton,
  MessageSelect,
  ReplyAction,
  RoleMode,
  SelectKind,
  SelectOption,
} from "./components.js";

export {
  MESSAGE_LIMITS,
  MESSAGE_VARIABLES,
  SEND_NAME_MAX,
  TIMESTAMP_STYLES,
  applyVariables,
  applyVariablesToMessage,
  cleanName,
  colorToInt,
  discordTimestamp,
  embedHasContent,
  embedLength,
  emptyEmbed,
  isEmojiToken,
  isHexColor,
  isHttpUrl,
  normalizeOrigin,
  parseMessage,
  parseSendOptions,
  linksOnly,
  flattenEmbeds,
  restrictMessage,
} from "./message.js";
export type {
  EmbedField,
  MessageBody,
  MessageDelivery,
  MessageEmbed,
  MessageError,
  MessageFolderDto,
  MessageLibrary,
  MessageTemplateDto,
  SendOptions,
  TimestampStyle,
  VariableValues,
} from "./message.js";

export {
  SERVER_LOG_CATEGORIES,
  SERVER_LOG_CATEGORY_IDS,
  isServerLogCategory,
  isServerLogType,
  readServerLogDetails,
  serverLogCategoryOf,
  serverLogTypeLabel,
} from "./serverlog.js";
export type {
  ServerLogCategory,
  ServerLogCategoryId,
  ServerLogChange,
  ServerLogDetails,
  ServerLogEntryDto,
  ServerLogType,
} from "./serverlog.js";

export {
  DELETION_NOTE_LIMIT,
  DELETION_NOTE_TTL_MS,
  clearDeletionNotes,
  noteDeletion,
  takeDeletionNote,
} from "./deletion-notes.js";
export type { DeletionNote, DeletionSource } from "./deletion-notes.js";
