-- Device/OS/Browser are now parsed once at click-insert time (redirect service) and
-- stored as real columns, instead of being re-parsed from the raw User-Agent on every
-- read — this is what makes them filterable (Visits table filters by Device/OS/Browser).
ALTER TABLE link_clicks
  ADD COLUMN device VARCHAR(16) NULL AFTER user_agent,
  ADD COLUMN os VARCHAR(16) NULL AFTER device,
  ADD COLUMN browser VARCHAR(16) NULL AFTER os,
  ADD INDEX idx_clicks_device (device),
  ADD INDEX idx_clicks_os (os),
  ADD INDEX idx_clicks_browser (browser);
