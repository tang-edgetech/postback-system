package middleware

import (
	"context"
	"database/sql"
	"net/http"

	"postback-system/shared/httpresp"
	"postback-system/shared/models"
	"postback-system/shared/permissions"
	"postback-system/shared/session"
)

type ctxKey string

const sessionCtxKey ctxKey = "session"

func RequireAuth(store *session.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sessionID, err := session.ReadCookie(r)
			if err != nil {
				httpresp.JSONError(w, http.StatusUnauthorized, "unauthenticated", "Not logged in")
				return
			}

			data, err := store.Get(r.Context(), sessionID)
			if err != nil {
				if err == session.ErrNotFound {
					httpresp.JSONError(w, http.StatusUnauthorized, "session_expired", "Session expired due to inactivity")
					return
				}
				httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong")
				return
			}
			_ = store.Touch(r.Context(), sessionID)

			ctx := context.WithValue(r.Context(), sessionCtxKey, data)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func SessionFromContext(ctx context.Context) *session.Data {
	data, _ := ctx.Value(sessionCtxKey).(*session.Data)
	return data
}

func RequireRole(roles ...models.Role) func(http.Handler) http.Handler {
	allowed := make(map[models.Role]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data := SessionFromContext(r.Context())
			if data == nil || !allowed[data.Role] {
				httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to perform this action")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePermission gates a route on the Settings > Permissions matrix rather than a
// fixed role list — Super Admin always passes, Admin/Marketer are checked against
// role_permissions so toggling the editor takes effect immediately, no redeploy.
func RequirePermission(db *sql.DB, key string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data := SessionFromContext(r.Context())
			if data == nil || !permissions.AllowedForUser(r.Context(), db, data.Role, data.UserID, key) {
				httpresp.JSONError(w, http.StatusForbidden, "forbidden", "You do not have permission to perform this action")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func Chain(h http.HandlerFunc, mws ...func(http.Handler) http.Handler) http.Handler {
	var handler http.Handler = h
	for i := len(mws) - 1; i >= 0; i-- {
		handler = mws[i](handler)
	}
	return handler
}
