CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'privateKey')),
  host_key_algorithm TEXT NOT NULL,
  host_key_fingerprint TEXT NOT NULL,
  host_key_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (host, port, username)
);

CREATE TABLE server_credentials (
  server_id TEXT PRIMARY KEY,
  encrypted_payload BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  source_ip TEXT,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);
CREATE INDEX audit_logs_target_idx ON audit_logs(target_type, target_id);
