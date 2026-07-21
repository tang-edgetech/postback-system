-- Links > Single Link > Forwarding tab: one forwarding rule per link, sending unsent
-- clicks ("leads") and postbacks ("actions") to a third-party endpoint via on-demand
-- "Send Now" + a once-daily sweep run by the new services/worker binary.

CREATE TABLE link_forwarding_configs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    link_id BIGINT UNSIGNED NOT NULL UNIQUE,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    endpoint_url VARCHAR(2048) NOT NULL DEFAULT '',
    method ENUM('get', 'post') NOT NULL DEFAULT 'post',
    body_format ENUM('url_encoded', 'json') NOT NULL DEFAULT 'json',
    auth_type ENUM('none', 'bearer', 'basic', 'api_key_header', 'api_key_query') NOT NULL DEFAULT 'none',
    auth_username VARCHAR(191) NULL,
    auth_secret_encrypted TEXT NULL,
    auth_param_name VARCHAR(191) NULL,
    custom_headers JSON NULL,
    cap_per_run SMALLINT UNSIGNED NOT NULL DEFAULT 50,
    last_run_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_forwarding_config_link FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
    CONSTRAINT chk_forwarding_cap CHECK (cap_per_run IN (10, 25, 50, 100, 150, 200))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Drives what counts as "unsent" for the next run — a record (click or postback) with
-- no 'sent' row here is still in the backlog. Failed attempts are retried on the next
-- run rather than dropped.
CREATE TABLE link_forwarding_deliveries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    link_id BIGINT UNSIGNED NOT NULL,
    record_type ENUM('lead', 'action') NOT NULL,
    record_id BIGINT UNSIGNED NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    http_status SMALLINT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_forwarding_delivery_link FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
    UNIQUE KEY uq_forwarding_delivery (link_id, record_type, record_id),
    INDEX idx_forwarding_delivery_status (link_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin gets Forwarding on by default (same tier as everything else it manages);
-- Marketer defaults off. Never shown to Marketer in the UI regardless of this value,
-- but still editable here so a future policy change doesn't need a code change.
INSERT INTO role_permissions (role_id, permission_key, allowed) VALUES
  (2, 'links.forwarding', 1),
  (3, 'links.forwarding', 0);
