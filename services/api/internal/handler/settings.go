package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
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

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	var siteTitle, siteURL, logoPath, faviconPath sql.NullString
	var region, language string
	var discourageIndexing bool
	var cfTokenEnc, cfZoneEnc sql.NullString

	err := h.DB.QueryRowContext(r.Context(),
		`SELECT site_title, site_url, region, language, discourage_indexing, logo_path, favicon_path, cf_api_token_encrypted, cf_zone_id_encrypted
		 FROM settings WHERE id = 1`,
	).Scan(&siteTitle, &siteURL, &region, &language, &discourageIndexing, &logoPath, &faviconPath, &cfTokenEnc, &cfZoneEnc)
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
		"logo_path":             logoPath.String,
		"favicon_path":          faviconPath.String,
		"cloudflare_configured": cfTokenEnc.Valid && cfTokenEnc.String != "" && cfZoneEnc.Valid && cfZoneEnc.String != "",
	})
}

// Public exposes only branding fields (no auth) — the Login page and the sidebar need
// site_title/logo/favicon before (or regardless of) any session existing, but nothing
// else on /v1/settings is safe to leak pre-auth.
func (h *SettingsHandler) Public(w http.ResponseWriter, r *http.Request) {
	var siteTitle, logoPath, faviconPath sql.NullString
	var discourageIndexing bool
	if err := h.DB.QueryRowContext(r.Context(), `SELECT site_title, logo_path, favicon_path, discourage_indexing FROM settings WHERE id = 1`).
		Scan(&siteTitle, &logoPath, &faviconPath, &discourageIndexing); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load settings")
		return
	}
	httpresp.JSON(w, http.StatusOK, map[string]any{
		"site_title":          siteTitle.String,
		"logo_path":           logoPath.String,
		"favicon_path":        faviconPath.String,
		"discourage_indexing": discourageIndexing,
	})
}

type updateGeneralRequest struct {
	SiteTitle string `json:"site_title"`
	SiteURL   string `json:"site_url"`
	Region    string `json:"region"`
	Language  string `json:"language"`
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

	req.SiteURL = strings.TrimSpace(req.SiteURL)
	if req.SiteURL == "" {
		if origin := r.Header.Get("Origin"); origin != "" {
			req.SiteURL = origin
		}
	}

	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE settings SET site_title = ?, site_url = ?, region = ?, language = ? WHERE id = 1`,
		req.SiteTitle, req.SiteURL, req.Region, req.Language,
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
