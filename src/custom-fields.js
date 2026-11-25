import { field, requireThat } from './http.js';

const fieldKinds = ['text', 'textarea', 'number', 'date', 'select', 'url'];

export function choice(value, list, name) {
  requireThat(list.includes(value), 400, 'Проверьте поле «' + name + '».');
  return value;
}

export function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function webLink(value, label) {
  let url;
  try { url = new URL(value); } catch {}
  requireThat(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password,
    400, 'Укажите ссылку с http:// или https:// в поле «' + label + '».');
  return url;
}

export function fieldDefinition(body, previous) {
  const name = field(body.name, 'Название поля', 80);
  const kind = previous?.kind ?? choice(body.kind, fieldKinds, 'Тип поля');
  requireThat(!previous || body.kind == null || body.kind === previous.kind, 400, 'Тип существующего поля изменить нельзя.');
  requireThat(typeof body.required === 'boolean', 400, 'Укажите, обязательно ли поле.');
  let options = [];
  if (kind === 'select') {
    requireThat(Array.isArray(body.options) && body.options.length >= 1 && body.options.length <= 30,
      400, 'Укажите от 1 до 30 вариантов списка.');
    options = [...new Set(body.options.map(option => field(option, 'Вариант списка', 100)))];
  }
  return [name, kind, body.required, options];
}

function customValue(value, definition, previous) {
  const label = definition.name;
  if (value === undefined || value === null || value === '') {
    requireThat(!definition.required, 400, 'Заполните поле «' + label + '».');
    return null;
  }
  if (definition.kind === 'number') {
    requireThat(typeof value === 'number' && Number.isFinite(value), 400, 'Введите число в поле «' + label + '».');
    return value;
  }
  const limit = { textarea: 4000, url: 2048 }[definition.kind] ?? 300;
  const text = field(value, label, limit, definition.required);
  if (!text) return null;
  if (definition.kind === 'select' && text !== previous) choice(text, definition.options, label);
  if (definition.kind === 'date') calendarDate(text, label);
  if (definition.kind === 'url') return field(webLink(text, label).href, label, limit);
  return text;
}

export function calendarDate(value, label) {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : new Date(NaN);
  requireThat(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && !value.startsWith('0000'),
    400, 'Введите дату в поле «' + label + '».');
  return value;
}

export function customValues(fields, supplied, previous) {
  const data = supplied ?? {};
  requireThat(object(data), 400, 'Проверьте дополнительные поля.');
  const active = fields.filter(item => !item.archived_at);
  const keys = new Set(active.map(item => String(item.id)));
  requireThat(Object.keys(data).every(key => keys.has(key)), 400, 'Дополнительные поля изменились. Обновите страницу.');
  const values = { ...previous };
  for (const definition of active) {
    const key = definition.id;
    const value = customValue(data[key], definition, values[key]);
    if (value === null) delete values[key];
    else values[key] = value;
  }
  return values;
}
