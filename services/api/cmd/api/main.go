package main

import (
	"log"
	"net/http"
	"time"

	"postback-system/services/api/internal/handler"
	"postback-system/services/api/internal/middleware"
	"postback-system/shared/config"
	"postback-system/shared/db"
	"postback-system/shared/httpresp"
	"postback-system/shared/models"
	"postback-system/shared/permissions"
	"postback-system/shared/redisclient"
	"postback-system/shared/session"
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
	httpresp.JSON(w, http.StatusOK, map[string]string{
		"service":   "api",
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func main() {
	port := config.GetEnv("API_PORT", "8082")
	dsn := config.GetEnv("DB_DSN", "root:@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4")
	redisAddr := config.GetEnv("REDIS_ADDR", "127.0.0.1:6379")
	cookieDomain := config.GetEnv("SESSION_COOKIE_DOMAIN", ".babawha.local")
	cookieSecure := config.GetEnv("SESSION_COOKIE_SECURE", "false") == "true"
	allowedOrigin := config.GetEnv("CORS_ALLOWED_ORIGIN", "http://backdash.babawha.local")
	encryptionKey := config.GetEnv("SETTINGS_ENCRYPTION_KEY", "dev-only-insecure-key-change-in-prod")

	sqlDB, err := db.Connect(dsn)
	if err != nil {
		log.Fatalf("mysql connect failed: %v", err)
	}
	defer sqlDB.Close()

	// First-run default so /v1/settings has a row to read/update before the real
	// Setup Wizard exists.
	if _, err := sqlDB.Exec(`INSERT IGNORE INTO settings (id, region, language) VALUES (1, 'GMT+8', 'EN')`); err != nil {
		log.Printf("warning: could not seed default settings row: %v", err)
	}

	rdb, err := redisclient.Connect(redisAddr)
	if err != nil {
		log.Fatalf("redis connect failed: %v", err)
	}
	defer rdb.Close()

	sessions := session.NewStore(rdb)

	auth := &handler.AuthHandler{DB: sqlDB, Sessions: sessions, CookieDomain: cookieDomain, CookieSecure: cookieSecure}
	users := &handler.UsersHandler{DB: sqlDB}
	tenants := &handler.SimpleEntityHandler{DB: sqlDB, Table: "tenants", EntityType: "tenant"}
	campaigns := &handler.CampaignsHandler{DB: sqlDB}
	profile := &handler.ProfileHandler{DB: sqlDB}
	settings := &handler.SettingsHandler{DB: sqlDB, EncryptionKey: encryptionKey}
	auditLogs := &handler.AuditLogsHandler{DB: sqlDB}
	links := &handler.LinksHandler{DB: sqlDB}
	postback := &handler.PostbackHandler{DB: sqlDB}
	permissionsHandler := &handler.PermissionsHandler{DB: sqlDB}
	twoFactor := &handler.TwoFactorHandler{DB: sqlDB, CookieDomain: cookieDomain, CookieSecure: cookieSecure}
	sessionsHandler := &handler.SessionsHandler{DB: sqlDB}
	media := &handler.MediaHandler{DB: sqlDB, UploadDir: config.GetEnv("UPLOAD_DIR", "./uploads")}
	setup := &handler.SetupHandler{DB: sqlDB, Sessions: sessions, CookieDomain: cookieDomain, CookieSecure: cookieSecure}

	requireAuth := middleware.RequireAuth(sessions)
	adminOrSuper := middleware.RequireRole(models.RoleSuperAdmin, models.RoleAdmin)
	superOnly := middleware.RequireRole(models.RoleSuperAdmin)

	authOnly := func(h http.HandlerFunc) http.Handler {
		return middleware.Chain(h, requireAuth)
	}
	adminOnly := func(h http.HandlerFunc) http.Handler {
		return middleware.Chain(h, requireAuth, adminOrSuper)
	}
	superAdminOnly := func(h http.HandlerFunc) http.Handler {
		return middleware.Chain(h, requireAuth, superOnly)
	}
	withPermission := func(h http.HandlerFunc, key string) http.Handler {
		return middleware.Chain(h, requireAuth, middleware.RequirePermission(sqlDB, key))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)

	mux.HandleFunc("GET /v1/setup/status", setup.Status)
	mux.HandleFunc("POST /v1/setup/complete", setup.Complete)

	mux.HandleFunc("POST /v1/auth/login", auth.Login)
	mux.HandleFunc("POST /v1/auth/verify-2fa", auth.Verify2FA)
	mux.HandleFunc("GET /v1/auth/me", auth.Me)
	mux.HandleFunc("POST /v1/auth/logout", auth.Logout)

	mux.Handle("GET /v1/users", adminOnly(users.List))
	mux.Handle("GET /v1/users/{id}", adminOnly(users.Get))
	mux.Handle("POST /v1/users", adminOnly(users.Create))
	mux.Handle("PATCH /v1/users/{id}", adminOnly(users.Update))
	mux.Handle("PATCH /v1/users/{id}/status", adminOnly(users.UpdateStatus))
	mux.Handle("DELETE /v1/users/{id}", adminOnly(users.Delete))
	mux.Handle("PATCH /v1/users/bulk/status", adminOnly(users.BulkStatus))
	mux.Handle("POST /v1/users/bulk/delete", adminOnly(users.BulkDelete))
	mux.Handle("GET /v1/users/{id}/sessions", superAdminOnly(sessionsHandler.ForUser))

	mux.Handle("GET /v1/tenants", authOnly(tenants.List))
	mux.Handle("POST /v1/tenants", withPermission(tenants.Create, permissions.MerchantsCreate))
	mux.Handle("PATCH /v1/tenants/{id}", withPermission(tenants.Update, permissions.MerchantsEdit))
	mux.Handle("PATCH /v1/tenants/{id}/status", withPermission(tenants.UpdateStatus, permissions.MerchantsStatus))
	mux.Handle("DELETE /v1/tenants/{id}", withPermission(tenants.Delete, permissions.MerchantsDelete))
	mux.Handle("PATCH /v1/tenants/bulk/status", withPermission(tenants.BulkStatus, permissions.MerchantsStatus))
	mux.Handle("POST /v1/tenants/bulk/delete", withPermission(tenants.BulkDelete, permissions.MerchantsDelete))

	mux.Handle("GET /v1/campaigns", authOnly(campaigns.List))
	mux.Handle("POST /v1/campaigns", withPermission(campaigns.Create, permissions.CampaignsCreate))
	mux.Handle("PATCH /v1/campaigns/{id}", withPermission(campaigns.Update, permissions.CampaignsEdit))
	mux.Handle("PATCH /v1/campaigns/{id}/status", withPermission(campaigns.UpdateStatus, permissions.CampaignsStatus))
	mux.Handle("DELETE /v1/campaigns/{id}", withPermission(campaigns.Delete, permissions.CampaignsDelete))
	mux.Handle("PATCH /v1/campaigns/bulk/status", withPermission(campaigns.BulkStatus, permissions.CampaignsStatus))
	mux.Handle("POST /v1/campaigns/bulk/delete", withPermission(campaigns.BulkDelete, permissions.CampaignsDelete))

	mux.Handle("GET /v1/links", authOnly(links.List))
	mux.Handle("GET /v1/links/{id}", authOnly(links.Get))
	mux.Handle("GET /v1/links/{id}/clicks", authOnly(links.Clicks))
	mux.Handle("POST /v1/links", withPermission(links.Create, permissions.LinksCreate))
	mux.Handle("PATCH /v1/links/{id}", withPermission(links.Update, permissions.LinksEdit))
	mux.Handle("PATCH /v1/links/{id}/status", withPermission(links.UpdateStatus, permissions.LinksStatus))
	mux.Handle("DELETE /v1/links/{id}", withPermission(links.Delete, permissions.LinksDelete))
	mux.Handle("PATCH /v1/links/bulk/status", withPermission(links.BulkStatus, permissions.LinksStatus))
	mux.Handle("POST /v1/links/bulk/delete", withPermission(links.BulkDelete, permissions.LinksDelete))

	mux.Handle("GET /v1/profile", authOnly(profile.Get))
	mux.Handle("PATCH /v1/profile", authOnly(profile.UpdateName))
	mux.Handle("POST /v1/profile/password", authOnly(profile.ChangePassword))

	mux.Handle("GET /v1/profile/2fa", authOnly(twoFactor.Status))
	mux.Handle("POST /v1/profile/2fa/enroll", authOnly(twoFactor.Enroll))
	mux.Handle("POST /v1/profile/2fa/verify", authOnly(twoFactor.VerifyEnrollment))
	mux.Handle("DELETE /v1/profile/2fa/devices/{id}", authOnly(twoFactor.RemoveDevice))

	mux.HandleFunc("GET /v1/settings/public", settings.Public)
	mux.Handle("GET /v1/settings", superAdminOnly(settings.Get))
	mux.Handle("PATCH /v1/settings/general", superAdminOnly(settings.UpdateGeneral))
	mux.Handle("POST /v1/settings/logo", superAdminOnly(media.UploadLogo))
	mux.Handle("POST /v1/settings/favicon", superAdminOnly(media.UploadFavicon))
	mux.Handle("PATCH /v1/settings/seo", superAdminOnly(settings.UpdateSEO))
	mux.Handle("PATCH /v1/settings/cloudflare", superAdminOnly(settings.UpdateCloudflare))
	mux.Handle("POST /v1/settings/cloudflare/clear-cache", superAdminOnly(settings.ClearCache))
	mux.Handle("GET /v1/settings/permissions", superAdminOnly(permissionsHandler.Get))
	mux.Handle("PATCH /v1/settings/permissions", superAdminOnly(permissionsHandler.Update))

	mux.Handle("GET /v1/audit-logs", authOnly(auditLogs.List))
	mux.Handle("GET /v1/audit-logs/export", authOnly(auditLogs.Export))

	mux.HandleFunc("GET /v1/postback", postback.Handle)
	mux.HandleFunc("POST /v1/postback", postback.Handle)
	// Unversioned alias — the postback URL handed to merchants/destination sites should
	// stay short and stable even if /v1/* ever becomes /v2/*.
	mux.HandleFunc("GET /postback", postback.Handle)
	mux.HandleFunc("POST /postback", postback.Handle)

	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(media.UploadDir))))

	mux.HandleFunc("/v1/", func(w http.ResponseWriter, r *http.Request) {
		httpresp.JSON(w, http.StatusOK, map[string]string{
			"service": "api",
			"message": "placeholder - not implemented yet",
			"path":    r.URL.Path,
		})
	})

	handlerWithCORS := middleware.CORS(allowedOrigin)(mux)

	log.Printf("api service listening on :%s", port)
	if err := http.ListenAndServe("127.0.0.1:"+port, handlerWithCORS); err != nil {
		log.Fatal(err)
	}
}
