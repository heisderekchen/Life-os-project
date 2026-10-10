-- Private finance models from the Life OS Prisma schema.
CREATE TABLE IF NOT EXISTS lifeos_finance_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'checking',
    balance REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', color TEXT, icon TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lifeos_transaction_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT NOT NULL DEFAULT '#6b7280',
    type TEXT NOT NULL DEFAULT 'expense', is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lifeos_transactions (
    id TEXT PRIMARY KEY, amount REAL NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'expense',
    date TEXT NOT NULL, note TEXT, is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0,1)), recurrence TEXT,
    account_id TEXT NOT NULL REFERENCES lifeos_finance_accounts(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES lifeos_transaction_categories(id) ON DELETE SET NULL,
    transfer_to_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_transactions_date ON lifeos_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_lifeos_transactions_account ON lifeos_transactions(account_id,date DESC);
CREATE TABLE IF NOT EXISTS lifeos_budgets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'monthly',
    start_date TEXT NOT NULL, end_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lifeos_budget_items (
    id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES lifeos_budgets(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES lifeos_transaction_categories(id) ON DELETE CASCADE,
    amount REAL NOT NULL, spent REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_budget_items_budget ON lifeos_budget_items(budget_id,created_at);
