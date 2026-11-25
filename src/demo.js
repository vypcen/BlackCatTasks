import { transaction } from './db.js';

const projects = [
  {
    code: 'A', name: 'Проект А', description: 'Личный кабинет и клиентские сценарии.',
    tasks: [
      ['Спроектировать страницу профиля', 'Продумать редактирование имени, контактов и фотографии.', 'todo', 'high'],
      ['Добавить уведомления о заказе', 'Показать изменения статуса заказа в личном кабинете.', 'todo', 'normal'],
      ['Подготовить макеты пустых состояний', 'Подготовить состояния для списка заказов и избранного.', 'todo', 'low'],
      ['Собрать форму восстановления пароля', 'Проверить состояния формы и обработку ошибок.', 'doing', 'high'],
      ['Обновить фильтры истории заказов', 'Добавить фильтр по периоду и статусу заказа.', 'doing', 'normal'],
      ['Проверить обновление контактных данных', 'Проверить валидацию email и номера телефона.', 'review', 'normal'],
      ['Настроить маршрутизацию кабинета', 'Подключить разделы профиля, заказов и уведомлений.', 'done', 'normal'],
    ],
  },
  {
    code: 'B', name: 'Проект Б', description: 'Внутренние инструменты для команды операций.',
    tasks: [
      ['Настроить очередь входящих заявок', 'Определить порядок сортировки заявок и доступные фильтры.', 'doing', 'high'],
      ['Подготовить шаблон отчёта', 'Согласовать состав показателей и примеры строк.', 'todo', 'normal'],
    ],
  },
];

export async function seedDemo() {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(67392001)');
    const admin = (await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")).rows[0];
    if (!admin) throw new Error('Сначала настройте первого администратора.');
    if ((await db.query('SELECT 1 FROM projects LIMIT 1')).rowCount) return;

    for (const project of projects) {
      const created = (await db.query(
        'INSERT INTO projects (code, name, description, created_by, next_task_number) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [project.code, project.name, project.description, admin.id, project.tasks.length + 1])).rows[0];
      for (const [index, [title, description, status, priority]] of project.tasks.entries()) {
        await db.query(`
          INSERT INTO tasks (project_id, number, title, description, creator_id, assignee_id, status, priority,
            created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - $9::int * interval '1 day', now() - $9::int * interval '1 hour')
        `, [created.id, index + 1, title, description, admin.id, index < 2 ? null : admin.id, status, priority, index]);
      }
    }
  });
}
