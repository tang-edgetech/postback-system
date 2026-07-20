package clientip

import (
	"net"
	"net/http"
	"strings"
)

// From prefers X-Forwarded-For since Apache/nginx sits in front of every service as a
// reverse proxy — RemoteAddr alone would always report the proxy's own address.
func From(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.Split(fwd, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func IsPrivate(ip string) bool {
	return ip == "" || ip == "127.0.0.1" || ip == "::1" || strings.HasPrefix(ip, "192.168.") ||
		strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "172.16.") || strings.HasPrefix(ip, "172.17.")
}
