-- Reports feature: no new tables needed — scoping reuses user_entity_grants
-- (migration 0006) and campaigns/tenants.created_by. Admin gets it on by default;
-- Marketer is scoped to entities it created or has been explicitly granted.
INSERT INTO role_permissions (role_id, permission_key, allowed) VALUES
  (2, 'reports.view', 1),
  (3, 'reports.view', 0);
