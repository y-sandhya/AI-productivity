import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "database" / "productivity.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            deadline TEXT,
            priority TEXT DEFAULT 'Medium',
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            start_time TEXT DEFAULT '09:00',
            end_time TEXT DEFAULT '10:00',
            category TEXT DEFAULT 'Personal',
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()


def get_all_tasks():
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, title, deadline, priority, status FROM tasks ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def add_task(task):
    conn = get_connection()
    cursor = conn.execute(
        """
        INSERT INTO tasks (title, deadline, priority, status)
        VALUES (?, ?, ?, ?)
        """,
        (
            task["title"],
            task.get("deadline", ""),
            task.get("priority", "Medium"),
            task.get("status", "Pending"),
        ),
    )
    conn.commit()
    task_id = cursor.lastrowid
    conn.close()
    return get_task_by_id(task_id)


def get_task_by_id(task_id):
    conn = get_connection()
    row = conn.execute(
        "SELECT id, title, deadline, priority, status FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_task(task_id, task):
    conn = get_connection()
    conn.execute(
        """
        UPDATE tasks
        SET title = ?, deadline = ?, priority = ?, status = ?
        WHERE id = ?
        """,
        (
            task.get("title", ""),
            task.get("deadline", ""),
            task.get("priority", "Medium"),
            task.get("status", "Pending"),
            task_id,
        ),
    )
    conn.commit()
    conn.close()
    return get_task_by_id(task_id)


def get_all_events():
    with get_connection() as conn:
        rows = conn.execute("SELECT id,title,date,start_time,end_time,category,description FROM events ORDER BY date,start_time,id").fetchall()
    return [dict(row) for row in rows]


def add_event(event):
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO events(title,date,start_time,end_time,category,description) VALUES(?,?,?,?,?,?)", (event["title"], event["date"], event.get("start_time", "09:00"), event.get("end_time", "10:00"), event.get("category", "Personal"), event.get("description", "")))
        event_id = cursor.lastrowid
    return next(item for item in get_all_events() if item["id"] == event_id)


def update_event(event_id, event):
    with get_connection() as conn:
        conn.execute("UPDATE events SET title=?,date=?,start_time=?,end_time=?,category=?,description=? WHERE id=?", (event.get("title", ""), event.get("date", ""), event.get("start_time", "09:00"), event.get("end_time", "10:00"), event.get("category", "Personal"), event.get("description", ""), event_id))
    return next((item for item in get_all_events() if item["id"] == event_id), None)


def delete_event(event_id):
    item = next((event for event in get_all_events() if event["id"] == event_id), None)
    if item:
        with get_connection() as conn:
            conn.execute("DELETE FROM events WHERE id=?", (event_id,))
    return item


def get_all_notes():
    with get_connection() as conn:
        rows = conn.execute("SELECT id,title,body,created_at,updated_at FROM notes ORDER BY updated_at DESC,id DESC").fetchall()
    return [dict(row) for row in rows]


def add_note(note):
    with get_connection() as conn:
        cursor = conn.execute("INSERT INTO notes(title,body) VALUES(?,?)", (note["title"], note.get("body", "")))
        note_id = cursor.lastrowid
    return next(item for item in get_all_notes() if item["id"] == note_id)


def update_note(note_id, note):
    with get_connection() as conn:
        conn.execute("UPDATE notes SET title=?,body=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (str(note.get("title", "Untitled note")).strip()[:240] or "Untitled note", str(note.get("body", ""))[:20000], note_id))
    return next((item for item in get_all_notes() if item["id"] == note_id), None)


def delete_note(note_id):
    item = next((note for note in get_all_notes() if note["id"] == note_id), None)
    if item:
        with get_connection() as conn:
            conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    return item


def delete_task(task_id):
    conn = get_connection()
    task = get_task_by_id(task_id)
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return task


def get_dashboard_stats():
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT
            COUNT(*) AS total_tasks,
            SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_tasks,
            SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending_tasks,
            SUM(CASE WHEN priority = 'High' THEN 1 ELSE 0 END) AS high_priority,
            SUM(CASE WHEN priority = 'Medium' THEN 1 ELSE 0 END) AS medium_priority,
            SUM(CASE WHEN priority = 'Low' THEN 1 ELSE 0 END) AS low_priority
        FROM tasks
        """
    ).fetchone()
    conn.close()

    total_tasks = rows["total_tasks"] or 0
    completed_tasks = rows["completed_tasks"] or 0
    pending_tasks = rows["pending_tasks"] or 0
    progress = round((completed_tasks / total_tasks) * 100, 1) if total_tasks else 0

    return {
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "pending_tasks": pending_tasks,
        "progress": progress,
        "high_priority": rows["high_priority"] or 0,
        "medium_priority": rows["medium_priority"] or 0,
        "low_priority": rows["low_priority"] or 0,
    }
