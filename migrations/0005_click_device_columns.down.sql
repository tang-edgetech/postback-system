ALTER TABLE link_clicks
  DROP INDEX idx_clicks_device,
  DROP INDEX idx_clicks_os,
  DROP INDEX idx_clicks_browser,
  DROP COLUMN device,
  DROP COLUMN os,
  DROP COLUMN browser;
