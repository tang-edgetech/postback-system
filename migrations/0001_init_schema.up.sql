-- Postback System — initial schema
-- All PKs: BIGINT UNSIGNED AUTO_INCREMENT starting at 1. InnoDB, utf8mb4.

CREATE TABLE roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(32) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (id, name) VALUES (1, 'super_admin'), (2, 'admin'), (3, 'marketer');

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(191) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    theme ENUM('light', 'dark') NOT NULL DEFAULT 'light',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
    CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_users_role (role_id),
    INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE two_factor_secrets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    secret_base32 VARCHAR(64) NOT NULL,
    enrolled_at DATETIME NULL,
    recovery_codes JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_2fa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    ip VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
    site_title VARCHAR(191) NULL,
    site_url VARCHAR(255) NULL,
    region VARCHAR(32) NOT NULL DEFAULT 'GMT+8',
    language VARCHAR(8) NOT NULL DEFAULT 'EN',
    logo_path VARCHAR(255) NULL,
    favicon_path VARCHAR(255) NULL,
    two_fa_enforced TINYINT(1) NOT NULL DEFAULT 0,
    cf_api_token_encrypted TEXT NULL,
    cf_zone_id_encrypted TEXT NULL,
    setup_completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_settings_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tenants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenants_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_tenants_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE campaigns (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campaigns_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_campaigns_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type ENUM('redirection', 'cloaking') NOT NULL DEFAULT 'redirection',
    slug VARCHAR(12) NOT NULL UNIQUE,
    tid VARCHAR(12) NOT NULL UNIQUE,
    destination_url TEXT NOT NULL,
    param_mode ENUM('cid_tid_only', 'pass_all') NOT NULL DEFAULT 'cid_tid_only',
    tenant_id BIGINT UNSIGNED NOT NULL,
    campaign_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NULL,
    remarks TEXT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_links_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    CONSTRAINT fk_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_links_tenant (tenant_id),
    INDEX idx_links_campaign (campaign_id),
    INDEX idx_links_expires (expires_at),
    INDEX idx_links_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE link_clicks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cid VARCHAR(12) NOT NULL UNIQUE,
    link_id BIGINT UNSIGNED NOT NULL,
    captured_query JSON NULL,
    ip VARBINARY(16) NULL,
    ip_display VARCHAR(45) NULL,
    user_agent TEXT NULL,
    geo_country VARCHAR(2) NULL,
    geo_region VARCHAR(64) NULL,
    fraud_flags JSON NULL,
    fraud_score SMALLINT NOT NULL DEFAULT 0,
    is_fraud TINYINT(1) NOT NULL DEFAULT 0,
    clicked_at DATETIME NOT NULL,
    valid_until DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_clicks_link FOREIGN KEY (link_id) REFERENCES links(id),
    INDEX idx_clicks_link_time (link_id, clicked_at),
    INDEX idx_clicks_ip (ip_display),
    INDEX idx_clicks_valid_until (valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE postback_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    link_click_id BIGINT UNSIGNED NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    extra_fields JSON NULL,
    source_ip VARCHAR(45) NULL,
    received_via ENUM('get', 'post') NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_postback_click FOREIGN KEY (link_click_id) REFERENCES link_clicks(id),
    INDEX idx_postback_click (link_click_id),
    INDEX idx_postback_event_name (event_name),
    INDEX idx_postback_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT UNSIGNED NULL,
    actor_email_snapshot VARCHAR(191) NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NULL,
    entity_id BIGINT UNSIGNED NULL,
    before_state JSON NULL,
    after_state JSON NULL,
    ip VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_actor (actor_user_id),
    INDEX idx_audit_entity (entity_type, entity_id),
    INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fraud_bot_user_agents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pattern VARCHAR(255) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fraud_datacenter_ip_ranges (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cidr VARCHAR(64) NOT NULL,
    provider_label VARCHAR(128) NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
