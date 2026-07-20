-- Campaigns now belong to exactly one Merchant (Tenant); Links derive their Merchant
-- from their Campaign instead of carrying an independent, potentially-drifting field.
ALTER TABLE campaigns
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL AFTER name;

UPDATE campaigns c
  JOIN (SELECT campaign_id, MIN(tenant_id) AS tenant_id FROM links GROUP BY campaign_id) x
  ON c.id = x.campaign_id
SET c.tenant_id = x.tenant_id
WHERE c.tenant_id IS NULL;

UPDATE campaigns
SET tenant_id = (SELECT id FROM tenants ORDER BY id LIMIT 1)
WHERE tenant_id IS NULL;

ALTER TABLE campaigns
  MODIFY COLUMN tenant_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_campaigns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  ADD INDEX idx_campaigns_tenant (tenant_id);

ALTER TABLE links
  DROP FOREIGN KEY fk_links_tenant,
  DROP INDEX idx_links_tenant,
  DROP COLUMN tenant_id;

-- Trusted-device 2FA: TOTP secret (two_factor_secrets, already exists) verifies the
-- code once per browser; the browser is then remembered here until removed. Capped
-- at 2 rows per user, enforced in application code (delete one to add a new one).
CREATE TABLE trusted_devices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    device_label VARCHAR(191) NOT NULL,
    device_token VARCHAR(64) NOT NULL UNIQUE,
    ip_display VARCHAR(45) NULL,
    geo_country VARCHAR(2) NULL,
    geo_region VARCHAR(64) NULL,
    user_agent TEXT NULL,
    last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_trusted_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_trusted_devices_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Login session tracking gains geo so Super Admin can see where Admin/Marketer
-- logins came from, not just the raw IP.
ALTER TABLE user_sessions
  ADD COLUMN geo_country VARCHAR(2) NULL AFTER ip,
  ADD COLUMN geo_region VARCHAR(64) NULL AFTER geo_country;

-- Internal-only tool: replace the unused meta_title/description/keywords SEO fields
-- with a single "keep search engines out" switch (drives noindex/nofollow + robots.txt).
ALTER TABLE settings
  DROP COLUMN meta_title,
  DROP COLUMN meta_description,
  DROP COLUMN meta_keywords,
  ADD COLUMN discourage_indexing TINYINT(1) NOT NULL DEFAULT 1 AFTER language;

-- Role Permission Editor (Settings > Permissions). Super Admin is always fully
-- allowed and is not represented here — only Admin/Marketer overrides are stored.
CREATE TABLE role_permissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_id BIGINT UNSIGNED NOT NULL,
    permission_key VARCHAR(64) NOT NULL,
    allowed TINYINT(1) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE KEY uq_role_permission (role_id, permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO role_permissions (role_id, permission_key, allowed) VALUES
  (2, 'users.manage', 1),
  (2, 'merchants.create', 1), (2, 'merchants.edit', 1), (2, 'merchants.status', 1), (2, 'merchants.delete', 1),
  (2, 'campaigns.create', 1), (2, 'campaigns.edit', 1), (2, 'campaigns.status', 1), (2, 'campaigns.delete', 1),
  (2, 'links.create', 1), (2, 'links.edit', 1), (2, 'links.status', 1), (2, 'links.delete', 1),
  (2, 'audit_logs.view', 1),
  (3, 'users.manage', 0),
  (3, 'merchants.create', 1), (3, 'merchants.edit', 1), (3, 'merchants.status', 0), (3, 'merchants.delete', 0),
  (3, 'campaigns.create', 1), (3, 'campaigns.edit', 1), (3, 'campaigns.status', 0), (3, 'campaigns.delete', 0),
  (3, 'links.create', 1), (3, 'links.edit', 1), (3, 'links.status', 1), (3, 'links.delete', 1),
  (3, 'audit_logs.view', 0);
