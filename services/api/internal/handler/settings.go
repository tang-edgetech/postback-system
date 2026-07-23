package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/crypto"
	"postback-system/shared/httpresp"
)

type SettingsHandler struct {
	DB            *sql.DB
	EncryptionKey string
}

var availableRegions = buildRegionList()

func buildRegionList() []string {
	regions := make([]string, 0, 27)
	for offset := -12; offset <= 14; offset++ {
		if offset == 0 {
			regions = append(regions, "GMT+0")
			continue
		}
		if offset < 0 {
			regions = append(regions, fmt.Sprintf("GMT-%d", -offset))
		} else {
			regions = append(regions, fmt.Sprintf("GMT+%d", offset))
		}
	}
	return regions
}

// loginPathPattern mirrors the dashboard's [slug] route matcher — lowercase
// letters/digits/hyphens only, so it's always a clean single URL segment.
var loginPathPattern = regexp.MustCompile(`^[a-z0-9-]{3,64}$`)

// reservedLoginPaths are the dashboard's other top-level routes — setting login_path to
// one of these would make the login page permanently unreachable (the static route
// always wins over the [slug] catch-all), silently locking everyone out. "login" itself
// is deliberately not reserved — it's the default value and must remain settable.
var reservedLoginPaths = map[string]bool{
	"dashboard": true, "audit-logs": true, "campaigns": true, "links": true,
	"merchants": true, "profile": true, "reports": true, "settings": true,
	"users": true, "setup": true, "uploads": true, "_next": true,
	"robots.txt": true, "favicon.ico": true, "default-favicon.ico": true,
}

func validateLoginPath(path string) error {
	if !loginPathPattern.MatchString(path) {
		return fmt.Errorf("Login path must be 3-64 lowercase letters, numbers or hyphens")
	}
	if reservedLoginPaths[path] {
		return fmt.Errorf("\"%s\" is a reserved route and can't be used as the login path", path)
	}
	return nil
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	var siteTitle, siteURL, logoPath, faviconPath sql.NullString
	var region, language, loginPath string
	var discourageIndexing bool
	var cfTokenEnc, cfZoneEnc sql.NullString

	err := h.DB.QueryRowContext(r.Context(),
		`SELECT site_title, site_url, region, language, discourage_indexing, login_path, logo_path, favicon_path, cf_api_token_encrypted, cf_zone_id_encrypted
		 FROM settings WHERE id = 1`,
	).Scan(&siteTitle, &siteURL, &region, &language, &discourageIndexing, &loginPath, &logoPath, &faviconPath, &cfTokenEnc, &cfZoneEnc)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load settings")
		return
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"site_title":            siteTitle.String,
		"site_url":              siteURL.String,
		"region":                region,
		"language":              language,
		"available_regions":     availableRegions,
		"discourage_indexing":   discourageIndexing,
		"login_path":            loginPath,
		"logo_path":             logoPath.String,
		"favicon_path":          faviconPath.String,
		"cloudflare_configured": cfTokenEnc.Valid && cfTokenEnc.String != "" && cfZoneEnc.Valid && cfZoneEnc.String != "",
	})
}

// Public exposes only branding fields (no auth) — the Login page and the sidebar need
// site_title/logo/favicon before (or regardless of) any session existing, but nothing
// else on /v1/settings is safe to leak pre-auth. login_path is included here too — the
// dashboard's [slug] route has to know it pre-auth to decide whether to render the
// login form or 404, and the app shell needs it to build every "go to login" redirect.
func (h *SettingsHandler) Public(w http.ResponseWriter, r *http.Request) {
	var siteTitle, logoPath, faviconPath sql.NullString
	var discourageIndexing bool
	var loginPath string
	if err := h.DB.QueryRowContext(r.Context(), `SELECT site_title, logo_path, favicon_path, discourage_indexing, login_path FROM settings WHERE id = 1`).
		Scan(&siteTitle, &logoPath, &faviconPath, &discourageIndexing, &loginPath); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load settings")
		return
	}
	httpresp.JSON(w, http.StatusOK, map[string]any{
		"site_title":          siteTitle.String,
		"logo_path":           logoPath.String,
		"favicon_path":        faviconPath.String,
		"discourage_indexing": discourageIndexing,
		"login_path":          loginPath,
	})
}

