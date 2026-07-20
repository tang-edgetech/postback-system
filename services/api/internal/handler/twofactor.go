package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/clientip"
	"postback-system/shared/geoip"
	"postback-system/shared/httpresp"
	"postback-system/shared/idgen"
	"postback-system/shared/session"
	"postback-system/shared/totp"
	"postback-system/shared/uaparse"
)

const maxTrustedDevices = 2

type TwoFactorHandler struct {
	DB           *sql.DB
	CookieDomain string
	CookieSecure bool
}

type trustedDeviceRow struct {
	ID         int64  `json:"id"`
	Label      string `json:"device_label"`
	IP         string `json:"ip"`
	Country    string `json:"country"`
	City       string `json:"city"`
	LastUsedAt string `json:"last_used_at"`
	CreatedAt  string `json:"created_at"`
}

func (h *TwoFactorHandler) Status(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var enrolledAt sql.NullTime
	err := h.DB.QueryRowContext(r.Context(), `SELECT enrolled_at FROM two_factor_secrets WHERE user_id = ?`, actor.UserID).Scan(&enrolledAt)
	enrolled := err == nil && enrolledAt.Valid

	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT id, device_label, COALESCE(ip_display,''), COALESCE(geo_country,''), COALESCE(geo_region,''), last_used_at, created_at
		 FROM trusted_devices WHERE user_id = ? ORDER BY created_at ASC`, actor.UserID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load 2FA status")
		return
	}
	defer rows.Close()

	devices := []trustedDeviceRow{}
	for rows.Next() {
		var d trustedDeviceRow
		var lastUsed, created sql.NullTime
		if err := rows.Scan(&d.ID, &d.Label, &d.IP, &d.Country, &d.City, &lastUsed, &created); err != nil {
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read 2FA devices")
			return
		}
		d.LastUsedAt = lastUsed.Time.Format("2006-01-02T15:04:05Z07:00")
		d.CreatedAt = created.Time.Format("2006-01-02T15:04:05Z07:00")
		devices = append(devices, d)
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"enabled":      enrolled,
		"devices":      devices,
		"max_devices":  maxTrustedDevices,
		"devices_used": len(devices),
	})
}

// Enroll generates (or regenerates, if enrollment was never confirmed) a TOTP secret
// and QR code. Nothing is "active" until VerifyEnrollment confirms the user actually
// scanned it and can produce a valid code.
func (h *TwoFactorHandler) Enroll(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	enrollment, err := totp.Generate("Postback System", actor.Email)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not generate 2FA secret")
		return
	}

	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO two_factor_secrets (user_id, secret_base32, enrolled_at) VALUES (?, ?, NULL)
		 ON DUPLICATE KEY UPDATE secret_base32 = ?, enrolled_at = NULL`,
		actor.UserID, enrollment.Secret, enrollment.Secret)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not save 2FA secret")
		return
	}

	httpresp.JSON(w, http.StatusOK, map[string]string{"secret": enrollment.Secret, "qr_code": enrollment.QRDataURI})
}

type verifyEnrollmentRequest struct {
	Code string `json:"code"`
}

// VerifyEnrollment confirms setup with one valid code, then immediately trusts the
// browser that just completed enrollment — the user is looking at the QR code on
// this device, so it's reasonable to count it as device #1 without asking again.
func (h *TwoFactorHandler) VerifyEnrollment(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req verifyEnrollmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}

	var secret string
	if err := h.DB.QueryRowContext(r.Context(), `SELECT secret_base32 FROM two_factor_secrets WHERE user_id = ?`, actor.UserID).Scan(&secret); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "not_enrolled", "Start enrollment first")
		return
	}
	if !totp.Validate(strings.TrimSpace(req.Code), secret) {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_code", "Incorrect verification code")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE two_factor_secrets SET enrolled_at = NOW() WHERE user_id = ?`, actor.UserID); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not confirm enrollment")
		return
	}

	var deviceCount int
	_ = h.DB.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM trusted_devices WHERE user_id = ?`, actor.UserID).Scan(&deviceCount)
	if deviceCount < maxTrustedDevices {
		if deviceToken, err := idgen.New(32); err == nil {
			ip := clientip.From(r)
			geoResult, _ := geoip.Lookup(ip)
			info := uaparse.Parse(r.UserAgent())
			label := info.Browser + " on " + info.OS
			_, _ = h.DB.ExecContext(r.Context(),
				`INSERT INTO trusted_devices (user_id, device_label, device_token, ip_display, geo_country, geo_region, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				actor.UserID, label, deviceToken, ip, geoResult.CountryCode, geoResult.City, r.UserAgent())
			session.SetDeviceCookie(w, deviceToken, h.CookieDomain, h.CookieSecure)
		}
	}

	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "2fa.enrolled", http.StatusOK, "user", actor.UserID, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "enrolled"})
}

// RemoveDevice lets a user free up a device slot (max 2) so a new browser can be
// trusted at its next login. Scoped to the caller's own devices only.
func (h *TwoFactorHandler) RemoveDevice(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid device id")
		return
	}

	res, err := h.DB.ExecContext(r.Context(), `DELETE FROM trusted_devices WHERE id = ? AND user_id = ?`, id, actor.UserID)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not remove device")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpresp.JSONError(w, http.StatusNotFound, "not_found", "Device not found")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "2fa.device_removed", http.StatusOK, "user", actor.UserID, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "removed"})
}
