-- Up
CREATE TABLE `mastodonapps` (
  domain TEXT PRIMARY KEY NOT NULL,
  id INTEGER,
  client_id TEXT,
  client_secret TEXT,
  vapid_key TEXT,
  working INTEGER,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Down
DROP TABLE IF EXISTS `mastodonapps`;
