package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/crypto"
	"postback-system/shared/forwarding"
	"postback-system/shared/httpresp"
	"postback-system/shared/listquery"
)

// ForwardingHandler backs Links > Single Link > Forwarding — config CRUD and the
// delivery log live here; the actual sending mechanics are shared/forwarding, reused
// by the daily sweep in services/worker so "Send Now" and the cron never drift.
type ForwardingHandler struct {
	DB            *sql.DB
	EncryptionKey string
}

var validForwardingMethods = map[string]bool{"get": true, "post": true}
var validBodyFormats = map[string]bool{"url_encoded": true, "json": true}
var validAuthTypes = map[string]bool{"none": true, "bearer": true, "basic": true, "api_key_header": true, "api_key_query": true}
var validCaps = map[int]bool{10: true, 25: true, 50: true, 100: true, 150: true, 200: true}

type forwardingConfigResponse struct {
	LinkID        int64             `json:"link_id"`
	Enabled       bool              `json:"enabled"`
	EndpointURL   string            `json:"endpoint_url"`
	Method        string            `json:"method"`
	BodyFormat    string            `json:"body_format"`
	AuthType      string            `json:"auth_type"`
	AuthUsername  string            `json:"auth_username"`
	AuthParamName string            `json:"auth_param_name"`
	HasSecret     bool              `json:"has_secret"`
	CustomHeaders map[string]string `json:"custom_headers"`
	CapPerRun     int               `json:"cap_per_run"`
	LastRunAt     *string           `json:"last_run_at"`
	Backlog       int               `json:"backlog"`
}

func (h *ForwardingHandler) loadRow(ctx context.Context, linkID int64) (*forwardingConfigResponse, string, error) {
	row := forwardingConfigResponse{LinkID: linkID, Method: "post", BodyFormat: "json", AuthType: "none", CapPerRun: 50, CustomHeaders: map[string]string{}}
	var authUsername, authParamName, authSecretEnc sql.NullString
	var customHeadersRaw []byte
	var lastRunAt sql.NullTime

	err := h.DB.QueryRowContext(ctx, `
		SELECT enabled, endpoint_url, method, body_format, auth_type, auth_username,
		       auth_secret_encrypted, auth_param_name, custom_headers, cap_per_run, last_run_at
		FROM link_forwarding_configs WHERE link_id = ?`, linkID,
	).Scan(&row.Enabled, &row.EndpointURL, &row.Method, &row.BodyFormat, &row.AuthType,
		&authUsername, &authSecretEnc, &authParamName, &customHeadersRaw, &row.CapPerRun, &lastRunAt)
	if err == sql.ErrNoRows {
		return &row, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	row.AuthUsername = authUsername.String
	row.AuthParamName = authParamName.String
	row.HasSecret = authSecretEnc.Valid && authSecretEnc.String != ""
	if len(customHeadersRaw) > 0 {
		_ = json.Unmarshal(customHeadersRaw, &row.CustomHeaders)
	}
	if lastRunAt.Valid {
		s := lastRunAt.Time.UTC().Format(time.RFC3339)
		row.LastRunAt = &s
	}
	return &row, authSecretEnc.String, nil
}

func (h *ForwardingHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	linkID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}
	row, _, err := h.loadRow(r.Context(), linkID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load forwarding configuration")
		return
	}
	backlog, err := forwarding.CountBacklog(r.Context(), h.DB, linkID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load forwarding backlog")
		return
	}
	row.Backlog = backlog
	httpresp.JSON(w, http.StatusOK, row)
}

type upsertForwardingRequest struct {
	Enabled       bool              `json:"enabled"`
	EndpointURL   string            `json:"endpoint_url"`
	Method        string            `json:"method"`
	BodyFormat    string            `json:"body_format"`
	AuthType      string            `json:"auth_type"`
	AuthUsername  string            `json:"auth_username"`
	AuthSecret    string            `json:"auth_secret"` // empty = keep existing secret
	AuthParamName string            `json:"auth_param_name"`
	CustomHeaders map[string]string `json:"custom_headers"`
	CapPerRun     int               `json:"cap_per_run"`
}

