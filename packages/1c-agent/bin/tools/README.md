# PerUN Bundled Tools

В этот каталог помещаются исполняемые файлы и утилиты инструментария 1С для автономной работы ПерУН:

- `bsl-analyzer` (или `bsl-analyzer.exe` на Windows): нативный статический анализатор кода 1С и LSP-сервер.
- `vanessa/`: внешняя обработка Vanessa Automation (`vanessa/vanessa-automation.epf`).
- `vrunner` / `oscript`: внешние утилиты, обнаруживаемые через системный PATH или переменные VRUNNER_PATH / OSCRIPT_PATH.

При запуске бинарника PerUN модуль `toolchain/resolver.ts` автоматически обнаруживает эти утилиты в `bin/tools/` или в системном окружении.
