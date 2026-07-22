// Package forwarding is the shared sending engine behind Links > Single Link >
// Forwarding: gathering a link's unsent clicks ("leads") and postbacks ("actions"),
// dispatching them to the configured third-party endpoint, and recording delivery
// status. Used by both the on-demand "Send Now" API handler and the daily sweep in
// services/worker, so the two never drift in behavior.
package forwarding

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"postback-system/shared/crypto"
)

type Config struct {
	LinkID        int64
	Enabled       bool
	EndpointURL   string
	Method        string // "get" | "post"
	BodyFormat    string // "url_encoded" | "json"
	AuthType      string // "none" | "bearer" | "basic" | "api_key_header" | "api_key_query"
	AuthUsername  string
	AuthSecret    string // decrypted, in-memory only — never written back out
	AuthParamName string
	CustomHeaders map[string]string
	CapPerRun     int
}

type Record struct {
	Type      string // "lead" | "action"
	RecordID  int64
	Timestamp time.Time
	Payload   map[string]any
}

type RunResult struct {
	Sent    int `json:"sent"`
	Failed  int `json:"failed"`
	Backlog int `json:"backlog"`
}

var httpClient = &http.Client{
	Timeout: 15 * time.Second,
	// Don't auto-follow redirects — a redirect could point at a private address the
	// SSRF check on the original URL never saw.
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// ValidateEndpoint blocks private/loopback/link-local targets. Checked both when a
// config is saved and again right before every send, since a DNS answer can change
// between the two (rebinding).
func ValidateEndpoint(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid endpoint URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("endpoint URL must start with http:// or https://")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("endpoint URL must include a domain")
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return fmt.Errorf("could not resolve endpoint host")
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("endpoint URL resolves to a private/internal address, which is not allowed")
		}
	}
	return nil
}

// LoadConfig returns nil, nil if the link has no forwarding config row yet.
func LoadConfig(ctx context.Context, db *sql.DB, linkID int64, encryptionKey string) (*Config, error) {
	var cfg Config
	var authUsername, authSecretEnc, authParamName sql.NullString
	var customHeadersRaw []byte
	err := db.QueryRowContext(ctx, `
		SELECT link_id, enabled, endpoint_url, method, body_format, auth_type,
		       auth_username, auth_secret_encrypted, auth_param_name, custom_headers, cap_per_run
		FROM link_forwarding_configs WHERE link_id = ?`, linkID,
	).Scan(&cfg.LinkID, &cfg.Enabled, &cfg.EndpointURL, &cfg.Method, &cfg.BodyFormat, &cfg.AuthType,
		&authUsername, &authSecretEnc, &authParamName, &customHeadersRaw, &cfg.CapPerRun)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cfg.AuthUsername = authUsername.String
	cfg.AuthParamName = authParamName.String
	if authSecretEnc.Valid && authSecretEnc.String != "" {
		secret, derr := crypto.DecryptSecret(authSecretEnc.String, encryptionKey)
		if derr != nil {
			return nil, fmt.Errorf("could not decrypt forwarding secret: %w", derr)
		}
		cfg.AuthSecret = secret
	}
	cfg.CustomHeaders = map[string]string{}
	if len(customHeadersRaw) > 0 {
		_ = json.Unmarshal(customHeadersRaw, &cfg.CustomHeaders)
	}
	return &cfg, nil
}

// unsentClause is shared between FetchBacklog (capped) and CountBacklog (uncapped) so
// the two can never disagree about what "unsent" means.
const unsentLeadsWhere = `lc.link_id = ? AND lc.id NOT IN (
	SELECT record_id FROM link_forwarding_deliveries WHERE link_id = ? AND record_type = 'lead' AND status = 'sent'
)`

const unsentActionsWhere = `lc.link_id = ? AND pe.id NOT IN (
	SELECT record_id FROM link_forwarding_deliveries WHERE link_id = ? AND record_type = 'action' AND status = 'sent'
)`

func fetchLeads(ctx context.Context, db *sql.DB, linkID int64, limit int) ([]Record, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT lc.id, lc.cid, lc.clicked_at, lc.captured_query
		FROM link_clicks lc WHERE %s ORDER BY lc.clicked_at ASC LIMIT ?`, unsentLeadsWhere),
		linkID, linkID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Record
	for rows.Next() {
		var id int64
		var cid string
		var clickedAt time.Time
		var capturedQuery []byte
		if err := rows.Scan(&id, &cid, &clickedAt, &capturedQuery); err != nil {
			return nil, err
		}
		var params map[string]any
		if len(capturedQuery) > 0 {
			_ = json.Unmarshal(capturedQuery, &params)
		}
		out = append(out, Record{
			Type: "lead", RecordID: id, Timestamp: clickedAt,
			Payload: map[string]any{"type": "lead", "cid": cid, "clicked_at": clickedAt.UTC().Format(time.RFC3339), "params": params},
		})
	}
	return out, rows.Err()
}

func fetchActions(ctx context.Context, db *sql.DB, linkID int64, limit int) ([]Record, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT pe.id, pe.event_name, pe.received_at, pe.extra_fields, lc.cid
		FROM postback_events pe JOIN link_clicks lc ON pe.link_click_id = lc.id
		WHERE %s ORDER BY pe.received_at ASC LIMIT ?`, unsentActionsWhere),
		linkID, linkID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Record
	for rows.Next() {
		var id int64
		var eventName, cid string
		var receivedAt time.Time
		var extraFieldsRaw []byte
		if err := rows.Scan(&id, &eventName, &receivedAt, &extraFieldsRaw, &cid); err != nil {
			return nil, err
		}
		var extraFields map[string]any
		if len(extraFieldsRaw) > 0 {
			_ = json.Unmarshal(extraFieldsRaw, &extraFields)
		}
		out = append(out, Record{
			Type: "action", RecordID: id, Timestamp: receivedAt,
			Payload: map[string]any{
				"type": "action", "cid": cid, "event_name": eventName,
				"received_at": receivedAt.UTC().Format(time.RFC3339), "extra_fields": extraFields,
			},
		})
	}
	return out, rows.Err()
}

