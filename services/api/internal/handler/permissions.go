package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/httpresp"
	"postback-system/shared/permissions"
)

// PermissionsHandler backs Settings > Permissions — a role x capability matrix editor
// for Admin/Marketer. Super Admin is always fully allowed and isn't editable here.
type PermissionsHandler struct {
	DB *sql.DB
}

func (h *PermissionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	matrix, err := permissions.Matrix(r.Context(), h.DB)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load permissions")
		return
	}
	httpresp.JSON(w, http.StatusOK, map[string]any{
		"keys":   permissions.AllKeys,
		"matrix": matrix,
	})
}

type updatePermissionsRequest struct {
	// Role name ("admin" or "marketer") -> permission key -> allowed
	Roles map[string]map[string]bool `json:"roles"`
}

var editableRoleIDs = map[string]int64{"admin": 2, "marketer": 3}

func (h *PermissionsHandler) Update(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updatePermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	for roleName, roleID := range editableRoleIDs {
		keys, ok := req.Roles[roleName]
		if !ok {
			continue
		}
		for key, allowed := range keys {
			if !permissions.IsValidKey(key) {
				continue
			}
			if _, err := h.DB.ExecContext(r.Context(),
				`INSERT INTO role_permissions (role_id, permission_key, allowed) VALUES (?, ?, ?)
				 ON DUPLICATE KEY UPDATE allowed = ?`,
				roleID, key, allowed, allowed,
			); err != nil {
				httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update permissions")
				return
			}
		}
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_permissions", http.StatusOK, "settings", 1, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
