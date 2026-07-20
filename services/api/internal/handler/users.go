package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/crypto"
	"postback-system/shared/httpresp"
	"postback-system/shared/listquery"
	"postback-system/shared/models"
	"postback-system/shared/session"
)

type statusRequest struct {
	Status string `json:"status"`
}

type UsersHandler struct {
	DB *sql.DB
}

type userRow struct {
	ID        int64  `json:"id"`
	FullName  string `json:"full_name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Status    string `json:"status"`
	Theme     string `json:"theme"`
	CreatedBy int64  `json:"created_by"`
}

var usersSortColumns = map[string]string{
	"full_name":  "u.full_name",
	"email":      "u.email",
	"role":       "r.name",
	"status":     "u.status",
	"created_at": "u.created_at",
}

func roleID(role string) (int64, bool) {
	switch models.Role(role) {
	case models.RoleSuperAdmin:
		return 1, true
	case models.RoleAdmin:
		return 2, true
	case models.RoleMarketer:
		return 3, true
	}
	return 0, false
}

// Admin can only edit/status-change/delete Marketer accounts it personally created
// (and its own profile via the separate /v1/profile endpoints). Super Admin can act
// on anyone.
func canActorMutateTarget(actor *session.Data, targetRole models.Role, targetCreatedBy int64) bool {
	if actor.Role == models.RoleSuperAdmin {
		return true
	}
	return actor.Role == models.RoleAdmin && targetRole == models.RoleMarketer && targetCreatedBy == actor.UserID
}

type targetInfo struct {
	Role      models.Role
	CreatedBy int64
}

func (h *UsersHandler) targetRole(r *http.Request, id int64) (targetInfo, error) {
	var roleName string
	var createdBy sql.NullInt64
	err := h.DB.QueryRowContext(r.Context(),
		`SELECT r.name, u.created_by FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`, id).Scan(&roleName, &createdBy)
	if err != nil {
		return targetInfo{}, err
	}
	return targetInfo{Role: models.Role(roleName), CreatedBy: createdBy.Int64}, nil
}

func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	params := listquery.Parse(r, usersSortColumns, "full_name", "ASC")
	roleFilter := r.URL.Query().Get("role")
	statusFilter := r.URL.Query().Get("status")

	where := []string{"1=1"}
	args := []any{}
	if params.Search != "" {
		where = append(where, "(u.full_name LIKE ? OR u.email LIKE ?)")
		args = append(args, "%"+params.Search+"%", "%"+params.Search+"%")
	}
	if _, ok := roleID(roleFilter); ok {
		where = append(where, "r.name = ?")
		args = append(args, roleFilter)
	}
	if statusFilter == "active" || statusFilter == "inactive" {
		where = append(where, "u.status = ?")
		args = append(args, statusFilter)
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id = r.id WHERE %s`, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load users")
		return
	}

	listSQL := fmt.Sprintf(
		`SELECT u.id, u.full_name, u.email, r.name, u.status, u.theme, COALESCE(u.created_by, 0)
		 FROM users u JOIN roles r ON u.role_id = r.id
		 WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listSQL, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load users")
		return
	}
	defer rows.Close()

	items := []userRow{}
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &u.Status, &u.Theme, &u.CreatedBy); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read users")
			return
		}
		items = append(items, u)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items":    items,
		"total":    total,
		"page":     params.Page,
		"per_page": params.PerPage,
	})
}

func (h *UsersHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid user id")
		return
	}
	var u userRow
	err = h.DB.QueryRowContext(r.Context(),
		`SELECT u.id, u.full_name, u.email, r.name, u.status, u.theme, COALESCE(u.created_by, 0)
		 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`, id,
	).Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &u.Status, &u.Theme, &u.CreatedBy)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	httpresp.JSON(w, http.StatusOK, u)
}

type createUserRequest struct {
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	if req.FullName == "" || req.Email == "" || len(req.Password) < 8 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Full name, email and a password of at least 8 characters are required")
		return
	}
	rid, ok := roleID(req.Role)
	if !ok {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid role")
		return
	}
	if actor.Role == models.RoleAdmin && models.Role(req.Role) == models.RoleSuperAdmin {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "Admins cannot create Super Admin accounts")
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not process password")
		return
	}

	res, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO users (full_name, email, password_hash, role_id, status, theme, created_by) VALUES (?, ?, ?, ?, 'active', 'light', ?)`,
		req.FullName, req.Email, hash, rid, actor.UserID)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate entry") {
			httpresp.JSONError(w, http.StatusConflict, "email_taken", "A user with this email already exists")
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create user")
		return
	}

	id, _ := res.LastInsertId()
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.create", http.StatusCreated, "user", id, nil,
		map[string]string{"full_name": req.FullName, "email": req.Email, "role": req.Role}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusCreated, map[string]any{"id": id})
}

