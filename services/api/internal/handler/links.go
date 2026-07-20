package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/httpresp"
	"postback-system/shared/idgen"
	"postback-system/shared/listquery"
)

// LinksHandler covers link CRUD + listing only (first version). Short-link redirect
// execution, CID/click capture, fraud checks and the postback receiver live in the
// separate redirect service and are a later build pass.
type LinksHandler struct {
	DB *sql.DB
}

type linkRow struct {
	ID             int64   `json:"id"`
	Type           string  `json:"type"`
	Slug           string  `json:"slug"`
	Tid            string  `json:"tid"`
	DestinationURL string  `json:"destination_url"`
	ParamMode      string  `json:"param_mode"`
	TenantID       int64   `json:"tenant_id"`
	TenantName     string  `json:"tenant_name"`
	CampaignID     int64   `json:"campaign_id"`
	CampaignName   string  `json:"campaign_name"`
	Remarks        string  `json:"remarks"`
	Status         string  `json:"status"`
	ExpiresAt      *string `json:"expires_at"`
	CreatedByName  string  `json:"created_by_name"`
	CreatedAt      string  `json:"created_at"`
}

// A Link's Merchant is derived from its Campaign (campaigns.tenant_id is the single
// source of truth) rather than carrying its own tenant_id — see migration 0004.
const linkSelectColumns = `l.id, l.type, l.slug, l.tid, l.destination_url, l.param_mode,
	       c.tenant_id, t.name, l.campaign_id, c.name,
	       COALESCE(l.remarks, ''), l.status, l.expires_at,
	       COALESCE(u.full_name, ''), l.created_at`

const linkSelectJoins = `FROM links l
	JOIN campaigns c ON l.campaign_id = c.id
	JOIN tenants t ON c.tenant_id = t.id
	LEFT JOIN users u ON l.created_by = u.id`

func scanLinkRow(scan func(dest ...any) error) (linkRow, error) {
	var row linkRow
	var expiresAt sql.NullTime
	var createdAt time.Time
	err := scan(&row.ID, &row.Type, &row.Slug, &row.Tid, &row.DestinationURL, &row.ParamMode,
		&row.TenantID, &row.TenantName, &row.CampaignID, &row.CampaignName,
		&row.Remarks, &row.Status, &expiresAt, &row.CreatedByName, &createdAt)
	if err != nil {
		return row, err
	}
	if expiresAt.Valid {
		s := expiresAt.Time.Format(time.RFC3339)
		row.ExpiresAt = &s
	}
	row.CreatedAt = createdAt.Format(time.RFC3339)
	return row, nil
}

var linksSortColumns = map[string]string{
	"created_at": "l.created_at",
	"slug":       "l.slug",
	"status":     "l.status",
	"expires_at": "l.expires_at",
}

var slugPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func (h *LinksHandler) List(w http.ResponseWriter, r *http.Request) {
	params := listquery.Parse(r, linksSortColumns, "created_at", "DESC")
	q := r.URL.Query()
	statusFilter := q.Get("status")
	tenantFilter := q.Get("tenant_id")
	campaignFilter := q.Get("campaign_id")

	where := []string{"1=1"}
	args := []any{}
	if params.Search != "" {
		where = append(where, "(l.slug LIKE ? OR l.remarks LIKE ?)")
		args = append(args, "%"+params.Search+"%", "%"+params.Search+"%")
	}
	if statusFilter == "active" || statusFilter == "inactive" {
		where = append(where, "l.status = ?")
		args = append(args, statusFilter)
	}
	if tenantFilter != "" {
		where = append(where, "c.tenant_id = ?")
		args = append(args, tenantFilter)
	}
	if campaignFilter != "" {
		where = append(where, "l.campaign_id = ?")
		args = append(args, campaignFilter)
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) %s WHERE %s`, linkSelectJoins, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load links")
		return
	}

	listSQL := fmt.Sprintf(`SELECT %s %s WHERE %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		linkSelectColumns, linkSelectJoins, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listSQL, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load links")
		return
	}
	defer rows.Close()

	items := []linkRow{}
	for rows.Next() {
		row, err := scanLinkRow(rows.Scan)
		if err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read links")
			return
		}
		items = append(items, row)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": params.Page, "per_page": params.PerPage,
	})
}

