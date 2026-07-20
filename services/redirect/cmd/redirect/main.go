package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"postback-system/shared/clientip"
	"postback-system/shared/config"
	"postback-system/shared/db"
	"postback-system/shared/geoip"
	"postback-system/shared/httpresp"
	"postback-system/shared/idgen"
	"postback-system/shared/uaparse"
)

var sqlDB *sql.DB

type linkRecord struct {
	ID             int64
	Tid            string
	DestinationURL string
	ParamMode      string
	Status         string
	ExpiresAt      sql.NullTime
}

func lookupLink(slug string) (*linkRecord, error) {
	var l linkRecord
	err := sqlDB.QueryRow(
		`SELECT id, tid, destination_url, param_mode, status, expires_at FROM links WHERE slug = ?`, slug,
	).Scan(&l.ID, &l.Tid, &l.DestinationURL, &l.ParamMode, &l.Status, &l.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// enrichGeo runs after the redirect response is already sent — a best-effort background
// lookup so the hot redirect path never waits on a third-party network call.
func enrichGeo(cid, ip string) {
	result, err := geoip.Lookup(ip)
	if err != nil || (result.CountryCode == "" && result.City == "") {
		return
	}
	_, _ = sqlDB.Exec(`UPDATE link_clicks SET geo_country = ?, geo_region = ? WHERE cid = ?`, result.CountryCode, result.City, cid)
}

func buildRedirectURL(destination, paramMode, cid, tid string, original url.Values) (string, error) {
	dest, err := url.Parse(destination)
	if err != nil {
		return "", err
	}
	q := dest.Query()
	if paramMode == "pass_all" {
		for key, values := range original {
			for _, v := range values {
				q.Add(key, v)
			}
		}
	}
	q.Set("cid", cid)
	q.Set("tid", tid)
	dest.RawQuery = q.Encode()
	return dest.String(), nil
}

func errorPage(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	fmt.Fprintf(w, `<!doctype html><html><head><title>%s</title></head>
<body style="font-family:sans-serif;text-align:center;padding:4rem;color:#334155;">
<h1>%s</h1></body></html>`, message, message)
}

func redirectHandler(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimPrefix(r.URL.Path, "/")
	if slug == "" {
		httpresp.JSON(w, http.StatusOK, map[string]string{"service": "redirect", "status": "ok"})
		return
	}

	link, err := lookupLink(slug)
	if err != nil {
		errorPage(w, http.StatusNotFound, "This link does not exist.")
		return
	}
	if link.Status != "active" {
		errorPage(w, http.StatusNotFound, "This link is no longer active.")
		return
	}
	if link.ExpiresAt.Valid && link.ExpiresAt.Time.Before(time.Now()) {
		errorPage(w, http.StatusNotFound, "This link has expired.")
		return
	}

	cid, err := idgen.New(12)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	ip := clientip.From(r)
	ua := r.UserAgent()
	uaInfo := uaparse.Parse(ua)
	queryJSON, _ := json.Marshal(r.URL.Query())
	now := time.Now().UTC()
	validUntil := now.Add(7 * 24 * time.Hour)

	_, err = sqlDB.Exec(
		`INSERT INTO link_clicks (cid, link_id, captured_query, ip_display, user_agent, device, os, browser, clicked_at, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		cid, link.ID, queryJSON, ip, ua, uaInfo.Device, uaInfo.OS, uaInfo.Browser, now, validUntil,
	)
	if err != nil {
		log.Printf("click insert failed: %v", err)
		// Still redirect the visitor even if logging failed — never block on tracking.
	} else {
		go enrichGeo(cid, ip)
	}

	target, err := buildRedirectURL(link.DestinationURL, link.ParamMode, cid, link.Tid, r.URL.Query())
	if err != nil {
		http.Error(w, "invalid destination", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	httpresp.JSON(w, http.StatusOK, map[string]string{"service": "redirect", "status": "ok"})
}

func main() {
	port := config.GetEnv("REDIRECT_PORT", "8081")
	dsn := config.GetEnv("DB_DSN", "root:@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4")

	conn, err := db.Connect(dsn)
	if err != nil {
		log.Fatalf("mysql connect failed: %v", err)
	}
	defer conn.Close()
	sqlDB = conn

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/", redirectHandler)

	log.Printf("redirect service listening on :%s", port)
	if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
		log.Fatal(err)
	}
}
