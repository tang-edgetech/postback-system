package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/crypto"
	"postback-system/shared/httpresp"
)

type ProfileHandler struct {
	DB *sql.DB
}

func (h *ProfileHandler) Get(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	var u userRow
	err := h.DB.QueryRowContext(r.Context(),
		`SELECT u.id, u.full_name, u.email, r.name, u.status, u.theme
		 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`, actor.UserID,
	).Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &u.Status, &u.Theme)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load profile")
		return
	}
	httpresp.JSON(w, http.StatusOK, u)
}

type updateNameRequest struct {
	FullName string `json:"full_name"`
}

func (h *ProfileHandler) UpdateName(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req updateNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	if req.FullName == "" {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Full name is required")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE users SET full_name = ? WHERE id = ?`, req.FullName, actor.UserID); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update profile")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.update", http.StatusOK, "user", actor.UserID, nil, req, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"full_name": req.FullName})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
	RepeatPassword  string `json:"repeat_password"`
}

func (h *ProfileHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())

	var req changePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "Invalid request body")
		return
	}
	if len(req.NewPassword) < 8 {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", "New password must be at least 8 characters")
		return
	}
	if req.NewPassword != req.RepeatPassword {
		httpresp.JSONError(w, http.StatusBadRequest, "password_mismatch", "New password and repeat password do not match")
		return
	}

	var currentHash string
	if err := h.DB.QueryRowContext(r.Context(), `SELECT password_hash FROM users WHERE id = ?`, actor.UserID).Scan(&currentHash); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong")
		return
	}
	ok, err := crypto.VerifyPassword(req.CurrentPassword, currentHash)
	if err != nil || !ok {
		httpresp.JSONError(w, http.StatusUnauthorized, "invalid_current_password", "Current password is incorrect")
		return
	}

	newHash, err := crypto.HashPassword(req.NewPassword)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not process new password")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(), `UPDATE users SET password_hash = ? WHERE id = ?`, newHash, actor.UserID); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update password")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "user.password_change", http.StatusOK, "user", actor.UserID, nil, nil, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
