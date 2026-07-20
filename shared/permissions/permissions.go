package permissions

import (
	"context"
	"database/sql"

	"postback-system/shared/models"
)

// Keys are the capabilities editable in Settings > Permissions. Super Admin is
// always allowed and is never represented in role_permissions.
const (
	UsersManage     = "users.manage"
	MerchantsCreate = "merchants.create"
	MerchantsEdit   = "merchants.edit"
	MerchantsStatus = "merchants.status"
	MerchantsDelete = "merchants.delete"
	CampaignsCreate = "campaigns.create"
	CampaignsEdit   = "campaigns.edit"
	CampaignsStatus = "campaigns.status"
	CampaignsDelete = "campaigns.delete"
	LinksCreate     = "links.create"
	LinksEdit       = "links.edit"
	LinksStatus     = "links.status"
	LinksDelete     = "links.delete"
	AuditLogsView   = "audit_logs.view"
)

// AllKeys drives the Settings > Permissions matrix — order here is render order.
var AllKeys = []string{
	UsersManage,
	MerchantsCreate, MerchantsEdit, MerchantsStatus, MerchantsDelete,
	CampaignsCreate, CampaignsEdit, CampaignsStatus, CampaignsDelete,
	LinksCreate, LinksEdit, LinksStatus, LinksDelete,
	AuditLogsView,
}

var validKeys = func() map[string]bool {
	m := make(map[string]bool, len(AllKeys))
	for _, k := range AllKeys {
		m[k] = true
	}
	return m
}()

func IsValidKey(key string) bool {
	return validKeys[key]
}

func roleIDFor(role models.Role) (int64, bool) {
	switch role {
	case models.RoleAdmin:
		return 2, true
	case models.RoleMarketer:
		return 3, true
	}
	return 0, false
}

// Allowed reports whether role may perform the capability identified by key.
// Super Admin is always allowed; unknown roles/keys default to denied.
func Allowed(ctx context.Context, db *sql.DB, role models.Role, key string) bool {
	if role == models.RoleSuperAdmin {
		return true
	}
	rid, ok := roleIDFor(role)
	if !ok {
		return false
	}
	var allowed bool
	err := db.QueryRowContext(ctx,
		`SELECT allowed FROM role_permissions WHERE role_id = ? AND permission_key = ?`, rid, key,
	).Scan(&allowed)
	if err != nil {
		return false
	}
	return allowed
}

// ForRole returns just the caller's own effective permissions — used to drive which
// action buttons the dashboard shows, since a Marketer can't call the Super-Admin-only
// Matrix endpoint to find out what it's allowed to do.
func ForRole(ctx context.Context, db *sql.DB, role models.Role) map[string]bool {
	result := make(map[string]bool, len(AllKeys))
	for _, k := range AllKeys {
		result[k] = Allowed(ctx, db, role, k)
	}
	return result
}

// Matrix returns every role's allowed map for AllKeys, e.g. for the Settings >
// Permissions editor. Super Admin is included as an always-true row for display.
func Matrix(ctx context.Context, db *sql.DB) (map[string]map[string]bool, error) {
	result := map[string]map[string]bool{
		string(models.RoleSuperAdmin): {},
		string(models.RoleAdmin):      {},
		string(models.RoleMarketer):   {},
	}
	for _, k := range AllKeys {
		result[string(models.RoleSuperAdmin)][k] = true
		result[string(models.RoleAdmin)][k] = false
		result[string(models.RoleMarketer)][k] = false
	}

	rows, err := db.QueryContext(ctx, `SELECT role_id, permission_key, allowed FROM role_permissions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var roleID int64
		var key string
		var allowed bool
		if err := rows.Scan(&roleID, &key, &allowed); err != nil {
			return nil, err
		}
		switch roleID {
		case 2:
			result[string(models.RoleAdmin)][key] = allowed
		case 3:
			result[string(models.RoleMarketer)][key] = allowed
		}
	}
	return result, nil
}
