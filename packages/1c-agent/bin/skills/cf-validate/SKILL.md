---
name: cf-validate
description: Валидация конфигурации 1С. Используй после создания или модификации конфигурации для проверки корректности
argument-hint: <ConfigPath> [-Detailed] [-MaxErrors 30]
allowed-tools:
  - Bash
  - Read
  - Glob
---

# /cf-validate — валидация конфигурации 1С

Проверяет Configuration.xml на структурные ошибки: XML well-formedness, InternalInfo, свойства, enum-значения, ChildObjects, DefaultLanguage, файлы языков, каталоги объектов.

## Параметры

| Параметр   | Обяз. | Умолч. | Описание                                      |
|------------|:-----:|---------|-------------------------------------------------|
| ConfigPath | да    | —       | Путь к Configuration.xml или каталогу выгрузки  |
| Detailed   | нет   | —       | Подробный вывод (все проверки, включая успешные) |
| MaxErrors  | нет   | 30      | Остановиться после N ошибок                     |
| OutFile    | нет   | —       | Записать результат в файл (UTF-8 BOM)           |

## Команда

Скрипт `scripts/cf-validate.py` является кроссплатформенным и не требует наличия pwsh или Windows.

### Через инструмент 1c_skill_execute (рекомендуется)

```json
{
  "skill": "cf-validate",
  "args": {
    "ConfigPath": "upload/cfempty"
  }
}
```

С дополнительными параметрами:
```json
{
  "skill": "cf-validate",
  "args": {
    "ConfigPath": "upload/cfempty/Configuration.xml",
    "Detailed": true,
    "MaxErrors": 50
  }
}
```

### Через python3 (кроссплатформенно)

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/cf-validate.py" -ConfigPath "upload/cfempty"
python3 "${CLAUDE_SKILL_DIR}/scripts/cf-validate.py" -ConfigPath "upload/cfempty/Configuration.xml"
```

### Через PowerShell

```powershell
powershell.exe -NoProfile -File "${CLAUDE_SKILL_DIR}/scripts/cf-validate.ps1" -ConfigPath "upload/cfempty"
powershell.exe -NoProfile -File "${CLAUDE_SKILL_DIR}/scripts/cf-validate.ps1" -ConfigPath "upload/cfempty/Configuration.xml"
```
