CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- insertion order, used for the split
  id TEXT NOT NULL UNIQUE,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX members_home_idx ON members(home_id, seq);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT bills_total_positive CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills(id),
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members(id),
  CONSTRAINT shares_amount_nonneg CHECK (amount_cents >= 0),
  CONSTRAINT shares_one_per_member UNIQUE (bill_id, member_id)
);