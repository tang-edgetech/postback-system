ALTER TABLE settings
  ADD COLUMN meta_title VARCHAR(191) NULL AFTER language,
  ADD COLUMN meta_description TEXT NULL AFTER meta_title,
  ADD COLUMN meta_keywords VARCHAR(255) NULL AFTER meta_description;

ALTER TABLE audit_logs
  ADD COLUMN status_code SMALLINT NOT NULL DEFAULT 200 AFTER action;