func (h *LinksHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}

	query := fmt.Sprintf(`SELECT %s %s WHERE l.id = ?`, linkSelectColumns, linkSelectJoins)
	row, err := scanLinkRow(h.DB.QueryRowContext(r.Context(), query, id).Scan)
	if err != nil {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "Link not found")
		return
	}
	httpresp.JSON(w, http.StatusOK, row)
}

type createLinkRequest struct {
	Type           string  `json:"type"`
	Slug           string  `json:"slug"`
	DestinationURL string  `json:"destination_url"`
	ParamMode      string  `json:"param_mode"`
	CampaignID     int64   `json:"campaign_id"`
	ExpiresAt      *string `json:"expires_at"`
	Remarks        string  `json:"remarks"`
}

func validateDestinationURL(raw string) error {
	u, err := url.ParseRequestURI(raw)
	if err != nil {
		return fmt.Errorf("destination URL is not a valid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("destination URL must start with http:// or https://")
	}
	if u.Host == "" {
		return fmt.Errorf("destination URL must include a domain")
	}
	return nil
}

func (h *LinksHandler) Create(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req createLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	if req.Type == "" {
		req.Type = "redirection"
	}
	if req.Type != "redirection" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Only the Redirection type is available right now — Cloaking is coming later")
		return
	}
	if req.ParamMode != "pass_all" {
		req.ParamMode = "cid_tid_only"
	}
	req.DestinationURL = strings.TrimSpace(req.DestinationURL)
	if err := validateDestinationURL(req.DestinationURL); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", strings.ToUpper(err.Error()[:1])+err.Error()[1:])
		return
	}
	if req.CampaignID == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Campaign is required")
		return
	}

	req.Slug = strings.TrimSpace(req.Slug)
	if req.Slug != "" && (len(req.Slug) < 3 || len(req.Slug) > 32 || !slugPattern.MatchString(req.Slug)) {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Slug must be 3-32 characters (letters, numbers, - or _ only)")
		return
	}

	var expiresAt any
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		expiresAt = *req.ExpiresAt
	}

	var linkID int64
	const maxAttempts = 5
	for attempt := 0; attempt < maxAttempts; attempt++ {
		slug := req.Slug
		if slug == "" {
			generated, err := idgen.New(10)
			if err != nil {
				httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not generate slug")
				return
			}
			slug = generated
		}
		tid, err := idgen.New(12)
		if err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not generate tracking id")
			return
		}

		res, err := h.DB.ExecContext(r.Context(),
			`INSERT INTO links (type, slug, tid, destination_url, param_mode, campaign_id, expires_at, remarks, status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
			req.Type, slug, tid, req.DestinationURL, req.ParamMode, req.CampaignID, expiresAt, req.Remarks, actor.UserID)
		if err != nil {
			if strings.Contains(err.Error(), "Duplicate entry") {
				if req.Slug != "" {
					httpresp.JSONError(w, http.StatusConflict, "slug_taken", "This slug is already in use")
					return
				}
				continue // collision on an auto-generated slug/tid — retry with a fresh one
			}
			if strings.Contains(err.Error(), "foreign key constraint") {
				httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Selected Campaign does not exist")
				return
			}
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create link")
			return
		}
		linkID, _ = res.LastInsertId()
		break
	}
	if linkID == 0 {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not generate a unique slug, please try again")
		return
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.create", http.StatusCreated, "link", linkID, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusCreated, map[string]any{"id": linkID})
}

type updateLinkRequest struct {
	DestinationURL string  `json:"destination_url"`
	ParamMode      string  `json:"param_mode"`
	CampaignID     int64   `json:"campaign_id"`
	ExpiresAt      *string `json:"expires_at"`
	Remarks        string  `json:"remarks"`
}

func (h *LinksHandler) Update(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}

	var req updateLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.DestinationURL = strings.TrimSpace(req.DestinationURL)
	if err := validateDestinationURL(req.DestinationURL); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", strings.ToUpper(err.Error()[:1])+err.Error()[1:])
		return
	}
	if req.ParamMode != "pass_all" {
		req.ParamMode = "cid_tid_only"
	}
	if req.CampaignID == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Campaign is required")
		return
	}
	var expiresAt any
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		expiresAt = *req.ExpiresAt
	}

	_, err = h.DB.ExecContext(r.Context(),
		`UPDATE links SET destination_url = ?, param_mode = ?, campaign_id = ?, expires_at = ?, remarks = ? WHERE id = ?`,
		req.DestinationURL, req.ParamMode, req.CampaignID, expiresAt, req.Remarks, id)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update link")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.update", http.StatusOK, "link", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *LinksHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}
	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Status must be active or inactive")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(), `UPDATE links SET status = ? WHERE id = ?`, req.Status, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.status_change", http.StatusOK, "link", id, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *LinksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(), `DELETE FROM links WHERE id = ?`, id); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete link")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.delete", http.StatusOK, "link", id, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *LinksHandler) BulkStatus(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	var req bulkStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 || (req.Status != "active" && req.Status != "inactive") {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list and a valid status are required")
		return
	}
	query := fmt.Sprintf(`UPDATE links SET status = ? WHERE id IN (%s)`, idPlaceholders(len(req.IDs)))
	args := append([]any{req.Status}, toArgs(req.IDs)...)
	if _, err := h.DB.ExecContext(r.Context(), query, args...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update status")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.bulk_status_change", http.StatusOK, "link", 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "updated", "count": len(req.IDs)})
}

func (h *LinksHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	var req bulkIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "A non-empty id list is required")
		return
	}
	query := fmt.Sprintf(`DELETE FROM links WHERE id IN (%s)`, idPlaceholders(len(req.IDs)))
	if _, err := h.DB.ExecContext(r.Context(), query, toArgs(req.IDs)...); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not delete links")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "link.bulk_delete", http.StatusOK, "link", 0, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]any{"status": "deleted", "count": len(req.IDs)})
}

type postbackRow struct {
	EventName   string         `json:"event_name"`
	ExtraFields map[string]any `json:"extra_fields"`
	ReceivedVia string         `json:"received_via"`
	ReceivedAt  time.Time      `json:"received_at"`
}

type clickRow struct {
	ID        int64          `json:"id"`
	CID       string         `json:"cid"`
	IP        string         `json:"ip"`
	Country   string         `json:"country"`
	City      string         `json:"city"`
	Device    string         `json:"device"`
	OS        string         `json:"os"`
	Browser   string         `json:"browser"`
	Params    map[string]any `json:"params"`
	ClickedAt time.Time      `json:"clicked_at"`
	Postbacks []postbackRow  `json:"postbacks"`
}

var clicksSortColumns = map[string]string{
	"clicked_at": "clicked_at",
}

func splitCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func inClause(column string, values []string, args *[]any) string {
	placeholders := idPlaceholders(len(values))
	for _, v := range values {
		*args = append(*args, v)
	}
	return fmt.Sprintf("%s IN (%s)", column, placeholders)
}

// Clicks lists the recorded visits/redirects for a single link — the "Visits" section
// on the Single Link page. Device/OS/browser are parsed once at insert time by the
// redirect service and stored as real columns (see migration 0005), which is what
// makes them filterable here without re-parsing every User-Agent on every read.
func (h *LinksHandler) Clicks(w http.ResponseWriter, r *http.Request) {
	linkID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid link id")
		return
	}
	params := listquery.Parse(r, clicksSortColumns, "clicked_at", "DESC")
	q := r.URL.Query()

	where := []string{"lc.link_id = ?"}
	args := []any{linkID}

	if params.Search != "" {
		where = append(where, `EXISTS (SELECT 1 FROM postback_events pe WHERE pe.link_click_id = lc.id AND (pe.event_name LIKE ? OR pe.extra_fields LIKE ?))`)
		like := "%" + params.Search + "%"
		args = append(args, like, like)
	}
	if dateFrom := q.Get("date_from"); dateFrom != "" {
		where = append(where, "lc.clicked_at >= ?")
		args = append(args, dateFrom+" 00:00:00")
	}
	if dateTo := q.Get("date_to"); dateTo != "" {
		where = append(where, "lc.clicked_at <= ?")
		args = append(args, dateTo+" 23:59:59")
	}
	if postbackFrom := q.Get("postback_from"); postbackFrom != "" {
		where = append(where, `EXISTS (SELECT 1 FROM postback_events pe WHERE pe.link_click_id = lc.id AND pe.received_at >= ?)`)
		args = append(args, postbackFrom+" 00:00:00")
	}
	if postbackTo := q.Get("postback_to"); postbackTo != "" {
		where = append(where, `EXISTS (SELECT 1 FROM postback_events pe WHERE pe.link_click_id = lc.id AND pe.received_at <= ?)`)
		args = append(args, postbackTo+" 23:59:59")
	}
	if devices := splitCSV(q.Get("device")); len(devices) > 0 {
		where = append(where, inClause("lc.device", devices, &args))
	}
	if osList := splitCSV(q.Get("os")); len(osList) > 0 {
		where = append(where, inClause("lc.os", osList, &args))
	}
	if browsers := splitCSV(q.Get("browser")); len(browsers) > 0 {
		where = append(where, inClause("lc.browser", browsers, &args))
	}
	whereClause := strings.Join(where, " AND ")

	var total int
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM link_clicks lc WHERE %s`, whereClause)
	if err := h.DB.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load visit history")
		return
	}

	listSQL := fmt.Sprintf(
		`SELECT lc.id, lc.cid, COALESCE(lc.ip_display, ''), COALESCE(lc.geo_country, ''), COALESCE(lc.geo_region, ''),
		        COALESCE(lc.device, 'Unknown'), COALESCE(lc.os, 'Unknown'), COALESCE(lc.browser, 'Unknown'),
		        lc.captured_query, lc.clicked_at
		 FROM link_clicks lc WHERE %s ORDER BY lc.%s %s LIMIT ? OFFSET ?`, whereClause, params.SortCol, params.Dir)
	rows, err := h.DB.QueryContext(r.Context(), listSQL, append(args, params.PerPage, params.Offset())...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load visit history")
		return
	}
	defer rows.Close()

	items := []clickRow{}
	for rows.Next() {
		var row clickRow
		var capturedQuery []byte
		if err := rows.Scan(&row.ID, &row.CID, &row.IP, &row.Country, &row.City, &row.Device, &row.OS, &row.Browser, &capturedQuery, &row.ClickedAt); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read visit history")
			return
		}
		if len(capturedQuery) > 0 {
			_ = json.Unmarshal(capturedQuery, &row.Params)
		}
		items = append(items, row)
	}

	if err := h.attachPostbacks(r, items); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load postback history")
		return
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": params.Page, "per_page": params.PerPage,
	})
}

