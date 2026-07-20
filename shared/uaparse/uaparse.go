// Package uaparse does lightweight, self-built User-Agent parsing (device/OS/browser).
// It's heuristic, not exhaustive — good enough for dashboard display, not a substitute
// for a full UA database.
package uaparse

import "strings"

type Info struct {
	Device  string
	OS      string
	Browser string
}

func Parse(ua string) Info {
	lower := strings.ToLower(ua)

	device := "Desktop"
	switch {
	case strings.Contains(lower, "ipad") || strings.Contains(lower, "tablet"):
		device = "Tablet"
	case strings.Contains(lower, "mobile") || strings.Contains(lower, "iphone") || strings.Contains(lower, "android"):
		device = "Mobile"
	case strings.Contains(lower, "bot") || strings.Contains(lower, "spider") || strings.Contains(lower, "crawler"):
		device = "Bot"
	}

	os := "Unknown"
	switch {
	case strings.Contains(lower, "windows"):
		os = "Windows"
	case strings.Contains(lower, "mac os") || strings.Contains(lower, "macintosh"):
		os = "macOS"
	case strings.Contains(lower, "android"):
		os = "Android"
	case strings.Contains(lower, "iphone") || strings.Contains(lower, "ipad") || strings.Contains(lower, "ios"):
		os = "iOS"
	case strings.Contains(lower, "linux"):
		os = "Linux"
	}

	browser := "Unknown"
	switch {
	case strings.Contains(lower, "edg/"):
		browser = "Edge"
	case strings.Contains(lower, "opr/") || strings.Contains(lower, "opera"):
		browser = "Opera"
	case strings.Contains(lower, "chrome/") && !strings.Contains(lower, "chromium"):
		browser = "Chrome"
	case strings.Contains(lower, "firefox/"):
		browser = "Firefox"
	case strings.Contains(lower, "safari/") && !strings.Contains(lower, "chrome"):
		browser = "Safari"
	case strings.Contains(lower, "curl") || strings.Contains(lower, "wget") || strings.Contains(lower, "postman"):
		browser = "HTTP Client"
	}

	return Info{Device: device, OS: os, Browser: browser}
}
