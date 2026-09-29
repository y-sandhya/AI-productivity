from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from database import (
    add_event, add_note, add_task, delete_event, delete_note, delete_task,
    get_all_events, get_all_notes, get_all_tasks, get_dashboard_stats,
    init_db, update_event, update_note, update_task,
)
from ai_service import (
    extract_text_from_uploaded_file, generate_daily_plan,
    generate_chat_response, infer_priority, optimize_schedule,
    summarize_document_text, summarize_notes,
)

ROOT = Path(__file__).resolve().parent.parent
app = Flask(__name__, static_folder=str(ROOT / "frontend"), static_url_path="/assets")
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024
init_db()


@app.get("/")
def landing():
    return send_from_directory(ROOT / "frontend", "landing.html")


@app.get("/app")
def workspace():
    return send_from_directory(ROOT / "frontend", "index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/tasks")
def get_tasks():
    return jsonify(get_all_tasks())


@app.post("/tasks")
def create_task():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    if not title:
        return jsonify({"error": "Add a title before saving this task."}), 400
    task = add_task({
        "title": title[:240],
        "deadline": str(data.get("deadline", ""))[:10],
        "priority": data.get("priority", "Medium") if data.get("priority") in {"High", "Medium", "Low"} else "Medium",
        "status": "Completed" if data.get("status") == "Completed" else "Pending",
    })
    return jsonify(task), 201


@app.put("/tasks/<int:task_id>")
def edit_task(task_id):
    data = request.get_json(silent=True) or {}
    current = next((task for task in get_all_tasks() if task["id"] == task_id), None)
    if not current:
        return jsonify({"error": "Task not found."}), 404
    data = {**current, **data}
    data["title"] = str(data.get("title", "")).strip()[:240]
    if not data["title"]:
        return jsonify({"error": "A task needs a title."}), 400
    data["priority"] = data.get("priority") if data.get("priority") in {"High", "Medium", "Low"} else "Medium"
    data["status"] = "Completed" if data.get("status") == "Completed" else "Pending"
    updated = update_task(task_id, data)
    return jsonify(updated)


@app.delete("/tasks/<int:task_id>")
def remove_task(task_id):
    deleted = delete_task(task_id)
    if not deleted:
        return jsonify({"error": "Task not found."}), 404
    return jsonify({"deleted": deleted})


@app.get("/events")
def events():
    return jsonify(get_all_events())


@app.post("/events")
def create_event():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    date = str(data.get("date", ""))[:10]
    if not title or not date:
        return jsonify({"error": "Add an event title and date."}), 400
    return jsonify(add_event({
        "title": title[:240], "date": date,
        "start_time": str(data.get("start_time", "09:00"))[:5],
        "end_time": str(data.get("end_time", "10:00"))[:5],
        "category": str(data.get("category", "Personal"))[:40],
        "description": str(data.get("description", ""))[:2000],
    })), 201


@app.put("/events/<int:event_id>")
def edit_event(event_id):
    data = request.get_json(silent=True) or {}
    current = next((item for item in get_all_events() if item["id"] == event_id), None)
    if not current:
        return jsonify({"error": "Event not found."}), 404
    merged = {**current, **data}
    if not str(merged.get("title", "")).strip() or not merged.get("date"):
        return jsonify({"error": "Add an event title and date."}), 400
    return jsonify(update_event(event_id, merged))


@app.delete("/events/<int:event_id>")
def remove_event(event_id):
    item = delete_event(event_id)
    return (jsonify({"deleted": item}), 200) if item else (jsonify({"error": "Event not found."}), 404)


@app.get("/notes")
def notes():
    return jsonify(get_all_notes())


@app.post("/notes")
def create_note():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    body = str(data.get("body", ""))
    if not title and not body.strip():
        return jsonify({"error": "Write something before saving your note."}), 400
    return jsonify(add_note({"title": title[:240] or "Untitled note", "body": body[:20000]})), 201


@app.put("/notes/<int:note_id>")
def edit_note(note_id):
    data = request.get_json(silent=True) or {}
    current = next((item for item in get_all_notes() if item["id"] == note_id), None)
    if not current:
        return jsonify({"error": "Note not found."}), 404
    return jsonify(update_note(note_id, {**current, **data}))


@app.delete("/notes/<int:note_id>")
def remove_note(note_id):
    item = delete_note(note_id)
    return (jsonify({"deleted": item}), 200) if item else (jsonify({"error": "Note not found."}), 404)


@app.get("/dashboard")
def dashboard():
    return jsonify(get_dashboard_stats())


@app.post("/ai-priority")
def ai_priority():
    data = request.get_json(silent=True) or {}
    return jsonify(infer_priority(data.get("text", "")))


@app.post("/ai-chat")
def ai_chat():
    data = request.get_json(silent=True) or {}
    return jsonify(generate_chat_response(data.get("message", ""), data.get("tasks", [])))


@app.post("/ai-plan")
def ai_plan():
    data = request.get_json(silent=True) or {}
    return jsonify(generate_daily_plan(data.get("tasks", [])))


@app.post("/ai-schedule-optimizer")
def ai_schedule_optimizer():
    data = request.get_json(silent=True) or {}
    return jsonify(optimize_schedule(data.get("available_slots", []), data.get("tasks", [])))


@app.post("/summarize")
def summarize():
    uploaded_file = request.files.get("file")
    try:
        if uploaded_file:
            text = extract_text_from_uploaded_file(uploaded_file)
            if not text.strip():
                return jsonify({"error": "We couldn’t find readable text in that file."}), 400
            return jsonify(summarize_document_text(text))
        data = request.get_json(silent=True) or request.form
        text = str(data.get("text", ""))
        if not text.strip():
            return jsonify({"error": "Add text or choose a document to summarize."}), 400
        return jsonify(summarize_notes(text))
    except Exception:
        app.logger.exception("Document summarization failed")
        return jsonify({"error": "We couldn’t read that document. Try a text, PDF, DOC or DOCX file."}), 400


@app.errorhandler(413)
def upload_too_large(_error):
    return jsonify({"error": "That file is larger than 12 MB. Try a smaller document."}), 413


@app.errorhandler(500)
def server_error(_error):
    app.logger.exception("Unhandled application error")
    return jsonify({"error": "Something went wrong in your workspace. Please try again."}), 500


if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=5000)
