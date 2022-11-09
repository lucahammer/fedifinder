-- Up
CREATE TABLE `domains` (
  domain TEXT PRIMARY KEY NOT NULL,
  local_domain TEXT,
  part_of_fediverse INTEGER,
  software_name TEXT,
  software_version TEXT,
  users_total INTEGER,
  users_activeMonth INTEGER,
  users_activeHalfyear INTEGER,
  localPosts INTEGER,
  openRegistrations INTEGER,
  status TEXT,
  retries INTEGER
);

-- Down
DROP TABLE IF EXISTS `domain`;
