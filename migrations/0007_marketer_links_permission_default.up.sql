-- Reverses the original migration 0004 default: Marketer no longer gets links.status/
-- links.delete on by default, matching how Merchants/Campaigns already work for that role.
UPDATE role_permissions SET allowed = 0 WHERE role_id = 3 AND permission_key IN ('links.status', 'links.delete');
