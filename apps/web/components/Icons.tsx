import type { ReactNode } from "react";

/**
 * The dashboard's entire icon set. Kept to a handful and in one file so
 * nobody reaches for an icon package to add one more.
 */

export function DiscordMark(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.211.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.076-.035A19.74 19.74 0 0 0 3.68 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128q.19-.142.372-.29a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009q.182.148.372.29a.077.077 0 0 1-.006.129 12.3 12.3 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028M8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.947 2.419-2.157 2.419" />
    </svg>
  );
}

export function SignOutIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function AlertIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function CheckIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ChevronRightIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronDownIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function MenuIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function XIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function SunIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />
    </svg>
  );
}

export function MonitorIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function SearchIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

export function InfoIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function ExternalLinkIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function OverviewIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function SetupIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3v4" />
      <path d="M3 5h4" />
      <path d="M17 15v4" />
      <path d="M15 17h4" />
      <path d="M13 3 3 13l8 8L21 11z" />
    </svg>
  );
}

export function HelpIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 2.4" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function CommandsIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </svg>
  );
}

export function PlusIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function HashIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

export function MegaphoneIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8.5a4 4 0 0 1 0 7" />
      <path d="M18 5.5a8 8 0 0 1 0 13" />
    </svg>
  );
}

export function SpeakerIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h3.5L13 19V5L7.5 9Z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

export function FolderIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a1 1 0 0 1 1-1h4.5l2 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function MessagesIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13H5.5L3 15.5V6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1Z" />
      <path d="M8 16v1a1 1 0 0 0 1 1h9.5L21 20.5V11a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

export function BotMessagesIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4.5" />
      <circle cx="12" cy="3.5" r="1" />
      <line x1="9" y1="13" x2="9" y2="14" />
      <line x1="15" y1="13" x2="15" y2="14" />
      <path d="M9.5 17h5" />
    </svg>
  );
}

export function ShieldIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function Stroke(props: { className?: string; children: ReactNode }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

export function ClockIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </Stroke>
  );
}

export function BanIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </Stroke>
  );
}

export function NoteIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M5 4h10l4 4v12H5Z" />
      <path d="M15 4v4h4" />
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="16" x2="13" y2="16" />
    </Stroke>
  );
}

export function DownloadIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M12 4v11" />
      <polyline points="7.5 10.5 12 15 16.5 10.5" />
      <path d="M4 19h16" />
    </Stroke>
  );
}

export function UserIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Stroke>
  );
}

export function ArrowUpIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </Stroke>
  );
}

export function ArrowRightIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </Stroke>
  );
}

export function ArrowDownIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </Stroke>
  );
}

export function FilterIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </Stroke>
  );
}

export function DoorIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
      <line x1="11" y1="12" x2="21" y2="12" />
      <polyline points="17.5 8.5 21 12 17.5 15.5" />
    </Stroke>
  );
}

export function PencilIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
      <line x1="14" y1="8" x2="17" y2="11" />
    </Stroke>
  );
}

export function TrashIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7 7.5 20h9l1-13" />
      <line x1="10.5" y1="11" x2="10.5" y2="16" />
      <line x1="13.5" y1="11" x2="13.5" y2="16" />
    </Stroke>
  );
}

export function UndoIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Stroke>
  );
}

export function WarnTriangleIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Stroke>
  );
}

export function HistoryIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <polyline points="3 4 3.5 8.5 8 8" />
      <polyline points="12 8 12 12 15 14" />
    </Stroke>
  );
}

export function ChevronLeftIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <polyline points="15 18 9 12 15 6" />
    </Stroke>
  );
}

export function RefreshIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5" />
      <polyline points="4 4 4 8.5 8.5 8.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.5l1.7-2" />
      <polyline points="20 20 20 15.5 15.5 15.5" />
    </Stroke>
  );
}

export function KeyIcon(props: { className?: string }) {
  return (
    <Stroke className={props.className}>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7" />
      <path d="m16.5 6.5 2.5 2.5" />
      <path d="m14 9 2 2" />
    </Stroke>
  );
}

export function EyeIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
