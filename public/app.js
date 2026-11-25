const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');

const paths = {
  projects: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-12 0v11"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-15a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  logout: '<path d="M10 17v3H4V4h6v3m4 1 4 4-4 4m-5-4h12"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="currentColor"/><circle cx="15" cy="17" r="2.5" fill="currentColor"/>',
  attach: '<path d="m10 14 5-5a2 2 0 0 1 3 3l-7 7a4 4 0 1 1-6-6l8-8a3 3 0 0 1 5 1"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7m2.4 4.5a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  file: '<path d="M8 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2z"/><path d="M15 3v5h5M8 12h8m-8 4h6"/>',
  person: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  flag: '<path d="M5 21V4m0 1c6-4 8 4 14 0v9c-6 4-8-4-14 0"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8m-9 4h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4"/>',
};
let statuses = [];
const priorities = { high: 'Высокий', normal: 'Средний', low: 'Низкий' };
const trackers = { task: 'Задача', bug: 'Ошибка', feature: 'Улучшение', support: 'Поддержка' };
const fieldKinds = { text: 'Строка', textarea: 'Длинный текст', number: 'Число', date: 'Дата', select: 'Список', url: 'Ссылка' };
const builtinNames = {
  description: 'Описание', customer: 'Заказчик', assignee_id: 'Исполнитель', priority: 'Приоритет',
  category: 'Категория', target_version: 'Целевая версия', parent_id: 'Родительская задача',
  start_date: 'Дата начала', due_date: 'Срок', estimated_hours: 'Оценка, ч', done_ratio: 'Готовность, %',
};
const brand = '<span class="brand"><img src="/favicon.svg" alt=""><span>BlackCat <small>Tasks</small></span></span>';
const icon = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const taskKey = (project, task) => project.code + '-' + task.number;
const taskPath = (project, task) => '/projects/' + project.id + '/tasks' + (task ? '/' + task.id : '');
const projectHref = project => '/#project/' + project.id;
const statusOptions = () => statuses.map(item => [item.key, item.name]);
const statusTone = status => status.closed ? 'done' : ['todo', 'doing', 'review'].includes(status.key) ? status.key : 'custom-status';
const relations = {
  relates: ['Связана с', 'Связана с'], blocks: ['Блокирует', 'Заблокирована задачей'],
  duplicates: ['Дублирует', 'Дублируется задачей'],
};
const visible = (project, key) => project.builtin_fields[key]?.visible !== false;
const required = (project, key) => project.builtin_fields[key]?.required ? ' required' : '';
const initial = name => Array.from(name.trim())[0]?.toLocaleUpperCase('ru') ?? '?';
const errorLine = '<p class="error" role="alert" hidden></p>';

let user;
let generation = 0;
let toastTimer;
let viewState = { id: null, mode: 'board', search: '', priority: 'all', assignee: 'all' };

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, options) {
  const response = await fetch('/api' + path, options);
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status, data.error);
  return data;
}

