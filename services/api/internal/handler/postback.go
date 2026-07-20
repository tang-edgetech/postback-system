package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"postback-system/shared/httpresp"
)

// PostbackHandler is the public, no-auth endpoint destination sites call back to report
// events against a click. Accepts GET or POST — mandatory fields are cid, tid, and a
// non-empty event_name; anything else sent along is stored as extra_fields.
type PostbackHandler struct {
	DB *sql.DB
}

func (h *PostbackHandler) Handle(w http.ResponseWriter, r *http.Request) {
	var cid, tid, eventName string
	extra := map[string]string{}

	if r.Method == http.MethodGet {
		q := r.URL.Query()
		cid, tid, eventName = q.Get("cid"), q.Get("tid"), q.Get("event_name")
		for k, v := range q {
			if k == "cid" || k == "tid" || k == "event_name" || len(v) == 0 {
				continue
			}
			extra[k] = v[0]
		}
	} else {
		_ = r.ParseForm()
		cid, tid, eventName = r.FormValue("cid"), r.FormValue("tid"), r.FormValue("event_name")
		for k, v := range r.Form {
			if k == "cid" || k == "tid" || k == "event_name" || len(v) == 0 {
				continue
			}
			extra[k] = v[0]
		}
	}

	if cid == "" || tid == "" || eventName == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "cid, tid and event_name are required")
		return
	}

	var clickID int64
	var validUntil time.Time
	err := h.DB.QueryRowContext(r.Context(), `
		SELECT lc.id, lc.valid_until FROM link_clicks lc
		JOIN links l ON lc.link_id = l.id
		WHERE lc.cid = ? AND l.tid = ?`, cid, tid).Scan(&clickID, &validUntil)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "No matching click found for this cid/tid")
		return
	}
	if time.Now().After(validUntil) {
		httpresp.JSONError(w, http.StatusGone, "expired", "This click's tracking window has expired")
		return
	}

	extraJSON, _ := json.Marshal(extra)
	receivedVia := "get"
	if r.Method == http.MethodPost {
		receivedVia = "post"
	}

	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO postback_events (link_click_id, event_name, extra_fields, source_ip, received_via) VALUES (?, ?, ?, ?, ?)`,
		clickID, eventName, extraJSON, r.RemoteAddr, receivedVia)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not record postback")
		return
	}

	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "recorded"})
}
