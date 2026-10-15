# План задач по устранению дефектов ПерУН (TASKS.md)

Документ сформирован по результатам анализа самодиагностики агента в [diagnostics.md](file:///Users/kenny/Work/pi/diagnostics.md).
Все задачи успешно реализованы, протестированы и верифицированы.

---

## 1. Сводная классификация инцидентов

| Категория | Инциденты | Статус | Обоснование |
|---|---|---|---|
| **Ядро харнесса и Inline LSP** | E20, E21, E25, I-01 | **DONE** | Детектор расширен на `Configuration.xml` и рекурсивный поиск, ленивый старт в `start()` и `tool_result`, CLI-fallback в `InlineFeedbackHandler` |
| **Навыки и генерация форм** | E6, E7, E8 | **DONE** | Алиас `Purpose: Object -> Item` для Catalog/Document, инвариант непустых `<ChildItems>`, инструмент `1c_skill_execute` |
| **Изоляция режимов и субагенты** | E12, E13, E14, E15 | **DONE** | Полная блокировка мутаций в read-only режимах (`bash`, `1c_skill_execute`), стабильный toolset, очистка DSML-разметки, 5-частный контракт ответа |
| **Безопасность ФС, язык, границы** | E1, E2, E3, E5, E18, E19 | **DONE** | Принудительный `strict`-режим для путей вне `projectRoot`, пин языка, правило границы задачи, строгий запрет `find /` и дизассемблирования |
| **Окружение платформы и хост** | E4, E16, E17 | **OUT OF SCOPE** | Поиск учебной платформы `1cv8t` в `vrunner` / `v8find`. Решается симлинком `/opt/1cv8` на машине пользователя |
| **Ограничения ОС / headless** | E11 | **OUT OF SCOPE** | Headless-запуск `1cv8t ENTERPRISE` на macOS невозможен без сессии WindowServer (системное ограничение платформы 1С) |
| **Прикладной код MiniCRM** | E9, E10, E22, E23, E24 | **CLOSED** | Ошибки BSL/СКД в коде тестового проекта, исправлены в рамках сессии разработки MiniCRM |

---

## 2. Базовые архитектурные решения

1. **Форматы проектов 1С**: равноправная поддержка 1C:EDT (`.mdo`, `.project`) и XML-выгрузки Конфигуратора (`Configuration.xml` в корне или в `src/`, модули `.bsl` до глубины 2).
2. **Диагностика BSL**:
   - Ленивый запуск демона `bsl-analyzer` при первой записи/правке `.bsl`/`.os`.
   - CLI-fallback (`bsl-analyzer analyze -s <file>`), если фоновый процесс недоступен.
   - Обязательный статус-баннер проверки в выводе инструмента: тишина канала исключена.
3. **Генерация форм и запуск навыков**:
   - Автоматический алиас `Purpose: Object -> Item` для справочников и документов в `form-compile.py`.
   - Инвариант непустого тега `<ChildItems>` в сгенерированном `Form.xml`.
   - Инструмент `1c_skill_execute` с валидацией схемы, контролем статусов конвейера и исключением потери `PIPESTATUS`.
4. **Контракты режимов**:
   - Техническая блокировка всех мутирующих инструментов в режиме ОБЪЯСНИТЬ (`edit`, `write`, `bash`, `bsl_fix_standards`, `1c_vanessa`, `1c_skill_execute`).
   - 5-частная обязательная структура ответа в промпте режима ОБЪЯСНИТЬ.
5. **Безопасность файловой системы**:
   - `PermissionManager` в режиме `strict` по умолчанию для любых путей за пределами `projectRoot`.
   - Системный пин языка ответа под язык пользователя.
   - Правило границы задачи: явно названный артефакт является жесткой границей модификаций.

---

## 3. Декомпозиция задач

```
Epic 1: Диагностика BSL и Inline LSP [COMPLETED]
  ├── [DONE] TASK-1.1: Детектор проектов 1С (EDT + Configuration.xml)
  ├── [DONE] TASK-1.2: Ленивый жизненный цикл BslLspClient
  └── [DONE] TASK-1.3: InlineFeedbackHandler: CLI-fallback и явный статус проверки

Epic 2: Генерация артефактов 1С и типизированный runner навыков [COMPLETED]
  ├── [DONE] TASK-2.1: Согласование Purpose и инвариант непустых ChildItems в form-compile.py
  └── [DONE] TASK-2.2: Инструмент 1c_skill_execute с контролем PIPESTATUS и валидацией

Epic 3: Изоляция режимов ПерУН и субагенты [COMPLETED]
  ├── [DONE] TASK-3.1: Полная блокировка мутаций в ModeManager для режима ОБЪЯСНИТЬ
  ├── [DONE] TASK-3.2: Фильтрация DSML-разметки и санитайзинг в 1c_subagent
  └── [DONE] TASK-3.3: Контракт ответа режима ОБЪЯСНИТЬ в системном промпте

Epic 4: Безопасность окружения, язык и границы задач [COMPLETED]
  ├── [DONE] TASK-4.1: Strict-режим в PermissionManager для путей вне projectRoot
  └── [DONE] TASK-4.2: Пин языка и правила границ артефакта в системных промптах
```

---

## 4. Спецификация атомарных задач

### Epic 1: Диагностика BSL и Inline LSP

#### [DONE] [TASK-1.1] Детектор проектов 1С (EDT + Configuration.xml)
- **Целевые файлы**: [packages/1c-agent/src/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts)
- **Связанные инциденты**: E20, E25, I-01
- **Реализация**:
  1. Реализована функция `detect1cProject(directory: string, maxDepth = 2)` с проверкой `Configuration.xml` и `Configuration.mdo` в корне и вложенных каталогах (`src/`).
  2. Поддержан рекурсивный поиск файлов `.bsl`/`.os` с глубиной до 2 уровней (включая `src/Documents/*.bsl`).
  3. Экспортирована функция `detect1cProject` для использования в тестах и внешних модулях.
- **Тесты**: [packages/1c-agent/test/extension.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/extension.test.ts) (успешно).

#### [DONE] [TASK-1.2] Ленивый жизненный цикл BslLspClient
- **Целевые файлы**: [packages/1c-agent/src/lsp/client.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/client.ts), [packages/1c-agent/src/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts)
- **Связанные инциденты**: E20, E25, I-01
- **Реализация**:
  1. В `BslLspClient.start(projectPath?: string)` добавлен ленивый резолв пути: `this.executablePath ??= resolveBslAnalyzerPath(this.executablePath)`.
  2. Добавлен `startingPromise` для предотвращения параллельных повторных запусков демона.
  3. В `packages/1c-agent/src/index.ts` на хуке `tool_result` при `write`/`edit` файлов `.bsl`/`.os` выполняется проверка `detect1cProject` и автоматический подъем `lspClient.start(projectRoot)`, если демон еще не запущен.
- **Тесты**: [packages/1c-agent/test/lsp-client.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/lsp-client.test.ts), [packages/1c-agent/test/extension.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/extension.test.ts) (успешно).

#### [DONE] [TASK-1.3] InlineFeedbackHandler: CLI-fallback и явный статус проверки
- **Целевые файлы**: [packages/1c-agent/src/lsp/feedback.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/lsp/feedback.ts)
- **Связанные инциденты**: E20, E21, E22, E25
- **Реализация**:
  1. Если `client.isReady()` возвращает `false`, запускается CLI-fallback через `runCliAnalysis(filePath)` (`bsl-analyzer analyze -s <file>`).
  2. Реализован парсер вывода CLI (`parseCliDiagnostics`) для форматов bsl-analyzer CLI и gcc-style.
  3. Если утилита `bsl-analyzer` отсутствует в системе, к результату инструмента добавляется явный баннер:
     `[bsl-analyzer]: Статический анализ недоступен (bsl-analyzer не обнаружен)`.
  4. При отсутствии ошибок выводится явное подтверждение: `[bsl-analyzer]: Ошибок не обнаружено`.
- **Тесты**: [packages/1c-agent/test/lsp-feedback.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/lsp-feedback.test.ts) (успешно).

---

### Epic 2: Генерация артефактов 1С и типизированный runner навыков

#### [DONE] [TASK-2.1] Согласование Purpose и инвариант непустых ChildItems в form-compile.py
- **Целевые файлы**: [packages/1c-agent/skills/form-compile/scripts/form-compile.py](file:///Users/kenny/Work/pi/packages/1c-agent/skills/form-compile/scripts/form-compile.py)
- **Связанные инциденты**: E6, E7, E8
- **Реализация**:
  1. В `form-compile.py` внедрена нормализация Purpose: алиас `Purpose: Object -> Item` для Catalog и Document.
  2. Добавлен резервный парсер на базе `xml.etree.ElementTree` при отсутствии `lxml`.
  3. Внедрена строгая валидация сгенерированного XML: если `<ChildItems>` пуст или представлен тегом `<ChildItems/>`, скрипт удаляет невалидный файл с диска и завершается с кодом ошибки `1`.
- **Тесты**: [packages/1c-agent/test/skills.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/skills.test.ts) (успешно).

#### [DONE] [TASK-2.2] Инструмент 1c_skill_execute с контролем PIPESTATUS и валидацией
- **Целевые файлы**: [packages/1c-agent/src/skills/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/skills/tools.ts), [packages/1c-agent/src/skills/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/skills/index.ts), [packages/1c-agent/src/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts)
- **Связанные инциденты**: E6, E7, E8
- **Реализация**:
  1. Реализован и зарегистрирован типизированный инструмент `1c_skill_execute`.
  2. Прямой запуск python3/oscript через `child_process.spawn` без bash-конвейеров с полным перехватом stdout, stderr и реального exitCode.
  3. Внедрена автоматическая проверка инварианта `validateFormArtifact`: детектирование пустых `<ChildItems/>` и удаление поврежденного файла.
  4. При ненулевом коде завершения возвращается `isError: true` с подробным описанием ошибки из stderr.
- **Тесты**: [packages/1c-agent/test/skills.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/skills.test.ts) (успешно).

---

### Epic 3: Изоляция режимов ПерУН и субагенты

#### [DONE] [TASK-3.1] Полная блокировка мутаций в ModeManager для режима ОБЪЯСНИТЬ
- **Целевые файлы**: [packages/1c-agent/src/modes/types.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/types.ts), [packages/1c-agent/src/modes/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/index.ts)
- **Связанные инциденты**: E12, E13, E14
- **Реализация**:
  1. В `MUTATING_TOOLS` включены `edit`, `write`, `bash`, `bsl_fix_standards`, `1c_vanessa`, `1c_skill_execute`.
  2. Устранена нестабильность toolset: исключено удаление инструментов из реестра (`setActiveTools`), блокировка осуществляется через `checkToolCall`.
  3. В режимах `find`, `explain`, `plan` любые вызовы мутирующих инструментов блокируются с возвратом понятного сообщения и предложения переключиться в режим НАПИСАТЬ.
- **Тесты**: [packages/1c-agent/test/modes.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/modes.test.ts) (успешно).

#### [DONE] [TASK-3.2] Фильтрация DSML-разметки и санитайзинг в 1c_subagent
- **Целевые файлы**: [packages/1c-agent/src/subagents/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/tools.ts), [packages/1c-agent/src/subagents/roles.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/subagents/roles.ts)
- **Связанные инциденты**: E15
- **Реализация**:
  1. Реализована функция `sanitizeSubagentOutput`, конвертирующая сырую разметку `<｜｜DSML｜｜ ...>`, XML `<tool_call>` и DeepSeek tool-call токены в структурированный текст `[Вызов инструмента: ...]`.
  2. В системных промптах всех 4 ролей субагентов (`1c-architect`, `1c-coder`, `1c-tester`, `1c-reviewer`) зафиксирован строгий запрет на вывод сырой разметки tool-call.
- **Тесты**: [packages/1c-agent/test/subagents.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/subagents.test.ts) (успешно).

#### [DONE] [TASK-3.3] Контракт ответа режима ОБЪЯСНИТЬ в системном промпте
- **Целевые файлы**: [packages/1c-agent/src/modes/prompts.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts)
- **Связанные инциденты**: E12
- **Реализация**:
  1. В промпте режима ОБЪЯСНИТЬ зафиксирован жесткий 5-частный контракт ответа:
     1. Симптом — как наблюдается.
     2. Трасса — файлы/строки/цепочки вызовов с точными цитатами.
     3. Причина — физика дефекта.
     4. Следствия — архитектурное влияние на регистры и проведение.
     5. Верификация — способ проверки гипотезы без мутаций.
  2. Блок «Как исправить» допускается строго в самом конце ответа с явным предупреждением о необходимости перехода в режим НАПИСАТЬ (`alt+m` / `/mode write`).
- **Тесты**: [packages/1c-agent/test/modes.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/modes.test.ts) (успешно).

---

### Epic 4: Безопасность окружения, язык и границы задач

#### [DONE] [TASK-4.1] Strict-режим в PermissionManager для путей вне projectRoot
- **Целевые файлы**: [packages/1c-agent/src/permissions/policy.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/policy.ts), [packages/1c-agent/src/permissions/tools.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/tools.ts), [packages/1c-agent/src/permissions/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/permissions/index.ts)
- **Связанные инциденты**: E5
- **Реализация**:
  1. Реализована функция `extractTargetPath`, инспектирующая ключи аргументов (`path`, `file_path`, `filePath`, `targetPath`, `outputPath`, `cwd` и т.д.).
  2. Реализована проверка `isPathInsideProject(projectRoot, filePath)` с поддержкой тильды (`~`).
  3. Если целевой путь находится вне `projectRoot`, уровень прав принудительно переключается в `strict` даже при глобальном `auto-approve`, требуя явного подтверждения пользователя в UI через `ctx.ui.askUser` / `ctx.ui.confirm`.
- **Тесты**: [packages/1c-agent/test/permissions.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/permissions.test.ts) (успешно).

#### [DONE] [TASK-4.2] Пин языка и правила границ артефакта в системных промптах
- **Целевые файлы**: [packages/1c-agent/src/index.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/index.ts), [packages/1c-agent/src/modes/prompts.ts](file:///Users/kenny/Work/pi/packages/1c-agent/src/modes/prompts.ts)
- **Связанные инциденты**: E1, E2, E3, E18, E19
- **Реализация**:
  1. В `before_agent_start` (хук `envInjection`) и системных промптах всех 4 режимов (`find`, `explain`, `write`, `plan`) зафиксированы правила:
     - ПИН ЯЗЫКА ОТВЕТА: строгое соответствие языку запроса пользователя, запрет дрейфа на китайский или английский при русском диалоге.
     - ГРАНИЦЫ ЗАДАЧИ И АРТЕФАКТА: названный артефакт является жесткой границей задачи; смежные дефекты оформлять только предложениями.
     - СТРОГИЙ ЗАПРЕТ СКАНИРОВАНИЯ ДИСКА И РЕВЕРС-ИНЖИНИРИНГА: запрет тотального поиска `find /` по всему диску и дизассемблирования бинарников через `strings`/`otool`.
- **Тесты**: [packages/1c-agent/test/extension.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/extension.test.ts), [packages/1c-agent/test/modes.test.ts](file:///Users/kenny/Work/pi/packages/1c-agent/test/modes.test.ts) (успешно).

---

## 5. Итоги верификации и тестов

- **Unit & Integration Tests** (`packages/1c-agent/test`):
  - 14 тестовых файлов, **135 тестов — 100% passed**.
  - `skills.test.ts`: 21 passed
  - `permissions.test.ts`: 9 passed
  - `modes.test.ts`: 11 passed
  - `subagents.test.ts`: 6 passed
  - `lsp-client.test.ts`: 8 passed
  - `lsp-feedback.test.ts`: 8 passed
  - `extension.test.ts`: 6 passed
  - `doctor.test.ts`, `vanessa.test.ts`, `autofix.test.ts`, `ast-parser.test.ts`, `call-hierarchy.test.ts`, `impact-analysis.test.ts`, `toolchain-resolver.test.ts`: все passed.
- **Полная проверка монорепозитория (`npm run check`)**:
  - `biome check`: проверено 1510 файлов, 0 ошибок.
  - `check:pinned-deps`: passed.
  - `check:runtime-deps`: passed.
  - `check:ts-imports`: passed.
  - `check:entry-graphs`: passed.
  - `check:install-lock:coding-agent`: passed.
  - `tsc --noEmit`: 0 ошибок компиляции TypeScript.
  - `check:browser-smoke`: passed.
- **Сборка бинарных артефактов PerUN**:
  - ESM-бандл: `packages/1c-agent/bin/perun.bundle.mjs` (успешно собран).
  - Нативный бинарник: `packages/1c-agent/bin/perun` (скомпилирован через Bun, успешно готов).
