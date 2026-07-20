package listquery

import (
	"net/http"
	"strconv"
	"strings"
)

var allowedPerPage = map[int]bool{25: true, 50: true, 100: true, 150: true, 200: true}

type Params struct {
	Page    int
	PerPage int
	SortCol string
	Dir     string
	Search  string
}

// Parse reads page/per_page/sort/dir/search from the request query string. allowedSort maps
// public sort keys (from the frontend) to the actual DB column/expression to order by, so
// arbitrary column names can never be injected into ORDER BY. defaultDir is used only when
// the caller doesn't specify ?dir= explicitly.
func Parse(r *http.Request, allowedSort map[string]string, defaultSortKey, defaultDir string) Params {
	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}

	perPage, _ := strconv.Atoi(q.Get("per_page"))
	if !allowedPerPage[perPage] {
		perPage = 25
	}

	sortKey := q.Get("sort")
	sortCol, ok := allowedSort[sortKey]
	if !ok {
		sortCol = allowedSort[defaultSortKey]
	}

	dir := strings.ToUpper(q.Get("dir"))
	if dir != "ASC" && dir != "DESC" {
		dir = strings.ToUpper(defaultDir)
		if dir != "ASC" && dir != "DESC" {
			dir = "ASC"
		}
	}

	return Params{
		Page:    page,
		PerPage: perPage,
		SortCol: sortCol,
		Dir:     dir,
		Search:  strings.TrimSpace(q.Get("search")),
	}
}

func (p Params) Offset() int {
	return (p.Page - 1) * p.PerPage
}

func TotalPages(total, perPage int) int {
	if perPage <= 0 {
		return 1
	}
	pages := total / perPage
	if total%perPage != 0 {
		pages++
	}
	if pages < 1 {
		pages = 1
	}
	return pages
}
