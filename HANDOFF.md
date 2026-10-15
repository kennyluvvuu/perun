# Handoff: Реализация улучшений и устранение дефектов ПерУН (Epics 1–4)

Данный документ фиксирует результаты реализации комплекса задач по устранению дефектов, выявленных в ходе самодиагностики агента ПерУН ([diagnostics.md](file:///Users/kenny/Work/pi/diagnostics.md)) и декомпозированных в [TASKS.md](file:///Users/kenny/Work/pi/TASKS.md).

---

## 1. Общий обзор и контекст

В ходе разработки проекта MiniCRM агент ПерУН зафиксировал 25 инцидентов (E1–E25) и инцидент I-01. После анализа они были разделены на три группы:
1. **Host/Окружение (Out of Scope)**: E4, E16, E17 (поиск учебной платформы `1cv8t` в `vrunner`/`v8find`) и E11 (headless-запуск GUI на macOS без WindowServer). Решаются настройкой симлинков хоста (`/opt/1cv8`).
2. **Прикладной код MiniCRM (Closed)**: E9, E10, E22, E23, E24 (ошибки BSL/СКД в коде тестовой конфигурации).
3. **Дефекты ядра ПерУН (Epics 1–4)**: реализованы и верифицированы на 100%.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ПЕРУН (1C-AGENT)                               │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│ Epic 1: BSL & LSP    │ Epic 2: Навыки и     │ Epic 3: Режимы и субагенты   │
│ - Рекурсивный детект │   генерация форм     │ - Техническая блокировка      │
│ - XML + EDT проекты  │ - form-compile алиас │   мутаций в explain/plan      │
│ - Ленивый подъем LSP │ - Инвариант ChildItem│ - Санитайзер DSML-разметки    │
│ - CLI-fallback       │ - 1c_skill_execute   │ - 5-частный контракт ответа   │
├──────────────────────┴──────────────────────┴───────────────────────────────┤
│ Epic 4: Безопасность, язык и границы задач                                  │
│ - Принудительный strict для путей вне projectRoot                           │
│ - Пин языка ответа, правило границы артефакта, запрет find / и otool        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Epic 1: Диагностика BSL и Inline LSP

### Проблема и связанные инциденты
- **Инциденты**: E20, E21, E25, I-01.
- **Симптом**: В проектах с XML-выгрузкой Конфигуратора (`src/Configuration.xml`) демон `bsl-analyzer` не запускался, так как функция детекта проверяла только корень и не знала про `Configuration.xml`. Путь к утилите не пробрасывался при создании расширения без опций. При правках файлов `.bsl` результат инструмента не содержал диагностик, что ошибочно воспринималось агентом как «код чист».

### Реализованные решения
1. **Универсальный детектор проектов 1С**:
   - Функция [`detect1cProject(directory, maxDepth = 2)`](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts#L226-L274) поддерживает как EDT (`Configuration.mdo`), так и XML-выгрузки Конфигуратора (`Configuration.xml` в корне или в `src/`), а также выполняет рекурсивный поиск файлов `.bsl`/`.os` до глубины 2 уровней (пропуская служебные директории вроде `.git`, `node_modules`, `build`).
2. **Ленивый жизненный цикл LSP-клиента**:
   - В [`BslLspClient.start()`](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/client.ts#L36-L70) добавлен ленивый резолв пути к утилите: `this.executablePath ??= resolveBslAnalyzerPath(this.executablePath)`.
   - Внедрен `startingPromise` для устранения race conditions при одновременных вызовах старта.
   - В хуке `tool_result` в [`packages/1c-agent/src/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts#L190-L208) при первой записи/правке `.bsl`/`.os`, если клиент еще не готов, автоматически запускается `detect1cProject` и подъем `lspClient.start(projectRoot)`.
3. **CLI-fallback и исключение молчания канала**:
   - В [`InlineFeedbackHandler`](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/feedback.ts#L79-L135) реализован разовый статический анализ через внешнюю CLI-команду (`bsl-analyzer analyze -s <file>`), если LSP-демон не готов.
   - Добавлен парсер вывода CLI (`parseCliDiagnostics`) для структурирования замечаний.
   - Исключено молчание канала: если замечаний нет, выводится `[bsl-analyzer]: Ошибок не обнаружено`; если утилита отсутствует — явное предупреждение `[bsl-analyzer]: Статический анализ недоступен (bsl-analyzer не обнаружен)`.

### Измененные файлы
- [`packages/1c-agent/src/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts)
- [`packages/1c-agent/src/lsp/client.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/client.ts)
- [`packages/1c-agent/src/lsp/feedback.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/feedback.ts)
- Тесты: [`packages/1c-agent/test/lsp-client.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/lsp-client.test.ts), [`packages/1c-agent/test/lsp-feedback.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/lsp-feedback.test.ts), [`packages/1c-agent/test/extension.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/extension.test.ts).

---

## 3. Epic 2: Генерация артефактов 1С и типизированный runner навыков

### Проблема и связанные инциденты
- **Инциденты**: E6, E7, E8.
- **Симптом**: Навык `form-add.py` создавал каркас с `Purpose: Object`, а компилятор `form-compile.py` принимал только `Item`, падая с кодом 1. В результате на диске оставался пустой `Form.xml` с `<ChildItems/>`, затиравший платформенные автоформы. Вызов через bash с конвейерами (`python3 ... | tail -2`) скрывал ненулевой код завершения.

### Реализованные решения
1. **Алиас Purpose и инвариант непустых форм**:
   - В [`form-compile.py`](file:///Users/kenny/Work/pi/packages/1c-agent/skills/form-compile/scripts/form-compile.py#L29-L42) добавлена нормализация: если для Catalog или Document передан `Purpose: Object`, он автоматически транслируется в `Item`.
   - Добавлен резервный парсер на `xml.etree.ElementTree` при отсутствии `lxml`.
   - Внедрена строгая валидация артефакта: если тег `<ChildItems>` пуст или представлен самозакрывающимся `<ChildItems/>`, файл удаляется с диска, а скрипт завершается с кодом 1 и ошибкой в `stderr`.
2. **Типизированный инструмент `1c_skill_execute`**:
   - В [`packages/1c-agent/src/skills/tools.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/skills/tools.ts) реализован инструмент прямого запуска скриптов навыков через `child_process.spawn`.
   - Полный перехват `stdout`, `stderr` и реального кода завершения без потерь статусов конвейера.
   - Встроенный валидатор `validateFormArtifact`, инспектирующий `Form.xml` после компиляции.
   - При ошибках скрипта возвращается `isError: true` с полным описанием ошибки.

### Измененные файлы
- [`packages/1c-agent/skills/form-compile/scripts/form-compile.py`](file:///Users/kenny/Work/pi/packages/1c-agent/skills/form-compile/scripts/form-compile.py)
- [`packages/1c-agent/bin/skills/form-compile/scripts/form-compile.py`](file:///Users/kenny/Work/pi/packages/1c-agent/bin/skills/form-compile/scripts/form-compile.py)
- [`packages/1c-agent/src/skills/tools.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/skills/tools.ts)
- [`packages/1c-agent/src/skills/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/skills/index.ts)
- Тесты: [`packages/1c-agent/test/skills.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/skills.test.ts) (21 тест).

---

## 4. Epic 3: Изоляция режимов ПерУН и субагенты

### Проблема и связанные инциденты
- **Инциденты**: E12, E13, E14, E15.
- **Симптом**: В режиме `ОБЪЯСНИТЬ` агент продолжал модифицировать файлы, так как `bash` и `1c_skill_execute` не входили в `MUTATING_TOOLS`. Динамическое удаление инструментов через `setActiveTools` приводило к дезориентации агента (`Tool bash not found`). Субагент `1c_subagent` возвращал сырую разметку `<｜｜DSML｜｜ ...>` вместо читаемого ответа. В режиме объяснения выдавались директивные инструкции вместо анализа.

### Реализованные решения
1. **Техническая блокировка мутаций и стабильный toolset**:
   - В [`MUTATING_TOOLS`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/types.ts#L15) включены: `edit`, `write`, `bash`, `bsl_fix_standards`, `1c_vanessa`, `1c_skill_execute`.
   - В [`ModeManager.checkToolCall`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/index.ts#L112-L138) любые мутирующие инструменты блокируются в режимах `find`, `explain`, `plan` с понятным сообщением и предложением переключиться в режим `НАПИСАТЬ`.
   - Исключено удаление инструментов из реестра (toolset остается стабильным).
2. **Санитайзинг вывода субагента**:
   - В [`packages/1c-agent/src/subagents/tools.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/tools.ts#L174-L241) реализована функция `sanitizeSubagentOutput`, которая очищает ответ от тегов `<｜｜DSML｜｜ ...>`, XML `<tool_call>` и токенов DeepSeek, преобразуя их в структурированный текст вида `[Вызов инструмента: ...]`.
   - В промптах ролей [`SUBAGENT_ROLES`](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/roles.ts) зафиксирован строгий запрет генерации сырой разметки tool-call.
3. **5-частный контракт ответа в режиме ОБЪЯСНИТЬ**:
   - В [`MODE_PROMPTS.explain`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts#L114-L126) закреплена обязательная структура ответа:
     1. *Симптом* — наблюдаемое проявление.
     2. *Трасса* — файлы, строки, цепочки вызовов с цитатами.
     3. *Причина* — механизм возникновения.
     4. *Следствия* — архитектурное влияние на регистры и проведение.
     5. *Верификация* — проверка гипотезы без изменения файлов.
   - Блок «Как исправить» разрешен строго в конце с пометкой о переключении в режим `НАПИСАТЬ`.

### Измененные файлы
- [`packages/1c-agent/src/modes/types.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/types.ts)
- [`packages/1c-agent/src/modes/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/index.ts)
- [`packages/1c-agent/src/modes/prompts.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts)
- [`packages/1c-agent/src/subagents/roles.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/roles.ts)
- [`packages/1c-agent/src/subagents/tools.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/tools.ts)
- [`packages/1c-agent/src/subagents/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/index.ts)
- Тесты: [`packages/1c-agent/test/modes.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/modes.test.ts), [`packages/1c-agent/test/subagents.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/subagents.test.ts).

---

## 5. Epic 4: Безопасность окружения, язык и границы задач

### Проблема и связанные инциденты
- **Инциденты**: E1, E2, E3, E5, E18, E19.
- **Симптом**: В режиме `auto-approve` агент молча менял чужие библиотеки OneScript в `~/.local/share/onescript/` (E5), запускал тяжелый `find /` по всему диску (E1), дизассемблировал бинарники через `strings`/`otool` (E2, E3), переходил на китайский язык при русском диалоге (E18), самовольно расширял задачу с 1 файла на 8 (E19).

### Реализованные решения
1. **Принудительный strict-режим для путей вне projectRoot**:
   - В [`packages/1c-agent/src/permissions/policy.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/policy.ts) реализована функция `extractTargetPath`, инспектирующая ключи аргументов (`path`, `file_path`, `filePath`, `targetPath`, `outputPath`, `cwd` и т.д.).
   - Функция `isPathInsideProject` валидирует принадлежность пути рабочему каталогу с учетом тильды (`~`).
   - Если путь находится за пределами `projectRoot`, проверка принудительно переключается в `strict`, требуя явного подтверждения пользователя в UI (`ctx.ui.askUser` / `ctx.ui.confirm`), даже если глобально включен `auto-approve`.
2. **Пин языка и границы артефактов**:
   - В системную инъекцию хука `before_agent_start` ([`packages/1c-agent/src/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts#L148-L157)) и промпты всех 4 режимов ([`packages/1c-agent/src/modes/prompts.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts)) внедрены строгие правила:
     - **Пин языка**: язык ответа обязан строго соответствовать языку пользовательского запроса; переключение языка запрещено.
     - **Границы задачи**: явно названный артефакт является жесткой границей; смежные дефекты оформляются только как предложения в тексте ответа.
     - **Запрет сканирования диска и реверс-инжиниринга**: категорически запрещен `find /` по всему диску, поиск разрешен только внутри проекта; запрещен вызов `strings`/`otool` для бинарников платформы и утилит.

### Измененные файлы
- [`packages/1c-agent/src/permissions/policy.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/policy.ts)
- [`packages/1c-agent/src/permissions/tools.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/tools.ts)
- [`packages/1c-agent/src/permissions/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/index.ts)
- [`packages/1c-agent/src/index.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts)
- [`packages/1c-agent/src/modes/prompts.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts)
- Тесты: [`packages/1c-agent/test/permissions.test.ts`](file:///Users/kenny/Work/pi/packages/1c-agent/test/permissions.test.ts).

---

## 6. Результаты верификации и статус сборки

### Тестовый набор Vitest (`packages/1c-agent/test`)
Все **14 тестовых сьютов (135 тестов) пройдены на 100%**:
- `skills.test.ts` (21/21 passed): Purpose alias, инвариант `<ChildItems>`, валидация артефактов, `1c_skill_execute`.
- `permissions.test.ts` (9/9 passed): strict вне проекта, tilde-expansion, UI-подтверждения.
- `modes.test.ts` (11/11 passed): блокировка мутаций, стабильный toolset, 5-частный контракт, правила безопасности.
- `subagents.test.ts` (6/6 passed): 4 роли, санитайзинг DSML и tool-call разметки.
- `lsp-client.test.ts` (8/8 passed): ленивый старт, защита от параллельных вызовов.
- `lsp-feedback.test.ts` (8/8 passed): CLI-fallback, парсер замечаний, явные статусы.
- `extension.test.ts` (6/6 passed): регистрация инструментов, детект XML/EDT, ленивый подъем на `write`.
- `ast-parser.test.ts` (8/8), `call-hierarchy.test.ts` (3/3), `impact-analysis.test.ts` (3/3), `doctor.test.ts` (10/10), `vanessa.test.ts` (20/20), `autofix.test.ts` (8/8), `toolchain-resolver.test.ts` (14/14) — все passed.

### Полная проверка репозитория (`npm run check`)
- Biome: проверено 1510 файлов, 0 ошибок.
- Проверки зависимостей и импортов (`pinned-deps`, `runtime-deps`, `ts-imports`, `entry-graphs`, `install-lock`) — passed.
- Компилятор TypeScript (`tsc --noEmit`) — 0 ошибок.
- `browser-smoke` — passed.

### Сборка бинарников ПерУН
- Скрипт сборки: [`scripts/build-perun.mjs`](file:///Users/kenny/Work/pi/scripts/build-perun.mjs).
- ESM-бандл: [`packages/1c-agent/bin/perun.bundle.mjs`](file:///Users/kenny/Work/pi/packages/1c-agent/bin/perun.bundle.mjs) (10.8 МБ).
- Нативный бинарник Bun: [`packages/1c-agent/bin/perun`](file:///Users/kenny/Work/pi/packages/1c-agent/bin/perun).

---

## 7. Инструкция по сквозной проверке

Сценарий сквозного тестирования ПерУН в реальной сессии зафиксирован в [diag_flow.md](file:///Users/kenny/Work/pi/diag_flow.md).

Для проверки работоспособности:
1. Запустить ПерУН в каталоге тестового проекта:
   ```bash
   cd ~/Work/TEST-perun
   /Users/kenny/Work/pi/packages/1c-agent/bin/perun
   ```
2. Следовать пошаговому сценарию из [diag_flow.md](file:///Users/kenny/Work/pi/diag_flow.md):
   - Шаг 1 (режим `НАПИСАТЬ`): проверка детекта XML и вывода `[bsl-analyzer]` при записи `.bsl`.
   - Шаг 2 (режим `НАПИСАТЬ`): компиляция формы через `1c_skill_execute` и проверка непустых `<ChildItems>`.
   - Шаг 3 (действие пользователя: `/mode explain`): проверка блокировки мутирующих инструментов ядром и 5-частного ответа.
   - Шаг 4 (действие пользователя: `/mode write`): проверка блокировки записи вне каталога проекта (`/tmp`).