// FetchBacklog merges unsent leads and actions into one oldest-first queue, capped at
// limit total — clicks and postbacks share a single per-link cap, not one each.
func FetchBacklog(ctx context.Context, db *sql.DB, linkID int64, limit int) ([]Record, error) {
	leads, err := fetchLeads(ctx, db, linkID, limit)
	if err != nil {
		return nil, err
	}
	actions, err := fetchActions(ctx, db, linkID, limit)
	if err != nil {
		return nil, err
	}
	merged := append(leads, actions...)
	sort.Slice(merged, func(i, j int) bool { return merged[i].Timestamp.Before(merged[j].Timestamp) })
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged, nil
}

// CountBacklog is the uncapped backlog size shown in the tab's delivery-log section.
func CountBacklog(ctx context.Context, db *sql.DB, linkID int64) (int, error) {
	var leadCount, actionCount int
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM link_clicks lc WHERE %s`, unsentLeadsWhere), linkID, linkID).Scan(&leadCount); err != nil {
		return 0, err
	}
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM postback_events pe JOIN link_clicks lc ON pe.link_click_id = lc.id WHERE %s`, unsentActionsWhere), linkID, linkID).Scan(&actionCount); err != nil {
		return 0, err
	}
	return leadCount + actionCount, nil
}

func applyAuth(req *http.Request, cfg *Config) {
	switch cfg.AuthType {
	case "bearer":
		req.Header.Set("Authorization", "Bearer "+cfg.AuthSecret)
	case "basic":
		req.SetBasicAuth(cfg.AuthUsername, cfg.AuthSecret)
	case "api_key_header":
		if cfg.AuthParamName != "" {
			req.Header.Set(cfg.AuthParamName, cfg.AuthSecret)
		}
	case "api_key_query":
		if cfg.AuthParamName != "" {
			q := req.URL.Query()
			q.Set(cfg.AuthParamName, cfg.AuthSecret)
			req.URL.RawQuery = q.Encode()
		}
	}
	// Custom headers are merged in on top of auth — a header key here can override an
	// auth header (e.g. a custom Authorization) since the caller set it explicitly.
	for k, v := range cfg.CustomHeaders {
		req.Header.Set(k, v)
	}
}

func flattenToValues(payload map[string]any) url.Values {
	values := url.Values{}
	for k, v := range payload {
		switch val := v.(type) {
		case nil:
			continue
		case string:
			values.Set(k, val)
		case map[string]any, []any:
			if b, err := json.Marshal(val); err == nil {
				values.Set(k, string(b))
			}
		default:
			values.Set(k, fmt.Sprintf("%v", val))
		}
	}
	return values
}

func doRequest(req *http.Request) (ok bool, status int, errMsg string) {
	res, err := httpClient.Do(req)
	if err != nil {
		return false, 0, err.Error()
	}
	defer res.Body.Close()
	ok = res.StatusCode >= 200 && res.StatusCode < 300
	if !ok {
		return false, res.StatusCode, fmt.Sprintf("endpoint returned HTTP %d", res.StatusCode)
	}
	return true, res.StatusCode, ""
}

func sendSingle(ctx context.Context, cfg *Config, record Record) (bool, int, string) {
	values := flattenToValues(record.Payload)

	if cfg.Method == "get" {
		u, err := url.Parse(cfg.EndpointURL)
		if err != nil {
			return false, 0, "invalid endpoint URL"
		}
		q := u.Query()
		for k, v := range values {
			q[k] = v
		}
		u.RawQuery = q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return false, 0, err.Error()
		}
		applyAuth(req, cfg)
		return doRequest(req)
	}

	// POST + url-encoded (POST + JSON is always batched, never a single-record call).
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.EndpointURL, strings.NewReader(values.Encode()))
	if err != nil {
		return false, 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	applyAuth(req, cfg)
	return doRequest(req)
}

