ALTER TABLE audit_logs
  ADD COLUMN actor_full_name_snapshot VARCHAR(191) NULL AFTER actor_email_snapshot;
