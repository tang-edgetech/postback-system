-- Configurable login route (Settings > General): Super Admin can rename the login page
-- away from the guessable default "/login" for basic obscurity. Enforcing that the
-- literal /login stops working once this is changed, and serving the login page at the
-- new path instead, is handled entirely in the dashboard app (a dynamic [slug] route),
-- not here — this migration only adds the stored value itself.
ALTER TABLE settings
  ADD COLUMN login_path VARCHAR(64) NOT NULL DEFAULT 'login' AFTER discourage_indexing;
