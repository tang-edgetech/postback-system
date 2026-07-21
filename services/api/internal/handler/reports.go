package handler

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"postback-system/services/api/internal/middleware"
	"postback-system/shared/httpresp"
	"postback-system/shared/models"
	"postback-system/shared/session"
)

// ReportsHandler backs the Reports page — filter, view, export on demand (v1: no
// saved/scheduled reports). Marketer visibility is scoped to campaigns it created or
// has been explicitly granted (user_entity_grants, migration 0006); Admin/Super Admin
// see everything. This scoping is unique to Reports — the Links/Campaigns lists
// themselves show every entity to every authenticated user regardless of role.
type ReportsHandler struct {
	DB *sql.DB
}

var basicDateRangePresets = map[string]bool{"7d": true, "2w": true, "1m": true, "3m": true}
var advancedDateRangePresets = map[string]bool{"quarter": true, "semiannual": true, "annual": true}

// visibleCampaignIDs returns the campaign IDs a Marketer may see in Reports. Admin and
// Super Admin get allowAll=true and an empty (unused) id list.
func visibleCampaignIDs(ctx context.Context, db *sql.DB, actor *session.Data) ([]int64, bool, error) {
	if actor.Role != models.RoleMarketer {
		return nil, true, nil
	}
	rows, err := db.QueryContext(ctx, `
		SELECT c.id FROM campaigns c WHERE c.created_by = ?
		UNION
		SELECT c.id FROM campaigns c JOIN user_entity_grants g ON g.entity_type = 'campaign' AND g.entity_id = c.id WHERE g.user_id = ?
		UNION
		SELECT c.id FROM campaigns c JOIN user_entity_grants g ON g.entity_type = 'tenant' AND g.entity_id = c.tenant_id WHERE g.user_id = ?`,
		actor.UserID, actor.UserID, actor.UserID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, false, err
		}
		ids = append(ids, id)
	}
	return ids, false, nil
}

// regionOffsetHours parses the site's configured "GMT+8"-style region setting into a
// fixed hour offset — regions here are fixed offsets (no DST), so simple hour
// arithmetic is enough; no need for MySQL named-timezone support.
func regionOffsetHours(db *sql.DB, ctx context.Context) int {
	var region string
	if err := db.QueryRowContext(ctx, `SELECT region FROM settings WHERE id = 1`).Scan(&region); err != nil {
		return 8
	}
	offset, err := strconv.Atoi(strings.TrimPrefix(region, "GMT"))
	if err != nil {
		return 8
	}
	return offset
}

func resolvePresetRange(preset string, offsetHours int) (time.Time, time.Time, error) {
	nowLocal := time.Now().UTC().Add(time.Duration(offsetHours) * time.Hour)
	todayLocal := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, time.UTC)
	endLocal := todayLocal.Add(24*time.Hour - time.Nanosecond)

	var startLocal time.Time
	switch preset {
	case "7d":
		startLocal = todayLocal.AddDate(0, 0, -6)
	case "2w":
		startLocal = todayLocal.AddDate(0, 0, -13)
	case "1m":
		startLocal = todayLocal.AddDate(0, -1, 0)
	case "3m":
		startLocal = todayLocal.AddDate(0, -3, 0)
	case "quarter":
		q := (int(nowLocal.Month()) - 1) / 3
		startLocal = time.Date(nowLocal.Year(), time.Month(q*3+1), 1, 0, 0, 0, 0, time.UTC)
	case "semiannual":
		startLocal = todayLocal.AddDate(0, -6, 0)
	case "annual":
		startLocal = todayLocal.AddDate(0, -12, 0)
	default:
		return time.Time{}, time.Time{}, fmt.Errorf("unknown date range preset")
	}
	offset := time.Duration(offsetHours) * time.Hour
	return startLocal.Add(-offset), endLocal.Add(-offset), nil
}