// attachPostbacks nests each click's postback events under it — a postback is always
// recorded against the click (CID) that produced it, so the Visits table can expand a
// row to show what came back from the destination site for that visit.
func (h *LinksHandler) attachPostbacks(r *http.Request, items []clickRow) error {
	if len(items) == 0 {
		return nil
	}
	idToIndex := make(map[int64]int, len(items))
	ids := make([]int64, len(items))
	for i, row := range items {
		idToIndex[row.ID] = i
		ids[i] = row.ID
	}

	query := fmt.Sprintf(
		`SELECT link_click_id, event_name, extra_fields, received_via, received_at
		 FROM postback_events WHERE link_click_id IN (%s) ORDER BY received_at ASC`, idPlaceholders(len(ids)))
	rows, err := h.DB.QueryContext(r.Context(), query, toArgs(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var clickID int64
		var pb postbackRow
		var extraFields []byte
		if err := rows.Scan(&clickID, &pb.EventName, &extraFields, &pb.ReceivedVia, &pb.ReceivedAt); err != nil {
			return err
		}
		if len(extraFields) > 0 {
			_ = json.Unmarshal(extraFields, &pb.ExtraFields)
		}
		idx := idToIndex[clickID]
		items[idx].Postbacks = append(items[idx].Postbacks, pb)
	}
	return nil
}
