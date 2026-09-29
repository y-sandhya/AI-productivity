# Daylight — AI Productivity Assistant

A calm, local-first planner built with Flask, SQLite, HTML, CSS and vanilla JavaScript. Tasks, calendar events and notes are stored in the existing SQLite database. The public landing page lives at `/`; the planner is served at `/app`.

## Run locally

1. Install dependencies: `python -m pip install -r requirements.txt`
2. Start Flask from the project root: `python backend/app.py`
3. Open [http://127.0.0.1:5000](http://127.0.0.1:5000)

The first launch adds the notes and events tables to `database/productivity.db`. Existing tasks are kept. New installs start empty so the planner does not invent sample work.

## Included

- Task create, update, completion, delete, deadline and priority
- Calendar event create, update and delete, with month, week and day views
- Notes create, edit and delete in SQLite
- Dashboard counts, progress and deadline-aware task display
- Local planning helpers, schedule fitting, priority guidance, task breakdown, chat responses and document summarization (TXT, PDF, DOC, DOCX)
- Responsive workspace navigation and a persisted light/dark appearance

## AI behavior

The supplied project does not contain a connected AI model. The companion keeps its local rule-based behavior and labels its limitations in the interface; it does not claim to generate model-backed answers. No API key is exposed in browser code. Connect and configure a server-side provider before describing these responses as generative AI.