func resolveDateRange(r *http.Request, role models.Role, offsetHours int) (time.Time, time.Time, error) {
	q := r.URL.Query()
	if from := q.Get("date_from"); from != "" {
		to := q.Get("date_to")
		if to == "" {
			to = from
		}
		fromT, err := time.Parse("2006-01-02", from)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid date_from")
		}
		toT, err := time.Parse("2006-01-02", to)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid date_to")
		}
		offset := time.Duration(offsetHours) * time.Hour
		fromUTC := fromT.Add(-offset)
		toUTC := toT.Add(24*time.Hour - time.Nanosecond).Add(-offset)
		return fromUTC, toUTC, nil
	}

	preset := q.Get("date_range")
	if preset == "" {
		preset = "7d"
	}
	if !basicDateRangePresets[preset] && !advancedDateRangePresets[preset] {
		return time.Time{}, time.Time{}, fmt.Errorf("unknown date range preset")
	}
	if advancedDateRangePresets[preset] && role == models.RoleMarketer {
		return time.Time{}, time.Time{}, fmt.Errorf("this date range is not available for your role")
	}
	return resolvePresetRange(preset, offsetHours)
}

type reportFilters struct {
	where      string
	args       []any
	eventWhere string
	eventArgs  []any
}

func inClauseInt64(column string, values []int64, args *[]any) string {
	strs := make([]string, len(values))
	for i, v := range values {
		strs[i] = strconv.FormatInt(v, 10)
	}
	return inClause(column, strs, args)
}

func buildReportFilters(r *http.Request, role models.Role, offsetHours int, visibleIDs []int64, allowAll bool) (reportFilters, error) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}

	if !allowAll {
		if len(visibleIDs) == 0 {
			where = append(where, "1=0")
		} else {
			where = append(where, inClauseInt64("l.campaign_id", visibleIDs, &args))
		}
	}

	if ids := splitCSV(q.Get("merchant_ids")); len(ids) > 0 {
		where = append(where, inClause("c.tenant_id", ids, &args))
	}
	if ids := splitCSV(q.Get("campaign_ids")); len(ids) > 0 {
		where = append(where, inClause("l.campaign_id", ids, &args))
	}
	if ids := splitCSV(q.Get("link_ids")); len(ids) > 0 {
		where = append(where, inClause("l.id", ids, &args))
	}
	if devices := splitCSV(q.Get("device")); len(devices) > 0 {
		where = append(where, inClause("COALESCE(lc.device, 'Unknown')", devices, &args))
	}
	if osList := splitCSV(q.Get("os")); len(osList) > 0 {
		where = append(where, inClause("COALESCE(lc.os, 'Unknown')", osList, &args))
	}
	if browsers := splitCSV(q.Get("browser")); len(browsers) > 0 {
		where = append(where, inClause("COALESCE(lc.browser, 'Unknown')", browsers, &args))
	}
	if statuses := splitCSV(q.Get("link_status")); len(statuses) > 0 {
		where = append(where, inClause("l.status", statuses, &args))
	}
	if countries := splitCSV(q.Get("geo_country")); len(countries) > 0 {
		where = append(where, inClause("lc.geo_country", countries, &args))
	}
	if regions := splitCSV(q.Get("geo_region")); len(regions) > 0 {
		where = append(where, inClause("lc.geo_region", regions, &args))
	}

	fromUTC, toUTC, err := resolveDateRange(r, role, offsetHours)
	if err != nil {
		return reportFilters{}, err
	}
	where = append(where, "lc.clicked_at >= ? AND lc.clicked_at <= ?")
	args = append(args, fromUTC, toUTC)

	var eventWhere string
	var eventArgs []any
	if events := splitCSV(q.Get("event_name")); len(events) > 0 {
		eventWhere = inClause("pe.event_name", events, &eventArgs)
	}

	return reportFilters{strings.Join(where, " AND "), args, eventWhere, eventArgs}, nil
}

const reportBaseJoins = `FROM link_clicks lc
	JOIN links l ON lc.link_id = l.id
	JOIN campaigns c ON l.campaign_id = c.id
	JOIN tenants t ON c.tenant_id = t.id`

func (h *ReportsHandler) postbackWhereArgs(f reportFilters) (string, []any) {
	where := f.where
	if f.eventWhere != "" {
		where += " AND " + f.eventWhere
	}
	args := append(append([]any{}, f.args...), f.eventArgs...)
	return where, args
}

