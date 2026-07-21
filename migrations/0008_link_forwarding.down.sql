DELETE FROM role_permissions WHERE permission_key = 'links.forwarding';
DROP TABLE IF EXISTS link_forwarding_deliveries;
DROP TABLE IF EXISTS link_forwarding_configs;
