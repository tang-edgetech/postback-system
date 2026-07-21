UPDATE role_permissions SET allowed = 1 WHERE role_id = 3 AND permission_key IN ('links.status', 'links.delete');
