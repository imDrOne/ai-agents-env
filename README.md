# agent-env-suite

Набор независимых CLI-утилит для настройки локального окружения Claude Code и Codex,
общих project overrides, звуковых уведомлений и dashboard-orchestrator.

Проект — Node.js ESM monorepo (`node >=18`) с workspace-пакетами:

- `claude-env` — CLI для глобального и проектного окружения Claude Code.
- `codex-env` — CLI для глобального и проектного окружения Codex.
- `agent-env-dashboard` — единая настройка Claude/Codex homes и статус адаптеров.
- `@agent-env/shared` — общая логика установки, project overrides, cleanup, sounds/notify.

## Быстрый старт для разработки

```bash
npm install
npm test
```

Локальный запуск CLI:

```bash
node bin/agent-env-suite help
node packages/claude-env/bin/claude-env help
node packages/codex-env/bin/codex-env help
node packages/dashboard/bin/agent-env-dashboard status
```

Полезные проверки:

```bash
npm run check
npm run lint
npm run format:check
npm run build:web
```

## Установка

Основной production package — root umbrella package `agent-env-suite`. Он публикует четыре bin:

- `agent-env-suite`
- `claude-env`
- `codex-env`
- `agent-env-dashboard`

После публикации в npm registry:

```bash
npm install -g agent-env-suite
claude-env help
codex-env setup
agent-env-dashboard status
```

One-shot запуск через npm registry:

```bash
npx -y agent-env-suite codex-env help
npx -y agent-env-suite claude-env install --dry-run
npx -y agent-env-suite dashboard status
```

Если нужен прямой запуск конкретного bin из umbrella package:

```bash
npx -y --package agent-env-suite codex-env help
npx -y --package agent-env-suite claude-env help
```

Установка из GitHub tag/commit:

```bash
npm install -g github:<owner>/<repo>#<tag-or-sha>
npx -y github:<owner>/<repo>#<tag-or-sha> codex-env help
npx -y --package github:<owner>/<repo>#<tag-or-sha> codex-env help
```

## Что умеет утилита

### Установка agent home

`claude-env install` и `codex-env install` создают только выбранное agent-scoped окружение:

- Claude: `$CLAUDE_HOME` или `~/.claude`, `claude-env.json`, `CLAUDE.md`,
  папки `commands/`, `hooks/`, `agents/`.
- Codex: `$CODEX_HOME` или `~/.codex`, `codex-env.json`, `AGENTS.md`,
  `config.toml`, папку `rules/`.
- `--dry-run` печатает план без изменений.
- `--home <path>` позволяет указать кастомный home.
- `--with-serena` добавляет нативный Serena MCP config для выбранного агента.

### Интерактивная настройка

```bash
claude-env setup
codex-env setup
```

Wizard собирает путь home, выбирает компоненты и по умолчанию предлагает сначала dry-run.
В неинтерактивном окружении setup завершается с подсказкой использовать флаги install/project.

### Claude plugins

```bash
claude-env plugins list
claude-env plugins status
claude-env plugins install --dry-run
```

Поддерживаются manifest-файлы `marketplaces.txt` и `plugins.txt`, добавление Claude plugin
marketplaces и установка plugins через внешний CLI `claude`. Если `claude` не найден, install
пропускается без падения всего процесса.

### Codex skills sync

```bash
codex-env skills list
codex-env skills status
codex-env skills sync --dry-run
```

Синхронизация читает `codex-skills.txt`, ищет skills в cache Claude plugins и копирует их в
`<agents-home>/skills`. Для plugin cache выбирается самая новая найденная версия.

### Project overrides

Обе agent CLI поддерживают локальные и tracked project profiles:

```bash
claude-env project status --project <path>
claude-env project setup
codex-env project init --local --project <path>
codex-env project enable skill personal-workflow --tracked
codex-env project disable plugin github --local
codex-env project list
```

- Local profile пишется в `.agent-env.local/<agent>.json` и добавляется в `.git/info/exclude`.
- Tracked profile пишется в `.agent-env/<agent>.json`.
- Поддержанные типы features: `plugin`, `skill`, `hook`, `instruction`.

