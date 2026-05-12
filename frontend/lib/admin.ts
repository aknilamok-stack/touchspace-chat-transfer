import { apiUrl } from "@/lib/api";

export type AdminMetric = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
};

export type AdminFilter = {
  label: string;
  value: string;
};

export type AdminColumn = {
  key: string;
  label: string;
};

export type AdminRow = Record<string, string>;

export type AdminPanel = {
  title: string;
  items: Array<{
    label: string;
    value: string;
    meta?: string;
  }>;
};

export type AdminInsight = {
  title: string;
  description: string;
};

export type AdminRouteData = {
  eyebrow: string;
  title: string;
  description: string;
  metrics: AdminMetric[];
  filters: AdminFilter[];
  table: {
    columns: AdminColumn[];
    rows: AdminRow[];
    emptyTitle: string;
    emptyDescription: string;
  };
  panels: AdminPanel[];
  insights: AdminInsight[];
};

type RouteConfig = {
  endpoint: string;
  fallback: AdminRouteData;
  map: (payload: any) => AdminRouteData;
};

const numberFormatter = new Intl.NumberFormat("ru-RU");

const formatDate = (value?: string | Date | null) => {
  if (!value) {
    return "Нет данных";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatDuration = (value?: number | null) => {
  if (typeof value !== "number") {
    return "n/a";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  const minutes = value / (60 * 1000);

  if (minutes < 60) {
    return `${minutes.toFixed(1)} мин`;
  }

  return `${(minutes / 60).toFixed(1)} ч`;
};

const asText = (value?: string | number | boolean | null) => {
  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }

  if (typeof value === "number") {
    return numberFormatter.format(value);
  }

  if (!value) {
    return "n/a";
  }

  return value;
};

const overviewFallback: AdminRouteData = {
  eyebrow: "Dashboard",
  title: "Операционный обзор TouchSpace",
  description:
    "Главный экран для контроля потока регистраций, загрузки чатов и качества ответов менеджеров и поставщиков.",
  metrics: [
    { label: "Всего диалогов", value: "248", hint: "За всё demo-окно" },
    { label: "Новые", value: "18", hint: "Нуждаются в реакции" },
    { label: "В работе", value: "57", hint: "Менеджеры и suppliers" },
    { label: "Решённые", value: "173", hint: "Закрытые или resolved", tone: "good" },
    { label: "1-й ответ менеджера", value: "12.4 мин", hint: "Среднее по системе" },
    { label: "Ответ поставщика", value: "2.1 ч", hint: "Среднее по supplier flow" },
    { label: "SLA просрочки", value: "9", hint: "Нужно разобрать", tone: "warn" },
    { label: "Pending registrations", value: "6", hint: "Ждут модерации", tone: "warn" },
  ],
  filters: [
    { label: "Период", value: "Последние 30 дней" },
    { label: "Режим", value: "Pilot / demo" },
    { label: "Источник причин", value: "Keyword placeholder" },
  ],
  table: {
    columns: [
      { key: "date", label: "День" },
      { key: "dialogs", label: "Диалоги" },
      { key: "managers", label: "Нагрузка менеджеров" },
      { key: "suppliers", label: "Нагрузка поставщиков" },
      { key: "signals", label: "Операционный сигнал" },
    ],
    rows: [
      {
        date: "18 мар",
        dialogs: "21",
        managers: "Анна 8 / Екатерина 7 / Михаил 6",
        suppliers: "Karelia 5 / Pergo 3",
        signals: "Рост supplier escalations",
      },
      {
        date: "19 мар",
        dialogs: "28",
        managers: "Анна 11 / Екатерина 9 / Михаил 8",
        suppliers: "Karelia 6 / Alpine Floor 4",
        signals: "Пик по заказам",
      },
      {
        date: "20 мар",
        dialogs: "17",
        managers: "Анна 5 / Екатерина 6 / Михаил 6",
        suppliers: "Karelia 4 / Pergo 2",
        signals: "Стабильно",
      },
    ],
    emptyTitle: "Нет обзорных данных",
    emptyDescription: "Когда появятся диалоги и регистрации, dashboard автоматически наполнится агрегатами.",
  },
  panels: [
    {
      title: "Top причины обращений",
      items: [
        { label: "Статус заказа", value: "64", meta: "placeholder keyword clustering" },
        { label: "Наличие товара", value: "39", meta: "можно заменить AI topic extraction" },
        { label: "Рекламация", value: "18", meta: "высокий приоритет" },
      ],
    },
    {
      title: "Нагрузка по ролям",
      items: [
        { label: "Анна", value: "31 активный диалог", meta: "лидер по потоку" },
        { label: "Karelia", value: "22 supplier запроса", meta: "самый загруженный supplier" },
        { label: "Просрочки", value: "9 случаев", meta: "нужен разбор" },
      ],
    },
  ],
  insights: [
    {
      title: "Что уже future-ready",
      description:
        "Каркас подразумевает server-side analytics, а не вычисления на клиенте. Это позволит без перелома UI подключить materialized views, cron-агрегации или AI-инсайты.",
    },
    {
      title: "Как использовать на демо",
      description:
        "Экран показывает менеджерам и руководству не только список чатов, но и центр операционного управления: где задержки, кто перегружен и какие причины обращений повторяются чаще всего.",
    },
  ],
};

const registrationsFallback: AdminRouteData = {
  eyebrow: "Registrations",
  title: "Модерация новых регистраций",
  description:
    "Операционный список заявок managers и suppliers с быстрым approve/reject flow и возможностью фиксировать комментарий.",
  metrics: [
    { label: "Всего заявок", value: "14" },
    { label: "Pending", value: "6", tone: "warn" },
    { label: "Approved", value: "5", tone: "good" },
    { label: "Rejected", value: "3" },
  ],
  filters: [
    { label: "Роли", value: "manager / supplier" },
    { label: "Статусы", value: "pending / approved / rejected" },
    { label: "Комментарий", value: "Причина отказа optional" },
  ],
  table: {
    columns: [
      { key: "name", label: "Имя" },
      { key: "email", label: "Email" },
      { key: "company", label: "Компания" },
      { key: "role", label: "Роль" },
      { key: "status", label: "Статус" },
      { key: "createdAt", label: "Дата регистрации" },
    ],
    rows: [
      {
        name: "Мария Фомина",
        email: "m.fomina@demo.ru",
        company: "HomeStyle",
        role: "manager",
        status: "pending",
        createdAt: "21 мар, 10:12",
      },
      {
        name: "ООО Karelia",
        email: "ops@karelia.ru",
        company: "Karelia",
        role: "supplier",
        status: "approved",
        createdAt: "20 мар, 16:42",
      },
    ],
    emptyTitle: "Нет новых регистраций",
    emptyDescription: "Когда demo-поток регистраций начнёт заполняться, здесь появятся pending заявки на модерацию.",
  },
  panels: [
    {
      title: "Действия администратора",
      items: [
        { label: "Approve", value: "Активирует доступ", meta: "approved + active" },
        { label: "Reject", value: "Отклоняет заявку", meta: "с комментарием" },
        { label: "Карточка заявки", value: "Проверка данных", meta: "email, company, role" },
      ],
    },
  ],
  insights: [
    {
      title: "Рекомендуемая модель данных",
      description:
        "Для MVP используется отдельная сущность RegistrationRequest, чтобы не перегружать Profile временными статусами заявки и не ломать уже существующие chat-связки.",
    },
  ],
};

const usersFallback: AdminRouteData = {
  eyebrow: "Users",
  title: "Управление пользователями",
  description:
    "Единый каталог admins, managers, suppliers и client-профилей с фильтрами по роли, статусу, компании и периоду.",
  metrics: [
    { label: "Всего профилей", value: "86" },
    { label: "Managers", value: "12" },
    { label: "Suppliers", value: "16" },
    { label: "Blocked", value: "2", tone: "warn" },
  ],
  filters: [
    { label: "Роль", value: "admin / manager / supplier / client" },
    { label: "Статус", value: "active / inactive / blocked / pending_approval" },
    { label: "Компания", value: "Текстовый фильтр" },
    { label: "Дата", value: "Диапазон создания" },
  ],
  table: {
    columns: [
      { key: "name", label: "Имя" },
      { key: "email", label: "Email" },
      { key: "role", label: "Роль" },
      { key: "status", label: "Доступ" },
      { key: "company", label: "Компания" },
      { key: "lastLogin", label: "Последний вход" },
      { key: "activity", label: "Диалоги / запросы" },
    ],
    rows: [
      {
        name: "Анна",
        email: "anna@touchspace.demo",
        role: "manager",
        status: "active",
        company: "TouchSpace",
        lastLogin: "22 мар, 11:45",
        activity: "34 диалога",
      },
      {
        name: "Karelia",
        email: "ops@karelia.ru",
        role: "supplier",
        status: "active",
        company: "Karelia",
        lastLogin: "22 мар, 10:08",
        activity: "18 supplier requests",
      },
    ],
    emptyTitle: "Пользователи ещё не заведены",
    emptyDescription: "После первой модерации и ручного создания пользователей здесь появится единый каталог доступов.",
  },
  panels: [
    {
      title: "Доступные действия",
      items: [
        { label: "Создать вручную", value: "Новый профиль", meta: "для demo onboarding" },
        { label: "Изменить роль", value: "manager / supplier / admin", meta: "через PATCH" },
        { label: "Заблокировать", value: "blocked", meta: "без удаления данных" },
      ],
    },
  ],
  insights: [
    {
      title: "Future-ready слой",
      description:
        "В Profile уже закладываются `lastLoginAt`, `createdByAdminId`, `approvalStatus` и `isActive`, поэтому позже можно достроить полноценный access control без новой миграции концепции.",
    },
  ],
};

const dialogsFallback: AdminRouteData = {
  eyebrow: "Dialogs",
  title: "Контроль всех диалогов",
  description:
    "Read-only список чатов для админа с фильтрами по статусу, менеджеру, поставщику, supplier escalation и нарушениям SLA.",
  metrics: [
    { label: "Всего диалогов", value: "248" },
    { label: "Supplier escalations", value: "72" },
    { label: "SLA breached", value: "9", tone: "warn" },
    { label: "Последнее сообщение", value: "22 мар, 12:04" },
  ],
  filters: [
    { label: "Статус", value: "new / in_progress / waiting_supplier / resolved" },
    { label: "Менеджер", value: "Выбор ответственного" },
    { label: "Поставщик", value: "Выбор supplier" },
    { label: "SLA", value: "Только problem dialogs" },
  ],
  table: {
    columns: [
      { key: "id", label: "ID" },
      { key: "client", label: "Клиент" },
      { key: "manager", label: "Менеджер" },
      { key: "supplier", label: "Поставщик" },
      { key: "status", label: "Статус" },
      { key: "lastMessage", label: "Последнее сообщение" },
      { key: "flags", label: "Флаги" },
    ],
    rows: [
      {
        id: "tsk_4821",
        client: "Клиент #1204",
        manager: "Анна",
        supplier: "Karelia",
        status: "waiting_supplier",
        lastMessage: "22 мар, 11:58",
        flags: "supplier escalation, SLA risk",
      },
      {
        id: "tsk_4814",
        client: "Клиент #1193",
        manager: "Екатерина",
        supplier: "Pergo",
        status: "in_progress",
        lastMessage: "22 мар, 10:41",
        flags: "normal",
      },
    ],
    emptyTitle: "Пока нет диалогов",
    emptyDescription: "После появления первых чатов админ увидит всю историю сообщений и служебные события внутри карточки диалога.",
  },
  panels: [
    {
      title: "Что видно в карточке диалога",
      items: [
        { label: "История сообщений", value: "С ролями и timestamps" },
        { label: "Supplier request", value: "Статус и SLA" },
        { label: "Response metrics", value: "1-й ответ и supplier response" },
      ],
    },
  ],
  insights: [
    {
      title: "Зачем это важно для MVP",
      description:
        "Даже без права редактирования переписки админ уже может разбирать проблемные кейсы, видеть источник задержки и объяснять руководству, где система теряет скорость.",
    },
  ],
};

const analyticsFallback: AdminRouteData = {
  eyebrow: "Analytics",
  title: "Общая аналитика",
  description:
    "Server-side агрегаты по потоку обращений, закрытию, supplier escalations и top topics без расчётов на клиенте.",
  metrics: [
    { label: "Диалоги за период", value: "128" },
    { label: "Новые / решённые", value: "31 / 84" },
    { label: "Среднее закрытие", value: "7.8 ч" },
    { label: "Escalation share", value: "0.34" },
  ],
  filters: [
    { label: "Preset", value: "day / week / month" },
    { label: "Custom", value: "dateFrom / dateTo" },
    { label: "Расчёт", value: "Только backend" },
  ],
  table: {
    columns: [
      { key: "metric", label: "Метрика" },
      { key: "value", label: "Значение" },
      { key: "comment", label: "Комментарий" },
    ],
    rows: [
      { metric: "Диалогов на неделе", value: "128", comment: "Нормальный объём для pilot" },
      { metric: "Среднее 1-го ответа", value: "11.9 мин", comment: "Ниже SLA цели" },
      { metric: "Топ тема", value: "Статус заказа", comment: "Кандидат на FAQ / AI summary" },
    ],
    emptyTitle: "Аналитика пока пуста",
    emptyDescription: "Когда в БД накопится история, backend отдаст агрегаты за выбранный период.",
  },
  panels: [
    {
      title: "Распределение по периодам",
      items: [
        { label: "Утро", value: "38%" },
        { label: "День", value: "44%" },
        { label: "Вечер", value: "18%" },
      ],
    },
    {
      title: "Top topics",
      items: [
        { label: "Статус заказа", value: "52" },
        { label: "Наличие товара", value: "27" },
        { label: "Рекламация", value: "11" },
      ],
    },
  ],
  insights: [
    {
      title: "Следующий шаг",
      description:
        "Когда появится AI-слой, этот раздел можно дополнить sentiment, auto-summary и anomaly detection без изменения базовой навигации или API-контракта страницы.",
    },
  ],
};

const managerAnalyticsFallback: AdminRouteData = {
  ...analyticsFallback,
  eyebrow: "Managers",
  title: "Аналитика по менеджерам",
  description:
    "Срез по качеству работы manager-команды: скорость первого ответа, закрытие, просрочки и эскалации к поставщикам.",
  table: {
    columns: [
      { key: "manager", label: "Менеджер" },
      { key: "handled", label: "Обработано" },
      { key: "inWork", label: "В работе" },
      { key: "firstResponse", label: "1-й ответ" },
      { key: "sla", label: "SLA просрочки" },
      { key: "escalations", label: "Escalations" },
    ],
    rows: [
      {
        manager: "Анна",
        handled: "44",
        inWork: "9",
        firstResponse: "8.2 мин",
        sla: "1",
        escalations: "12",
      },
      {
        manager: "Екатерина",
        handled: "38",
        inWork: "7",
        firstResponse: "10.1 мин",
        sla: "2",
        escalations: "9",
      },
    ],
    emptyTitle: "Нет manager-аналитики",
    emptyDescription: "После накопления диалогов backend посчитает индивидуальные performance-метрики.",
  },
};

const supplierAnalyticsFallback: AdminRouteData = {
  ...analyticsFallback,
  eyebrow: "Suppliers",
  title: "Аналитика по поставщикам",
  description:
    "Контроль supplier response quality: сколько запросов получено, насколько быстро отвечают и где нарушают SLA.",
  table: {
    columns: [
      { key: "supplier", label: "Поставщик" },
      { key: "received", label: "Получено запросов" },
      { key: "answered", label: "Ответили" },
      { key: "avg", label: "Средний ответ" },
      { key: "sla", label: "SLA просрочки" },
      { key: "dialogs", label: "Связанные диалоги" },
    ],
    rows: [
      {
        supplier: "Karelia",
        received: "22",
        answered: "18",
        avg: "1.7 ч",
        sla: "2",
        dialogs: "19",
      },
      {
        supplier: "Pergo",
        received: "11",
        answered: "10",
        avg: "58 мин",
        sla: "0",
        dialogs: "10",
      },
    ],
    emptyTitle: "Нет supplier-аналитики",
    emptyDescription: "Когда менеджеры начнут чаще эскалировать запросы поставщикам, экран наполнится фактическими метриками.",
  },
};

const slaFallback: AdminRouteData = {
  eyebrow: "SLA",
  title: "Контроль качества и SLA",
  description:
    "Операционный срез по проблемным диалогам, менеджерам и поставщикам с наибольшим количеством просрочек.",
  metrics: [
    { label: "Проблемных диалогов", value: "9", tone: "warn" },
    { label: "Avg manager response", value: "12.4 мин" },
    { label: "Avg supplier response", value: "2.1 ч" },
    { label: "Требуют разбора", value: "4 high-risk", tone: "warn" },
  ],
  filters: [
    { label: "Период", value: "День / неделя / custom" },
    { label: "Роль", value: "manager / supplier" },
    { label: "Риск", value: "breached / near breach" },
  ],
  table: {
    columns: [
      { key: "dialog", label: "Диалог" },
      { key: "manager", label: "Менеджер" },
      { key: "supplier", label: "Поставщик" },
      { key: "status", label: "Статус" },
      { key: "lastMessage", label: "Последнее сообщение" },
      { key: "risk", label: "Риск" },
    ],
    rows: [
      {
        dialog: "tsk_4821",
        manager: "Анна",
        supplier: "Karelia",
        status: "waiting_supplier",
        lastMessage: "22 мар, 11:58",
        risk: "supplier SLA breached",
      },
      {
        dialog: "tsk_4799",
        manager: "Михаил",
        supplier: "n/a",
        status: "new",
        lastMessage: "22 мар, 09:03",
        risk: "first response overdue",
      },
    ],
    emptyTitle: "SLA-рисков пока нет",
    emptyDescription: "Как только появятся просрочки, экран покажет problem dialogs и лидеров по нарушениям.",
  },
  panels: [
    {
      title: "Менеджеры с просрочками",
      items: [
        { label: "Михаил", value: "3", meta: "первый ответ" },
        { label: "Екатерина", value: "2", meta: "закрытие" },
      ],
    },
    {
      title: "Поставщики с просрочками",
      items: [
        { label: "Karelia", value: "2", meta: "supplier response" },
        { label: "LabArte", value: "1", meta: "ожидание ответа" },
      ],
    },
  ],
  insights: [
    {
      title: "Почему нужен отдельный раздел SLA",
      description:
        "Руководству и операционной команде нужен не просто список чатов, а точка, где видно, кто именно задерживает response loop и где теряется клиентский опыт.",
    },
  ],
};

const configs: Record<string, RouteConfig> = {
  overview: {
    endpoint: "/admin/overview",
    fallback: overviewFallback,
    map: (payload) => ({
      ...overviewFallback,
      metrics: [
        { label: "Всего диалогов", value: asText(payload?.metrics?.totalDialogs) },
        { label: "Новые", value: asText(payload?.metrics?.newDialogs) },
        { label: "В работе", value: asText(payload?.metrics?.inProgressDialogs) },
        { label: "Решённые", value: asText(payload?.metrics?.resolvedDialogs), tone: "good" },
        { label: "1-й ответ менеджера", value: formatDuration(payload?.metrics?.avgFirstResponseMs) },
        { label: "Ответ поставщика", value: formatDuration(payload?.metrics?.avgSupplierResponseMs) },
        { label: "SLA просрочки", value: asText(payload?.metrics?.slaBreaches), tone: "warn" },
        { label: "Pending registrations", value: asText(payload?.metrics?.pendingRegistrations), tone: "warn" },
      ],
      table: {
        ...overviewFallback.table,
        rows: (payload?.charts?.dialogsByDay ?? []).slice(-7).map((item: any) => ({
          date: asText(item.date),
          dialogs: asText(item.count),
          managers: "Нагрузка доступна в панели ниже",
          suppliers: "Нагрузка доступна в панели ниже",
          signals: "Серверный агрегат по дням",
        })),
      },
      panels: [
        {
          title: "Top причины обращений",
          items: (payload?.charts?.topReasons ?? []).map((item: any) => ({
            label: asText(item.label),
            value: asText(item.count),
            meta: "future AI topic layer",
          })),
        },
        {
          title: "Нагрузка по ролям",
          items: [
            ...(payload?.charts?.managerLoad ?? []).map((item: any) => ({
              label: `Manager ${asText(item.entityId)}`,
              value: `${asText(item.dialogs)} диалога`,
            })),
            ...(payload?.charts?.supplierLoad ?? []).map((item: any) => ({
              label: `Supplier ${asText(item.entityId)}`,
              value: `${asText(item.dialogs)} диалога`,
            })),
          ].slice(0, 6),
        },
      ],
    }),
  },
  registrations: {
    endpoint: "/admin/registrations",
    fallback: registrationsFallback,
    map: (payload) => ({
      ...registrationsFallback,
      metrics: [
        { label: "Всего заявок", value: asText(payload?.summary?.total) },
        { label: "Pending", value: asText(payload?.summary?.pending), tone: "warn" },
        { label: "Approved", value: asText(payload?.summary?.approved), tone: "good" },
        { label: "Rejected", value: asText(payload?.summary?.rejected) },
      ],
      table: {
        ...registrationsFallback.table,
        rows: (payload?.items ?? []).map((item: any) => ({
          name: asText(item.fullName),
          email: asText(item.email),
          company: asText(item.companyName),
          role: asText(item.role),
          status: asText(item.status),
          createdAt: formatDate(item.createdAt),
        })),
      },
    }),
  },
  users: {
    endpoint: "/admin/users",
    fallback: usersFallback,
    map: (payload) => ({
      ...usersFallback,
      metrics: [
        { label: "Всего профилей", value: asText(payload?.total) },
        {
          label: "Managers",
          value: asText((payload?.items ?? []).filter((item: any) => item.role === "manager").length),
        },
        {
          label: "Suppliers",
          value: asText((payload?.items ?? []).filter((item: any) => item.role === "supplier").length),
        },
        {
          label: "Blocked",
          value: asText((payload?.items ?? []).filter((item: any) => item.status === "blocked").length),
          tone: "warn",
        },
      ],
      table: {
        ...usersFallback.table,
        rows: (payload?.items ?? []).map((item: any) => ({
          name: asText(item.fullName),
          email: asText(item.email),
          role: asText(item.role),
          status: asText(item.status),
          company: asText(item.companyName),
          lastLogin: formatDate(item.lastLoginAt),
          activity: `${asText(item.dialogsCount)} / ${asText(item.supplierRequestsCount)}`,
        })),
      },
    }),
  },
  dialogs: {
    endpoint: "/admin/dialogs",
    fallback: dialogsFallback,
    map: (payload) => ({
      ...dialogsFallback,
      metrics: [
        { label: "Всего диалогов", value: asText(payload?.total) },
        {
          label: "Supplier escalations",
          value: asText((payload?.items ?? []).filter((item: any) => item.supplierEscalated).length),
        },
        {
          label: "SLA breached",
          value: asText((payload?.items ?? []).filter((item: any) => item.slaBreached).length),
          tone: "warn",
        },
        { label: "Последнее сообщение", value: formatDate(payload?.items?.[0]?.lastMessageAt) },
      ],
      table: {
        ...dialogsFallback.table,
        rows: (payload?.items ?? []).map((item: any) => ({
          id: asText(item.id),
          client: asText(item.clientName),
          manager: asText(item.managerName),
          supplier: asText(item.supplierName),
          status: asText(item.status),
          lastMessage: formatDate(item.lastMessageAt),
          flags: [item.supplierEscalated ? "supplier escalation" : null, item.slaBreached ? "SLA breached" : null]
            .filter(Boolean)
            .join(", ") || "normal",
        })),
      },
    }),
  },
  analytics: {
    endpoint: "/admin/analytics/overview",
    fallback: analyticsFallback,
    map: (payload) => ({
      ...analyticsFallback,
      metrics: [
        { label: "Диалоги за период", value: asText(payload?.metrics?.dialogs) },
        {
          label: "Новые / решённые",
          value: `${asText(payload?.metrics?.newDialogs)} / ${asText(payload?.metrics?.resolvedDialogs)}`,
        },
        { label: "Среднее закрытие", value: formatDuration(payload?.metrics?.avgCloseTimeMs) },
        { label: "Escalation share", value: asText(payload?.metrics?.escalatedShare) },
      ],
      table: {
        ...analyticsFallback.table,
        rows: [
          {
            metric: "Диалогов за период",
            value: asText(payload?.metrics?.dialogs),
            comment: "Server-side count",
          },
          {
            metric: "Среднее 1-го ответа",
            value: formatDuration(payload?.metrics?.avgFirstResponseMs),
            comment: "По всем диалогам периода",
          },
          {
            metric: "Среднее сообщений на диалог",
            value: asText(payload?.metrics?.avgMessagesPerDialog),
            comment: "Оценка плотности переписки",
          },
        ],
      },
      panels: [
        {
          title: "Распределение по периодам",
          items: (payload?.charts?.dialogsByDay ?? []).slice(-7).map((item: any) => ({
            label: asText(item.date),
            value: asText(item.count),
          })),
        },
        {
          title: "Top topics",
          items: (payload?.charts?.topTopics ?? []).map((item: any) => ({
            label: asText(item.label),
            value: asText(item.count),
          })),
        },
      ],
    }),
  },
  "analytics-managers": {
    endpoint: "/admin/analytics/managers",
    fallback: managerAnalyticsFallback,
    map: (payload) => ({
      ...managerAnalyticsFallback,
      metrics: [
        { label: "Менеджеров в отчёте", value: asText(payload?.items?.length) },
        {
          label: "Обработано диалогов",
          value: asText(
            (payload?.items ?? []).reduce((total: number, item: any) => total + (item.handledDialogs ?? 0), 0),
          ),
        },
        {
          label: "Средний 1-й ответ",
          value: formatDuration(
            Math.round(
              ((payload?.items ?? []).reduce((total: number, item: any) => total + (item.avgFirstResponseMs ?? 0), 0) /
                Math.max((payload?.items ?? []).length, 1)) || 0,
            ),
          ),
        },
        {
          label: "SLA просрочки",
          value: asText(
            (payload?.items ?? []).reduce((total: number, item: any) => total + (item.slaBreaches ?? 0), 0),
          ),
          tone: "warn",
        },
      ],
      table: {
        ...managerAnalyticsFallback.table,
        rows: (payload?.items ?? []).map((item: any) => ({
          manager: asText(item.fullName),
          handled: asText(item.handledDialogs),
          inWork: asText(item.dialogsInWork),
          firstResponse: formatDuration(item.avgFirstResponseMs),
          sla: asText(item.slaBreaches),
          escalations: asText(item.escalationsToSupplier),
        })),
      },
    }),
  },
  "analytics-suppliers": {
    endpoint: "/admin/analytics/suppliers",
    fallback: supplierAnalyticsFallback,
    map: (payload) => ({
      ...supplierAnalyticsFallback,
      metrics: [
        { label: "Поставщиков в отчёте", value: asText(payload?.items?.length) },
        {
          label: "Всего запросов",
          value: asText(
            (payload?.items ?? []).reduce((total: number, item: any) => total + (item.receivedRequests ?? 0), 0),
          ),
        },
        {
          label: "Средний ответ",
          value: formatDuration(
            Math.round(
              ((payload?.items ?? []).reduce((total: number, item: any) => total + (item.avgResponseMs ?? 0), 0) /
                Math.max((payload?.items ?? []).length, 1)) || 0,
            ),
          ),
        },
        {
          label: "SLA просрочки",
          value: asText(
            (payload?.items ?? []).reduce((total: number, item: any) => total + (item.slaBreaches ?? 0), 0),
          ),
          tone: "warn",
        },
      ],
      table: {
        ...supplierAnalyticsFallback.table,
        rows: (payload?.items ?? []).map((item: any) => ({
          supplier: asText(item.fullName),
          received: asText(item.receivedRequests),
          answered: asText(item.answeredRequests),
          avg: formatDuration(item.avgResponseMs),
          sla: asText(item.slaBreaches),
          dialogs: asText(item.relatedDialogs),
        })),
      },
    }),
  },
  sla: {
    endpoint: "/admin/sla",
    fallback: slaFallback,
    map: (payload) => ({
      ...slaFallback,
      metrics: [
        { label: "Проблемных диалогов", value: asText(payload?.summary?.breachedDialogs), tone: "warn" },
        { label: "Avg manager response", value: formatDuration(payload?.summary?.avgManagerResponseMs) },
        { label: "Avg supplier response", value: formatDuration(payload?.summary?.avgSupplierResponseMs) },
        { label: "Требуют разбора", value: asText(payload?.problemDialogs?.length), tone: "warn" },
      ],
      table: {
        ...slaFallback.table,
        rows: (payload?.problemDialogs ?? []).map((item: any) => ({
          dialog: asText(item.id),
          manager: asText(item.assignedManagerName),
          supplier: asText(item.supplierName),
          status: asText(item.status),
          lastMessage: formatDate(item.lastMessageAt),
          risk: "breached",
        })),
      },
      panels: [
        {
          title: "Менеджеры с просрочками",
          items: (payload?.topManagers ?? []).map((item: any) => ({
            label: asText(item.name),
            value: asText(item.breaches),
          })),
        },
        {
          title: "Поставщики с просрочками",
          items: (payload?.topSuppliers ?? []).map((item: any) => ({
            label: asText(item.name),
            value: asText(item.breaches),
          })),
        },
      ],
    }),
  },
};

export async function getAdminRouteData(routeKey: string) {
  const config = configs[routeKey];

  if (!config) {
    throw new Error(`Unknown admin route key: ${routeKey}`);
  }

  try {
    const response = await fetch(apiUrl(config.endpoint), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
      data: config.map(payload),
      error: null,
    };
  } catch (error) {
    return {
      data: config.fallback,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
