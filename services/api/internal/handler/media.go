package handler

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/audit"
	"postback-system/shared/httpresp"
	"postback-system/shared/idgen"
)

// MediaHandler handles the Logo/Favicon uploaders on Settings > General. This is a
// direct upload-and-replace, not a browsable media library — each field owns exactly
// one file, and a new upload simply replaces the previous path.
type MediaHandler struct {
	DB        *sql.DB
	UploadDir string
}

const maxUploadSize = 5 << 20 // 5MB

var allowedImageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".svg": true, ".ico": true, ".webp": true}

func (h *MediaHandler) saveUpload(r *http.Request, field string) (string, error) {
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		return "", fmt.Errorf("file is too large or the request is malformed")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return "", fmt.Errorf("no file was uploaded")
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedImageExt[ext] {
		return "", fmt.Errorf("unsupported file type — use PNG, JPG, SVG, ICO or WebP")
	}

	if err := os.MkdirAll(h.UploadDir, 0o755); err != nil {
		return "", fmt.Errorf("could not prepare upload directory")
	}
	name, err := idgen.New(16)
	if err != nil {
		return "", fmt.Errorf("could not generate filename")
	}
	filename := field + "-" + name + ext
	dest, err := os.Create(filepath.Join(h.UploadDir, filename))
	if err != nil {
		return "", fmt.Errorf("could not save file")
	}
	defer dest.Close()

	if _, err := io.Copy(dest, file); err != nil {
		return "", fmt.Errorf("could not save file")
	}
	return "/uploads/" + filename, nil
}

func (h *MediaHandler) UploadLogo(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	path, err := h.saveUpload(r, "logo")
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if _, err := h.DB.ExecContext(r.Context(), `UPDATE settings SET logo_path = ? WHERE id = 1`, path); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update logo")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_general", http.StatusOK, "settings", 1, nil,
		map[string]string{"logo_path": path}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"logo_path": path})
}

func (h *MediaHandler) UploadFavicon(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	path, err := h.saveUpload(r, "favicon")
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if _, err := h.DB.ExecContext(r.Context(), `UPDATE settings SET favicon_path = ? WHERE id = 1`, path); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not update favicon")
		return
	}
	audit.Log(r.Context(), h.DB, actor.UserID, actor.Email, actor.FullName, "settings.update_general", http.StatusOK, "settings", 1, nil,
		map[string]string{"favicon_path": path}, r.RemoteAddr, r.UserAgent())
	httpresp.JSON(w, http.StatusOK, map[string]string{"favicon_path": path})
}
