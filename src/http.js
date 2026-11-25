export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireThat(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

export function field(value, label, max, required = true) {
  if (value === undefined && !required) return '';
  requireThat(typeof value === 'string' && !value.includes('\0'), 400, 'Проверьте поле «' + label + '».');
  const trimmed = value.trim();
  requireThat(trimmed.length <= max && (trimmed || !required), 400, 'Проверьте поле «' + label + '».');
  return trimmed;
}

export function id(value) {
  const number = Number(value);
  requireThat(/^\d+$/.test(String(value)) && Number.isInteger(number) && number > 0 && number <= 2_147_483_647,
    400, 'Некорректный идентификатор.');
  return number;
}

export async function readBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, 'Слишком большой запрос.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function readBody(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Ожидается JSON.');
  try {
    const value = JSON.parse((await readBytes(req, 262_144)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Некорректный JSON.');
  }
}
