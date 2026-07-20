package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
)

func Log(ctx context.Context, db *sql.DB, actorUserID int64, actorEmail, actorFullName, action string, statusCode int, entityType string, entityID int64, before, after any, ip, userAgent string) {
	var beforeJSON, afterJSON any
	if before != nil {
		if b, err := json.Marshal(before); err == nil {
			beforeJSON = b
		}
	}
	if after != nil {
		if b, err := json.Marshal(after); err == nil {
			afterJSON = b
		}
	}

	_, err := db.ExecContext(ctx,
		`INSERT INTO audit_logs (actor_user_id, actor_email_snapshot, actor_full_name_snapshot, action, status_code, entity_type, entity_id, before_state, after_state, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		actorUserID, actorEmail, actorFullName, action, statusCode, entityType, entityID, beforeJSON, afterJSON, ip, userAgent,
	)
	if err != nil {
		log.Printf("audit log failed (action=%s): %v", action, err)
	}
}
