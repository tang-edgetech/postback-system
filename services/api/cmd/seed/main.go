// Temporary dev-only seeding utility. Creates a default Super Admin so the
// login flow can be exercised before the real Setup Wizard exists.
// Run once: go run ./services/api/cmd/seed
package main

import (
	"fmt"
	"log"

	"postback-system/shared/config"
	"postback-system/shared/crypto"
	"postback-system/shared/db"
)

const (
	devEmail    = "admin@babawha.local"
	devPassword = "Passw0rd!23"
	devFullName = "Super Admin"
)

func main() {
	dsn := config.GetEnv("DB_DSN", "root:@tcp(127.0.0.1:3306)/postback_system?parseTime=true&charset=utf8mb4")

	sqlDB, err := db.Connect(dsn)
	if err != nil {
		log.Fatalf("mysql connect failed: %v", err)
	}
	defer sqlDB.Close()

	var existingID int64
	err = sqlDB.QueryRow("SELECT id FROM users WHERE email = ?", devEmail).Scan(&existingID)
	if err == nil {
		fmt.Printf("dev Super Admin already exists (id=%d, email=%s) — nothing to do\n", existingID, devEmail)
		return
	}

	hash, err := crypto.HashPassword(devPassword)
	if err != nil {
		log.Fatalf("hash password failed: %v", err)
	}

	res, err := sqlDB.Exec(
		`INSERT INTO users (full_name, email, password_hash, role_id, status, theme) VALUES (?, ?, ?, 1, 'active', 'light')`,
		devFullName, devEmail, hash,
	)
	if err != nil {
		log.Fatalf("insert user failed: %v", err)
	}

	id, _ := res.LastInsertId()
	fmt.Printf("seeded dev Super Admin (id=%d)\n  email:    %s\n  password: %s\n", id, devEmail, devPassword)
}
