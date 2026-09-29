(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { tasks: [], events: [], notes: [], filter: 'all', view: 'home', calendarMode: 'month', cursor: new Date(), selectedDate: new Date() };
  const defaultPreferences = { taskReminders: false, calendarReminders: false, deadlineAlerts: false, aiSuggestions: true };
  const preferences = { ...defaultPreferences, ...JSON.parse(localStorage.getItem('daylight-preferences') || '{}') };
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = localDate(new Date());
  const shortDate = (value) => { if (!value) return 'No deadline'; const d = new Date(`${value}T12:00:00`); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const $el = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'That didn’t work just now. Please try again.');
    return data;
  }
  function toast(message, isError = false) {
    const item = $el('div', `toast${isError ? ' error' : ''}`, message);
    $('#toastRegion').append(item); window.setTimeout(() => item.remove(), 3600);
  }
  function loading(button, text) {
    if (button.dataset.busy === 'true') return null;
    const old = button.textContent; button.dataset.busy = 'true'; button.disabled = true; button.textContent = text;
    return () => { button.dataset.busy = 'false'; button.disabled = false; button.textContent = old; };
  }
  function navigate(view) {
    state.view = view;
    $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${view}`));
    $$('[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    const names = { home: 'My day', calendar: 'Calendar', tasks: 'Tasks', notes: 'Notes', assistant: 'AI companion' };
    $('#crumbTitle').textContent = names[view] || 'My day';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'calendar') renderCalendar();
    if (view === 'notes') renderNotes();
    if (view === 'settings') renderPreferences();
  }
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));

  function initDates() {
    const now = new Date();
    $('#topDate').textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    $('#greetingEyebrow').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
    const hour = now.getHours();
    $('#greetingTitle').firstChild.textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }
  initDates();

  async function refresh() {
    try {
      const [tasks, events, notes] = await Promise.all([api('/tasks'), api('/events'), api('/notes')]);
      state.tasks = tasks; state.events = events; state.notes = notes;
      renderTasks(); renderHome(); renderCalendar(); renderNotes(); renderStats();
    } catch (error) { toast(error.message || 'Could not connect to your workspace.', true); }
  }
  function renderStats() {
    const pending = state.tasks.filter((task) => task.status !== 'Completed');
    const completed = state.tasks.length - pending.length;
    const progress = state.tasks.length ? Math.round(completed / state.tasks.length * 100) : 0;
    $('#navTaskCount').textContent = String(pending.length);
    $('#overviewTasks').textContent = `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'}`;
    $('#overviewEvents').textContent = `${state.events.filter((event) => event.date === today).length} ${state.events.filter((event) => event.date === today).length === 1 ? 'event' : 'events'}`;
    $('#completedTasks').textContent = completed; $('#pendingTasks').textContent = pending.length;
    $('#analyticsProgress').textContent = `${progress}%`; $('#analyticsProgressBar').style.width = `${progress}%`;
    $('#highPriorityTasks').textContent = pending.filter((task) => task.priority === 'High').length;
    $('#taskCountText').textContent = `${pending.length} to do · ${completed} completed`;
  }
  function deadlineLabel(date) {
    if (!date) return 'Whenever you’re ready';
    if (date === today) return 'Due today';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (date === localDate(tomorrow)) return 'Due tomorrow';
    if (date < today) return `Overdue · ${shortDate(date)}`;
    return `Due ${shortDate(date)}`;
  }
  function createTaskRow(task, compact = false) {
    const row = $el(compact ? 'div' : 'li', compact ? 'home-task' : 'task-item');
    const check = $el('button', `task-check${task.status === 'Completed' ? ' checked' : ''}`, task.status === 'Completed' ? '✓' : '');
    check.type = 'button'; check.setAttribute('aria-label', task.status === 'Completed' ? `Reopen ${task.title}` : `Complete ${task.title}`);
    check.addEventListener('click', () => toggleTask(task)); row.append(check);
    if (compact) {
      const title = $el('span', `home-task-title${task.status === 'Completed' ? ' done' : ''}`, task.title);
      const meta = $el('span', 'home-task-meta', deadlineLabel(task.deadline)); row.append(title, meta);
      const dot = $el('i', `priority-dot ${task.priority.toLowerCase()}`); dot.title = `${task.priority} priority`; row.insertBefore(dot, title);
      return row;
    }
    const main = $el('div', 'task-main'); const titleRow = $el('div', 'task-title-row');
    titleRow.append($el('span', `task-title${task.status === 'Completed' ? ' completed' : ''}`, task.title), $el('span', `task-priority ${task.priority.toLowerCase()}`, task.priority));
    const meta = $el('div', `task-meta${task.deadline && task.deadline < today && task.status !== 'Completed' ? ' overdue' : ''}`, deadlineLabel(task.deadline));
    main.append(titleRow, meta); row.append(main);
    const actions = $el('div', 'task-actions');
    for (const [action, label] of [['edit', 'Edit'], ['delete', 'Remove']]) {
      const button = $el('button', 'task-action', label); button.type = 'button'; button.setAttribute('aria-label', `${label} ${task.title}`);
      button.addEventListener('click', () => action === 'edit' ? openEditTask(task) : removeTask(task)); actions.append(button);
    }
    row.append(actions); return row;
  }
  function renderTasks() {
    const list = $('#taskList'); list.replaceChildren();
    let shown = state.tasks;
    if (state.filter === 'Pending') shown = shown.filter((task) => task.status !== 'Completed');
    if (state.filter === 'Completed') shown = shown.filter((task) => task.status === 'Completed');
    if (!shown.length) {
      const li = $el('li', 'empty-state'); li.append($el('span', 'empty-icon', state.tasks.length ? '♡' : '✳'), $el('strong', '', state.tasks.length ? 'Nothing in this view.' : 'Nothing planned yet ♡'), $el('span', '', state.tasks.length ? 'Try another filter or enjoy the breathing room.' : 'Add a small first step when you’re ready.')); list.append(li);
    } else shown.forEach((task) => list.append(createTaskRow(task)));
    const home = $('#homeTaskList'); home.replaceChildren();
    const focus = state.tasks.filter((task) => task.status !== 'Completed').slice(0, 4);
    if (!focus.length) { const empty = $el('div', 'empty-state'); empty.append($el('span', 'empty-icon', '♡'), $el('strong', '', state.tasks.length ? 'All caught up.' : 'Nothing planned yet ♡'), $el('span', '', 'Make a little room for whatever comes next.')); home.append(empty); }
    else focus.forEach((task) => home.append(createTaskRow(task, true)));
    renderStats();
  }
  async function addTask(event) {
    event.preventDefault(); const title = $('#taskTitle').value.trim(); if (!title) return;
    const button = $('#taskForm button[type="submit"]'); const done = loading(button, 'Adding…'); if (!done) return;
    try { await api('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, deadline: $('#taskDeadline').value, priority: $('#taskPriority').value }) });
      $('#taskForm').reset(); $('#taskPriority').value = 'Medium'; await refresh(); toast('Task added. One step at a time.'); }
    catch (error) { toast(error.message, true); } finally { done(); }
  }
  $('#taskForm').addEventListener('submit', addTask);
  async function toggleTask(task) {
    try { await api(`/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...task, status: task.status === 'Completed' ? 'Pending' : 'Completed' }) }); await refresh(); if (task.status !== 'Completed') toast('A little progress, celebrated ✨'); }
    catch (error) { toast(error.message, true); }
  }
  async function removeTask(task) {
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); await refresh(); toast('Task removed.'); }
    catch (error) { toast(error.message, true); }
  }
  function openEditTask(task) { $('#editTaskId').value = task.id; $('#editTaskTitle').value = task.title; $('#editTaskDeadline').value = task.deadline || ''; $('#editTaskPriority').value = task.priority; $('#taskDialog').showModal(); }
  $('#editTaskForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const id = $('#editTaskId').value; const task = state.tasks.find((item) => item.id === Number(id)); if (!task) return;
    try { await api(`/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...task, title: $('#editTaskTitle').value.trim(), deadline: $('#editTaskDeadline').value, priority: $('#editTaskPriority').value }) }); $('#taskDialog').close(); await refresh(); toast('Changes saved.'); }
    catch (error) { toast(error.message, true); }
  });
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('[data-filter]').forEach((b) => b.classList.toggle('selected', b === button)); renderTasks(); }));
  function openTaskComposer() { navigate('tasks'); $('#taskTitle').focus(); }
  ['#quickAdd', '#homeAddTask', '#taskViewAdd'].forEach((selector) => $(selector).addEventListener('click', openTaskComposer));

  function eventRow(event) {
    const row = $el('div', 'agenda-row'); row.append($el('span', 'agenda-time', event.start_time || 'All day'), $el('i', 'agenda-marker'));
    const card = $el('div', `agenda-event ${event.category.toLowerCase()}`); card.append($el('b', '', event.title), $el('small', '', `${event.category} · ${event.start_time} – ${event.end_time}`));
    card.addEventListener('click', () => openEvent(event)); row.append(card); return row;
  }
  function renderHome() {
    $('.plan-panel').hidden = !preferences.aiSuggestions;
    const agenda = $('#homeAgenda'); agenda.replaceChildren();
    const todaysEvents = state.events.filter((event) => event.date === today).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const taskDeadlines = state.tasks.filter((task) => task.status !== 'Completed' && task.deadline === today).map((task) => ({ title: task.title, start_time: 'All day', end_time: '', category: 'Task', date: today, _task: task }));
    const rows = [...todaysEvents.map((event) => ({ ...event })), ...taskDeadlines].sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (!rows.length) { const empty = $el('div', 'empty-state'); empty.append($el('span', 'empty-icon', '☼'), $el('strong', '', 'Your day is wide open ✨'), $el('span', '', 'No events scheduled for today.')); agenda.append(empty); $('#nextUp').textContent = 'Nothing scheduled'; }
    else { rows.slice(0, 4).forEach((event) => agenda.append(event._task ? makeAgendaTask(event._task) : eventRow(event))); const upcoming = rows.find((event) => event.start_time >= new Date().toTimeString().slice(0, 5)); $('#nextUp').textContent = upcoming ? upcoming.title : `${rows.length} ${rows.length === 1 ? 'event' : 'things'} today`; }
  }
  function makeAgendaTask(task) { const row = $el('div', 'agenda-row'); row.append($el('span', 'agenda-time', 'Due today'), $el('i', 'agenda-marker')); const card = $el('div', 'agenda-event'); card.append($el('b', '', task.title), $el('small', '', 'Task deadline')); row.append(card); return row; }

  const eventDialog = $('#eventDialog');
  function openEvent(event = null, date = state.selectedDate) {
    $('#eventDialogTitle').textContent = event ? 'Edit event' : 'New event'; $('#eventId').value = event?.id || '';
    $('#eventTitle').value = event?.title || ''; $('#eventDate').value = event?.date || localDate(date);
    $('#eventStart').value = event?.start_time || '09:00'; $('#eventEnd').value = event?.end_time || '10:00';
    $('#eventCategory').value = event?.category || 'Personal'; $('#eventDescription').value = event?.description || '';
    eventDialog.showModal();
  }
  $('#addEventButton').addEventListener('click', () => openEvent());
  $('#eventForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const id = $('#eventId').value; const body = { title: $('#eventTitle').value.trim(), date: $('#eventDate').value, start_time: $('#eventStart').value, end_time: $('#eventEnd').value, category: $('#eventCategory').value, description: $('#eventDescription').value.trim() };
    try { await api(id ? `/events/${id}` : '/events', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); eventDialog.close(); await refresh(); toast(id ? 'Event updated.' : 'Event added to your calendar.'); }
    catch (error) { toast(error.message, true); }
  });
  async function deleteEvent(event) {
    if (!window.confirm) return;
    const choice = document.createElement('dialog'); choice.className = 'form-dialog'; const content = document.createElement('div'); content.append($el('p', 'eyebrow', 'A QUICK CHECK'), $el('h2', '', `Remove “${event.title}”?`), $el('p', 'subheading', 'This will remove the event from your calendar.'));
    const actions = $el('div', 'dialog-actions'); const cancel = $el('button', 'secondary-btn', 'Keep event'); const remove = $el('button', 'primary-btn', 'Remove event'); cancel.type = remove.type = 'button'; actions.append(cancel, remove); content.append(actions); choice.append(content); document.body.append(choice); choice.showModal();
    cancel.addEventListener('click', () => { choice.close(); choice.remove(); });
    remove.addEventListener('click', async () => { choice.close(); choice.remove(); try { await api(`/events/${event.id}`, { method: 'DELETE' }); await refresh(); toast('Event removed.'); } catch (error) { toast(error.message, true); } });
  }
  function renderCalendar() {
    const grid = $('#calendarGrid'); const heading = $('#calendarMonth'); if (!grid || !heading) return;
    heading.textContent = state.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const y = state.cursor.getFullYear(), m = state.cursor.getMonth(); let start = new Date(y, m, 1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const total = state.calendarMode === 'month' ? 42 : state.calendarMode === 'week' ? 7 : 1;
    if (state.calendarMode === 'day') start = new Date(`${localDate(state.selectedDate)}T12:00:00`);
    if (state.calendarMode === 'week') { start = new Date(`${localDate(state.selectedDate)}T12:00:00`); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); }
    grid.replaceChildren(); grid.classList.toggle('single-day', state.calendarMode === 'day');
    for (let index = 0; index < total; index++) {
      const day = new Date(start); day.setDate(start.getDate() + index); const date = localDate(day);
      const cell = $el('div', `calendar-cell${day.getMonth() !== m && state.calendarMode === 'month' ? ' muted' : ''}${date === today ? ' today' : ''}${date === localDate(state.selectedDate) ? ' selected' : ''}`);
      cell.setAttribute('role', 'button'); cell.tabIndex = 0; cell.setAttribute('aria-label', day.toLocaleDateString()); cell.append($el('span', 'date-number', String(day.getDate())));
      const dayEvents = state.events.filter((event) => event.date === date).sort((a, b) => a.start_time.localeCompare(b.start_time));
      dayEvents.slice(0, state.calendarMode === 'month' ? 2 : 8).forEach((event) => { const chip = $el('div', `calendar-event ${event.category.toLowerCase()}`, `${event.start_time} ${event.title}`); chip.title = event.title; chip.addEventListener('click', (e) => { e.stopPropagation(); openEvent(event); }); cell.append(chip); });
      if (dayEvents.length > 2 && state.calendarMode === 'month') cell.append($el('div', 'calendar-event', `+${dayEvents.length - 2} more`));
      cell.addEventListener('click', () => { state.selectedDate = day; if (state.calendarMode === 'month') { state.calendarMode = 'day'; $$('.view-switch button').forEach((b) => b.classList.toggle('selected', b.dataset.calendarView === 'day')); } renderCalendar(); });
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cell.click(); } }); grid.append(cell);
    }
    const weekdayLabels = $('.calendar-weekdays'); weekdayLabels.style.display = state.calendarMode === 'day' ? 'none' : 'grid';
    $('#dayAgenda').replaceChildren();
    const selectedDate = localDate(state.selectedDate); const agendaEvents = state.events.filter((event) => event.date === selectedDate).sort((a, b) => a.start_time.localeCompare(b.start_time));
    $('#dayAgenda').append($el('h3', '', new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
    if (!agendaEvents.length) { const empty = $el('div', 'empty-state'); empty.append($el('span', 'empty-icon', '✳'), $el('strong', '', 'Your day is wide open ✨'), $el('span', '', 'No events scheduled for this day.')); $('#dayAgenda').append(empty); }
    else agendaEvents.forEach((event) => { const row = $el('div', 'calendar-agenda-row'); row.append($el('time', '', `${event.start_time}–${event.end_time}`), $el('b', '', `${event.title} · ${event.category}`)); const edit = $el('button', 'task-action', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => openEvent(event)); const remove = $el('button', 'task-action', 'Remove'); remove.type = 'button'; remove.addEventListener('click', () => deleteEvent(event)); row.append(edit, remove); $('#dayAgenda').append(row); });
  }
  $('#prevMonth').addEventListener('click', () => { state.cursor.setMonth(state.cursor.getMonth() - 1); state.selectedDate = new Date(state.cursor); renderCalendar(); });
  $('#nextMonth').addEventListener('click', () => { state.cursor.setMonth(state.cursor.getMonth() + 1); state.selectedDate = new Date(state.cursor); renderCalendar(); });
  $('#todayButton').addEventListener('click', () => { state.cursor = new Date(); state.selectedDate = new Date(); renderCalendar(); });
  $$('[data-calendar-view]').forEach((button) => button.addEventListener('click', () => { state.calendarMode = button.dataset.calendarView; $$('.view-switch button').forEach((b) => b.classList.toggle('selected', b === button)); renderCalendar(); }));

  function renderNotes() {
    const list = $('#notesList'); list.replaceChildren(); $('#notesCount').textContent = String(state.notes.length);
    if (!state.notes.length) { const empty = $el('div', 'empty-state'); empty.append($el('span', 'empty-icon', '♡'), $el('strong', '', 'Your thoughts deserve a place ♡'), $el('span', '', 'Create your first note.')); list.append(empty); return; }
    state.notes.forEach((note) => { const card = $el('article', `note-card${Number($('#noteId').value) === note.id ? ' selected' : ''}`); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Open note ${note.title}`); card.append($el('b', '', note.title), $el('p', '', note.body || 'An open page for a new thought.'), $el('small', '', `Updated ${new Date(`${note.updated_at.replace(' ', 'T')}Z`).toLocaleDateString()}`)); card.addEventListener('click', () => selectNote(note)); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNote(note); } }); const remove = $el('button', 'note-delete', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Delete ${note.title}`); remove.addEventListener('click', (e) => { e.stopPropagation(); deleteNote(note); }); card.append(remove); list.append(card); });
  }
  function selectNote(note) { $('#noteId').value = note.id; $('#noteTitle').value = note.title; $('#noteBody').value = note.body; $('#noteSavedLabel').textContent = 'Editing a note in your workspace.'; renderNotes(); }
  function clearNote() { $('#noteId').value = ''; $('#noteTitle').value = ''; $('#noteBody').value = ''; $('#noteSavedLabel').textContent = 'Notes save to your private workspace.'; renderNotes(); $('#noteTitle').focus(); }
  $('#newNoteButton').addEventListener('click', clearNote);
  $('#noteForm').addEventListener('submit', async (event) => { event.preventDefault(); const id = $('#noteId').value; const title = $('#noteTitle').value.trim(); const body = $('#noteBody').value; if (!title && !body.trim()) { toast('Write a little something before saving.', true); return; }
    try { const note = await api(id ? `/notes/${id}` : '/notes', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) }); $('#noteId').value = note.id; await refresh(); selectNote(note); toast('Note saved.'); }
    catch (error) { toast(error.message, true); }
  });
  async function deleteNote(note) { try { await api(`/notes/${note.id}`, { method: 'DELETE' }); if (Number($('#noteId').value) === note.id) clearNote(); await refresh(); toast('Note removed.'); } catch (error) { toast(error.message, true); } }

  $('#homePlanButton').addEventListener('click', async () => {
    const button = $('#homePlanButton'); const done = loading(button, 'Gathering your day…'); if (!done) return;
    try { const pending = state.tasks.filter((task) => task.status !== 'Completed'); const data = await api('/ai-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: pending }) });
      const result = $('#homePlanResult'); result.replaceChildren(); if (!data.schedule?.length) result.append($el('span', '', 'Add a task and I’ll help you shape a gentle plan.'));
      else data.schedule.slice(0, 4).forEach((item) => { const line = $el('span', '', `${item.time}  ·  ${item.task}`); result.append(line); });
    } catch (error) { toast(error.message, true); } finally { done(); }
  });

  function renderPreferences() {
    $$('[data-preference]').forEach((input) => { input.checked = Boolean(preferences[input.dataset.preference]); });
    $$('[data-theme-choice]').forEach((button) => button.classList.toggle('selected', button.dataset.themeChoice === (document.body.classList.contains('dark') ? 'dark' : 'light')));
  }
  function applyTheme(theme) {
    const dark = theme === 'dark'; document.body.classList.toggle('dark', dark);
    localStorage.setItem('daylight-theme', dark ? 'dark' : 'light');
    $('#themeLabel').textContent = dark ? 'Light appearance' : 'Dark appearance';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#202421' : '#f8f7f3'; renderPreferences();
  }
  $('#themeToggle').addEventListener('click', () => applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
  $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
  $$('[data-preference]').forEach((input) => input.addEventListener('change', async () => {
    const key = input.dataset.preference; preferences[key] = input.checked; localStorage.setItem('daylight-preferences', JSON.stringify(preferences));
    if (input.checked && ['taskReminders', 'calendarReminders', 'deadlineAlerts'].includes(key) && 'Notification' in window && Notification.permission === 'default') {
      try { const result = await Notification.requestPermission(); if (result !== 'granted') toast('Browser notifications are off; reminders can still appear here while Daylight is open.'); }
      catch (_error) { toast('Browser notifications are unavailable. In app reminders can still appear while Daylight is open.'); }
    }
    if (key === 'aiSuggestions') renderHome();
    toast(input.checked ? 'Preference saved.' : 'Preference turned off.');
  }));
  if (localStorage.getItem('daylight-theme') === 'dark') applyTheme('dark');
  renderPreferences();

  function deliverReminder(key, title, body) {
    const sent = JSON.parse(localStorage.getItem('daylight-reminders-sent') || '{}'); const stamp = `${today}:${key}`;
    if (sent[stamp]) return;
    sent[stamp] = true; localStorage.setItem('daylight-reminders-sent', JSON.stringify(sent));
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: stamp });
    else toast(`${title} · ${body}`);
  }
  function checkReminders() {
    const now = new Date(); const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (preferences.taskReminders && currentMinute >= 9 * 60) {
      const due = state.tasks.filter((task) => task.status !== 'Completed' && task.deadline === today);
      if (due.length) deliverReminder('tasks-due', 'A gentle task reminder', `You have ${due.length} task${due.length === 1 ? '' : 's'} due today.`);
    }
    if (preferences.deadlineAlerts && currentMinute >= 9 * 60) {
      const overdue = state.tasks.filter((task) => task.status !== 'Completed' && task.deadline && task.deadline < today);
      if (overdue.length) deliverReminder('tasks-overdue', 'A deadline to revisit', `There ${overdue.length === 1 ? 'is' : 'are'} ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} in your planner.`);
    }
    if (preferences.calendarReminders) state.events.filter((event) => event.date === today).forEach((event) => {
      const [hour, minute] = event.start_time.split(':').map(Number); const target = hour * 60 + minute - 15;
      if (currentMinute >= target && currentMinute < target + 60) deliverReminder(`event-${event.id}`, 'Coming up soon', `${event.title} starts in about 15 minutes.`);
    });
  }
  window.setInterval(checkReminders, 60_000);
  window.setTimeout(checkReminders, 1600);

  function renderAIResult(container, text) { container.replaceChildren($el('p', '', text)); }
  $('#aiButton').addEventListener('click', async () => {
    const input = $('#aiInput').value.trim(); if (!input) { renderAIResult($('#aiOutput'), 'Describe a task or deadline first.'); return; }
    const button = $('#aiButton'); const done = loading(button, 'Thinking…'); if (!done) return;
    try { const data = await api('/ai-priority', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input }) }); renderAIResult($('#aiOutput'), `${data.priority} priority · ${data.reason} The built in guide uses deadline words and task context.`); }
    catch (error) { toast(error.message, true); } finally { done(); }
  });
  $('#breakdownButton').addEventListener('click', () => {
    const task = $('#breakdownInput').value.trim(); if (!task) { renderAIResult($('#breakdownOutput'), 'Add a bigger task first.'); return; }
    const steps = ['Write down what “done” looks like', 'Gather the information or materials you need', `Spend 25 minutes on the first part of “${task}”`, 'Pause, review, and choose the next small step'];
    const list = document.createElement('ol'); list.className = 'breakdown-list'; steps.forEach((step) => list.append($el('li', '', step))); $('#breakdownOutput').replaceChildren(list);
  });

  async function runPlanning(path, buttonSelector, outputSelector, body, busyText) {
    const button = $(buttonSelector); const done = loading(button, busyText); if (!done) return;
    try { const result = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const output = $(outputSelector); output.replaceChildren();
      if (!result.schedule?.length) { renderAIResult(output, result.message || 'Add a little more detail and try again.'); return; }
      result.schedule.forEach((entry) => { const row = $el('div', 'schedule-row'); row.append($el('b', '', entry.time || `${entry.start} – ${entry.end}`), $el('span', '', entry.task)); output.append(row); }); if (result.message) output.append($el('p', '', result.message));
    } catch (error) { toast(error.message, true); } finally { done(); }
  }
  $('#plannerButton').addEventListener('click', () => { const tasks = $('#plannerInput').value.split(/\n|,|;/).map((text) => text.trim()).filter(Boolean); if (!tasks.length) { renderAIResult($('#plannerOutput'), 'Add at least one task to make a plan.'); return; } runPlanning('/ai-plan', '#plannerButton', '#plannerOutput', { tasks }, 'Finding a rhythm…'); });
  $('#optimizerButton').addEventListener('click', () => { const slots = $('#availableSlots').value.split(/\n|,|;/).map((text) => text.trim()).filter(Boolean); const tasks = $('#taskScheduleInput').value.split(/\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => { const [title, duration, deadline] = line.split('|').map((part) => part.trim()); return { title, duration: duration || '60', deadline: deadline || '' }; }); if (!slots.length || !tasks.length) { renderAIResult($('#optimizerOutput'), 'Add available time slots and tasks to find a fit.'); return; } runPlanning('/ai-schedule-optimizer', '#optimizerButton', '#optimizerOutput', { available_slots: slots, tasks }, 'Finding space…'); });

  $('#chatForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const input = $('#chatInput'); const message = input.value.trim(); if (!message || $('#chatButton').dataset.busy === 'true') return;
    const messages = $('#chatMessages'); messages.append($el('div', 'chat-message user-message', message)); input.value = ''; const done = loading($('#chatButton'), '…');
    try { const data = await api('/ai-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, tasks: state.tasks }) }); let reply = data.reply || 'I couldn’t find a helpful answer just now.'; if (data.suggestions?.length) reply += ` A few tasks to consider: ${data.suggestions.join(', ')}.`; messages.append($el('div', 'chat-message assistant-message', reply)); }
    catch (error) { messages.append($el('div', 'chat-message assistant-message', 'I can’t reach your planner right now. Please try again in a moment.')); console.error(error); }
    finally { done(); messages.scrollTop = messages.scrollHeight; }
  });
  $$('.suggestion-chips button').forEach((button) => button.addEventListener('click', () => { $('#chatInput').value = button.dataset.prompt; $('#chatInput').focus(); }));

  $('#summarizeButton').addEventListener('click', async () => {
    const text = $('#notesInput').value.trim() || $('#noteBody').value.trim(); const file = $('#notesFile').files[0]; if (!text && !file) { renderAIResult($('#notesSummaryOutput'), 'Write or choose a document to summarize.'); return; }
    const button = $('#summarizeButton'); const done = loading(button, 'Finding the thread…'); if (!done) return;
    try { const form = new FormData(); if (text) form.append('text', text); if (file) form.append('file', file); const data = await api('/summarize', { method: 'POST', body: form }); const content = [`${data.summary || 'No summary available.'}`, ...(data.key_points || []).map((point) => `• ${point}`)].join('\n\n'); renderAIResult($('#notesSummaryOutput'), content); }
    catch (error) { toast(error.message, true); } finally { done(); }
  });
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  [eventDialog, $('#taskDialog')].forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  refresh();
})();
