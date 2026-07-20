DROP TABLE IF EXISTS role_permissions;

ALTER TABLE settings
  DROP COLUMN discourage_indexing,
  ADD COLUMN meta_title VARCHAR(191) NULL AFTER language,
  ADD COLUMN meta_description TEXT NULL AFTER meta_title,
  ADD COLUMN meta_keywords VARCHAR(255) NULL AFTER meta_description;

ALTER TABLE user_sessions
  DROP COLUMN geo_country,
  DROP COLUMN geo_region;

DROP TABLE IF EXISTS trusted_devices;

ALTER TABLE links
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL AFTER destination_url;

UPDATE links l JOIN campaigns c ON l.campaign_id = c.id SET l.tenant_id = c.tenant_id;

ALTER TABLE links
  MODIFY COLUMN tenant_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  ADD INDEX idx_links_tenant (tenant_id);

ALTER TABLE campaigns
  DROP FOREIGN KEY fk_campaigns_tenant,
  DROP INDEX idx_campaigns_tenant,
  DROP COLUMN tenant_id;
