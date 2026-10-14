# Handoff: Архитектура, инструменты и изменения ПерУН (1C Agent)

Документ фиксирует текущее состояние кодовой базы, реализованные инструменты, изменения в системных промптах и готовность к разработке проектов на платформе 1С:Предприятие.

---

## 1. Сводка статуса

- **Все тесты пакета 1c-agent**: 97 из 97 тестов пройдены успешно (`node node_modules/vitest/dist/cli.js --run packages/1c-agent/test`).
- **Проверка типов TypeScript**: `npx tsc --noEmit` выполняется с кодом 0 (0 ошибок по всему монорепозиторию).
- **Комплексная проверка репозитория**: `npm run check` выполняется с кодом 0 (Biome, pinned-deps, runtime-deps, ts-imports, entry-graphs, install-lock, tsc, browser-smoke).
- **Бинарный дистрибутив**: Скомпилирован автономный Mach-O arm64 бинарник [packages/1c-agent/bin/perun](file:///Users/kenny/Work/pi/packages/1c-agent/bin/perun) (87.8 MB) и ESM-бандл [packages/1c-agent/bin/perun.bundle.mjs](file:///Users/kenny/Work/pi/packages/1c-agent/bin/perun.bundle.mjs).
- **Комплектация бинарника**: В каталоге [packages/1c-agent/bin](file:///Users/kenny/Work/pi/packages/1c-agent/bin) рядом с исполняемым файлом размещены:
  - `tools/`:
    - встроенный `bsl-analyzer` (нативный Mach-O arm64 бинарник).
    - официальная внешняя обработка `vanessa/vanessa-automation.epf`.
    - чистый поиск `vrunner` и `oscript` через системный `$PATH` и переменные `VRUNNER_PATH` / `OSCRIPT_PATH` (без костылей и мостов; при отсутствии выдается понятная ошибка со способом установки).
  - `skills/`: 81 навык из библиотеки `cc-1c-skills` (Николай Широков).
  - `theme/`: системные темы `dark.json` и `light.json` (с fallback в памяти).
  - `export-html/` и `assets/`: шаблоны экспорта сессий.

---

## 2. Реализованные инструменты 1С

Все специализированные инструменты изолированы в пакете `packages/1c-agent` и не загрязняют ядро Pi.

### 2.1. `1c_vanessa` — управление ИБ и BDD-тестирование (контракт vrunner 3.0+)
- **Расположение**: [packages/1c-agent/src/vanessa/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/vanessa/tools.ts), [runner.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/vanessa/runner.ts), [types.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/vanessa/types.ts).
- **Назначение**: Пакетная автоматизация операций с конфигурацией через актуальный стек Vanessa Runner 3.0+ (Autumn CLI):
  - `init-dev` (`infobase-init`): `vrunner infobase init --src [src] --ibconnection [conn]`.
  - `load` (`cf-load`): `vrunner cf load --ibconnection [conn] [src]` (позиционный параметр пути источника).
  - `dump` (`cf-dump`): `vrunner cf decompile --ibconnection [conn] [out]` (позиционный параметр каталога выгрузки).
  - `updatedb` (`infobase-update`): `vrunner infobase update --src [src] --ibconnection [conn]`.
  - `test` (`test-vanessa`): `vrunner test vanessa --feature-path [path] --bddrunner-path [epf] --ibconnection [conn]`.
- **Особенности реализации**:
  - Полное соответствие CLI vrunner 3.0+ (дефисные опции `--db-user`, `--db-pwd`, позиционные параметры исходников).
  - На macOS автоматически передается `--v8version <версия>`, а также задаются переменные окружения `VRUNNER_V8PATH` и `VRUNNER_V8VERSION` для преодоления ограничений v8find.
  - Если `vrunner` отсутствует в `$PATH`, выводится ясная инструкция по установке без падений с `ENOENT`.

### 2.2. `toolchain-resolver` — резолвер окружения
- **Расположение**: [packages/1c-agent/src/toolchain/resolver.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/toolchain/resolver.ts).
- **Назначение**: Разрешение путей ко всем встроенным и системным утилитам:
  - `bsl-analyzer`: ищет в `bin/tools/bsl-analyzer`, переменной `BSL_ANALYZER_PATH`, системном PATH (`/usr/local/bin/bsl-analyzer`).
  - `vrunner` и `oscript`: разрешает через `VRUNNER_PATH` / `OSCRIPT_PATH` или системный PATH.
  - `vanessa-automation.epf`: находит встроенную обработку в `tools/vanessa/vanessa-automation.epf`.
  - `onec-enterprise`: автодетектирует платформу 1С с корректной сортировкой версий (`compareVersionStrings`: `8.3.27 > 8.3.9`).
  - `ibcmd`: обнаружение утилиты `ibcmd` платформы 1С.

### 2.3. `bsl_fix_standards` — автофиксер стандартов 1С:ИТС
- **Расположение**: [packages/1c-agent/src/autofix/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/autofix/tools.ts), [rules.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/autofix/rules.ts), [patcher.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/autofix/patcher.ts).
- **Назначение**: Статический анализ BSL и применение безопасных diff-патчей:
  - Исправление пустых блоков `Попытка - Исключение` (EmptyExcept).
  - Удаление неиспользуемых локальных переменных (UnusedVariable).
  - Генерация BSLDoc-шаблонов для недокументированных экспортных процедур/функций (MissingBSLDoc).
  - Предупреждение и исправление модальных вызовов в серверном контексте (ServerModalCall).
  - Выявление запросов внутри циклов (QueryInLoop).

### 2.4. `1c_call_hierarchy` — граф вызовов
- **Расположение**: [packages/1c-agent/src/navigator/call-hierarchy.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/navigator/call-hierarchy.ts), [tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/navigator/tools.ts).
- **Назначение**: Построение графа входящих (`incoming`) и исходящих (`outgoing`) вызовов для любой процедуры или функции BSL с номерами строк и путями к файлам.

### 2.5. `1c_impact_analysis` — анализ связанности и влияния
- **Расположение**: [packages/1c-agent/src/navigator/impact-analysis.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/navigator/impact-analysis.ts).
- **Назначение**: Комплексный анализ зависимостей: какие документы, регистры накопления/сведений и обработчики `ОбработкаПроведения` затрагиваются при изменении указанного метода или реквизита.

### 2.6. `1c_ast_symbols` — быстрое извлечение AST
- **Расположение**: [packages/1c-agent/src/navigator/ast-parser.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/navigator/ast-parser.ts).
- **Назначение**: Моментальное синтаксическое извлечение процедур, функций, директив (&НаСервере, &НаКлиенте), параметров и текстов запросов SDBL без полного чтения файла.

### 2.7. Встроенный фоновый LSP-демон `bsl-analyzer`
- **Расположение**: [packages/1c-agent/src/lsp/client.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/client.ts), [feedback.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/feedback.ts).
- **Назначение**: При каждом изменении файлов `.bsl` и `.os` через `write` или `edit` фоновый демон LSP мгновенно возвращает диагностику синтаксиса и ошибок ИТС прямо в ответе инструмента (inline feedback loop).

### 2.8. Субагенты 1С (`1c_subagent`)
- **Расположение**: [packages/1c-agent/src/subagents/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/tools.ts), [roles.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/roles.ts).
- **Назначение**: Запуск изолированных подсессий для параллельной работы:
  - `1c-architect`: проектирование метаданных и схем данных.
  - `1c-coder`: разработка чистого BSL-кода.
  - `1c-tester`: создание BDD feature-файлов и тестов YAXUnit.
  - `1c-reviewer`: аудит качества и стандартов ИТС.

### 2.9. `perun --doctor` / `/doctor` — диагностика готовности тулчейна
- **Расположение**: [packages/1c-agent/src/doctor/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/doctor/index.ts), [cli.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/cli.ts).
- **Назначение**: Комплексная проверка готовности всех компонентов:
  1. Платформа 1С:Предприятие (1cv8 / 1cv8t).
  2. bsl-analyzer (нативный статический анализатор / LSP).
  3. vrunner (Vanessa Runner).
  4. oscript (интерпретатор OneScript).
  5. vanessa-automation.epf (обработка BDD).
  6. ibcmd (консольная утилита).
  7. CC-1C-SKILLS (встроенные навыки 1С).
  8. Каталог встроенных инструментов (tools).
- **Формат запуска**: CLI флаг `./packages/1c-agent/bin/perun --doctor`, подкоманда `./packages/1c-agent/bin/perun doctor`, либо слэш-команда `/doctor` в интерактивной сессии.

---

## 3. Интеграция библиотеки навыков `cc-1c-skills`

- **Каталог**: [packages/1c-agent/skills](file:///Users/kenny/Work/pi/packages/1c-agent/skills).
- **Состав**: 82 специализированных навыка на Python для полного цикла 1С-разработки:
  - Управляемые формы: `form-add`, `form-edit`, `form-compile`, `form-validate`, `form-decompile`.
  - Метаданные (23 типа): `meta-compile`, `meta-edit`, `meta-info`, `meta-validate`, `meta-remove`.
  - Схемы компоновки данных: `skd-compile`, `skd-edit`, `skd-validate`, `skd-info`.
  - Макеты табличных документов: `mxl-compile`, `mxl-edit`, `mxl-validate`, `mxl-info`.
  - Роли и права: `role-compile`, `role-edit`, `role-validate`.
  - Внешние обработки и отчеты: `epf-init`, `epf-build`, `epf-validate`, `erf-init`, `erf-build`.
  - Расширения: `cfe-init`, `cfe-borrow`, `cfe-patch-method`, `cfe-validate`.
- **Автообнаружение**: В хуке `resources_discover` расширения ПерУН прописана отдача каталога навыков агенту.

---

## 4. Обновления системного промпта и инструкций

В [packages/coding-agent/src/core/system-prompt.ts](file:///Users/kenny/Work/pi/packages/coding-agent/src/core/system-prompt.ts), [packages/1c-agent/src/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts) и [packages/1c-agent/src/modes/prompts.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts):

1. **Action Bias (OpenCode Mentality)**:
   - Категорический запрет черновиков кода в мыслях (`<think>`). Модель формулирует гипотезу в 1-2 строки и сразу вызывает инструменты.
   - Запрет поиска `bsl-analyzer` через bash: модель проинформирована, что анализатор уже встроен и работает как фоновый демон.
2. **Матрица инструментов**:
   - Четко зафиксированы триггеры вызова для `1c_vanessa`, `bsl_fix_standards`, `1c_call_hierarchy`, `1c_impact_analysis`, `1c_ast_symbols`.
3. **Делегирование субагентам**:
   - Модели дано прямое указание разделять комплексные задачи между субагентами `1c-architect`, `1c-coder`, `1c-tester`, `1c-reviewer`.
4. **Стандарты 1C:EDT**:
   - Строгий запрет на ручное создание сложных XML-форм интерфейса (использование автоформ платформы и headless-модулей).
   - Обязательная установка управляемых блокировок `БлокировкаДанных` перед чтением остатков в `ОбработкаПроведения`.

---

## 5. Следующие шаги для продолжения

1. **Разработка проекта MiniCRM** (в формате 1C:EDT):
   - Справочники: `Клиенты`, `Номенклатура`, `Склады`.
   - Регистры накопления: `ОстаткиНоменклатуры` (Остатки), `РезервыНоменклатуры` (Остатки).
   - Документы: `ПоступлениеТоваров`, `ЗаказКлиента` (с резервированием и проверкой остатков), `ОтгрузкаТоваров` (с частичной отгрузкой и списанием резерва/остатка).
   - BDD-тесты Vanessa Automation (`features/MiniCRM.feature`).
2. **Проверка через `1c_vanessa`**:
   - Создание базы через `1c_vanessa` (`action: "init-dev"`).
   - Загрузка исходников через `1c_vanessa` (`action: "load"`).
   - Обновление БД через `1c_vanessa` (`action: "updatedb"`).
   - Прогон BDD-тестов через `1c_vanessa` (`action: "test"`).
