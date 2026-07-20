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

// CampaignsHandler is split out from SimpleEntityHandler because a Campaign belongs to
// exactly one Merchant (tenant_id) — everything else about it (name/status/audit
// pattern) matches the generic entity shape used by Tenants.
type CampaignsHandler struct {
	DB *sql.DB
}

type campaignRow struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	TenantID   int64  `json:"tenant_id"`
	TenantName string `json:"tenant_name"`
}

var campaignsSortColumns = map[string]string{
	"name":       "c.name",
	"status":     "c.status",
	"created_at": "c.created_at",
}

func (h *CampaignsHandler) List(w http.ResponseWriter, r *http.Request) {
	params := listquery.Parse(r, campaignsSortColumns, "name", "ASC")
	statusFilter := r.URL.Query().Get("status")
	tenantFilter := r.URL.Query().Get("tenant_id")

	where := []string{"1=1"}
	args := []any{}
	if params.Search != "" {
		where = append(where, "c.name LIKE ?")
		args = append(args, "%"+params.Search+"%")
	}
	if statusFilter == "active" || statusFilter == "inactive" {
		where = append(where, "c.status = ?")
		args = append(args, statusFilter)
	}
	if tenantFilter != "" {
		where = append(where, "c.tenant_id = ?")
		args = append(args, tenantFilter)
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM campaigns c WHERE %s`, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load campaigns")
		return
	}

	listSQL := fmt.Sprintf(`
		SELECT c.id, c.name, c.status, c.tenant_id, t.name
		FROM campaigns c JOIN tenants t ON c.tenant_id = t.id
		WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listSQL, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load campaigns")
		return
	}
	defer rows.Close()

	items := []campaignRow{}
	for rows.Next() {
		var row campaignRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Status, &row.TenantID, &row.TenantName); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read campaigns")
			return
		}
		items = append(items, row)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": params.Page, "per_page": params.PerPage,
	})
}

type campaignRequest struct {
	Name     string `json:"name"`
	TenantID int64  `json:"tenant_id"`
}

func (h *CampaignsHandler) Create(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req campaignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.TenantID == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Name and Merchant are required")
		return
	}

	res, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO campaigns (name, tenant_id, status, created_by) VALUES (?, ?, 'active', ?)`, req.Name, req.TenantID, actor.UserID)
	if err != nil {
		if strings.Contains(err.Error(), "foreign key constraint") {
			httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Selected Merchant does not exist")
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create campaign")
		return
	}

	id, _ := res.LastInsertId()
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.create", http.StatusCreated, "campaign", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *CampaignsHandler) Update(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid id")
		return
	}

	var req campaignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.TenantID == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Name and Merchant are required")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE campaigns SET name = ?, tenant_id = ? WHERE id = ?`, req.Name, req.TenantID, id); err != nil {
		if strings.Contains(err.Error(), "foreign key constraint") {
			httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Selected Merchant does not exist")
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update campaign")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.update", http.StatusOK, "campaign", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *CampaignsHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
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

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE campaigns SET status = ? WHERE id = ?`, req.Status, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.status_change", http.StatusOK, "campaign", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *CampaignsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid id")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `DELETE FROM campaigns WHERE id = ?`, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete campaign")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.delete", http.StatusOK, "campaign", id, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *CampaignsHandler) BulkStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	var req bulkStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list and a valid status are required")
		return
	}
	query := fmt.Sprintf(`UPDATE campaigns SET status = ? WHERE id IN (%s)`, idPlaceholders(len(req.IDs)))
	args := append([]any{req.Status}, toArgs(req.IDs)...)
	if _, err := h.DB.ExecContext(r.Context(), query, args...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.bulk_status_change", http.StatusOK, "campaign", 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.IDs)})
}

func (h *CampaignsHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	var req bulkIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list is required")
		return
	}
	query := fmt.Sprintf(`DELETE FROM campaigns WHERE id IN (%s)`, idPlaceholders(len(req.IDs)))
	if _, err := h.DB.ExecContext(r.Context(), query, toArgs(req.IDs)...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete campaigns")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "campaign.bulk_delete", http.StatusOK, "campaign", 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "deleted", "count": len(req.IDs)})
}
