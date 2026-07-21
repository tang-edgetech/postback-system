-- Per-user permission overrides (on top of role_permissions), per-user data-access
-- grants (Reports scoping), and the advanced-auth-type toggles for Links > Forwarding.

CREATE TABLE user_permission_overrides (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    permission_key VARCHAR(64) NOT NULL,
    allowed TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_perm_overrides_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_permission (user_id, permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_entity_grants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    entity_type ENUM('tenant', 'campaign') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_entity_grants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_entity (user_id, entity_type, entity_id),
    INDEX idx_entity_grants_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE advanced_auth_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    auth_type ENUM('hmac', 'oauth2_client_credentials') NOT NULL UNIQUE,
    enabled_globally TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO advanced_auth_settings (auth_type, enabled_globally) VALUES ('hmac', 0), ('oauth2_client_credentials', 0);

CREATE TABLE advanced_auth_link_scope (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    auth_type ENUM('hmac', 'oauth2_client_credentials') NOT NULL,
    link_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_auth_scope_link FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
    UNIQUE KEY uq_auth_type_link (auth_type, link_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