function api(path, method = 'GET', body = {}) {
  return request(path, method === 'GET' ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function notice(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3300);
}

function avatar(name, className = '') {
  return '<span class="avatar ' + className + '" aria-hidden="true">' + (name ? esc(initial(name)) : icon('person')) + '</span>';
}

function button(label, id, glyph, tone = '') {
  return '<button class="button ' + tone + '" type="button" id="' + id + '">' + (glyph ? icon(glyph) : '') + esc(label) + '</button>';
}

function iconButton(label, id, glyph) {
  return '<button class="icon-button" type="button" id="' + id + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon(glyph) + '</button>';
}

function empty(title, explanation, glyph = 'projects') {
  return '<div class="empty"><span>' + icon(glyph) + '</span><strong>' + esc(title) + '</strong><p>' + esc(explanation) + '</p></div>';
}

function input(name, label, value, attrs = '') {
  return '<label class="field"><span>' + esc(label) + '</span><input name="' + name + '" value="' + esc(value) + '" ' + attrs + '></label>';
}

function area(name, label, value, attrs = '') {
  return '<label class="field"><span>' + esc(label) + '</span><textarea name="' + name + '" ' + attrs + '>' + esc(value) + '</textarea></label>';
}

function options(items, current) {
  return items.map(([value, label]) => '<option value="' + esc(value) + '"' +
    (String(value) === String(current ?? '') ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
}

function select(name, label, pairs, current, attrs = '') {
  return '<label class="field"><span>' + esc(label) + '</span><select name="' + name + '" ' + attrs + '>' + options(pairs, current) + '</select></label>';
}

function checkbox(name, label, checked = false) {
  return '<label class="check-field"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
}

function formError(target, message = '') {
  target.textContent = message;
  target.hidden = !message;
}

function bindForm(form, handler) {
  form.onsubmit = async event => {
    event.preventDefault();
    const error = form.querySelector(':scope > .dialog-body > .error') ?? form.querySelector('.error');
    const submit = form.querySelector('button[type=submit]');
    formError(error);
    submit.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (failure) {
      formError(error, failure.message);
    } finally {
      submit.disabled = false;
    }
  };
}

function openModal(title, body, submitLabel, handler, config = {}) {
  if (dialog.open) dialog.close();
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = `<form><div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
    ${iconButton('Закрыть окно', 'close-window', 'close')}</div>
    <div class="dialog-body">${body}${errorLine}</div>
    <div class="dialog-actions">${config.extra ?? ''}<div class="dialog-submit">
    <button class="button" type="button" id="close-button">${submitLabel ? 'Отмена' : 'Закрыть'}</button>
    ${submitLabel ? '<button class="button ' + (config.danger ? 'danger' : 'primary') + '" type="submit">' + esc(submitLabel) + '</button>' : ''}
    </div></div></form>`;
  dialog.querySelector('#close-window').onclick = () => dialog.close();
  dialog.querySelector('#close-button').onclick = () => dialog.close();
  if (handler) bindForm(dialog.querySelector('form'), handler);
  dialog.showModal();
  return dialog;
}

function navigate(hash) {
  if (location.pathname !== '/') return location.assign('/' + hash);
  if (location.hash === hash) return render();
  location.hash = hash;
}

async function loginView(token, version) {
  let info;
  let issue;
  if (token) {
    try { info = await api('/invitations/' + encodeURIComponent(token)); }
    catch (error) { issue = error.message; }
  }
  if (version !== generation) return;
  app.innerHTML = `<main class="login-layout"><section class="login-side"><div>${brand}</div>
    <div class="login-art" aria-hidden="true"><i></i><i></i><img src="/favicon.svg" alt=""></div>
    <div><h1>Задачи команды<br>в одном месте</h1><p>Проекты, исполнители и материалы по задачам.</p></div>
    </section><section class="login-main"><div class="login-card"><div class="mobile-brand">${brand}</div>
    <h2>${token ? 'Приглашение в команду' : 'Вход в BlackCat Tasks'}</h2>
    ${issue ? '<p class="error" role="alert">' + esc(issue) + '</p><a class="button" href="#projects">Ко входу</a>' : `
      <form>${info ? input('email', 'Email', info.email, 'type="email" readonly') + input('name', 'Имя', '', 'required maxlength="100" autocomplete="name"')
        : input('email', 'Email', '', 'type="email" required maxlength="254" autocomplete="email" placeholder="name@company.ru"')}
      ${input('password', 'Пароль', '', 'type="password" required maxlength="200" ' + (info ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'))}
      ${errorLine}<button type="submit" class="button primary">${info ? 'Принять приглашение' : 'Войти'}</button></form>`}
    </div></section></main>`;
  if (issue) return;
  bindForm(app.querySelector('form'), async fields => {
    ({ user } = await api(info ? '/invitations/' + token : '/login', 'POST', fields));
    if (info) navigate('#projects');
    else await render();
  });
}

function projectMark(project, extra = '') {
  const tones = ['violet', 'teal', 'gold', 'blue'];
  return '<span class="project-mark ' + tones[(project.id - 1) % tones.length] + ' ' + extra + '" aria-hidden="true">' + esc(project.code[0]) + '</span>';
}

function shell(projects, current, project, task) {
  const admin = user.role === 'admin';
  const onProjects = current === 'projects';
  const onTeam = current === 'team';
  const pageTitles = { team: 'Команда', admin: 'Администрирование', mine: 'Мои задачи', profile: 'Профиль' };
  app.innerHTML = `<aside class="sidebar">
    <a class="brand-link" href="/#projects" aria-label="BlackCat Tasks — проекты">${brand}</a>
    <nav aria-label="Рабочая область" class="main-nav">
      <a href="/#projects" ${onProjects ? 'aria-current="page"' : ''}>${icon('projects')}Все проекты</a>
      <a href="/#mine" ${current === 'mine' ? 'aria-current="page"' : ''}>${icon('list')}Мои задачи</a>
      ${admin ? '<a href="/#team" ' + (onTeam ? 'aria-current="page"' : '') + '>' + icon('team') + 'Команда</a>' +
        '<a href="/#admin" ' + (current === 'admin' ? 'aria-current="page"' : '') + '>' + icon('settings') + 'Администрирование</a>' : ''}
    </nav>
    <div class="sidebar-heading"><span>Проекты</span>${admin ? iconButton('Новый проект', 'sidebar-new', 'plus') : ''}</div>
    <nav aria-label="Проекты" class="project-nav">${projects.map(item =>
      `<a href="${projectHref(item)}" ${project?.id === item.id ? 'aria-current="page"' : ''}>${projectMark(item)}<span>${esc(item.name)}</span></a>`).join('')}</nav>
    <div class="profile"><a class="profile-link" href="/#profile" aria-label="Мой профиль">${avatar(user.name)}<div><strong>${esc(user.name)}</strong><small>${admin ? 'Администратор' : 'Участник'}</small></div></a>
      ${iconButton('Выйти', 'logout', 'logout')}</div>
    </aside><div class="workspace">
    <header class="topbar">${task ? '<a href="/#projects">Проекты</a>' + icon('chevron') + '<a href="' + projectHref(project) + '">' + esc(project.name) + '</a>' + icon('chevron') + '<strong>' + taskKey(project, task) + '</strong>'
      : project ? '<a href="/#projects">Проекты</a>' + icon('chevron') + '<strong>' + esc(project.name) + '</strong>'
      : '<strong>' + (pageTitles[current] ?? 'Проекты') + '</strong>'}
    </header><main id="content"></main></div>`;
  document.querySelector('#logout').onclick = async () => {
    try {
      await api('/logout', 'POST');
      user = null;
      await render();
    } catch (error) { notice(error.message); }
  };
  if (admin) document.querySelector('#sidebar-new').onclick = projectForm;
  return document.querySelector('#content');
}

function projectForm() {
  openModal('Новый проект',
    input('name', 'Название проекта', '', 'required maxlength="100" placeholder="Например, Личный кабинет"') +
    input('code', 'Ключ проекта', '', 'required maxlength="10" pattern="[A-Za-z][A-Za-z0-9]{0,9}" placeholder="Например, WEB"') +
    area('description', 'Описание проекта', '', 'maxlength="300"'),
    'Создать проект', async fields => {
      const result = await api('/projects', 'POST', fields);
      dialog.close();
      navigate('#project/' + result.id);
      notice('Проект создан');
    });
}

function projectsView(content, projects) {
  const canCreate = user.role === 'admin';
  content.innerHTML = `<div class="page-head"><div><h1>Проекты</h1><p>Откройте проект, чтобы посмотреть задачи и ход работы.</p></div>
    ${canCreate ? button('Создать проект', 'new-project', 'plus', 'primary') : ''}</div>
    ${projects.length ? '<section class="project-grid" aria-label="Список проектов">' + projects.map(item => `
      <a class="panel project-card" href="#project/${item.id}"><div>${projectMark(item)}<span class="project-code">${esc(item.code)}</span></div>
        <h2>${esc(item.name)}</h2>${item.description ? '<p>' + esc(item.description) + '</p>' : ''}
        <div class="project-progress"><progress max="${item.total || 1}" value="${item.done}" aria-label="Выполнено задач"></progress><span>${item.done} / ${item.total} готово</span></div>
      </a>`).join('') + '</section>' : '<section class="panel">' + empty('Проектов пока нет', canCreate ? 'Создайте первый проект, чтобы добавить задачи.' : 'Проекты появятся после настройки администратором.') + '</section>'}`;
  if (canCreate) content.querySelector('#new-project').onclick = projectForm;
}

function projectView(content, { project, fields, tasks }, users) {
  if (viewState.id !== project.id) {
    viewState = { id: project.id, mode: 'board', search: '', priority: 'all', assignee: 'all' };
  }
  content.innerHTML = `<div class="page-head project-head"><div class="project-title">${projectMark(project, 'large')}
    <div><h1>${esc(project.name)}</h1>${project.description ? '<p>' + esc(project.description) + '</p>' : ''}</div></div>
    <div class="page-actions">${user.role === 'admin' ? button('Настройки', 'project-settings', 'settings') : ''}
    ${button('Новая задача', 'new-task', 'plus', 'primary')}</div></div>
    <div class="project-toolbar">
      <div class="tabs" aria-label="Вид задач">
        <button type="button" data-mode="board">${icon('board')}Доска</button>
        <button type="button" data-mode="list">${icon('list')}Список</button>
      </div>
      <div class="filters">
        <label class="search">${icon('search')}<input id="task-search" type="search" aria-label="Поиск задач" placeholder="Поиск задач"></label>
        ${visible(project, 'assignee_id') ? select('filter-assignee', 'Исполнитель', [['all', 'Все исполнители'], ['unassigned', 'Без исполнителя'], ...users.map(item => [item.id, item.name])], viewState.assignee) : ''}
        ${visible(project, 'priority') ? select('filter-priority', 'Приоритет', [['all', 'Любой приоритет'], ...Object.entries(priorities)], viewState.priority) : ''}
      </div>
    </div><section id="task-results" aria-label="Задачи проекта"></section>`;
  const target = content.querySelector('#task-results');
  const searchBox = content.querySelector('#task-search');
  searchBox.value = viewState.search;
  const activeFields = fields.filter(item => !item.archived_at);
  const createTask = status => createTaskForm(project, activeFields, users, tasks, status);
  function draw() {
    const query = viewState.search.trim().toLocaleLowerCase('ru');
    const filtered = tasks.filter(task => (
      !query || [task.title, taskKey(project, task), visible(project, 'description') ? task.description : ''].some(value => value.toLocaleLowerCase('ru').includes(query))
    ) && (!visible(project, 'priority') || viewState.priority === 'all' || task.priority === viewState.priority)
      && (!visible(project, 'assignee_id') || viewState.assignee === 'all' ||
      (viewState.assignee === 'unassigned' && !task.assignee_id) || String(task.assignee_id) === viewState.assignee));
    target.innerHTML = viewState.mode === 'board'
      ? boardView(project, filtered, activeFields, tasks.length > 0)
      : listView(project, filtered, tasks.length > 0);
    target.querySelectorAll('[data-create]').forEach(control => control.onclick = () => createTask(control.dataset.create));
    content.querySelectorAll('[data-mode]').forEach(control => control.setAttribute('aria-pressed', control.dataset.mode === viewState.mode));
  }
  content.querySelectorAll('[data-mode]').forEach(control => control.onclick = () => {
    viewState.mode = control.dataset.mode;
    draw();
  });
  searchBox.oninput = () => { viewState.search = searchBox.value; draw(); };
  for (const [name, key] of [['filter-priority', 'priority'], ['filter-assignee', 'assignee']]) {
    const filter = content.querySelector('[name=' + name + ']');
    if (filter) filter.onchange = () => { viewState[key] = filter.value; draw(); };
  }
  content.querySelector('#new-task').onclick = () => createTask('todo');
  const settings = content.querySelector('#project-settings');
  if (settings) settings.onclick = () => navigate('#admin/' + project.id);
  draw();
}

function priorityBadge(priority) {
  return '<span class="priority ' + priority + '">' + icon('flag') + priorities[priority] + '</span>';
}

function statusBadge(status) {
  const definition = statuses.find(item => item.key === status) ?? { key: status, name: status };
  return '<span class="status ' + statusTone(definition) + '"><i></i>' + esc(definition.name) + '</span>';
}

function boardView(project, tasks, fields, hadTasks) {
  if (hadTasks && !tasks.length) return '<div class="panel">' + empty('Ничего не найдено', 'Измените запрос или сбросьте фильтры.', 'search') + '</div>';
  return '<div class="board">' + statuses.map(definition => {
    const { key: status, name: title } = definition;
    const items = tasks.filter(task => task.status === status);
    return `<section class="lane ${statusTone(definition)}" aria-label="${esc(title)}">
      <div class="lane-head"><i></i><h2>${esc(title)}</h2><span class="lane-count">${items.length}</span>
      <button type="button" class="icon-button" data-create="${esc(status)}" title="Добавить задачу" aria-label="Добавить задачу · ${esc(title)}">${icon('plus')}</button></div>
      <div class="lane-cards">${items.map(task => card(project, task, fields)).join('')}${items.length ? '' : '<p class="lane-empty">Нет задач</p>'}</div>
    </section>`;
  }).join('') + '</div>';
}

function card(project, task, fields) {
  const custom = fields.find(item => item.kind === 'select' && task.custom_values[item.id]);
  return `<a href="${taskPath(project, task)}" class="task-card">
    <div class="task-card-top"><span class="task-key">${taskKey(project, task)}</span>
    ${task.attachment_count ? '<span class="attachments-count" aria-label="Вложений: ' + task.attachment_count + '">' + icon('attach') + task.attachment_count + '</span>' : ''}</div>
    <h3>${esc(task.title)}</h3>
    ${custom ? '<span class="task-component">' + esc(task.custom_values[custom.id]) + '</span>' : ''}
    <div class="card-foot">${visible(project, 'priority') ? priorityBadge(task.priority) : ''}
     ${visible(project, 'assignee_id') ? '<span class="card-assignee" title="' + esc(task.assignee ?? 'Без исполнителя') + '">' +
      avatar(task.assignee, 'small') + '<span class="sr-only">' + esc(task.assignee ?? 'Без исполнителя') + '</span></span>' : ''}</div></a>`;
}

function listView(project, tasks, hadTasks) {
  if (!tasks.length) return '<div class="panel">' +
    (hadTasks ? empty('Ничего не найдено', 'Измените запрос или сбросьте фильтры.', 'search') : empty('Задач пока нет', 'Добавьте первую задачу проекта.', 'list')) + '</div>';
  const priority = visible(project, 'priority');
  const assignee = visible(project, 'assignee_id');
  return `<div class="panel table-wrap"><table><thead><tr><th>Задача</th><th>Статус</th>${priority ? '<th>Приоритет</th>' : ''}
    ${assignee ? '<th>Исполнитель</th>' : ''}<th>Обновлена</th></tr></thead><tbody>
    ${tasks.map(task => `<tr><td><span class="task-key">${taskKey(project, task)}</span><a class="row-title" href="${taskPath(project, task)}">${esc(task.title)}</a></td>
    <td>${statusBadge(task.status)}</td>${priority ? '<td>' + priorityBadge(task.priority) + '</td>' : ''}
    ${assignee ? '<td>' + esc(task.assignee ?? '—') + '</td>' : ''}<td class="muted nowrap">${date(task.updated_at)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function customControl(definition, value) {
  const name = 'custom-' + definition.id;
  const needed = definition.required ? ' required' : '';
  if (definition.kind === 'textarea') return area(name, definition.name, value, 'maxlength="4000"' + needed);
  if (definition.kind === 'select') {
    const pairs = [['', 'Выберите вариант'], ...definition.options.map(option => [option, option])];
    if (value && !definition.options.includes(value)) pairs.push([value, value + ' (прежний вариант)']);
    return select(name, definition.name, pairs, value, needed);
  }
  const attrs = {
    text: 'maxlength="300"', number: 'type="number" step="any"', date: 'type="date"',
    url: 'type="url" maxlength="2048" placeholder="https://"',
  };
  return input(name, definition.name, value, attrs[definition.kind] + needed);
}

function formPayload(form, fields, task) {
  const body = { custom_values: {} };
  for (const [key, value] of Object.entries(form)) {
    if (!key.startsWith('custom-')) body[key] = value;
  }
  for (const definition of fields) {
    const value = form['custom-' + definition.id];
    if (value != null && value !== '') body.custom_values[definition.id] = definition.kind === 'number' ? Number(value) : value;
  }
  if (task) body.version = task.version;
  return body;
}

function attachmentSection() {
  return `<section class="attachments" aria-labelledby="attachments-title"><div class="panel-head"><h2 id="attachments-title">Вложения</h2></div>
    <div class="attachments-body">
    <div id="attachment-items"></div>
    <div class="attachment-actions">
      ${button('Добавить файлы', 'choose-files', 'attach')}
      ${button('Добавить ссылку', 'show-link', 'link')}
      <input type="file" id="upload-files" multiple hidden>
    </div>
    <div id="link-fields" class="link-fields" hidden>
      ${input('link-url', 'Ссылка', '', 'inputmode="url" maxlength="2048" placeholder="https://"')}
      ${input('link-name', 'Название ссылки', '', 'maxlength="240"')}
      ${button('Прикрепить ссылку', 'save-link', 'check')}
    </div>
    <p class="attachment-error error" role="alert" hidden></p><p id="upload-state" class="muted" role="status"></p></div>
  </section>`;
}

function taskInputs(project, fields, users, candidates, task, draftStatus = 'todo', fixedParent) {
  const selectIf = (key, pairs, value) => visible(project, key) ? select(key, builtinNames[key], pairs, value, required(project, key)) : '';
  const inputIf = (key, attrs, fallback) => visible(project, key)
    ? input(key, builtinNames[key], task?.[key] ?? fallback, attrs + required(project, key)) : '';
  const planning = [
    inputIf('category', 'maxlength="120"'),
    inputIf('target_version', 'maxlength="120" placeholder="Например, 1.2.0"'),
    fixedParent ? '' : selectIf('parent_id', [['', 'Без родительской задачи'], ...candidates.map(item => [item.id, taskKey(project, item) + ' · ' + item.title])], task?.parent_id),
    inputIf('start_date', 'type="date"'),
    inputIf('due_date', 'type="date"'),
    inputIf('estimated_hours', 'type="number" min="0" max="999999.99" step="0.01"'),
    inputIf('done_ratio', 'type="number" min="0" max="100" step="1"', 0),
  ].join('');
  return input('title', 'Заголовок', task?.title, 'required maxlength="160" placeholder="Что нужно сделать?"') +
    (visible(project, 'description') ? area('description', 'Описание', task?.description, 'maxlength="12000" rows="4"' + required(project, 'description')) : '') +
    '<div class="form-grid">' +
    select('tracker', 'Тип задачи', Object.entries(trackers), task?.tracker ?? 'task') +
    select('status', 'Статус', statusOptions(), task?.status ?? draftStatus) +
    selectIf('priority', Object.entries(priorities), task?.priority ?? 'normal') +
    inputIf('customer', 'maxlength="180" placeholder="Имя или команда"') +
    selectIf('assignee_id', [['', 'Без исполнителя'], ...users.map(item => [item.id, item.name])], task?.assignee_id) +
    '</div>' +
    (planning ? '<section class="task-section"><h3>Планирование</h3><div class="form-grid">' + planning + '</div></section>' : '') +
    (fields.length ? '<section class="task-section"><h3>Поля проекта</h3><div class="form-grid">' +
      fields.map(definition => customControl(definition, task?.custom_values[definition.id])).join('') + '</div></section>' : '');
}

function createTaskForm(project, fields, users, candidates, draftStatus, parent) {
  const title = parent ? 'Новая подзадача' : 'Новая задача';
  openModal(title, (parent ? '<p class="form-hint">' + taskKey(project, parent) + ' · ' + esc(parent.title) + '</p>' : '') +
    taskInputs(project, fields, users, candidates, null, draftStatus, parent) +
    '<p class="form-hint">' + icon('attach') + 'Вложения можно добавить на странице созданной задачи.</p>',
    parent ? 'Создать подзадачу' : 'Создать задачу', async form => {
      const result = await api(parent ? taskPath(project, parent) + '/subtasks' : taskPath(project), 'POST', formPayload(form, fields));
      location.assign(taskPath(project, result));
    });
}

function calendarLabel(value) {
  return value ? new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value + 'T00:00:00Z')) : '';
}

function customDisplay(definition, value) {
  if (value == null || value === '') return '<span class="prop-empty">—</span>';
  if (definition.kind === 'date') return esc(calendarLabel(value));
  if (definition.kind === 'url') {
    let url;
    try { url = new URL(value); } catch {}
    if (url && ['https:', 'http:'].includes(url.protocol)) {
      return '<a class="text-link" href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">' + esc(value) + '</a>';
    }
  }
  return esc(value);
}

function customPropertyRows(fields, values) {
  return fields.map(definition => '<div><dt>' + esc(definition.name) + '</dt><dd>' +
    customDisplay(definition, values[definition.id]) + '</dd></div>').join('');
}

function taskProperties(project, task, fields) {
  const parent = task.parent_number ? {
    id: task.parent_id, number: task.parent_number, title: task.parent_title,
  } : null;
  const progress = '<div class="task-progress"><progress max="100" value="' + task.done_ratio +
    '" aria-label="Готовность задачи"></progress><span>' + task.done_ratio + '%</span></div>';
  function rows(values) {
    return values.map(([key, markup]) => '<div><dt>' + builtinNames[key] + '</dt><dd>' +
      (markup || '<span class="prop-empty">—</span>') + '</dd></div>').join('');
  }
  const work = [
    ['priority', priorityBadge(task.priority)],
    ['assignee_id', task.assignee ? '<span class="task-person">' + avatar(task.assignee, 'small') + esc(task.assignee) + '</span>' : ''],
    ['customer', esc(task.customer)],
    ['category', esc(task.category)],
    ['target_version', esc(task.target_version)],
    ['parent_id', parent ? '<a class="text-link" href="' + taskPath(project, parent) + '">' +
      taskKey(project, parent) + ' · ' + esc(parent.title) + '</a>' : ''],
  ].filter(([key]) => visible(project, key));
  const planning = [
    ['start_date', calendarLabel(task.start_date)],
    ['due_date', calendarLabel(task.due_date)],
    ['estimated_hours', task.estimated_hours == null ? '' : new Intl.NumberFormat('ru-RU').format(Number(task.estimated_hours)) + ' ч'],
    ['done_ratio', progress],
  ].filter(([key]) => visible(project, key));
  return `<aside class="task-side" aria-label="Свойства задачи">
    <section class="panel task-detail-panel"><div class="panel-head"><h2>Свойства</h2></div>
      <dl class="task-properties"><div><dt>Статус</dt><dd>${statusBadge(task.status)}</dd></div>
        <div><dt>Тип задачи</dt><dd>${trackers[task.tracker]}</dd></div>${rows(work)}</dl>
      ${planning.length ? '<div class="panel-subhead"><h3>Планирование</h3></div><dl class="task-properties">' + rows(planning) + '</dl>' : ''}
    </section>
    ${fields.length ? '<section class="panel task-detail-panel"><div class="panel-head"><h2>Поля проекта</h2></div><dl class="task-properties">' +
      customPropertyRows(fields, task.custom_values) + '</dl></section>' : ''}
  </aside>`;
}

function taskView(content, detail) {
  const { project, task, attachments, children } = detail;
  const fields = detail.fields.filter(item => !item.archived_at);
  const key = taskKey(project, task);
  document.title = key + ' · ' + task.title + ' — BlackCat Tasks';
  content.innerHTML = `<article class="task-page">
    <header class="task-page-head"><div>
      <div class="task-page-labels"><span class="issue-key">${key}</span>${statusBadge(task.status)}</div>
      <h1>${esc(task.title)}</h1>
      <div class="task-byline"><span>${avatar(task.creator, 'small')} Создатель <strong>${esc(task.creator)}</strong></span>
        <span>Создана ${date(task.created_at)}</span><span>Обновлена ${date(task.updated_at)}</span></div>
    </div><div class="page-actions">${button('Редактировать', 'edit-task', 'edit', 'primary')}</div></header>
    <div class="task-detail-grid"><div class="task-main">
      ${visible(project, 'description') ? '<section class="panel task-detail-panel"><div class="panel-head"><h2>Описание</h2></div>' +
        '<div class="task-description' + (task.description ? '' : ' muted') + '">' + esc(task.description || 'Описание пока не добавлено.') + '</div></section>' : ''}
      <div class="panel task-detail-panel">${attachmentSection()}</div>
      <section class="panel task-detail-panel"><div class="panel-head"><h2>Подзадачи</h2>${button('Создать подзадачу', 'new-subtask', 'plus')}</div>
      ${children.length ? '<ul class="subtasks">' +
        children.map(child => '<li><a href="' + taskPath(project, child) + '"><span class="task-key">' + taskKey(project, child) +
          '</span><strong>' + esc(child.title) + '</strong></a>' + statusBadge(child.status) + '</li>').join('') + '</ul>'
        : '<p class="section-body muted">Подзадач пока нет.</p>'}</section>
      ${relationsSection(detail.relations)}
    </div>${taskProperties(project, task, fields)}</div>
    <div class="task-footer"><a class="button" href="${projectHref(project)}">К задачам проекта</a>
      ${button('Удалить задачу', 'delete-task', 'trash', 'subtle-danger')}</div>
  </article>`;
  bindAttachments(content, project, task, attachments);
  const addSubtask = content.querySelector('#new-subtask');
  addSubtask.onclick = async () => {
    addSubtask.disabled = true;
    try {
      const users = await api('/users');
      createTaskForm(project, fields, users, [], 'todo', task);
    } catch (error) {
      notice(error.message);
    } finally {
      addSubtask.disabled = false;
    }
  };
  bindRelations(content, project, task);
  content.querySelector('#delete-task').onclick = () => openModal('Удалить задачу?',
    '<p class="form-hint">Задача ' + key + ' и её вложения будут удалены.</p>', 'Удалить', async () => {
      await api(taskPath(project, task), 'DELETE');
      location.assign(projectHref(project));
    }, { danger: true });
  const edit = content.querySelector('#edit-task');
  edit.onclick = async () => {
    edit.disabled = true;
    try {
      const [users, candidates] = await Promise.all([api('/users'), api(taskPath(project, task) + '/edit-options')]);
      editTaskView(content, detail, fields, users, candidates);
    } catch (error) {
      notice(error.message);
    } finally {
      edit.disabled = false;
    }
  };
}

function relationsSection(items) {
  return `<section class="panel task-detail-panel"><div class="panel-head"><h2>Связанные задачи</h2>${button('Добавить связь', 'new-relation', 'link')}</div>
    ${items.length ? '<ul class="subtasks relation-list">' + items.map(item => `<li><div><small>${relations[item.kind][Number(!item.outgoing)]}</small>
      <a href="${taskPath({ id: item.project_id }, { id: item.task_id })}"><span class="task-key">${esc(item.project_code)}-${item.number}</span><strong>${esc(item.title)}</strong></a></div>
      <div>${statusBadge(item.status)}${iconButton('Удалить связь с ' + item.project_code + '-' + item.number, 'relation-' + item.id, 'close')}</div></li>`).join('') + '</ul>'
    : '<p class="section-body muted">Связей пока нет.</p>'}</section>`;
}

function bindRelations(content, project, task) {
  const root = taskPath(project, task);
  const add = content.querySelector('#new-relation');
  add.onclick = async () => {
    add.disabled = true;
    try {
      const candidates = await api(root + '/relation-options');
      if (!candidates.length) {
        notice('Создайте ещё одну задачу, чтобы добавить связь');
        return;
      }
      openModal('Новая связь',
        select('kind', 'Тип связи', [
          ['relates', 'Связана с'], ['blocks', 'Блокирует'], ['blocked_by', 'Заблокирована задачей'],
          ['duplicates', 'Дублирует'], ['duplicated_by', 'Дублируется задачей'],
        ], 'relates') +
        select('task_id', 'Связанная задача', [['', 'Выберите задачу'], ...candidates.map(item =>
          [item.id, item.project_code + '-' + item.number + ' · ' + item.title])], '', 'required'),
        'Добавить связь', async data => {
          await api(root + '/relations', 'POST', data);
          dialog.close();
          await render();
          notice('Связь добавлена');
        });
    } catch (error) {
      notice(error.message);
    } finally {
      add.disabled = false;
    }
  };
  content.querySelectorAll('.relation-list [id^="relation-"]').forEach(control => control.onclick = () => {
    openModal('Удалить связь?', '<p class="form-hint">Связь исчезнет из обеих задач.</p>', 'Удалить связь', async () => {
      await api(root + '/relations/' + control.id.slice('relation-'.length), 'DELETE');
      dialog.close();
      await render();
      notice('Связь удалена');
    }, { danger: true });
  });
}

function editTaskView(content, detail, fields, users, candidates) {
  const { project, task } = detail;
  content.innerHTML = `<div class="task-page"><header class="task-page-head">
    <div><div class="task-page-labels"><span class="issue-key">${taskKey(project, task)}</span></div><h1>Редактирование задачи</h1></div>
    </header><section class="panel task-edit-panel"><form class="section-body">
      ${taskInputs(project, fields, users, candidates, task)}${errorLine}
      <div class="task-footer">${button('Отмена', 'cancel-task-edit', '')}<button type="submit" class="button primary">Сохранить</button></div>
    </form></section></div>`;
  content.querySelector('[name=title]').focus();
  content.querySelector('#cancel-task-edit').onclick = render;
  bindForm(content.querySelector('form'), async form => {
    await api(taskPath(project, task), 'PATCH', formPayload(form, fields, task));
    await render();
    notice('Задача обновлена');
  });
}

function bindAttachments(element, project, task, attachments) {
  const path = taskPath(project, task) + '/attachments';
  const list = element.querySelector('#attachment-items');
  const errorLine = element.querySelector('.attachment-error');
  const files = element.querySelector('#upload-files');
  const choose = element.querySelector('#choose-files');
  const uploadState = element.querySelector('#upload-state');
  const linkForm = element.querySelector('#link-fields');
  const saveLink = element.querySelector('#save-link');
  const toggle = element.querySelector('#show-link');
  toggle.setAttribute('aria-expanded', 'false');
  element.querySelector('[name=link-url]').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); saveLink.click(); }
  };
  element.querySelector('[name=link-name]').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); saveLink.click(); }
  };

  function redraw() {
    list.innerHTML = attachments.length ? attachments.map(item => {
      const filePath = '/api' + path + '/' + item.id;
      const isImage = item.mime?.startsWith('image/');
      const href = item.url ? esc(item.url) : filePath + (isImage ? '' : '?download=1');
      const details = item.url ? esc(new URL(item.url).hostname) : new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(Math.max(0.1, item.size / 1024)) + ' КБ';
      const visual = isImage ? '<img src="' + filePath + '" alt="" loading="lazy">' : '<span class="attachment-icon">' + icon(item.url ? 'link' : 'file') + '</span>';
      return `<div class="attachment-row"><a href="${href}" ${isImage || item.url ? 'target="_blank" rel="noopener noreferrer"' : ''}>${visual}
        <span><strong>${esc(item.name)}</strong><small>${details}</small></span></a>
        <button type="button" class="icon-button" data-delete-attachment="${item.id}" title="Убрать вложение" aria-label="Убрать вложение ${esc(item.name)}">${icon('close')}</button></div>`;
    }).join('') : '<p class="attachment-empty muted">Вложений пока нет.</p>';
    list.querySelectorAll('[data-delete-attachment]').forEach(control => control.onclick = async () => {
      control.disabled = true;
      formError(errorLine);
      try {
        await api(path + '/' + control.dataset.deleteAttachment, 'DELETE');
        attachments = attachments.filter(item => item.id !== Number(control.dataset.deleteAttachment));
        redraw();
        notice('Вложение удалено');
      } catch (error) {
        formError(errorLine, error.message);
        control.disabled = false;
      }
    });
  }
  choose.onclick = () => files.click();
  files.onchange = async () => {
    const selected = [...files.files];
    if (!selected.length) return;
    choose.disabled = true;
    formError(errorLine);
    const failures = [];
    for (const file of selected) {
      uploadState.textContent = 'Загрузка ' + file.name + '…';
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('размер больше 10 МБ');
        attachments.push(await request(path + '/files', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
        }));
      } catch (error) {
        failures.push(file.name + ' — ' + error.message);
      }
    }
    files.value = '';
    uploadState.textContent = '';
    choose.disabled = false;
    redraw();
    if (failures.length) formError(errorLine, failures.join('\n'));
    if (selected.length > failures.length) notice('Файлы прикреплены');
  };
  toggle.onclick = () => {
    linkForm.hidden = !linkForm.hidden;
    toggle.setAttribute('aria-expanded', String(!linkForm.hidden));
    if (!linkForm.hidden) linkForm.querySelector('[name=link-url]').focus();
  };
  saveLink.onclick = async () => {
    const url = linkForm.querySelector('[name=link-url]');
    const name = linkForm.querySelector('[name=link-name]');
    formError(errorLine);
    saveLink.disabled = true;
    try {
      attachments.push(await api(path + '/links', 'POST', { url: url.value, name: name.value }));
      url.value = name.value = '';
      redraw();
      linkForm.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      notice('Ссылка прикреплена');
    } catch (error) {
      formError(errorLine, error.message);
    } finally {
      saveLink.disabled = false;
    }
  };
  redraw();
}