type breakdownRow struct {
	Label string  `json:"label"`
	Count int     `json:"count"`
	Pct   float64 `json:"pct"`
}

func (h *ReportsHandler) breakdown(ctx context.Context, column string, f reportFilters) ([]breakdownRow, error) {
	query := fmt.Sprintf(`SELECT %s AS label, COUNT(DISTINCT lc.id) %s WHERE %s GROUP BY label ORDER BY COUNT(DISTINCT lc.id) DESC`, column, reportBaseJoins, f.where)
	rows, err := h.DB.QueryContext(ctx, query, f.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []breakdownRow
	total := 0
	for rows.Next() {
		var row breakdownRow
		if err := rows.Scan(&row.Label, &row.Count); err != nil {
			return nil, err
		}
		total += row.Count
		out = append(out, row)
	}
	if total > 0 {
		for i := range out {
			out[i].Pct = float64(out[i].Count) / float64(total) * 100
		}
	}
	return out, nil
}

type seriesPoint struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

func (h *ReportsHandler) series(ctx context.Context, dayExpr, joins, where string, args []any) ([]seriesPoint, error) {
	query := fmt.Sprintf(`SELECT %s AS day, COUNT(*) AS cnt %s WHERE %s GROUP BY day ORDER BY day`, dayExpr, joins, where)
	rows, err := h.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []seriesPoint{}
	for rows.Next() {
		var p seriesPoint
		if err := rows.Scan(&p.Day, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

type topLinkRow struct {
	LinkID       int64  `json:"link_id"`
	Slug         string `json:"slug"`
	CampaignName string `json:"campaign_name"`
	MerchantName string `json:"merchant_name"`
	Clicks       int    `json:"clicks"`
}

func (h *ReportsHandler) topLinks(ctx context.Context, f reportFilters, limit int) ([]topLinkRow, error) {
	query := fmt.Sprintf(`
		SELECT l.id, l.slug, c.name, t.name, COUNT(DISTINCT lc.id) AS clicks
		%s WHERE %s GROUP BY l.id, l.slug, c.name, t.name ORDER BY clicks DESC LIMIT ?`, reportBaseJoins, f.where)
	rows, err := h.DB.QueryContext(ctx, query, append(append([]any{}, f.args...), limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []topLinkRow{}
	for rows.Next() {
		var row topLinkRow
		if err := rows.Scan(&row.LinkID, &row.Slug, &row.CampaignName, &row.MerchantName, &row.Clicks); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (h *ReportsHandler) Get(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	ctx := r.Context()

	visibleIDs, allowAll, err := visibleCampaignIDs(ctx, h.DB, actor)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not resolve report visibility")
		return
	}

	offset := regionOffsetHours(h.DB, ctx)
	filters, err := buildReportFilters(r, actor.Role, offset, visibleIDs, allowAll)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	var totalClicks int
	if err := h.DB.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(DISTINCT lc.id) %s WHERE %s`, reportBaseJoins, filters.where), filters.args...).Scan(&totalClicks); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load report totals")
		return
	}

	postbackJoins := reportBaseJoins + ` JOIN postback_events pe ON pe.link_click_id = lc.id`
	postbackWhere, postbackArgs := h.postbackWhereArgs(filters)

	var totalPostbacks int
	if err := h.DB.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) %s WHERE %s`, postbackJoins, postbackWhere), postbackArgs...).Scan(&totalPostbacks); err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load report totals")
		return
	}

	conversionRows, err := h.DB.QueryContext(ctx, fmt.Sprintf(
		`SELECT pe.event_name, COUNT(*) %s WHERE %s GROUP BY pe.event_name ORDER BY COUNT(*) DESC`, postbackJoins, postbackWhere), postbackArgs...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load conversion breakdown")
		return
	}
	conversionByEvent := []map[string]any{}
	for conversionRows.Next() {
		var name string
		var count int
		if err := conversionRows.Scan(&name, &count); err != nil {
			conversionRows.Close()
			httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not read conversion breakdown")
			return
		}
		rate := 0.0
		if totalClicks > 0 {
			rate = float64(count) / float64(totalClicks) * 100
		}
		conversionByEvent = append(conversionByEvent, map[string]any{"event_name": name, "count": count, "conversion_rate_pct": rate})
	}
	conversionRows.Close()

	clickDayExpr := fmt.Sprintf("DATE(DATE_ADD(lc.clicked_at, INTERVAL %d HOUR))", offset)
	clickSeries, err := h.series(ctx, clickDayExpr, reportBaseJoins, filters.where, filters.args)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load click trend")
		return
	}
	postbackDayExpr := fmt.Sprintf("DATE(DATE_ADD(pe.received_at, INTERVAL %d HOUR))", offset)
	postbackSeries, err := h.series(ctx, postbackDayExpr, postbackJoins, postbackWhere, postbackArgs)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load postback trend")
		return
	}

	deviceBreakdown, err := h.breakdown(ctx, "COALESCE(lc.device, 'Unknown')", filters)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load device breakdown")
		return
	}
	osBreakdown, err := h.breakdown(ctx, "COALESCE(lc.os, 'Unknown')", filters)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load OS breakdown")
		return
	}
	browserBreakdown, err := h.breakdown(ctx, "COALESCE(lc.browser, 'Unknown')", filters)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load browser breakdown")
		return
	}

	topLinks, err := h.topLinks(ctx, filters, 10)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not load top links")
		return
	}

	httpresp.JSON(w, http.StatusOK, map[string]any{
		"total_clicks":        totalClicks,
		"total_postbacks":     totalPostbacks,
		"conversion_by_event": conversionByEvent,
		"click_series":        clickSeries,
		"postback_series":     postbackSeries,
		"device_breakdown":    deviceBreakdown,
		"os_breakdown":        osBreakdown,
		"browser_breakdown":   browserBreakdown,
		"top_links":           topLinks,
	})
}

