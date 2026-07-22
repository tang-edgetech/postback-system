// The worker service runs the once-daily Links > Forwarding sweep — deliberately its
// own binary (not folded into api or redirect) so a slow/misbehaving destination
// endpoint can never affect the redirect hot path or the dashboard API.
package main

import (
	"context"
	"log"
	"time"

	"postback-system/shared/config"
	"postback-system/shared/db"
	"postback-system/shared/forwarding"
)

func nextMidnight(from time.Time) time.Time {
	return time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, from.Location()).AddDate(0, 0, 1)
}

func main() {
	dsn := config.GetEnv("DB_DSN", "root:@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4")
	encryptionKey := config.GetEnv("SETTINGS_ENCRYPTION_KEY", "dev-only-insecure-key-change-in-prod")
	runOnStart := config.GetEnv("FORWARDING_RUN_ON_START", "false") == "true"

	sqlDB, err := db.Connect(dsn)
	if err != nil {
		log.Fatalf("mysql connect failed: %v", err)
	}
	defer sqlDB.Close()

	log.Println("worker service started — running the Links > Forwarding sweep once every 24h")

	if runOnStart {
		log.Println("FORWARDING_RUN_ON_START=true — running an immediate sweep before the first scheduled one")
		forwarding.RunDailySweep(context.Background(), sqlDB, encryptionKey)
	}

	for {
		next := nextMidnight(time.Now())
		log.Printf("next forwarding sweep scheduled for %s", next.Format(time.RFC3339))
		time.Sleep(time.Until(next))
		forwarding.RunDailySweep(context.Background(), sqlDB, encryptionKey)
	}
}
