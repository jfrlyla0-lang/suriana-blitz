const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'test.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
    else console.log('تم الاتصال بقاعدة بيانات سوريانا بنجاح! 💾');
});

db.serialize(() => {
    // Core table first: all other tables depend on users.
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        age INTEGER,
        city TEXT,
        gender TEXT,
        role TEXT DEFAULT 'user',
        points INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0,
        verification_img TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_banned INTEGER DEFAULT 0,
        birth_date TEXT,
        public_id INTEGER,
        last_seen DATETIME,
        avatar TEXT,
        google_id TEXT,
        referral_code TEXT
    )`);

    // Safe migrations for older databases.
    const userColumns = [
        ['google_id', 'TEXT'],
        ['last_seen', 'DATETIME'],
        ['avatar', 'TEXT'],
        ['referral_code', 'TEXT'],
        ['birth_date', 'TEXT'],
        ['public_id', 'INTEGER'],
        ['is_banned', 'INTEGER DEFAULT 0'],
        ['verification_img', 'TEXT'],
        ['is_verified', 'INTEGER DEFAULT 0'],
        ['points', 'INTEGER DEFAULT 0'],
        ['role', "TEXT DEFAULT 'user'"],
        ['gender', 'TEXT'],
        ['city', 'TEXT'],
        ['age', 'INTEGER']
    ];

    db.all(`PRAGMA table_info(users)`, (err, rows) => {
        if (err) return console.error('users schema check error:', err.message);
        const existing = new Set(rows.map(r => r.name));
        for (const [name, type] of userColumns) {
            if (!existing.has(name)) {
                db.run(`ALTER TABLE users ADD COLUMN ${name} ${type}`, e => {
                    if (e) console.error(`users migration ${name}:`, e.message);
                });
            }
        }
    });

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
            ON users(google_id) WHERE google_id IS NOT NULL`);

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
            ON users(referral_code) WHERE referral_code IS NOT NULL`);

    db.run(`CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL,
        addressee_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(requester_id) REFERENCES users(id),
        FOREIGN KEY(addressee_id) REFERENCES users(id),
        UNIQUE(requester_id, addressee_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        points INTEGER,
        amount_syr INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        cost INTEGER DEFAULT 0,
        is_paid INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_delivered INTEGER DEFAULT 0,
        is_read INTEGER DEFAULT 0,
        delivered_at DATETIME,
        read_at DATETIME,
        message_type TEXT DEFAULT 'text',
        media_url TEXT,
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        points INTEGER DEFAULT 0,
        admin_share INTEGER DEFAULT 0,
        girl_share INTEGER DEFAULT 0,
        status TEXT DEFAULT 'started',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_seconds INTEGER DEFAULT 0,
        ended_at DATETIME,
        max_seconds INTEGER,
        started_at DATETIME,
        FOREIGN KEY(caller_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_profits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT,
        points INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS wallet_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        points INTEGER DEFAULT 0,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS charge_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        points INTEGER,
        amount_syr INTEGER,
        method TEXT,
        phone TEXT,
        receipt TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payment_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sham_cash TEXT,
        syriatel_cash TEXT,
        mtn_cash TEXT,
        point_price INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdraw_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        points INTEGER,
        method TEXT,
        wallet_num TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        maintenance INTEGER DEFAULT 0,
        register_open INTEGER DEFAULT 1,
        announcement TEXT DEFAULT '',
        message_cost INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT,
        message TEXT,
        type TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inviter_id INTEGER NOT NULL,
        invited_user_id INTEGER NOT NULL UNIQUE,
        referral_code TEXT NOT NULL,
        reward_points INTEGER NOT NULL DEFAULT 100,
        rewarded INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        rewarded_at DATETIME,
        FOREIGN KEY(inviter_id) REFERENCES users(id),
        FOREIGN KEY(invited_user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        jti TEXT NOT NULL UNIQUE,
        ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS hidden_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        other_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, other_user_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(other_user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS profile_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        liker_id INTEGER NOT NULL,
        liked_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(liker_id, liked_id),
        FOREIGN KEY(liker_id) REFERENCES users(id),
        FOREIGN KEY(liked_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL,
        target_user_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        details TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(reporter_id) REFERENCES users(id),
        FOREIGN KEY(target_user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blocker_id INTEGER NOT NULL,
        blocked_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(blocker_id, blocked_id),
        FOREIGN KEY(blocker_id) REFERENCES users(id),
        FOREIGN KEY(blocked_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS verification_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        image TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        video TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT,
        type TEXT,
        points INTEGER,
        amount TEXT,
        fullName TEXT,
        code_or_wallet TEXT,
        status TEXT DEFAULT 'قيد المراجعة ⏳'
    )`);
});

module.exports = db;