func (h *ReportsHandler) Export(w http.ResponseWriter, r *http.Request) {
	actor := middleware.SessionFromContext(r.Context())
	ctx := r.Context()

	visibleIDs, allowAll, err := visibleCampaignIDs(ctx, h.DB, actor)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not resolve report visibility")
		return
	}
	offset := regionOffsetHours(h.DB, ctx)
	filters, err := buildReportFilters(r, actor.Role, offset, visibleIDs, allowAll)
	if err != nil {
		httpresp.JSONError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	query := fmt.Sprintf(`
		SELECT l.slug, c.name, t.name, lc.cid, COALESCE(lc.device, 'Unknown'), COALESCE(lc.os, 'Unknown'), COALESCE(lc.browser, 'Unknown'),
		       COALESCE(lc.geo_country, ''), COALESCE(lc.geo_region, ''), lc.clicked_at,
		       (SELECT COUNT(*) FROM postback_events pe WHERE pe.link_click_id = lc.id),
		       COALESCE((SELECT GROUP_CONCAT(DISTINCT pe.event_name) FROM postback_events pe WHERE pe.link_click_id = lc.id), '')
		%s WHERE %s ORDER BY lc.clicked_at DESC`, reportBaseJoins, filters.where)
	rows, err := h.DB.QueryContext(ctx, query, filters.args...)
	if err != nil {
		httpresp.JSONError(w, http.StatusInternalServerError, "server_error", "Could not export report")
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="report-%s.csv"`, time.Now().UTC().Format("20060102-150405")))

	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"Link Slug", "Campaign", "Merchant", "CID", "Device", "OS", "Browser", "Country", "Region", "Clicked At", "Postback Count", "Postback Events"})

	for rows.Next() {
		var slug, campaign, merchant, cid, device, os, browser, country, region, eventNames string
		var clickedAt time.Time
		var postbackCount int
		if err := rows.Scan(&slug, &campaign, &merchant, &cid, &device, &os, &browser, &country, &region, &clickedAt, &postbackCount, &eventNames); err != nil {
			continue
		}
		_ = writer.Write([]string{
			slug, campaign, merchant, cid, device, os, browser, country, region,
			clickedAt.Format(time.RFC3339), strconv.Itoa(postbackCount), eventNames,
		})
	}
	writer.Flush()
}
