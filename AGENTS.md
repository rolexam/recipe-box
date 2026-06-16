## STYLE
- CommonJS-модули, именованные экспорты
- Никаких console.log в коммитах

## GOTCHAS
- better-sqlite3 синхронный — не оборачивай в async без нужды
- Порядок Express-middleware важен: парсеры до роутов

## ARCH_DECISIONS
- Всё состояние в SQLite, без in-memory кэшей
- Один Express-роутер на модуль-фичу

## TEST_STRATEGY
- Интеграционные тесты (supertest) важнее юнитов для роутов
- Каждая новая фича приходит со своим тестом
