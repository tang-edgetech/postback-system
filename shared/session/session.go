package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"postback-system/shared/models"
)

const (
	CookieName = "pb_session"
	TTL        = 2 * time.Hour
	keyPrefix  = "session:"

	DeviceCookieName = "pb_device"
	DeviceCookieTTL  = 365 * 24 * time.Hour

	pendingPrefix = "pending2fa:"
	PendingTTL    = 5 * time.Minute
)

var ErrNotFound = errors.New("session: not found")

type Data struct {
	UserID     int64        `json:"user_id"`
	Role       models.Role  `json:"role"`
	Email      string       `json:"email"`
	FullName   string       `json:"full_name"`
	Theme      models.Theme `json:"theme"`
	LastSeenAt time.Time    `json:"last_seen_at"`
}

type Store struct {
	rdb *redis.Client
}

func NewStore(rdb *redis.Client) *Store {
	return &Store{rdb: rdb}
}

func newSessionID() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *Store) Create(ctx context.Context, data Data) (string, error) {
	id, err := newSessionID()
	if err != nil {
		return "", err
	}
	data.LastSeenAt = time.Now().UTC()

	payload, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	if err := s.rdb.Set(ctx, keyPrefix+id, payload, TTL).Err(); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Store) Get(ctx context.Context, id string) (*Data, error) {
	payload, err := s.rdb.Get(ctx, keyPrefix+id).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var data Data
	if err := json.Unmarshal(payload, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// Touch refreshes the session's sliding 2-hour inactivity TTL.
func (s *Store) Touch(ctx context.Context, id string) error {
	ok, err := s.rdb.Expire(ctx, keyPrefix+id, TTL).Result()
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Delete(ctx context.Context, id string) error {
	return s.rdb.Del(ctx, keyPrefix+id).Err()
}

func SetCookie(w http.ResponseWriter, sessionID, domain string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    sessionID,
		Domain:   domain,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(TTL.Seconds()),
	})
}

func ClearCookie(w http.ResponseWriter, domain string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Domain:   domain,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func ReadCookie(r *http.Request) (string, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return "", err
	}
	return cookie.Value, nil
}

// Pending 2FA tokens bridge "password verified" and "TOTP code verified" — issued
// after a correct password when the account has 2FA enrolled and the browser isn't a
// trusted device yet, exchanged for a real session by AuthHandler.Verify2FA.
func (s *Store) CreatePending(ctx context.Context, userID int64) (string, error) {
	token, err := newSessionID()
	if err != nil {
		return "", err
	}
	if err := s.rdb.Set(ctx, pendingPrefix+token, userID, PendingTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Store) GetPending(ctx context.Context, token string) (int64, error) {
	userID, err := s.rdb.Get(ctx, pendingPrefix+token).Int64()
	if err != nil {
		if err == redis.Nil {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return userID, nil
}

func (s *Store) DeletePending(ctx context.Context, token string) error {
	return s.rdb.Del(ctx, pendingPrefix+token).Err()
}

func SetDeviceCookie(w http.ResponseWriter, token, domain string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     DeviceCookieName,
		Value:    token,
		Domain:   domain,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(DeviceCookieTTL.Seconds()),
	})
}

func ReadDeviceCookie(r *http.Request) string {
	cookie, err := r.Cookie(DeviceCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}
