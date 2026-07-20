// Mirrors shared/permissions/permissions.go AllKeys — keep in sync with the backend.
export const permissions = [
  "users.manage",
  "merchants.create",
  "merchants.edit",
  "merchants.status",
  "merchants.delete",
  "campaigns.create",
  "campaigns.edit",
  "campaigns.status",
  "campaigns.delete",
  "links.create",
  "links.edit",
  "links.status",
  "links.delete",
  "audit_logs.view",
] as const;

export const ROLE_COLUMNS = ["super_admin", "admin", "marketer"] as const;

export function formatPermissionKey(key: string) {
  const [group, action] = key.split(".");
  const groupLabel = group.charAt(0).toUpperCase() + group.slice(1).replace(/_/g, " ");
  const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
  return `${groupLabel} — ${actionLabel}`;
}
