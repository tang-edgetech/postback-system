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
	"postback-system/shared/httpresp"
	"postback-system/shared/listquery"
)

// SimpleEntityHandler implements CRUD + listing for simple named+status entities
// (Tenants, Campaigns). Table/EntityType are fixed at construction time (never user
// input), so building queries with fmt.Sprintf here is safe from SQL injection.
type SimpleEntityHandler struct {
	DB         *sql.DB
	Table      string
	EntityType string
}

type simpleEntityRow struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

var simpleEntitySortColumns = map[string]string{
	"name":       "name",
	"status":     "status",
	"created_at": "created_at",
}

func (h *SimpleEntityHandler) List(w http.ResponseWriter, r *http.Request) {
	params := listquery.Parse(r, simpleEntitySortColumns, "name", "ASC")
	statusFilter := r.URL.Query().Get("status")

	where := []string{"1=1"}
	args := []any{}
	if params.Search != "" {
		where = append(where, "name LIKE ?")
		args = append(args, "%"+params.Search+"%")
	}
	if statusFilter == "active" || statusFilter == "inactive" {
		where = append(where, "status = ?")
		args = append(args, statusFilter)
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, h.Table, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load list")
		return
	}

	listQuery := fmt.Sprintf(`SELECT id, name, status FROM %s WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		h.Table, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listQuery, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load list")
		return
	}
	defer rows.Close()

	items := []simpleEntityRow{}
	for rows.Next() {
		var row simpleEntityRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Status); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read list")
			return
		}
		items = append(items, row)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items":    items,
		"total":    total,
		"page":     params.Page,
		"per_page": params.PerPage,
	})
}

type nameRequest struct {
	Name string `json:"name"`
}

func (h *SimpleEntityHandler) Create(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req nameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Name is required")
		return
	}

	query := fmt.Sprintf(`INSERT INTO %s (name, status, created_by) VALUES (?, 'active', ?)`, h.Table)
	res, err := h.DB.ExecContext(r.Context(), query, req.Name, actor.UserID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create")
		return
	}

	id, _ := res.LastInsertId()
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".create", http.StatusCreated, h.EntityType, id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *SimpleEntityHandler) Update(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid id")
		return
	}

	var req nameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Name is required")
		return
	}

	query := fmt.Sprintf(`UPDATE %s SET name = ? WHERE id = ?`, h.Table)
	if _, err := h.DB.ExecContext(r.Context(), query, req.Name, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".update", http.StatusOK, h.EntityType, id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *SimpleEntityHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid id")
		return
	}

	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Status must be active or inactive")
		return
	}

	query := fmt.Sprintf(`UPDATE %s SET status = ? WHERE id = ?`, h.Table)
	if _, err := h.DB.ExecContext(r.Context(), query, req.Status, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".status_change", http.StatusOK, h.EntityType, id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *SimpleEntityHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid id")
		return
	}

	query := fmt.Sprintf(`DELETE FROM %s WHERE id = ?`, h.Table)
	if _, err := h.DB.ExecContext(r.Context(), query, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".delete", http.StatusOK, h.EntityType, id, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type bulkIDsRequest struct {
	IDs []int64 `json:"ids"`
}

type bulkStatusRequest struct {
	IDs    []int64 `json:"ids"`
	Status string  `json:"status"`
}

func idPlaceholders(n int) string {
	ph := make([]string, n)
	for i := range ph {
		ph[i] = "?"
	}
	return strings.Join(ph, ",")
}

func toArgs(ids []int64) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

func (h *SimpleEntityHandler) BulkStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req bulkStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list and a valid status are required")
		return
	}

	query := fmt.Sprintf(`UPDATE %s SET status = ? WHERE id IN (%s)`, h.Table, idPlaceholders(len(req.IDs)))
	args := append([]any{req.Status}, toArgs(req.IDs)...)
	if _, err := h.DB.ExecContext(r.Context(), query, args...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".bulk_status_change", http.StatusOK, h.EntityType, 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.IDs)})
}

func (h *SimpleEntityHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req bulkIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list is required")
		return
	}

	query := fmt.Sprintf(`DELETE FROM %s WHERE id IN (%s)`, h.Table, idPlaceholders(len(req.IDs)))
	if _, err := h.DB.ExecContext(r.Context(), query, toArgs(req.IDs)...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, h.EntityType+".bulk_delete", http.StatusOK, h.EntityType, 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "deleted", "count": len(req.IDs)})
}
