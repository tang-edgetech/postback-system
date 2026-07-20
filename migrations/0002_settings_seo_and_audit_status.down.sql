ALTER TABLE audit_logs DROP COLUMN status_code;

ALTER TABLE settings
  DROP COLUMN meta_keywords,
  DROP COLUMN meta_description,
  DROP COLUMN meta_title;