func (h *ForwardingHandler) UpsertConfig(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	linkID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}

	var req upsertForwardingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	if !validForwardingMethods[req.Method] {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Method must be get or post")
		return
	}
	if !validBodyFormats[req.BodyFormat] {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Body format must be url_encoded or json")
		return
	}
	if !validAuthTypes[req.AuthType] {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid authentication type")
		return
	}
	if !validCaps[req.CapPerRun] {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Cap per run must be 10, 25, 50, 100, 150 or 200")
		return
	}
	if req.AuthType == "basic" && req.AuthUsername == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Basic Auth requires a username")
		return
	}
	if (req.AuthType == "api_key_header" || req.AuthType == "api_key_query") && req.AuthParamName == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "API Key auth requires a header/param name")
		return
	}
	if req.Enabled {
		if err := forwarding.ValidateEndpoint(req.EndpointURL); err != nil {
			httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
	}

	existing, existingSecretEnc, err := h.loadRow(r.Context(), linkID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load forwarding configuration")
		return
	}

	secretEnc := existingSecretEnc
	if req.AuthType == "none" {
		secretEnc = ""
	} else if req.AuthSecret != "" {
		enc, err := crypto.EncryptSecret(req.AuthSecret, h.EncryptionKey)
		if err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not encrypt secret")
			return
		}
		secretEnc = enc
	} else if !existing.HasSecret && req.AuthType != "none" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "This authentication type requires a secret")
		return
	}

	headersJSON, err := json.Marshal(req.CustomHeaders)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid custom headers")
		return
	}

	var secretArg any
	if secretEnc != "" {
		secretArg = secretEnc
	}
	_, err = h.DB.ExecContext(r.Context(), `
		INSERT INTO link_forwarding_configs
			(link_id, enabled, endpoint_url, method, body_format, auth_type, auth_username, auth_secret_encrypted, auth_param_name, custom_headers, cap_per_run)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			enabled = VALUES(enabled), endpoint_url = VALUES(endpoint_url), method = VALUES(method),
			body_format = VALUES(body_format), auth_type = VALUES(auth_type), auth_username = VALUES(auth_username),
			auth_secret_encrypted = VALUES(auth_secret_encrypted), auth_param_name = VALUES(auth_param_name),
			custom_headers = VALUES(custom_headers), cap_per_run = VALUES(cap_per_run)`,
		linkID, req.Enabled, req.EndpointURL, req.Method, req.BodyFormat, req.AuthType,
		req.AuthUsername, secretArg, req.AuthParamName, headersJSON, req.CapPerRun,
	)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not save forwarding configuration")
		return
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.forwarding_update", http.StatusOK, "link", linkID, nil,
		map[string]any{"enabled": req.Enabled, "endpoint_url": req.EndpointURL, "method": req.Method, "body_format": req.BodyFormat, "auth_type": req.AuthType, "cap_per_run": req.CapPerRun},
		r.RemoteAddr, r.UserAgent())

	row, _, err := h.loadRow(r.Context(), linkID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load forwarding configuration")
		return
	}
	backlog, _ := forwarding.CountBacklog(r.Context(), h.DB, linkID)
	row.Backlog = backlog
	httpresp.JSON(w, http.StatusOK, row)
}

func (h *ForwardingHandler) SendNow(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	linkID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}

	result, err := forwarding.RunForLink(r.Context(), h.DB, linkID, h.EncryptionKey, true)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.forwarding_send_now", http.StatusOK, "link", linkID, nil, result, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, result)
}

type forwardingDeliveryRow struct {
	ID         int64   `json:"id"`
	RecordType string  `json:"record_type"`
	RecordID   int64   `json:"record_id"`
	Status     string  `json:"status"`
	HTTPStatus *int    `json:"http_status"`
	Attempts   int     `json:"attempts"`
	LastError  string  `json:"last_error"`
	SentAt     *string `json:"sent_at"`
	UpdatedAt  string  `json:"updated_at"`
}

var forwardingDeliveriesSortColumns = map[string]string{"updated_at": "updated_at"}

func (h *ForwardingHandler) Deliveries(w http.ResponseWriter, r *http.Request) {
	linkID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}
	params := listquery.Parse(r, forwardingDeliveriesSortColumns, "updated_at", "DESC")

	where := "link_id = ?"
	args := []any{linkID}
	if status := r.URL.Query().Get("status"); status == "pending" || status == "sent" || status == "failed" {
		where += " AND status = ?"
		args = append(args, status)
	}

	var total int
	if err := h.DB.QueryRowContext(r.Context(), fmt.Sprintf(`SELECT COUNT(*) FROM link_forwarding_deliveries WHERE %s`, where), args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load delivery log")
		return
	}

	rows, err := h.DB.QueryContext(r.Context(), fmt.Sprintf(
		`SELECT id, record_type, record_id, status, http_status, attempts, COALESCE(last_error, ''), sent_at, updated_at
		 FROM link_forwarding_deliveries WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`, where, params.SortCol, params.Dir),
		append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load delivery log")
		return
	}
	defer rows.Close()

	items := []forwardingDeliveryRow{}
	for rows.Next() {
		var row forwardingDeliveryRow
		var httpStatus sql.NullInt64
		var sentAt sql.NullTime
		var updatedAt time.Time
		if err := rows.Scan(&row.ID, &row.RecordType, &row.RecordID, &row.Status, &httpStatus, &row.Attempts, &row.LastError, &sentAt, &updatedAt); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read delivery log")
			return
		}
		if httpStatus.Valid {
			v := int(httpStatus.Int64)
			row.HTTPStatus = &v
		}
		if sentAt.Valid {
			s := sentAt.Time.UTC().Format(time.RFC3339)
			row.SentAt = &s
		}
		row.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		items = append(items, row)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": params.Page, "per_page": params.PerPage,
	})
}
