export default function ChatAppLandingPage() {
  return (
    <main
      dangerouslySetInnerHTML={{
        __html: `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

  #ts-chat-app-landing {
    --bg: #F5F5F7;
    --card: #FFFFFF;
    --text: #1E1E1E;
    --muted: #6E6E73;
    --line: rgba(30,30,30,0.08);
    --blue: #0A84FF;
    --blue-dark: #0066CC;
    --shadow: 0 12px 40px rgba(17, 24, 39, 0.08);
    --radius-xl: 28px;
    --radius-lg: 20px;
    --radius-md: 16px;
    font-family: 'Montserrat', Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 32px 16px 64px;
    overflow: hidden;
  }

  #ts-chat-app-landing * { box-sizing: border-box; }
  #ts-chat-app-landing a { text-decoration: none; }
  #ts-chat-app-landing .ts-wrap { max-width: 1180px; margin: 0 auto; }
  #ts-chat-app-landing .ts-topbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; padding: 14px 18px;
    background: rgba(255,255,255,0.72); border: 1px solid rgba(255,255,255,0.7); backdrop-filter: blur(16px);
    border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,0.04);
  }
  #ts-chat-app-landing .ts-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  #ts-chat-app-landing .ts-brand-mark {
    width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, #0A84FF 0%, #4DA3FF 100%);
    display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 16px;
    box-shadow: 0 10px 20px rgba(10,132,255,0.22); flex: 0 0 auto;
  }
  #ts-chat-app-landing .ts-brand-text { min-width: 0; }
  #ts-chat-app-landing .ts-brand-title { font-size: 15px; font-weight: 800; line-height: 1.1; margin-bottom: 2px; letter-spacing: 0.01em; }
  #ts-chat-app-landing .ts-brand-sub { font-size: 12px; color: var(--muted); line-height: 1.2; }
  #ts-chat-app-landing .ts-mini-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 16px; border-radius: 999px;
    background: #fff; border: 1px solid var(--line); color: var(--text); font-size: 13px; font-weight: 700; transition: .25s ease; white-space: nowrap;
  }
  #ts-chat-app-landing .ts-mini-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.07); }
  #ts-chat-app-landing .ts-hero {
    position: relative; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 24px; padding: 40px;
    background: radial-gradient(circle at top right, rgba(10,132,255,0.14), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.92));
    border: 1px solid rgba(255,255,255,0.85); border-radius: 36px; box-shadow: var(--shadow); overflow: hidden;
  }
  #ts-chat-app-landing .ts-hero::before,
  #ts-chat-app-landing .ts-hero::after { content: ""; position: absolute; border-radius: 999px; filter: blur(40px); pointer-events: none; }
  #ts-chat-app-landing .ts-hero::before { width: 240px; height: 240px; right: -60px; top: -70px; background: rgba(10,132,255,0.16); }
  #ts-chat-app-landing .ts-hero::after { width: 180px; height: 180px; left: -40px; bottom: -60px; background: rgba(0,102,204,0.09); }
  #ts-chat-app-landing .ts-eyebrow {
    display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px; background: rgba(10,132,255,0.08);
    color: var(--blue-dark); font-size: 13px; font-weight: 700; margin-bottom: 18px;
  }
  #ts-chat-app-landing .ts-h1 { margin: 0 0 16px; font-size: clamp(34px, 5vw, 58px); line-height: 1.02; letter-spacing: -0.03em; font-weight: 800; max-width: 720px; }
  #ts-chat-app-landing .ts-h1 .accent { color: var(--blue); }
  #ts-chat-app-landing .ts-lead { margin: 0 0 22px; max-width: 620px; font-size: 17px; line-height: 1.65; color: var(--muted); }
  #ts-chat-app-landing .ts-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
  #ts-chat-app-landing .ts-btn {
    display: inline-flex; align-items: center; justify-content: center; min-height: 54px; padding: 0 22px;
    border-radius: 16px; font-size: 15px; font-weight: 700; transition: .25s ease; cursor: pointer;
  }
  #ts-chat-app-landing .ts-btn-primary { background: linear-gradient(180deg, #1C90FF 0%, #0A84FF 100%); color: #fff; box-shadow: 0 14px 26px rgba(10,132,255,0.28); }
  #ts-chat-app-landing .ts-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 18px 30px rgba(10,132,255,0.34); }
  #ts-chat-app-landing .ts-btn-secondary { background: rgba(255,255,255,0.88); border: 1px solid var(--line); color: var(--text); }
  #ts-chat-app-landing .ts-btn-secondary:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(0,0,0,0.07); }
  #ts-chat-app-landing .ts-btn-muted { background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.18); color: rgba(255,255,255,0.92); }
  #ts-chat-app-landing .ts-btn-muted:hover { transform: translateY(-2px); }
  #ts-chat-app-landing .ts-pills { display: flex; flex-wrap: wrap; gap: 10px; }
  #ts-chat-app-landing .ts-pill {
    padding: 11px 14px; background: rgba(255,255,255,0.9); border: 1px solid var(--line); border-radius: 999px;
    font-size: 13px; font-weight: 700; color: #3B3B3F;
  }
  #ts-chat-app-landing .ts-phone-wrap { display: flex; align-items: center; justify-content: center; }
  #ts-chat-app-landing .ts-phone {
    width: min(100%, 420px); background: linear-gradient(180deg, #0F1115 0%, #171B22 100%); border-radius: 34px; padding: 14px;
    box-shadow: 0 30px 70px rgba(10, 20, 35, 0.26); position: relative;
  }
  #ts-chat-app-landing .ts-phone::before {
    content: ""; position: absolute; top: 11px; left: 50%; transform: translateX(-50%); width: 120px; height: 24px; border-radius: 999px; background: #0A0B0F;
  }
  #ts-chat-app-landing .ts-screen { background: linear-gradient(180deg, #F8FAFD 0%, #EEF3F9 100%); border-radius: 24px; padding: 18px; min-height: 620px; overflow: hidden; }
  #ts-chat-app-landing .ts-appbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 18px; }
  #ts-chat-app-landing .ts-appbar-title { font-size: 15px; font-weight: 800; }
  #ts-chat-app-landing .ts-status {
    display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 999px; background: rgba(10,132,255,0.08);
    color: var(--blue-dark); font-size: 12px; font-weight: 700;
  }
  #ts-chat-app-landing .ts-dot { width: 8px; height: 8px; border-radius: 50%; background: #22C55E; }
  #ts-chat-app-landing .ts-chatlist { display: grid; gap: 12px; margin-bottom: 16px; }
  #ts-chat-app-landing .ts-chatitem,
  #ts-chat-app-landing .ts-info-card {
    background: rgba(255,255,255,0.95); border: 1px solid rgba(17,24,39,0.06); border-radius: 18px; box-shadow: 0 10px 24px rgba(18, 28, 45, 0.05);
  }
  #ts-chat-app-landing .ts-chatitem { padding: 14px; }
  #ts-chat-app-landing .ts-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  #ts-chat-app-landing .ts-user { display: flex; align-items: center; gap: 10px; }
  #ts-chat-app-landing .ts-avatar {
    width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #D9ECFF, #B8DAFF); color: #0A5FC2;
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; flex: 0 0 auto;
  }
  #ts-chat-app-landing .ts-user-name { font-size: 14px; font-weight: 700; margin-bottom: 3px; }
  #ts-chat-app-landing .ts-user-sub { font-size: 12px; color: var(--muted); }
  #ts-chat-app-landing .ts-tag {
    padding: 7px 10px; background: rgba(10,132,255,0.08); border-radius: 999px; font-size: 11px; font-weight: 800; color: var(--blue-dark); white-space: nowrap;
  }
  #ts-chat-app-landing .ts-message { font-size: 13px; color: #424245; line-height: 1.55; }
  #ts-chat-app-landing .ts-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  #ts-chat-app-landing .ts-info-card { padding: 14px; }
  #ts-chat-app-landing .ts-info-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  #ts-chat-app-landing .ts-info-value { font-size: 15px; font-weight: 800; line-height: 1.35; }
  #ts-chat-app-landing .ts-section { margin-top: 26px; }
  #ts-chat-app-landing .ts-section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
  #ts-chat-app-landing .ts-kicker { display: inline-block; font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--blue); margin-bottom: 10px; }
  #ts-chat-app-landing .ts-h2 { margin: 0; font-size: clamp(28px, 3vw, 40px); line-height: 1.08; letter-spacing: -0.03em; font-weight: 800; }
  #ts-chat-app-landing .ts-subtext { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 560px; }
  #ts-chat-app-landing .ts-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  #ts-chat-app-landing .ts-card {
    background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.92));
    border: 1px solid rgba(255,255,255,0.85); border-radius: var(--radius-xl); box-shadow: var(--shadow); padding: 24px; position: relative; overflow: hidden;
  }
  #ts-chat-app-landing .ts-card::after {
    content: ""; position: absolute; width: 180px; height: 180px; right: -60px; top: -70px; border-radius: 50%;
    background: rgba(10,132,255,0.06); filter: blur(10px); pointer-events: none;
  }
  #ts-chat-app-landing .ts-card-icon {
    width: 54px; height: 54px; border-radius: 16px; background: linear-gradient(135deg, #EAF4FF, #D7EAFF); color: #0A5FC2;
    display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;
  }
  #ts-chat-app-landing .ts-card-title { margin: 0 0 10px; font-size: 24px; line-height: 1.1; font-weight: 800; letter-spacing: -0.02em; }
  #ts-chat-app-landing .ts-card-desc { margin: 0 0 16px; font-size: 15px; line-height: 1.65; color: var(--muted); }
  #ts-chat-app-landing .ts-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  #ts-chat-app-landing .ts-list li { position: relative; padding-left: 22px; font-size: 14px; line-height: 1.55; color: #33343A; }
  #ts-chat-app-landing .ts-list li::before {
    content: ""; position: absolute; left: 0; top: 8px; width: 10px; height: 10px; border-radius: 50%;
    background: linear-gradient(135deg, #0A84FF, #4DA3FF); box-shadow: 0 0 0 4px rgba(10,132,255,0.08);
  }
  #ts-chat-app-landing .ts-feature-grid { margin-top: 18px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  #ts-chat-app-landing .ts-feature { background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 18px; box-shadow: 0 8px 22px rgba(0,0,0,0.04); }
  #ts-chat-app-landing .ts-feature-title { font-size: 15px; font-weight: 800; margin-bottom: 8px; }
  #ts-chat-app-landing .ts-feature-text { font-size: 13px; line-height: 1.55; color: var(--muted); }
  #ts-chat-app-landing .ts-install {
    margin-top: 26px; background: linear-gradient(135deg, #0A84FF 0%, #0066CC 100%); color: #fff; border-radius: 34px; padding: 34px;
    position: relative; overflow: hidden; box-shadow: 0 26px 60px rgba(10,132,255,0.28);
  }
  #ts-chat-app-landing .ts-install::before {
    content: ""; position: absolute; width: 280px; height: 280px; border-radius: 50%; right: -60px; top: -110px;
    background: rgba(255,255,255,0.12); filter: blur(4px);
  }
  #ts-chat-app-landing .ts-install-grid { position: relative; z-index: 2; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; align-items: center; }
  #ts-chat-app-landing .ts-install .ts-kicker { color: rgba(255,255,255,0.75); }
  #ts-chat-app-landing .ts-install .ts-h2 { color: #fff; }
  #ts-chat-app-landing .ts-install .ts-subtext { color: rgba(255,255,255,0.84); max-width: 640px; }
  #ts-chat-app-landing .ts-install-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
  #ts-chat-app-landing .ts-btn-white { background: #fff; color: #0A5FC2; box-shadow: 0 12px 24px rgba(0,0,0,0.10); }
  #ts-chat-app-landing .ts-btn-white:hover { transform: translateY(-2px); }
  #ts-chat-app-landing .ts-note { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.92); font-size: 13px; font-weight: 600; }
  #ts-chat-app-landing .ts-install-card { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(12px); border-radius: 26px; padding: 22px; }
  #ts-chat-app-landing .ts-install-list { display: grid; gap: 12px; }
  #ts-chat-app-landing .ts-install-item { display: flex; align-items: start; gap: 12px; color: #fff; }
  #ts-chat-app-landing .ts-install-badge {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 12px; background: rgba(255,255,255,0.16);
    display: flex; align-items: center; justify-content: center; font-weight: 800;
  }
  #ts-chat-app-landing .ts-install-item strong { display: block; margin-bottom: 3px; font-size: 14px; }
  #ts-chat-app-landing .ts-install-item span { display: block; font-size: 13px; line-height: 1.55; color: rgba(255,255,255,0.82); }
  #ts-chat-app-landing .ts-footer { margin-top: 18px; text-align: center; color: #7A7A80; font-size: 12px; line-height: 1.5; }
  @media (max-width: 1024px) {
    #ts-chat-app-landing .ts-hero,
    #ts-chat-app-landing .ts-install-grid,
    #ts-chat-app-landing .ts-cards,
    #ts-chat-app-landing .ts-feature-grid { grid-template-columns: 1fr; }
    #ts-chat-app-landing .ts-phone-wrap { order: -1; }
    #ts-chat-app-landing .ts-screen { min-height: auto; }
  }
  @media (max-width: 768px) {
    #ts-chat-app-landing { padding: 18px 10px 44px; }
    #ts-chat-app-landing .ts-topbar { border-radius: 22px; padding: 14px; }
    #ts-chat-app-landing .ts-mini-btn { display: none; }
    #ts-chat-app-landing .ts-hero,
    #ts-chat-app-landing .ts-card,
    #ts-chat-app-landing .ts-install { padding: 22px; border-radius: 26px; }
    #ts-chat-app-landing .ts-h1 { font-size: 34px; }
    #ts-chat-app-landing .ts-lead { font-size: 15px; }
    #ts-chat-app-landing .ts-info-grid { grid-template-columns: 1fr; }
  }
</style>

<div id="ts-chat-app-landing">
  <div class="ts-wrap">
    <div class="ts-topbar">
      <div class="ts-brand">
        <div class="ts-brand-mark">TS</div>
        <div class="ts-brand-text">
          <div class="ts-brand-title">TouchSpace Chat App</div>
          <div class="ts-brand-sub">единое пространство общения для реселлеров, менеджеров и производителей</div>
        </div>
      </div>
      <a class="ts-mini-btn" href="#install-app">Скачать приложение</a>
    </div>

    <section class="ts-hero">
      <div>
        <div class="ts-eyebrow">Новый формат коммуникации внутри TouchSpace</div>
        <h1 class="ts-h1">
          Вся рабочая переписка —
          <span class="accent">в одном приложении</span>
        </h1>
        <p class="ts-lead">
          TouchSpace Chat App помогает быстрее решать вопросы по товарам, заказам, наличию и отгрузкам.
          Без потери сообщений, без долгих цепочек писем и без хаоса в коммуникации.
        </p>

        <div class="ts-actions">
          <a href="#install-app" class="ts-btn ts-btn-primary">Скачать для macOS и Windows</a>
          <a href="#about-app" class="ts-btn ts-btn-secondary">Кратко о возможностях</a>
        </div>

        <div class="ts-pills">
          <div class="ts-pill">Диалоги в одном окне</div>
          <div class="ts-pill">Быстрый ответ клиенту</div>
          <div class="ts-pill">Для реселлеров и производителей</div>
          <div class="ts-pill">История общения сохраняется</div>
        </div>
      </div>

      <div class="ts-phone-wrap">
        <div class="ts-phone">
          <div class="ts-screen">
            <div class="ts-appbar">
              <div class="ts-appbar-title">TouchSpace Chat</div>
              <div class="ts-status"><span class="ts-dot"></span> онлайн</div>
            </div>
            <div class="ts-chatlist">
              <div class="ts-chatitem">
                <div class="ts-chat-head">
                  <div class="ts-user">
                    <div class="ts-avatar">AR</div>
                    <div>
                      <div class="ts-user-name">АрхПроект</div>
                      <div class="ts-user-sub">Запрос по наличию и срокам</div>
                    </div>
                  </div>
                  <div class="ts-tag">новое</div>
                </div>
                <div class="ts-message">Добрый день. Подскажите, есть ли остатки по этой позиции и какая ближайшая дата поставки?</div>
              </div>
              <div class="ts-chatitem">
                <div class="ts-chat-head">
                  <div class="ts-user">
                    <div class="ts-avatar">LP</div>
                    <div>
                      <div class="ts-user-name">LabArte Partner</div>
                      <div class="ts-user-sub">Согласование заказа</div>
                    </div>
                  </div>
                  <div class="ts-tag">в работе</div>
                </div>
                <div class="ts-message">Подтвердили объём. Можем отправить счёт и зафиксировать резерв на складе.</div>
              </div>
            </div>
            <div class="ts-info-grid">
              <div class="ts-info-card">
                <div class="ts-info-label">Преимущество</div>
                <div class="ts-info-value">Меньше потерянных сообщений и быстрее ответ клиенту</div>
              </div>
              <div class="ts-info-card">
                <div class="ts-info-label">Формат работы</div>
                <div class="ts-info-value">Один инструмент вместо мессенджеров и длинной почты</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="ts-section" id="about-app">
      <div class="ts-section-head">
        <div>
          <div class="ts-kicker">О приложении</div>
          <h2 class="ts-h2">Коротко и по делу</h2>
        </div>
        <p class="ts-subtext">
          Приложение создано для быстрой, понятной и рабочей коммуникации между участниками платформы TouchSpace.
        </p>
      </div>

      <div class="ts-feature-grid">
        <div class="ts-feature">
          <div class="ts-feature-title">Единое окно общения</div>
          <div class="ts-feature-text">Все рабочие диалоги собраны в одном месте, без необходимости переключаться между разными сервисами.</div>
        </div>
        <div class="ts-feature">
          <div class="ts-feature-title">Быстрые ответы</div>
          <div class="ts-feature-text">Менеджеры и поставщики могут оперативно отвечать по товарам, заказам, остаткам и условиям поставки.</div>
        </div>
        <div class="ts-feature">
          <div class="ts-feature-title">Прозрачная история</div>
          <div class="ts-feature-text">Вся переписка сохраняется, поэтому к диалогу легко вернуться в любой момент.</div>
        </div>
        <div class="ts-feature">
          <div class="ts-feature-title">Рабочий инструмент</div>
          <div class="ts-feature-text">Приложение помогает быстрее доводить общение до результата и не терять важные детали.</div>
        </div>
      </div>
    </section>

    <section class="ts-section">
      <div class="ts-cards">
        <div class="ts-card">
          <div class="ts-card-icon">🛍️</div>
          <h3 class="ts-card-title">Для реселлера</h3>
          <p class="ts-card-desc">
            Удобный способ быстро задать вопрос и получить ответ по товару, срокам, наличию и заказу — без лишних переходов и долгих ожиданий.
          </p>
          <ul class="ts-list">
            <li>Быстрый контакт по нужному вопросу прямо в приложении</li>
            <li>Понятная история общения по каждой теме</li>
            <li>Удобно уточнять наличие, условия и детали заказа</li>
            <li>Меньше риска потерять сообщение или забыть договорённость</li>
          </ul>
        </div>
        <div class="ts-card">
          <div class="ts-card-icon">🏭</div>
          <h3 class="ts-card-title">Для производителя</h3>
          <p class="ts-card-desc">
            Инструмент для более быстрой обработки обращений, точной коммуникации с клиентами и более комфортной работы команды.
          </p>
          <ul class="ts-list">
            <li>Быстрая реакция на входящие запросы</li>
            <li>Единое пространство для общения менеджеров и клиентов</li>
            <li>Сохранение истории по каждому диалогу</li>
            <li>Удобнее контролировать качество и скорость ответов</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="ts-install" id="install-app">
      <div class="ts-install-grid">
        <div>
          <div class="ts-kicker">Установка</div>
          <h2 class="ts-h2">Установите приложение и начните работу</h2>
          <p class="ts-subtext">
            Выберите свою платформу и скачайте установочный файл приложения TouchSpace Chat App.
          </p>

          <div class="ts-install-actions">
            <a href="/downloads/touchspace-macos.zip" download class="ts-btn ts-btn-white">Скачать для macOS</a>
            <a href="/downloads/touchspace-windows.exe" download class="ts-btn ts-btn-white">Скачать для Windows</a>
            <a href="#about-app" class="ts-btn ts-btn-secondary" style="background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.18); color: #fff;">Сначала посмотреть возможности</a>
          </div>

          <div class="ts-note">
            Для macOS и Windows используются отдельные установочные файлы. Если одна из ссылок не открывается, значит соответствующий установщик ещё не загружен на сервер.
          </div>
        </div>

        <div class="ts-install-card">
          <div class="ts-install-list">
            <div class="ts-install-item">
              <div class="ts-install-badge">1</div>
              <div>
                <strong>Скачайте приложение</strong>
                <span>Выберите нужную платформу и загрузите установочный файл.</span>
              </div>
            </div>
            <div class="ts-install-item">
              <div class="ts-install-badge">2</div>
              <div>
                <strong>Установите TouchSpace</strong>
                <span>После установки сотрудники смогут быстро перейти к рабочей переписке.</span>
              </div>
            </div>
            <div class="ts-install-item">
              <div class="ts-install-badge">3</div>
              <div>
                <strong>Начните общение в одном окне</strong>
                <span>Вопросы, ответы и история диалогов будут собраны в одном месте.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="ts-footer">
      TouchSpace Chat App · современный рабочий инструмент для быстрой коммуникации внутри платформы
    </div>
  </div>
</div>`,
      }}
    />
  );
}