function adminTabs(current) {
  return '<nav class="admin-tabs tabs" aria-label="Администрирование">' +
    [['projects', '/#admin', 'Поля проектов'], ['tasks', '/#admin/tasks', 'Общие поля задач'],
      ['users', '/#admin/users', 'Поля профилей'], ['statuses', '/#admin/statuses', 'Статусы задач']]
      .map(([key, href, label]) => '<a href="' + href + '"' + (key === current ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') + '</nav>';
}

function adminFieldPanel(fields) {
  const active = fields.filter(item => !item.archived_at);
  const archived = fields.filter(item => item.archived_at);
  const fieldRows = items => '<div class="field-list">' + items.map(definition => `<div class="field-row">
    <span class="field-icon">${icon(definition.archived_at ? 'archive' : definition.kind === 'url' ? 'link' : 'file')}</span>
    <div><strong>${esc(definition.name)}</strong><small>${fieldKinds[definition.kind]}${definition.required ? ' · Обязательное' : ''}</small></div>
    <button type="button" class="button compact" data-edit-field="${definition.id}" aria-label="Настроить поле ${esc(definition.name)}">Настроить</button></div>`).join('') + '</div>';
  return `<section class="panel settings-panel"><div class="panel-head"><h2>Дополнительные поля</h2>${button('Добавить поле', 'add-field', 'plus', 'primary')}</div>
      ${active.length ? fieldRows(active) : empty('Дополнительных полей пока нет', 'Добавьте поля, которые нужны в задачах этого проекта.', 'file')}
      ${archived.length ? '<details class="admin-archived"><summary>Скрытые поля</summary>' + fieldRows(archived) + '</details>' : ''}</section>`;
}

function administrationView(content, projects, data) {
  const project = data?.project;
  const fields = data?.fields ?? [];
  content.innerHTML = `<div class="page-head"><div><h1>Поля проектов</h1>
    <p>Настройки применяются ко всем задачам выбранного проекта.</p></div>
    ${project ? '<a class="button" href="' + projectHref(project) + '">К задачам проекта</a>' : ''}</div>
    ${adminTabs('projects')}
    ${projects.length ? '<div class="admin-project-picker">' + select('admin-project', 'Проект',
      [...(project ? [] : [['', 'Выберите проект']]), ...projects.map(item => [item.id, item.name + ' · ' + item.code])], project?.id) + '</div>' : ''}
    ${project ? `<div class="settings-layout admin-layout">
    ${adminFieldPanel(fields)}
    <section class="panel settings-panel"><div class="panel-head"><h2>Настройки проекта</h2></div>
      <form id="project-config" class="section-body">
      ${input('name', 'Название проекта', project.name, 'required maxlength="100"')}
      ${input('code', 'Ключ проекта', project.code, 'readonly')}
      ${area('description', 'Описание проекта', project.description, 'maxlength="300" rows="2"')}
      <details class="admin-builtin"><summary>Стандартные поля</summary>
        <p class="form-hint">Заголовок, тип задачи, создатель и статус всегда видны.</p>
        <div class="builtin-list">${Object.entries(builtinNames).map(([key, label]) => {
          const config = project.builtin_fields[key];
          const mode = config?.visible === false ? 'hidden' : config?.required ? 'required' : 'visible';
          return select('set-' + key, label, [['visible', 'Показывать'], ['required', 'Обязательное'], ['hidden', 'Скрыть']], mode);
        }).join('')}</div>
      </details>
      ${errorLine}<button type="submit" class="button primary">Сохранить настройки</button></form></section></div>`
      : '<section class="panel">' + (projects.length
        ? empty('Выберите проект', 'Поля настраиваются отдельно для каждого проекта.')
        : empty('Проектов пока нет', 'Создайте проект, чтобы настроить его поля.')) + '</section>'}`;
  const picker = content.querySelector('[name=admin-project]');
  if (picker) picker.onchange = () => navigate(picker.value ? '#admin/' + picker.value : '#admin');
  if (!project) return;
  bindForm(content.querySelector('#project-config'), async form => {
    const builtin_fields = Object.fromEntries(Object.keys(builtinNames).map(key =>
      [key, { visible: form['set-' + key] !== 'hidden', required: form['set-' + key] === 'required' }]));
    await api('/projects/' + project.id, 'PATCH', { name: form.name, description: form.description, builtin_fields });
    await render();
    notice('Настройки сохранены');
  });
  bindFieldPanel(content, fields, {
    path: '/projects/' + project.id + '/fields', title: 'Новое поле проекта', context: project.name,
  });
}

function bindFieldPanel(content, fields, scope) {
  content.querySelector('#add-field').onclick = () => fieldForm(scope);
  content.querySelectorAll('[data-edit-field]').forEach(control => control.onclick = () =>
    fieldForm(scope, fields.find(definition => definition.id === Number(control.dataset.editField))));
}

function fieldForm(scope, definition) {
  const path = scope.path + (definition ? '/' + definition.id : '');
  const kind = definition?.kind ?? 'text';
  const controls = input('name', 'Название поля', definition?.name, 'required maxlength="80" placeholder="Например, Merge Request"') +
    select('kind', 'Тип поля', Object.entries(fieldKinds), kind, definition ? 'disabled' : '') +
    checkbox('required', 'Обязательное поле', definition?.required) +
    '<div id="field-options" ' + (kind === 'select' ? '' : 'hidden') + '>' +
    area('options', 'Варианты списка', definition?.options.join('\n'), 'maxlength="3050" rows="5" placeholder="Один вариант на строку"') + '</div>';
  const element = openModal(definition ? definition.name : scope.title, (scope.context ? '<p class="form-hint">' + esc(scope.context) + '</p>' : '') + controls, definition ? 'Сохранить' : 'Добавить поле',
    async form => {
      await api(path, definition ? 'PATCH' : 'POST', {
        name: form.name, kind: definition?.kind ?? form.kind, required: form.required === 'on',
        options: form.options.split('\n').map(option => option.trim()).filter(Boolean),
      });
      dialog.close();
      await render();
      notice(definition ? 'Поле обновлено' : 'Поле добавлено');
    }, {
      extra: definition ? button(definition.archived_at ? 'Восстановить' : 'Скрыть поле', 'toggle-field', 'archive') : '',
    });
  const kindSelect = element.querySelector('[name=kind]');
  kindSelect.onchange = () => {
    element.querySelector('#field-options').hidden = kindSelect.value !== 'select';
  };
  const toggle = element.querySelector('#toggle-field');
  if (toggle) toggle.onclick = async () => {
    toggle.disabled = true;
    try {
      await api(path, 'PATCH', { archived: !definition.archived_at });
      dialog.close();
      await render();
      notice(definition.archived_at ? 'Поле восстановлено' : 'Поле скрыто');
    } catch (error) {
      formError(element.querySelector('.error'), error.message);
    } finally {
      toggle.disabled = false;
    }
  };
}

function profileFieldsView(content, fields) {
  content.innerHTML = '<div class="page-head"><div><h1>Поля профилей</h1><p>Настройки применяются ко всем профилям пользователей.</p></div></div>' +
    adminTabs('users') + adminFieldPanel(fields);
  bindFieldPanel(content, fields, { path: '/profile-fields', title: 'Новое поле профиля' });
}

function sharedTaskFieldsView(content, fields) {
  content.innerHTML = '<div class="page-head"><div><h1>Общие поля задач</h1><p>Эти поля доступны в задачах всех проектов.</p></div></div>' +
    adminTabs('tasks') + adminFieldPanel(fields);
  bindFieldPanel(content, fields, { path: '/task-fields', title: 'Новое общее поле задач' });
}

function roleName(role) {
  return role === 'admin' ? 'Администратор' : 'Участник';
}

function profileView(content, { profile, fields }) {
  content.innerHTML = `<div class="page-head"><div class="project-title">${avatar(profile.name, 'large')}
    <div><h1>${esc(profile.name)}</h1><p>${esc(profile.job_title || roleName(profile.role))}</p></div></div>
    ${button('Редактировать профиль', 'edit-profile', 'edit', 'primary')}</div>
    <div class="settings-layout">
      <section class="panel"><div class="panel-head"><h2>Личная информация</h2></div>
      <dl class="task-properties"><div><dt>Email</dt><dd>${esc(profile.email)}</dd></div>
        <div><dt>Роль</dt><dd>${roleName(profile.role)}</dd></div>
        <div><dt>Должность</dt><dd>${esc(profile.job_title) || '—'}</dd></div>
        <div><dt>О себе</dt><dd>${esc(profile.bio) || '—'}</dd></div></dl></section>
      ${fields.length ? '<section class="panel"><div class="panel-head"><h2>Дополнительные поля</h2></div><dl class="task-properties">' +
        customPropertyRows(fields, profile.custom_values) + '</dl></section>' : ''}
    </div>`;
  content.querySelector('#edit-profile').onclick = () => openModal('Редактировать профиль',
    input('name', 'Имя', profile.name, 'required maxlength="100" autocomplete="name"') +
    input('job_title', 'Должность', profile.job_title, 'maxlength="120"') +
    area('bio', 'О себе', profile.bio, 'maxlength="4000" rows="4"') +
    fields.map(definition => customControl(definition, profile.custom_values[definition.id])).join(''),
    'Сохранить профиль', async form => {
      const saved = await api('/profiles/' + profile.id, 'PATCH', formPayload(form, fields));
      if (profile.id === user.id) user = { ...user, name: saved.name };
      dialog.close();
      await render();
      notice('Профиль сохранён');
    });
}

function myTasksView(content, tasks) {
  content.innerHTML = `<div class="page-head"><div><h1>Мои задачи</h1><p>Все задачи, назначенные вам в проектах команды.</p></div></div>
    <section class="panel">${tasks.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Задача</th><th>Проект</th><th>Статус</th><th>Срок</th></tr></thead><tbody>${tasks.map(task =>
        `<tr><td><span class="task-key">${esc(task.project_code)}-${task.number}</span>
          <a class="row-title" href="${taskPath({ id: task.project_id }, task)}">${esc(task.title)}</a></td>
        <td><a class="text-link" href="${projectHref({ id: task.project_id })}">${esc(task.project_name)}</a></td>
        <td>${statusBadge(task.status)}</td><td class="muted nowrap">${calendarLabel(task.due_date) || '—'}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Пока нет назначенных задач', 'Здесь появятся задачи, в которых вы указаны исполнителем.', 'list')}</section>`;
}

function statusAdminView(content) {
  content.innerHTML = `<div class="page-head"><div><h1>Статусы задач</h1>
    <p>Статусы доступны во всех проектах. Порядок задаёт расположение колонок на доске.</p></div>
    ${button('Добавить статус', 'add-status', 'plus', 'primary')}</div>${adminTabs('statuses')}
    <section class="panel table-wrap"><table><thead><tr><th>Статус</th><th>Порядок</th><th>Завершение</th><th></th></tr></thead><tbody>
      ${statuses.map(item => `<tr><td>${statusBadge(item.key)}</td><td>${item.position}</td>
        <td>${item.closed ? 'Завершённый' : 'Открытый'}</td><td><button type="button" class="button compact" data-status-key="${esc(item.key)}"
          aria-label="Настроить статус ${esc(item.name)}">Настроить</button></td></tr>`).join('')}
    </tbody></table></section>`;
  content.querySelector('#add-status').onclick = () => statusForm();
  content.querySelectorAll('[data-status-key]').forEach(control => control.onclick = () =>
    statusForm(statuses.find(item => item.key === control.dataset.statusKey)));
}

function statusForm(status) {
  const nextPosition = Math.min(999999, Math.max(0, ...statuses.map(item => item.position)) + 10);
  openModal(status ? 'Настроить статус' : 'Новый статус',
    input('name', 'Название статуса', status?.name, 'required maxlength="60" placeholder="Например, Бэклог"') +
    input('position', 'Порядок', status?.position ?? nextPosition, 'type="number" required min="0" max="999999" step="1"') +
    checkbox('closed', 'Считать задачи в этом статусе завершёнными', status?.closed),
    status ? 'Сохранить статус' : 'Добавить статус', async form => {
      await api(status ? '/statuses/' + status.key : '/statuses', status ? 'PATCH' : 'POST', {
        name: form.name, position: form.position, closed: form.closed === 'on',
      });
      dialog.close();
      await render();
      notice(status ? 'Статус обновлён' : 'Статус добавлен');
    });
}

function teamView(content, data) {
  content.innerHTML = `<div class="page-head"><div><h1>Команда</h1><p>Учётные записи и приглашения в рабочую область.</p></div>
    <div class="page-actions">${button('Пригласить', 'invite-member', 'link')}${button('Создать пользователя', 'new-member', 'plus', 'primary')}</div></div>
    <section class="panel"><div class="panel-head"><h2>Пользователи</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th></th></tr></thead><tbody>${data.users.map(item => `<tr>
      <td><a class="member-name row-title" href="/#profile/${item.id}">${avatar(item.name)}<strong>${esc(item.name)}</strong></a></td>
      <td>${esc(item.email)}</td><td>${roleName(item.role)}</td><td><button type="button" class="button compact" data-role-user="${item.id}"
        aria-label="Изменить роль · ${esc(item.name)}">Изменить роль</button></td></tr>`).join('')}</tbody></table></div></section>
    ${data.invitations.length ? `<section class="panel team-invitations"><div class="panel-head"><h2>Активные приглашения</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Email</th><th>Действует до</th></tr></thead><tbody>
      ${data.invitations.map(item => '<tr><td>' + esc(item.email) + '</td><td>' + date(item.expires_at) + '</td></tr>').join('')}</tbody></table></div></section>` : ''}`;
  content.querySelectorAll('[data-role-user]').forEach(control => control.onclick = () => {
    const account = data.users.find(item => item.id === Number(control.dataset.roleUser));
    openModal('Изменить роль', '<p class="form-hint">' + esc(account.name) + '</p>' +
      select('role', 'Роль', [['member', 'Участник'], ['admin', 'Администратор']], account.role),
      'Сохранить роль', async form => {
        const saved = await api('/team/users/' + account.id + '/role', 'PATCH', form);
        dialog.close();
        if (saved.id === user.id && saved.role !== 'admin') {
          user = { ...user, role: saved.role };
          navigate('#mine');
        } else await render();
        notice('Роль обновлена');
      });
  });
  content.querySelector('#new-member').onclick = () => openModal('Новый пользователь',
    input('name', 'Имя', '', 'required maxlength="100"') +
    input('email', 'Email', '', 'required type="email" maxlength="254" autocomplete="off"') +
    input('password', 'Пароль', '', 'required minlength="12" maxlength="200" type="password" autocomplete="new-password"'),
    'Создать пользователя', async fields => {
      await api('/team/users', 'POST', fields);
      dialog.close();
      await render();
      notice('Пользователь создан');
    });
  content.querySelector('#invite-member').onclick = () => openModal('Пригласить участника',
    input('email', 'Email', '', 'required type="email" maxlength="254"'),
    'Создать ссылку', async fields => {
      const { token } = await api('/team/invitations', 'POST', fields);
      dialog.close();
      await render();
      const link = location.origin + '/#invite/' + token;
      openModal('Приглашение', '<p class="form-hint">Ссылка действует 7 дней.</p>' + input('link', 'Ссылка', link, 'readonly'),
        'Скопировать', async () => {
          try {
            await navigator.clipboard.writeText(link);
            notice('Ссылка скопирована');
          } catch {
            dialog.querySelector('[name=link]').select();
            notice('Скопируйте выделенную ссылку');
          }
        });
    });
}

async function render() {
  const version = ++generation;
  if (dialog.open) dialog.close();
  const [section, projectId, page, oldTaskId] = location.hash.slice(1).split('/');
  const taskRoute = location.pathname.match(/^\/projects\/(\d+)\/tasks\/(\d+)\/?$/);
  if (!user || section === 'invite') {
    await loginView(section === 'invite' ? projectId || 'invalid' : '', version);
    return;
  }
  if (!taskRoute && section === 'project' && page === 'task' && /^\d+$/.test(projectId) && /^\d+$/.test(oldTaskId)) {
    location.replace(taskPath({ id: projectId }, { id: oldTaskId }));
    return;
  }
  document.title = 'BlackCat Tasks';
  try {
    const [projects, detail, workflow] = await Promise.all([
      api('/projects'),
      taskRoute ? api(taskPath({ id: taskRoute[1] }, { id: taskRoute[2] })).catch(error => {
        if (error.status === 404) return null;
        throw error;
      }) : null,
      api('/statuses'),
    ]);
    if (version !== generation) return;
    statuses = workflow;
    if (taskRoute) {
      if (detail) {
        taskView(shell(projects, 'project', detail.project, detail.task), detail);
      } else {
        const project = projects.find(item => String(item.id) === taskRoute[1]);
        const content = shell(projects, 'project', project);
        content.innerHTML = '<div class="panel retry">' + empty('Задача не найдена', 'Проверьте ссылку на задачу.', 'file') +
          '<a class="button" href="' + (project ? projectHref(project) : '/#projects') + '">К проекту</a></div>';
      }
      return;
    }
    if (user.role === 'admin' && (section === 'admin' || (section === 'project' && page === 'settings'))) {
      if (section === 'admin' && projectId === 'statuses') {
        statusAdminView(shell(projects, 'admin'));
        return;
      }
      if (section === 'admin' && projectId === 'users') {
        const fields = await api('/profile-fields');
        if (version === generation) profileFieldsView(shell(projects, 'admin'), fields);
        return;
      }
      if (section === 'admin' && projectId === 'tasks') {
        const fields = await api('/task-fields');
        if (version === generation) sharedTaskFieldsView(shell(projects, 'admin'), fields);
        return;
      }
      const project = projectId ? projects.find(item => String(item.id) === projectId) : projects[0];
      if (project && section !== 'admin') history.replaceState(null, '', '#admin/' + project.id);
      const content = shell(projects, 'admin');
      content.innerHTML = '<p class="loading" role="status">Загрузка…</p>';
      const config = project ? await api('/projects/' + project.id + '/configuration') : null;
      if (version === generation) administrationView(content, projects, config);
      return;
    }
    if (section === 'profile') {
      const data = await api('/profiles/' + (projectId || user.id));
      if (version === generation) profileView(shell(projects, 'profile'), data);
      return;
    }
    if (section === 'mine') {
      const tasks = await api('/my-tasks');
      if (version === generation) myTasksView(shell(projects, 'mine'), tasks);
      return;
    }
    const project = section === 'project' ? projects.find(item => String(item.id) === projectId) : !section ? projects[0] : null;
    if (project) {
      if (!section) history.replaceState(null, '', '#project/' + project.id);
      const content = shell(projects, 'project', project);
      content.innerHTML = '<p class="loading" role="status">Загрузка…</p>';
      const data = await api('/projects/' + project.id);
      if (version !== generation) return;
      const users = await api('/users');
      if (version !== generation) return;
      projectView(content, data, users);
      return;
    }
    if (section === 'team' && user.role === 'admin') {
      const data = await api('/team');
      if (version !== generation) return;
      teamView(shell(projects, 'team'), data);
      return;
    }
    projectsView(shell(projects, 'projects'), projects);
  } catch (error) {
    if (version !== generation) return;
    if (error.status === 401) {
      user = null;
      await render();
      return;
    }
    const content = app.querySelector('#content') ?? app;
    content.innerHTML = '<div class="panel retry">' + empty('Не удалось загрузить страницу', error.message) +
      button('Повторить', 'retry', '') + '</div>';
    content.querySelector('#retry').onclick = render;
  }
}

async function start() {
  try {
    ({ user } = await api('/session'));
    window.addEventListener('hashchange', render);
    await render();
  } catch (error) {
    app.innerHTML = '<main class="startup-error"><h1>BlackCat Tasks</h1><p class="error" role="alert">' + esc(error.message) +
      '</p>' + button('Повторить', 'retry-start', '') + '</main>';
    app.querySelector('#retry-start').onclick = start;
  }
}

start();
