package handler

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"postback-system/shared/httpresp"
	"postback-system/shared/listquery"
)

type AuditLogsHandler struct {
	DB *sql.DB
}

type auditLogRow struct {
	ID            int64          `json:"id"`
	ActorFullName string         `json:"actor_full_name"`
	ActorEmail    string         `json:"actor_email"`
	Action        string         `json:"action"`
	StatusCode    int            `json:"status_code"`
	Changes       map[string]any `json:"changes,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

var auditLogsSortColumns = map[string]string{
	"created_at":  "created_at",
	"action":      "action",
	"status_code": "status_code",
}

// buildFilter shares filter construction between List and Export so the CSV export
// always reflects exactly the same search/date-range/action combination as the screen.
func buildFilter(r *http.Request, search string) (string, []any) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}

	if search != "" {
		where = append(where, "(actor_email_snapshot LIKE ? OR actor_full_name_snapshot LIKE ? OR action LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	if action := q.Get("action"); action != "" {
		where = append(where, "action = ?")
		args = append(args, action)
	}
	if dateFrom := q.Get("date_from"); dateFrom != "" {
		where = append(where, "created_at >= ?")
		args = append(args, dateFrom+" 00:00:00")
	}
	if dateTo := q.Get("date_to"); dateTo != "" {
		where = append(where, "created_at <= ?")
		args = append(args, dateTo+" 23:59:59")
	}
	if entityType := q.Get("entity_type"); entityType != "" {
		where = append(where, "entity_type = ?")
		args = append(args, entityType)
	}
	if entityID := q.Get("entity_id"); entityID != "" {
		where = append(where, "entity_id = ?")
		args = append(args, entityID)
	}

	return strings.Join(where, " AND "), args
}

func parseChanges(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

func (h *AuditLogsHandler) List(w http.ResponseWriter, r *http.Request) {
	params := listquery.Parse(r, auditLogsSortColumns, "created_at", "DESC")
	whereClause, args := buildFilter(r, params.Search)

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM audit_logs WHERE %s`, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load audit logs")
		return
	}

	listSQL := fmt.Sprintf(
		`SELECT id, COALESCE(actor_full_name_snapshot, ''), COALESCE(actor_email_snapshot, ''), action, status_code, after_state, created_at
		 FROM audit_logs WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listSQL, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load audit logs")
		return
	}
	defer rows.Close()

	items := []auditLogRow{}
	for rows.Next() {
		var row auditLogRow
		var afterState []byte
		if err := rows.Scan(&row.ID, &row.ActorFullName, &row.ActorEmail, &row.Action, &row.StatusCode, &afterState, &row.CreatedAt); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read audit logs")
			return
		}
		row.Changes = parseChanges(afterState)
		items = append(items, row)
	}

	actionRows, err := h.DB.QueryContext(r.Context(), `SELECT DISTINCT action FROM audit_logs ORDER BY action`)
	availableActions := []string{}
	if err == nil {
		defer actionRows.Close()
		for actionRows.Next() {
			var a string
			if actionRows.Scan(&a) == nil {
				availableActions = append(availableActions, a)
			}
		}
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items":             items,
		"total":             total,
		"page":              params.Page,
		"per_page":          params.PerPage,
		"available_actions": availableActions,
	})
}

func (h *AuditLogsHandler) Export(w http.ResponseWriter, r *http.Request) {
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	whereClause, args := buildFilter(r, search)

	query := fmt.Sprintf(
		`SELECT id, COALESCE(actor_full_name_snapshot, ''), COALESCE(actor_email_snapshot, ''), action, status_code, after_state, created_at
		 FROM audit_logs WHERE %s ORDER BY created_at DESC`, whereClause)
	rows, err := h.DB.QueryContext(r.Context(), query, args...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not export audit logs")
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="audit-logs-%s.csv"`, time.Now().UTC().Format("20060102-150405")))

	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"Timestamp", "Performed By", "Email", "Action", "Status Code", "Data Changed"})

	for rows.Next() {
		var id int64
		var fullName, email, action string
		var statusCode int
		var afterState []byte
		var createdAt time.Time
		if err := rows.Scan(&id, &fullName, &email, &action, &statusCode, &afterState, &createdAt); err != nil {
			continue
		}
		changes := ""
		if len(afterState) > 0 {
			changes = string(afterState)
		}
		_ = writer.Write([]string{
			createdAt.Format(time.RFC3339),
			fullName,
			email,
			action,
			fmt.Sprintf("%d", statusCode),
			changes,
		})
	}
	writer.Flush()
}