type updateGeneralRequest struct {
	SiteTitle string `json:"site_title"`
	SiteURL   string `json:"site_url"`
	Region    string `json:"region"`
	Language  string `json:"language"`
	LoginPath string `json:"login_path"`
}

func (h *SettingsHandler) UpdateGeneral(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updateGeneralRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.SiteTitle = strings.TrimSpace(req.SiteTitle)
	if req.SiteTitle == "" || req.Region == "" || req.Language == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Site title, region and language are required")
		return
	}
	validRegion := false
	for _, reg := range availableRegions {
		if reg == req.Region {
			validRegion = true
			break
		}
	}
	if !validRegion {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid region")
		return
	}

	req.LoginPath = strings.ToLower(strings.TrimSpace(req.LoginPath))
	if req.LoginPath == "" {
		req.LoginPath = "login"
	}
	if err := validateLoginPath(req.LoginPath); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	req.SiteURL = strings.TrimSpace(req.SiteURL)
	if req.SiteURL == "" {
		if origin := r.Header.Get("Origin"); origin != "" {
			req.SiteURL = origin
		}
	}

	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE settings SET site_title = ?, site_url = ?, region = ?, language = ?, login_path = ? WHERE id = 1`,
		req.SiteTitle, req.SiteURL, req.Region, req.Language, req.LoginPath,
	); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update settings")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_general", http.StatusOK, "settings", 1, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

type updateSEORequest struct {
	DiscourageIndexing bool `json:"discourage_indexing"`
}

// UpdateSEO is a single on/off switch, not a full SEO suite — this system is internal
// tooling, so the only meaningful "SEO" control is keeping search engines out entirely
// (noindex/nofollow + a disallow-all robots.txt, both driven off this one flag).
func (h *SettingsHandler) UpdateSEO(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updateSEORequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE settings SET discourage_indexing = ? WHERE id = 1`, req.DiscourageIndexing); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update SEO settings")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_seo", http.StatusOK, "settings", 1, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

type updateCloudflareRequest struct {
	APIToken string `json:"api_token"`
	ZoneID   string `json:"zone_id"`
}

func (h *SettingsHandler) UpdateCloudflare(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updateCloudflareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.APIToken = strings.TrimSpace(req.APIToken)
	req.ZoneID = strings.TrimSpace(req.ZoneID)
	if req.APIToken == "" || req.ZoneID == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "API token and zone ID are required")
		return
	}

	encToken, err := crypto.EncryptSecret(req.APIToken, h.EncryptionKey)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not secure credentials")
		return
	}
	encZone, err := crypto.EncryptSecret(req.ZoneID, h.EncryptionKey)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not secure credentials")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE settings SET cf_api_token_encrypted = ?, cf_zone_id_encrypted = ? WHERE id = 1`,
		encToken, encZone,
	); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update Cloudflare settings")
		return
	}
	// Never write the actual secret values into the audit trail.
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_cloudflare", http.StatusOK, "settings", 1, nil,
		map[string]string{"status": "credentials_rotated"}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

var advancedAuthTypes = []string{"hmac", "oauth2_client_credentials"}

func isAdvancedAuthType(t string) bool {
	for _, v := range advancedAuthTypes {
		if v == t {
			return true
		}
	}
	return false
}

type authTypeSetting struct {
	EnabledGlobally bool    `json:"enabled_globally"`
	LinkIDs         []int64 `json:"link_ids"`
}

