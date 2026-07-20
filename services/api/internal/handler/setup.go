package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"postback-system/shared/audit"
	"postback-system/shared/crypto"
	"postback-system/shared/httpresp"
	"postback-system/shared/models"
	"postback-system/shared/permissions"
	"postback-system/shared/session"
)

// SetupHandler drives the first-run wizard. "Needs setup" is gated purely on whether
// any user row exists — that's the actual blocker (nobody can log in), not a separate
// settings flag that could drift out of sync with reality.
type SetupHandler struct {
	DB           *sql.DB
	Sessions     *session.Store
	CookieDomain string
	CookieSecure bool
}

func (h *SetupHandler) needsSetup(r *http.Request) (bool, error) {
	var count int
	if err := h.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	needsSetup, err := h.needsSetup(r)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not check setup status")
		return
	}
	httpresp.JSON(w, http.StatusOK, map[string]any{"needs_setup": needsSetup, "available_regions": availableRegions})
}

type completeSetupRequest struct {
	SiteTitle string `json:"site_title"`
	SiteURL   string `json:"site_url"`
	Region    string `json:"region"`
	Language  string `json:"language"`
	FullName  string `json:"full_name"`
	Email     string `json:"email"`
	Password  string `json:"password"`
}

func (h *SetupHandler) Complete(w http.ResponseWriter, r *http.Request) {
	needsSetup, err := h.needsSetup(r)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not check setup status")
		return
	}
	if !needsSetup {
		httpresp.JSONError(w, http.StatusForbidden, "already_completed", "Setup has already been completed")
		return
	}

	var req completeSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.SiteTitle = strings.TrimSpace(req.SiteTitle)
	req.SiteURL = strings.TrimSpace(req.SiteURL)
	req.FullName = strings.TrimSpace(req.FullName)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.SiteURL == "" {
		req.SiteURL = r.Header.Get("Origin")
	}

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
	if req.FullName == "" || req.Email == "" || len(req.Password) < 8 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Full name, email and a password of at least 8 characters are required")
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not process password")
		return
	}

	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not start setup")
		return
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(r.Context(),
		`UPDATE settings SET site_title = ?, site_url = ?, region = ?, language = ?, setup_completed_at = NOW() WHERE id = 1`,
		req.SiteTitle, req.SiteURL, req.Region, req.Language,
	); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not save settings")
		return
	}

	res, err := tx.ExecContext(r.Context(),
		`INSERT INTO users (full_name, email, password_hash, role_id, status, theme) VALUES (?, ?, ?, 1, 'active', 'light')`,
		req.FullName, req.Email, hash,
	)
	if err != nil {
		if strings.Contains(err.Error(), "Duplicate entry") {
			httpresp.JSONError(w, http.StatusConflict, "email_taken", "A user with this email already exists")
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create the Super Admin account")
		return
	}
	userID, _ := res.LastInsertId()

	if err := tx.Commit(); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not complete setup")
		return
	}

	audit.Log(r.Context(), h.DB, userID, req.Email, req.FullName, "setup.completed", http.StatusOK, "user", userID, nil,
		map[string]string{"email": req.Email}, r.RemoteAddr, r.UserAgent())

	sessionID, err := h.Sessions.Create(r.Context(), session.Data{
		UserID:   userID,
		Role:     models.RoleSuperAdmin,
		Email:    req.Email,
		FullName: req.FullName,
		Theme:    models.ThemeLight,
	})
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Account created, but could not start a session — please log in")
		return
	}
	session.SetCookie(w, sessionID, h.CookieDomain, h.CookieSecure)

	payload := userPayload(userID, req.FullName, req.Email, models.RoleSuperAdmin, models.ThemeLight)
	payload["permissions"] = permissions.ForRole(r.Context(), h.DB, models.RoleSuperAdmin)
	httpresp.JSON(w, http.StatusOK, payload)
}
