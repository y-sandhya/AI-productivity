import os
import re
import tempfile
from datetime import datetime

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None

try:
    from docx import Document as DocxDocument
except ImportError:  # pragma: no cover
    DocxDocument = None

try:
    import olefile
except ImportError:  # pragma: no cover
    olefile = None


def clean_summary_text(raw_text: str):
    if raw_text is None:
        return ""
    text = str(raw_text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_sentences(text: str):
    if not text:
        return []
    pieces = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [piece.strip() for piece in pieces if piece and piece.strip()]


def build_summary(sentences):
    if not sentences:
        return {"summary": "No notes provided.", "key_points": []}

    ranked = []
    for sentence in sentences:
        words = re.findall(r"[A-Za-z0-9']+", sentence.lower())
        score = sum(1 for word in words if len(word) >= 4)
        ranked.append((score, sentence))

    ranked.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    selected = []
    for _, sentence in ranked:
        if sentence not in selected:
            selected.append(sentence)
        if len(selected) >= 3:
            break

    if not selected:
        selected = sentences[:3]

    summary = " ".join(selected[:2])
    if len(summary) < 80 and len(sentences) > 1:
        summary = " ".join(sentences[:2])

    key_points = [sentence for sentence in sentences[:4] if sentence]
    return {"summary": summary, "key_points": key_points}


def summarize_document_text(text: str):
    cleaned = clean_summary_text(text)
    if not cleaned:
        return {"summary": "No text found in the uploaded document.", "key_points": []}

    sentences = split_sentences(cleaned)
    if not sentences:
        return {"summary": "No text found in the uploaded document.", "key_points": []}

    return build_summary(sentences)


def extract_text_from_pdf(file_path: str):
    if PdfReader is None:
        raise RuntimeError("PDF support is not installed.")

    reader = PdfReader(file_path)
    pages = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        pages.append(page_text)
    return "\n".join(pages)


def extract_text_from_docx(file_path: str):
    if DocxDocument is None:
        raise RuntimeError("DOCX support is not installed.")

    document = DocxDocument(file_path)
    paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    return "\n".join(paragraphs)


def extract_text_from_doc(file_path: str):
    if olefile is None:
        raise RuntimeError("Legacy DOC support is not installed.")

    ole = olefile.OleFileIO(file_path)
    try:
        if ole.exists("WordDocument"):
            stream_data = ole.openstream("WordDocument").read()
            text = stream_data.decode("utf-16le", errors="ignore")
            text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]+", " ", text)
            text = re.sub(r"\s+", " ", text)
            return text.strip()
    finally:
        ole.close()
    return ""


def extract_text_from_uploaded_file(file_storage):
    if file_storage is None:
        return ""

    filename = getattr(file_storage, "filename", "") or ""
    if not filename:
        return ""

    extension = os.path.splitext(filename)[1].lower()
    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_file:
        file_storage.save(temp_file.name)
        temp_path = temp_file.name

    try:
        if extension == ".pdf":
            return extract_text_from_pdf(temp_path)
        if extension in (".docx", ".docm"):
            return extract_text_from_docx(temp_path)
        if extension == ".doc":
            return extract_text_from_doc(temp_path)

        file_storage.stream.seek(0)
        return file_storage.read().decode("utf-8", errors="ignore")
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def infer_priority(text: str):
    task_text = (text or "").lower()
    if any(keyword in task_text for keyword in ["tomorrow", "today", "urgent", "deadline", "due"]):
        return {
            "priority": "HIGH",
            "reason": "Deadline is very close.",
        }
    if any(keyword in task_text for keyword in ["later", "optional", "low priority", "can wait"]):
        return {
            "priority": "LOW",
            "reason": "This task can be scheduled later.",
        }
    return {
        "priority": "MEDIUM",
        "reason": "The task is moderately important.",
    }


def generate_chat_response(message: str, tasks):
    question = (message or "").strip().lower()
    task_list = tasks or []
    pending = [task for task in task_list if task.get("status", "Pending") != "Completed"]
    completed = [task for task in task_list if task.get("status") == "Completed"]
    urgent = [
        task for task in pending
        if str(task.get("priority", "")).lower() == "high"
        or any(word in str(task.get("deadline", "")).lower() for word in ["today", "tomorrow"])
    ]

    if not question:
        return {
            "reply": "Ask me about your workload, priorities, deadlines, or what to work on next.",
            "suggestions": [],
        }

    if any(word in question for word in ["next", "start", "priorit", "important", "focus"]):
        if urgent:
            first = urgent[0]
            reply = f"Start with '{first.get('title', 'your highest-priority task')}'. It is marked high priority or has an immediate deadline."
            suggestions = [task.get("title", "Untitled task") for task in urgent[:3]]
        elif pending:
            first = pending[0]
            reply = f"Start with '{first.get('title', 'your next task')}'. You have {len(pending)} pending task(s) and no immediate high-priority deadline is marked."
            suggestions = [task.get("title", "Untitled task") for task in pending[:3]]
        else:
            reply = "Everything in your task list is complete. This is a good time to plan the next work session."
            suggestions = []
    elif any(word in question for word in ["workload", "how much", "many task", "status", "progress"]):
        reply = f"You have {len(pending)} pending task(s) and {len(completed)} completed task(s)."
        if urgent:
            reply += f" {len(urgent)} pending task(s) need close attention."
        suggestions = [task.get("title", "Untitled task") for task in urgent[:3]]
    elif any(word in question for word in ["deadline", "due", "today", "tomorrow"]):
        due_tasks = [task for task in pending if task.get("deadline")]
        if due_tasks:
            reply = "Your pending tasks with deadlines are: " + "; ".join(
                f"{task.get('title', 'Untitled task')} ({task.get('deadline')})" for task in due_tasks[:5]
            ) + "."
            suggestions = [task.get("title", "Untitled task") for task in due_tasks[:3]]
        else:
            reply = "You do not currently have deadlines recorded for pending tasks."
            suggestions = []
    else:
        reply = "Based on your current task list, break the largest pending task into a 25-minute step, then review your progress before starting another task."
        suggestions = [task.get("title", "Untitled task") for task in pending[:3]]

    return {"reply": reply, "suggestions": suggestions}