type updateUserRequest struct {
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

func (h *UsersHandler) Update(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid user id")
		return
	}

	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	rid, ok := roleID(req.Role)
	if req.FullName == "" || !ok {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Full name and a valid role are required")
		return
	}

	target, err := h.targetRole(r, id)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	if !canActorMutateTarget(actor, target.Role, target.CreatedBy) {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to modify this user")
		return
	}
	if actor.Role == models.RoleAdmin && models.Role(req.Role) == models.RoleSuperAdmin {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "Admins cannot promote users to Super Admin")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE users SET full_name = ?, role_id = ? WHERE id = ?`, req.FullName, rid, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update user")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.update", http.StatusOK, "user", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *UsersHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid user id")
		return
	}
	if id == actor.UserID {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You cannot change your own status")
		return
	}

	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Status must be active or inactive")
		return
	}

	target, err := h.targetRole(r, id)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	if !canActorMutateTarget(actor, target.Role, target.CreatedBy) {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to modify this user")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE users SET status = ? WHERE id = ?`, req.Status, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.status_change", http.StatusOK, "user", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid user id")
		return
	}
	if id == actor.UserID {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You cannot delete your own account")
		return
	}

	target, err := h.targetRole(r, id)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "User not found")
		return
	}
	if !canActorMutateTarget(actor, target.Role, target.CreatedBy) {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to delete this user")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `DELETE FROM users WHERE id = ?`, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete user")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.delete", http.StatusOK, "user", id, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// filterMutable keeps only the ids the actor is actually allowed to act on (never self,
// and Admins are restricted to Marketer targets) — bulk actions silently skip the rest
// rather than failing the whole batch over one disallowed id.
func (h *UsersHandler) filterMutable(r *http.Request, actor *session.Data, ids []int64) []int64 {
	allowed := []int64{}
	for _, id := range ids {
		if id == actor.UserID {
			continue
		}
		target, err := h.targetRole(r, id)
		if err != nil {
			continue
		}
		if canActorMutateTarget(actor, target.Role, target.CreatedBy) {
			allowed = append(allowed, id)
		}
	}
	return allowed
}

func (h *UsersHandler) BulkStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req bulkStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list and a valid status are required")
		return
	}

	allowedIDs := h.filterMutable(r, actor, req.IDs)
	if len(allowedIDs) == 0 {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to modify any of the selected users")
		return
	}

	query := fmt.Sprintf(`UPDATE users SET status = ? WHERE id IN (%s)`, idPlaceholders(len(allowedIDs)))
	args := append([]any{req.Status}, toArgs(allowedIDs)...)
	if _, err := h.DB.ExecContext(r.Context(), query, args...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.bulk_status_change", http.StatusOK, "user", 0, nil,
		map[string]any{"ids": allowedIDs, "status": req.Status}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(allowedIDs)})
}

func (h *UsersHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req bulkIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list is required")
		return
	}

	allowedIDs := h.filterMutable(r, actor, req.IDs)
	if len(allowedIDs) == 0 {
		httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to delete any of the selected users")
		return
	}

	query := fmt.Sprintf(`DELETE FROM users WHERE id IN (%s)`, idPlaceholders(len(allowedIDs)))
	if _, err := h.DB.ExecContext(r.Context(), query, toArgs(allowedIDs)...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete users")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.bulk_delete", http.StatusOK, "user", 0, nil,
		map[string]any{"ids": allowedIDs}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "deleted", "count": len(allowedIDs)})
}