func sendBatch(ctx context.Context, cfg *Config, records []Record) (bool, int, string) {
	payloads := make([]map[string]any, len(records))
	for i, r := range records {
		payloads[i] = r.Payload
	}
	body, err := json.Marshal(payloads)
	if err != nil {
		return false, 0, err.Error()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.EndpointURL, strings.NewReader(string(body)))
	if err != nil {
		return false, 0, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	applyAuth(req, cfg)
	return doRequest(req)
}

func recordDelivery(ctx context.Context, db *sql.DB, linkID int64, r Record, status string, httpStatus int, errMsg string) {
	var sentAt any
	if status == "sent" {
		sentAt = time.Now().UTC()
	}
	var lastError any
	if errMsg != "" {
		lastError = errMsg
	}
	var httpStatusVal any
	if httpStatus != 0 {
		httpStatusVal = httpStatus
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO link_forwarding_deliveries (link_id, record_type, record_id, status, http_status, attempts, last_error, sent_at)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON DUPLICATE KEY UPDATE status = VALUES(status), http_status = VALUES(http_status),
			attempts = attempts + 1, last_error = VALUES(last_error), sent_at = VALUES(sent_at)`,
		linkID, r.Type, r.RecordID, status, httpStatusVal, lastError, sentAt)
	if err != nil {
		log.Printf("forwarding: could not record delivery for link %d record %d: %v", linkID, r.RecordID, err)
	}
}

// Send dispatches records per cfg.Method/BodyFormat and writes a delivery-log row per
// record. POST+JSON is sent as a single batched call; every other combination sends
// one call per record (a GET or a url-encoded POST body can't serialize an array).
func Send(ctx context.Context, db *sql.DB, cfg *Config, records []Record) RunResult {
	result := RunResult{}
	if len(records) == 0 {
		return result
	}

	if cfg.Method == "post" && cfg.BodyFormat == "json" {
		ok, httpStatus, errMsg := sendBatch(ctx, cfg, records)
		status := "failed"
		if ok {
			status = "sent"
			result.Sent = len(records)
		} else {
			result.Failed = len(records)
		}
		for _, r := range records {
			recordDelivery(ctx, db, cfg.LinkID, r, status, httpStatus, errMsg)
		}
		return result
	}

	for _, r := range records {
		ok, httpStatus, errMsg := sendSingle(ctx, cfg, r)
		if ok {
			result.Sent++
			recordDelivery(ctx, db, cfg.LinkID, r, "sent", httpStatus, "")
		} else {
			result.Failed++
			recordDelivery(ctx, db, cfg.LinkID, r, "failed", httpStatus, errMsg)
		}
	}
	return result
}

// RunForLink is the single entry point both "Send Now" and the daily sweep call — load
// config, skip if disabled, validate the endpoint, gather the capped backlog, send, and
// stamp last_run_at. Returns a zero RunResult (not an error) when forwarding is simply
// off for this link, since that's an expected, non-exceptional state. force=true (used
// by the manual "Send Now" action) sends even when the link's forwarding is toggled
// off — the toggle only controls whether the daily sweep picks the link up.
func RunForLink(ctx context.Context, db *sql.DB, linkID int64, encryptionKey string, force bool) (RunResult, error) {
	cfg, err := LoadConfig(ctx, db, linkID, encryptionKey)
	if err != nil {
		return RunResult{}, err
	}
	if cfg == nil {
		return RunResult{}, fmt.Errorf("no forwarding configuration found for this link")
	}
	if !force && !cfg.Enabled {
		return RunResult{}, nil
	}
	if err := ValidateEndpoint(cfg.EndpointURL); err != nil {
		return RunResult{}, err
	}

	records, err := FetchBacklog(ctx, db, linkID, cfg.CapPerRun)
	if err != nil {
		return RunResult{}, err
	}
	result := Send(ctx, db, cfg, records)

	backlog, err := CountBacklog(ctx, db, linkID)
	if err == nil {
		result.Backlog = backlog
	}

	if _, err := db.ExecContext(ctx, `UPDATE link_forwarding_configs SET last_run_at = ? WHERE link_id = ?`, time.Now().UTC(), linkID); err != nil {
		log.Printf("forwarding: could not stamp last_run_at for link %d: %v", linkID, err)
	}
	return result, nil
}

// RunDailySweep iterates every link with forwarding enabled independently — one link
// failing (bad endpoint, network error) never blocks the next.
func RunDailySweep(ctx context.Context, db *sql.DB, encryptionKey string) {
	rows, err := db.QueryContext(ctx, `SELECT link_id FROM link_forwarding_configs WHERE enabled = 1`)
	if err != nil {
		log.Printf("forwarding: could not list enabled configs: %v", err)
		return
	}
	var linkIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		linkIDs = append(linkIDs, id)
	}
	rows.Close()

	for _, id := range linkIDs {
		result, err := RunForLink(ctx, db, id, encryptionKey, false)
		if err != nil {
			log.Printf("forwarding: sweep failed for link %d: %v", id, err)
			continue
		}
		log.Printf("forwarding: link %d sweep done — sent=%d failed=%d backlog=%d", id, result.Sent, result.Failed, result.Backlog)
	}
}
