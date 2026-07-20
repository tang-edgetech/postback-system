package handler

import (
	"database/sql"
	"net/http"
	"strconv"

	"postback-system/shared/httpresp"
)

// SessionsHandler exposes login history (ip/device/location) for Super Admin
// oversight of Admin/Marketer accounts — the user_sessions table already records a
// row per login (see AuthHandler.completeLogin); this just surfaces it.
type SessionsHandler struct {
	DB *sql.DB
}

type loginSessionRow struct {
	ID        int64  `json:"id"`
	IP        string `json:"ip"`
	Country   string `json:"country"`
	City      string `json:"city"`
	UserAgent string `json:"user_agent"`
	CreatedAt string `json:"created_at"`
	LastSeen  string `json:"last_seen_at"`
}

func (h *SessionsHandler) ForUser(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid user id")
		return
	}

	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT id, COALESCE(ip,''), COALESCE(geo_country,''), COALESCE(geo_region,''), COALESCE(user_agent,''), created_at, last_seen_at
		 FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load login history")
		return
	}
	defer rows.Close()

	items := []loginSessionRow{}
	for rows.Next() {
		var row loginSessionRow
		var created, lastSeen sql.NullTime
		if err := rows.Scan(&row.ID, &row.IP, &row.Country, &row.City, &row.UserAgent, &created, &lastSeen); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read login history")
			return
		}
		row.CreatedAt = created.Time.Format("2006-01-02T15:04:05Z07:00")
		row.LastSeen = lastSeen.Time.Format("2006-01-02T15:04:05Z07:00")
		items = append(items, row)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{"items": items})
}
