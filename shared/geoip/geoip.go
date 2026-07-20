package geoip

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"postback-system/shared/clientip"
)

type Result struct {
	CountryCode string
	City        string
}

// Lookup is a best-effort call to the free ip-api.com endpoint — no API key, no cost,
// good enough for "which country/city did this login/click come from" without paying
// for a commercial geo-IP database. Private/loopback IPs (dev/localhost) are skipped
// since ip-api.com can't resolve them; callers see a zero Result, not an error.
func Lookup(ip string) (Result, error) {
	if clientip.IsPrivate(ip) {
		return Result{}, nil
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://ip-api.com/json/%s?fields=status,countryCode,city", ip))
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()

	var body struct {
		Status      string `json:"status"`
		CountryCode string `json:"countryCode"`
		City        string `json:"city"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Result{}, err
	}
	if body.Status != "success" {
		return Result{}, nil
	}
	return Result{CountryCode: body.CountryCode, City: body.City}, nil
}