// GetAuthentication backs the Settings > Authentication tab — the advanced Forwarding
// auth types (HMAC-signed requests, OAuth2 client-credentials) are hidden by default;
// this is where Super Admin turns them on, either for every Link or a specific allowlist.
func (h *SettingsHandler) GetAuthentication(w http.ResponseWriter, r *http.Request) {
	result := map[string]authTypeSetting{}
	for _, t := range advancedAuthTypes {
		result[t] = authTypeSetting{LinkIDs: []int64{}}
	}

	rows, err := h.DB.QueryContext(r.Context(), `SELECT auth_type, enabled_globally FROM advanced_auth_settings`)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load authentication settings")
		return
	}
	for rows.Next() {
		var authType string
		var enabled bool
		if err := rows.Scan(&authType, &enabled); err != nil {
			rows.Close()
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read authentication settings")
			return
		}
		if setting, ok := result[authType]; ok {
			setting.EnabledGlobally = enabled
			result[authType] = setting
		}
	}
	rows.Close()

	scopeRows, err := h.DB.QueryContext(r.Context(), `SELECT auth_type, link_id FROM advanced_auth_link_scope`)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load authentication link scope")
		return
	}
	defer scopeRows.Close()
	for scopeRows.Next() {
		var authType string
		var linkID int64
		if err := scopeRows.Scan(&authType, &linkID); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read authentication link scope")
			return
		}
		if setting, ok := result[authType]; ok {
			setting.LinkIDs = append(setting.LinkIDs, linkID)
			result[authType] = setting
		}
	}

	httpresp.JSON(w, http.StatusOK, result)
}

type updateAuthenticationRequest map[string]authTypeSetting

func (h *SettingsHandler) UpdateAuthentication(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updateAuthenticationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update authentication settings")
		return
	}
	defer tx.Rollback()

	for authType, setting := range req {
		if !isAdvancedAuthType(authType) {
			continue
		}
		if _, err := tx.ExecContext(r.Context(),
			`UPDATE advanced_auth_settings SET enabled_globally = ? WHERE auth_type = ?`, setting.EnabledGlobally, authType,
		); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update authentication settings")
			return
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM advanced_auth_link_scope WHERE auth_type = ?`, authType); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update authentication link scope")
			return
		}
		for _, linkID := range setting.LinkIDs {
			if _, err := tx.ExecContext(r.Context(),
				`INSERT INTO advanced_auth_link_scope (auth_type, link_id) VALUES (?, ?)`, authType, linkID,
			); err != nil {
				httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update authentication link scope")
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update authentication settings")
		return
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_authentication", http.StatusOK, "settings", 1, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *SettingsHandler) ClearCache(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var encToken, encZone sql.NullString
	if err := h.DB.QueryRowContext(r.Context(), `SELECT cf_api_token_encrypted, cf_zone_id_encrypted FROM settings WHERE id = 1`).Scan(&encToken, &encZone); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load Cloudflare credentials")
		return
	}
	if !encToken.Valid || encToken.String == "" || !encZone.Valid || encZone.String == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "cloudflare_not_configured", "Cloudflare API token and zone ID must be configured first")
		return
	}

	token, err := crypto.DecryptSecret(encToken.String, h.EncryptionKey)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read Cloudflare credentials")
		return
	}
	zoneID, err := crypto.DecryptSecret(encZone.String, h.EncryptionKey)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read Cloudflare credentials")
		return
	}

	body, _ := json.Marshal(map[string]bool{"purge_everything": true})
	cfReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/purge_cache", zoneID), bytes.NewReader(body))
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not build Cloudflare request")
		return
	}
	cfReq.Header.Set("Authorization", "Bearer "+token)
	cfReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(cfReq)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadGateway, "cloudflare_unreachable", "Could not reach Cloudflare: "+err.Error())
		return
	}
	defer resp.Body.Close()

	var cfResp struct {
		Success bool `json:"success"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&cfResp)

	if !cfResp.Success {
		msg := "Cloudflare rejected the request"
		if len(cfResp.Errors) > 0 {
			msg = cfResp.Errors[0].Message
		}
		audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "cache.purge", http.StatusBadGateway, "settings", 1, nil,
			map[string]string{"result": "failed", "message": msg}, r.RemoteAddr, r.UserAgent())
		httpresp.JSONError(w, http.StatusBadGateway, "cloudflare_error", msg)
		return
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "cache.purge", http.StatusOK, "settings", 1, nil,
		map[string]string{"result": "success"}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "cache_cleared"})
}
