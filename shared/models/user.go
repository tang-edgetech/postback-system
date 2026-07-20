package models

type Role string

const (
	RoleSuperAdmin Role = "super_admin"
	RoleAdmin      Role = "admin"
	RoleMarketer   Role = "marketer"
)

type UserStatus string

const (
	UserActive   UserStatus = "active"
	UserInactive UserStatus = "inactive"
)

type Theme string

const (
	ThemeLight Theme = "light"
	ThemeDark  Theme = "dark"
)

type User struct {
	ID           int64
	FullName     string
	Email        string
	PasswordHash string
	Role         Role
	Status       UserStatus
	Theme        Theme
}