def parse_duration_to_minutes(value):
    if value is None:
        return 60
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().lower()
    if not text:
        return 60
    if text.endswith("h"):
        try:
            return int(float(text[:-1]) * 60)
        except ValueError:
            return 60
    if text.endswith("m"):
        try:
            return int(float(text[:-1]))
        except ValueError:
            return 60
    if text.isdigit():
        return int(text)
    return 60


def parse_time_to_minutes(value):
    if value is None:
        return 0
    text = str(value).strip()
    if "-" in text and ":" in text:
        text = text.split("-")[-1].strip()
    try:
        hour, minute = map(int, text.split(":"))
        return hour * 60 + minute
    except ValueError:
        return 0


def generate_daily_plan(tasks):
    """Build a simple, honest local plan from the tasks the user provided."""
    task_list = [task for task in (tasks or []) if task]
    if not task_list:
        return {"schedule": []}

    pending = [task for task in task_list if not isinstance(task, dict) or task.get("status", "Pending") != "Completed"]
    pending.sort(key=lambda task: (
        0 if isinstance(task, dict) and task.get("deadline") == datetime.now().strftime("%Y-%m-%d") else 1,
        {"High": 0, "Medium": 1, "Low": 2}.get(task.get("priority", "Medium"), 1) if isinstance(task, dict) else 1,
    ))
    start_minute = 9 * 60
    schedule = []
    for task in pending[:6]:
        if isinstance(task, dict):
            title = str(task.get("title") or task.get("task") or "Untitled task")
            duration = max(25, min(90, parse_duration_to_minutes(task.get("duration", 45))))
        else:
            title = str(task)
            duration = 45
        end_minute = start_minute + duration
        fmt = lambda value: f"{(value // 60) % 12 or 12:02d}:{value % 60:02d} {'AM' if value // 60 < 12 else 'PM'}"
        schedule.append({"time": f"{fmt(start_minute)} – {fmt(end_minute)}", "task": title})
        # Leave a short reset between focused blocks and a longer pause near lunch.
        start_minute = end_minute + (45 if end_minute < 12 * 60 <= end_minute + 20 else 15)
    return {"schedule": schedule}


def optimize_schedule(available_slots, tasks):
    slots = []
    for item in available_slots or []:
        if isinstance(item, dict):
            start = item.get("start") or item.get("from")
            end = item.get("end") or item.get("to")
            if start and end:
                slots.append({"start": start, "end": end})
        elif isinstance(item, str):
            if "-" in item:
                start, end = [part.strip() for part in item.split("-", 1)]
                if start and end:
                    slots.append({"start": start, "end": end})

    if not slots:
        return {"schedule": [], "message": "Please add at least one available time slot."}

    normalized_tasks = []
    for task in tasks or []:
        if isinstance(task, str):
            title = task
            duration = 60
            deadline = ""
        else:
            title = task.get("title") or task.get("task") or task.get("name") or "Untitled task"
            duration = task.get("duration", task.get("hours", task.get("minutes", 60)))
            deadline = task.get("deadline", "")

        normalized_tasks.append({
            "title": title,
            "duration": parse_duration_to_minutes(duration),
            "deadline": deadline,
        })

    if not normalized_tasks:
        return {"schedule": [], "message": "Please add tasks to optimize."}

    def deadline_score(task):
        dl = task["deadline"]
        if not dl:
            return 0
        try:
            day = datetime.strptime(dl, "%Y-%m-%d")
            return day.timestamp()
        except ValueError:
            return 0

    normalized_tasks.sort(key=lambda t: (deadline_score(t), -t["duration"]))

    assigned = []
    slots.sort(key=lambda slot: parse_time_to_minutes(slot["start"]))
    for task in normalized_tasks:
        duration = max(1, task["duration"])
        placed = False
        for slot in slots:
            slot_start = parse_time_to_minutes(slot["start"])
            slot_end = parse_time_to_minutes(slot["end"])
            cursor = slot_start
            for entry in sorted((item for item in assigned if item.get("slot") == slot), key=lambda item: parse_time_to_minutes(item["start"])):
                entry_start = parse_time_to_minutes(entry["start"])
                if entry_start - cursor >= duration:
                    break
                cursor = max(cursor, parse_time_to_minutes(entry["end"]))
            if slot_end - cursor >= duration:
                end = cursor + duration
                fmt = lambda value: f"{value // 60:02d}:{value % 60:02d}"
                assigned.append({"task": task["title"], "start": fmt(cursor), "end": fmt(end), "duration": duration, "slot": slot})
                placed = True
                break
        if not placed:
            assigned.append({"task": task["title"], "start": "Flexible slot", "end": f"Needs {duration} minutes", "duration": duration})

    for entry in assigned:
        entry.pop("slot", None)

    return {
        "schedule": assigned,
        "message": "Optimized schedule created successfully.",
    }


def summarize_notes(text: str):
    return summarize_document_text(text)


def get_optional_ai_response(task_text: str):
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return infer_priority(task_text)
    return infer_priority(task_text)