### Звуки и уведомления

```bash
claude-env sound add ./sound.mp3 --assign
codex-env sound assign agent_turn_complete done.wav
claude-env sound list
codex-env notify '{"type":"agent-turn-complete"}'
```

Поддержанные аудио-расширения: `mp3`, `wav`, `ogg`, `m4a`, `flac`.
Звуки можно хранить в `AGENT_SOUNDS_DIR` или в директории, указанной через `--sound-dir`.

События:

- Claude: `session_start`, `session_end`, `idle_prompt`, `permission_prompt`,
  `agent_turn_complete`.
- Codex: `permission_prompt`, `agent_turn_complete`.

Для проигрывания используются `afplay` на macOS, PowerShell MediaPlayer на Windows,
а на Linux — первый доступный `paplay`, `aplay` или `mpv`.

### Cleanup

```bash
claude-env clean global --dry-run
codex-env clean global
codex-env clean global --wipe --dry-run
codex-env clean global --wipe --confirm-wipe
claude-env clean project --local --project <path>
```

Safe cleanup удаляет только managed-файлы с ожидаемым содержимым и пустые managed-директории.
Полный `--wipe` требует `--confirm-wipe` и дополнительно проверяет, что путь похож на home
выбранного агента.

### Dashboard orchestrator

```bash
agent-env-dashboard status
agent-env-dashboard adapters
agent-env-dashboard install --dry-run
agent-env-dashboard install --serena-clients both
agent-env-dashboard setup
agent-env-dashboard ui --port 7200
agent-env-dashboard ui --no-open
```

Dashboard показывает статус доступности адаптеров `claude-env` и `codex-env`, а также Serena
(`uv`, `serena`, dashboard URL).

`install` и `setup` запускают единый orchestrator:

- создают Claude и Codex homes через те же install plans, что и agent CLI;
- поддерживают `--dry-run`;
- поддерживают `--claude-home <path>` и `--codex-home <path>`;
- поддерживают `--serena-clients both|codex|claude|none` с default `both`;
- запускают Claude plugin installation flow так же, как `claude-env install`.

`ui` запускает React dashboard на `http://localhost:7200` (`127.0.0.1`) и по умолчанию открывает
браузер. Порт меняется через `--port`, автооткрытие отключается через `--no-open`.

UI покрывает основные консольные workflows:

- overview: adapters, agent homes, Serena status;
- install: Claude/Codex homes, Serena clients, dry-run/apply;
- Claude plugins: manifest, dry-run/install;
- Codex skills: manifest/cache status, dry-run/sync;
- project overrides: status, init, enable/disable feature;
- sounds: upload, assign event sounds, test playback;
- cleanup: global/project dry-run, safe apply, wipe only with explicit confirmation;
- Serena: status and dashboard URL;
- logs: результат последних UI operations.

Для разработки frontend:

```bash
npm run dev:web
npm run build:web
```

Runtime не требует Vite: production package отдаёт заранее собранный `packages/dashboard/web/dist`.

### Serena MCP

Serena wiring больше не является placeholder-файлом. При выборе Serena:

- Codex получает секцию `[mcp_servers.serena]` в `config.toml`;
- Claude настраивается через `claude mcp add-json serena ... --scope user`;
- MCP server запускается как native stdio command:
  `serena start-mcp-server --project-from-cwd --context=<codex|claude-code>`;
- Serena dashboard ожидается по адресу `http://localhost:24282/dashboard/index.html`, пока активна
  MCP-сессия.

Если `serena` не найден во время реального install/setup, утилита не оставляет сломанный MCP config
и возвращает ошибку. В `--dry-run` файлы и внешние CLI не изменяются.

## Что ещё не хватает

- Workspace-пакеты `claude-env`, `codex-env`, `agent-env-dashboard`, `@agent-env/shared`
  остаются внутренними; production install идёт через root `agent-env-suite`.
