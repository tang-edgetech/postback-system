package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"postback-system/shared/audit"
	"postback-system/shared/clientip"
	"postback-system/shared/crypto"
	"postback-system/shared/geoip"
	"postback-system/shared/httpresp"
	"postback-system/shared/idgen"
	"postback-system/shared/models"
	"postback-system/shared/permissions"
	"postback-system/shared/session"
	"postback-system/shared/totp"
	"postback-system/shared/uaparse"
)

type AuthHandler struct {
	DB           *sql.DB
	Sessions     *session.Store
	CookieDomain string
	CookieSecure bool
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func userPayload(id int64, fullName, email string, role models.Role, theme models.Theme) map[string]any {
	return map[string]any{
		"id":        id,
		"full_name": fullName,
		"email":     email,
		"role":      role,
		"theme":     theme,
	}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Email and password are required")
		return
	}

	var user models.User
	var roleName string
	row := h.DB.QueryRowContext(r.Context(),
		`SELECT u.id, u.full_name, u.email, u.password_hash, u.status, u.theme, r.name
		 FROM users u JOIN roles r ON u.role_id = r.id
		 WHERE u.email = ?`, req.Email)
	if err := row.Scan(&user.ID, &user.FullName, &user.Email, &user.PasswordHash, &user.Status, &user.Theme, &roleName); err != nil {
		if err == sql.ErrNoRows {
			audit.Log(r.Context(), h.DB, 0, req.Email, "", "auth.login_failed", http.StatusUnauthorized, "user", 0, nil,
				map[string]string{"reason": "no_such_account"}, r.RemoteAddr, r.UserAgent())
			httpresp.JSONError(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect email or password")
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong")
		return
	}
	user.Role = models.Role(roleName)

	if user.Status != models.UserActive {
		audit.Log(r.Context(), h.DB, user.ID, user.Email, user.FullName, "auth.login_failed", http.StatusUnauthorized, "user", user.ID, nil,
			map[string]string{"reason": "account_inactive"}, r.RemoteAddr, r.UserAgent())
		httpresp.JSONError(w, http.StatusUnauthorized, "account_inactive", "This account is inactive")
		return
	}

	ok, err := crypto.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !ok {
		audit.Log(r.Context(), h.DB, user.ID, user.Email, user.FullName, "auth.login_failed", http.StatusUnauthorized, "user", user.ID, nil,
			map[string]string{"reason": "wrong_password"}, r.RemoteAddr, r.UserAgent())
		httpresp.JSONError(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect email or password")
		return
	}

	var secret sql.NullString
	var enrolledAt sql.NullTime
	_ = h.DB.QueryRowContext(r.Context(), `SELECT secret_base32, enrolled_at FROM two_factor_secrets WHERE user_id = ?`, user.ID).
		Scan(&secret, &enrolledAt)

	if enrolledAt.Valid {
		deviceToken := session.ReadDeviceCookie(r)
		trusted := false
		if deviceToken != "" {
			var count int
			_ = h.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM trusted_devices WHERE user_id = ? AND device_token = ?`, user.ID, deviceToken).Scan(&count)
			trusted = count > 0
			if trusted {
				_, _ = h.DB.ExecContext(r.Context(), `UPDATE trusted_devices SET last_used_at = NOW() WHERE user_id = ? AND device_token = ?`, user.ID, deviceToken)
			}
		}
		if !trusted {
			pendingToken, err := h.Sessions.CreatePending(r.Context(), user.ID)
			if err != nil {
				httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not start verification")
				return
			}
			httpresp.JSON(w, http.StatusOK, map[string]any{"two_fa_required": true, "pending_token": pendingToken})
			return
		}
	}

	h.completeLogin(w, r, user)
}

// completeLogin issues the real session + login audit/tracking, shared by the plain
// password login (2FA not enrolled, or the browser is already trusted) and Verify2FA
// (2FA enrolled, code just checked).
func (h *AuthHandler) completeLogin(w http.ResponseWriter, r *http.Request, user models.User) {
	sessionID, err := h.Sessions.Create(r.Context(), session.Data{
		UserID:   user.ID,
		Role:     user.Role,
		Email:    user.Email,
		FullName: user.FullName,
		Theme:    user.Theme,
	})
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not create session")
		return
	}
	session.SetCookie(w, sessionID, h.CookieDomain, h.CookieSecure)

	ip := clientip.From(r)
	geoResult, _ := geoip.Lookup(ip)
	_, _ = h.DB.ExecContext(r.Context(),
		`INSERT INTO user_sessions (user_id, session_id, ip, geo_country, geo_region, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
		user.ID, sessionID, ip, geoResult.CountryCode, geoResult.City, r.UserAgent())

	audit.Log(r.Context(), h.DB, user.ID, user.Email, user.FullName, "auth.login", http.StatusOK, "user", user.ID, nil, nil, r.RemoteAddr, r.UserAgent())
	payload := userPayload(user.ID, user.FullName, user.Email, user.Role, user.Theme)
	payload["permissions"] = permissions.ForRole(r.Context(), h.DB, user.Role)
	httpresp.JSON(w, http.StatusOK, payload)
}

type verify2FARequest struct {
	PendingToken string `json:"pending_token"`
	Code         string `json:"code"`
}

// Verify2FA exchanges a pending_token (issued after a correct password on an account
// with 2FA enrolled) for a real session, once the TOTP code checks out. If the browser
// isn't already trusted and the account is under its 2-device cap, this browser is
// registered as trusted so future logins skip the code.
func (h *AuthHandler) Verify2FA(w http.ResponseWriter, r *http.Request) {
	var req verify2FARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	userID, err := h.Sessions.GetPending(r.Context(), req.PendingToken)
	if err != nil {
		httpresp.JSONError(w, http.StatusUnauthorized, "invalid_pending_token", "Verification expired, please log in again")
		return
	}

	var user models.User
	var roleName, secret string
	err = h.DB.QueryRowContext(r.Context(),
		`SELECT u.id, u.full_name, u.email, u.theme, r.name, t.secret_base32
		 FROM users u JOIN roles r ON u.role_id = r.id JOIN two_factor_secrets t ON t.user_id = u.id
		 WHERE u.id = ?`, userID,
	).Scan(&user.ID, &user.FullName, &user.Email, &user.Theme, &roleName, &secret)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong")
		return
	}
	user.Role = models.Role(roleName)

	if !totp.Validate(strings.TrimSpace(req.Code), secret) {
		audit.Log(r.Context(), h.DB, user.ID, user.Email, user.FullName, "auth.login_failed", http.StatusUnauthorized, "user", user.ID, nil,
			map[string]string{"reason": "invalid_2fa_code"}, r.RemoteAddr, r.UserAgent())
		httpresp.JSONError(w, http.StatusUnauthorized, "invalid_code", "Incorrect verification code")
		return
	}
	_ = h.Sessions.DeletePending(r.Context(), req.PendingToken)

	var deviceCount int
	_ = h.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM trusted_devices WHERE user_id = ?`, user.ID).Scan(&deviceCount)
	if deviceCount < 2 {
		if deviceToken, err := idgen.New(32); err == nil {
			ip := clientip.From(r)
			geoResult, _ := geoip.Lookup(ip)
			info := uaparse.Parse(r.UserAgent())
			label := info.Browser + " on " + info.OS
			_, _ = h.DB.ExecContext(r.Context(),
				`INSERT INTO trusted_devices (user_id, device_label, device_token, ip_display, geo_country, geo_region, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				user.ID, label, deviceToken, ip, geoResult.CountryCode, geoResult.City, r.UserAgent())
			session.SetDeviceCookie(w, deviceToken, h.CookieDomain, h.CookieSecure)
		}
	}

	h.completeLogin(w, r, user)
}

// Me reports session status. It always answers 200 — "is there a session?" is a routine
// check the frontend makes on every page load, not an error condition, so an absent/expired
// session is reported via {authenticated:false} rather than an HTTP error status. Only real
// failures (e.g. Redis down) return a non-200.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	sessionID, err := session.ReadCookie(r)
	if err != nil {
		httpresp.JSON(w, http.StatusOK, map[string]any{"authenticated": false, "reason": "unauthenticated"})
		return
	}

	data, err := h.Sessions.Get(r.Context(), sessionID)
	if err != nil {
		if err == session.ErrNotFound {
			httpresp.JSON(w, http.StatusOK, map[string]any{"authenticated": false, "reason": "session_expired"})
			return
		}
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong")
		return
	}
	_ = h.Sessions.Touch(r.Context(), sessionID)

	payload := userPayload(data.UserID, data.FullName, data.Email, data.Role, data.Theme)
	payload["authenticated"] = true
	payload["permissions"] = permissions.ForRole(r.Context(), h.DB, data.Role)
	httpresp.JSON(w, http.StatusOK, payload)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if sessionID, err := session.ReadCookie(r); err == nil {
		if data, getErr := h.Sessions.Get(r.Context(), sessionID); getErr == nil {
			audit.Log(r.Context(), h.DB, data.UserID, data.Email, data.FullName, "auth.logout", http.StatusOK, "user", data.UserID, nil, nil, r.RemoteAddr, r.UserAgent())
		}
		_ = h.Sessions.Delete(r.Context(), sessionID)
	}
	session.ClearCookie(w, h.CookieDomain, h.CookieSecure)
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}
