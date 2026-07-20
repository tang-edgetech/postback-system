type IconProps = { className?: string };

const base = "shrink-0";

export const OverviewIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

export const LinksIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 15 15 9" />
    <path d="M11 7l1.5-1.5a4 4 0 1 1 5.66 5.66L17 12.66" />
    <path d="M13 17l-1.5 1.5a4 4 0 1 1-5.66-5.66L7 11.34" />
  </svg>
);

export const CampaignsIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z" />
    <path d="M15 8a4 4 0 0 1 0 8" />
    <path d="M18 5a8 8 0 0 1 0 14" />
  </svg>
);

export const MerchantsIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7h18l-1.5 5.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5L3 7Z" />
    <path d="M3 7 2 4H1" />
    <circle cx="8" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
  </svg>
);

export const UsersIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.5a3.5 3.5 0 0 1 0 7" />
    <path d="M15.5 13.2a6.5 6.5 0 0 1 6 6.8" />
  </svg>
);

export const ProfileIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </svg>
);

export const AuditLogsIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 3h6l5 5v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3Z" />
    <path d="M14 3v5h5" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);

export const SettingsIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const SunIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
  </svg>
);

export const LogoutIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const EditIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const TrashIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
  </svg>
);

export const CheckIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const XIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const PowerIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v8" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </svg>
);

export const PlusIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowLeftIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
);

export const ClipboardIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
  </svg>
);

export const ChevronLeftIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const RefreshIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const CaretDownIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const UploadIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const MenuIcon = ({ className = "" }: IconProps) => (
  <svg className={`${base} ${className}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
