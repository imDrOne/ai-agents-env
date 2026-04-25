# Architecture Reboot: independent agent utilities and project environments

## Summary

`agents-env` должен быть разобран на независимые agent-specific утилиты и
опциональный общий dashboard. Главное требование: пользователь может поставить
и использовать только Claude или только Codex, не устанавливая лишние файлы,
плагины, зависимости и runtime-настройки второго агента.

Целевая модель:

- `claude-env` — standalone utility для Claude Code.
- `codex-env` — standalone utility для Codex.
- `agent-env-dashboard` — опциональный локальный web dashboard/facade.
- shared infrastructure — технические helpers без agent-specific product logic.

Утилиты также должны помогать настраивать окружение конкретного проекта:
включать и отключать plugins, skills, hooks, instructions и интеграции на уровне
repo, чтобы разные проекты могли иметь разные профили. Например, в одном проекте
может быть включён `superpowers`, а в другом отключён.

## Legacy Inventory From `draft/`

Старая реализация в `draft/` является монолитом `agents-env`.

Фактические responsibilities старого проекта:

- единый npm package `agents-env` и единый CLI `bin/agents-env`;
- installer, который одновременно создаёт/меняет Claude, Codex и shared folders;
- общий config v1 в platform-specific `agents-env/config.json`;
- Claude templates: `.claude/CLAUDE.md`, `settings.json`, hooks, commands, agents,
  pump phrase, statusline;
- Codex templates: `.codex/config.toml`, `AGENTS.md`, rules, local skills;
- shared notification runtime для Claude и Codex;
- Serena install/update/status/stop и MCP wiring для обоих агентов;
- Claude plugin marketplaces/plugins install;
- linking Codex skills from local templates and Claude plugin cache;
- Express server and React dashboard with config, sounds, pump phrase, Serena and
  statusline preview screens.

Эта legacy-модель полезна как source of behavior, но не должна сохраняться как
целевая product architecture. Новый дизайн должен переносить функциональность
по ownership, а не сохранять `agents-env install` как универсальный flow.

## Target Architecture

Архитектура делится на четыре слоя.

### 1. Agent-specific utilities

`claude-env` и `codex-env` являются отдельными продуктами, а не режимами одного
CLI.

`claude-env` owns:

- Claude user-level install/setup;
- Claude settings/templates;
- Claude hooks and notification wiring;
- Claude statusline;
- pump phrase agent/config;
- Claude slash commands and agents;
- Claude plugins and marketplaces;
- Claude project-level overrides;
- Claude Serena MCP wiring.

`codex-env` owns:

- Codex user-level install/setup;
- Codex `config.toml` and rules;
- Codex skills and skill links;
- Codex plugin config;
- Codex notification wiring;
- Codex project-level overrides;
- Codex Serena MCP wiring.

Одна утилита не должна создавать, менять или требовать runtime окружение другой
утилиты.

### 2. Shared facade

Общий facade состоит из локального HTTP server и web UI.

Facade responsibilities:

- обнаруживать доступные agent adapters;
- показывать только реально доступные capabilities;
- вызывать agent utilities через adapter contract;
- отображать status/config/project environment/actions;
- работать, если установлен только один агент.

Facade не должен импортировать Claude/Codex business logic напрямую и не должен
хранить agent-specific config semantics.

### 3. Shared infrastructure

Shared infrastructure допустим только для технических задач:

- filesystem helpers;
- backup/link/copy/template rendering helpers;
- process spawning helpers;
- platform path helpers;
- Serena detection/install helpers;
- adapter interface definitions;
- small shared UI/API utilities.

Shared infrastructure не должен тянуть Claude или Codex runtime dependencies и
не должен становиться новым скрытым монолитом.

### 4. Project environment layer

Project environment layer управляет настройками конкретного repo поверх
user-level setup.

Он нужен для сценариев:

- в одном проекте включить `superpowers`, в другом выключить;
- отключить тяжёлый или шумный skill только для текущего repo;
- добавить project-specific instructions;
- включить agent-specific hooks только для одного проекта;
- иметь tracked team profile для repo или local-only personal overrides.

Project environment belongs to the agent utility. Dashboard может только
визуализировать и вызывать declared project capabilities.

## Key Principles

### No forced multi-agent install

Установка выбранного агента не должна ставить ничего лишнего.

- `claude-env install` не создаёт и не меняет `~/.codex`.
- `claude-env install` не пишет Codex TOML, rules, skills или plugins.
- `codex-env install` не создаёт и не меняет `~/.claude`.
- `codex-env install` не ставит Claude plugins, commands, hooks или statusline.
- dashboard устанавливается отдельно.
- Serena устанавливается отдельно или через явный opt-in.

### Separate products, shared optional facade

`claude-env` и `codex-env` должны быть полноценными standalone utilities.
Dashboard не является обязательной частью базового install.

### Capability-driven integration

Facade работает через capabilities, а не через hardcoded branches вроде
`if agent === 'claude'`.

Новый агент должен подключаться новым adapter без переписывания core facade.

### No forced config unification

Нельзя смешивать Claude и Codex behavior в единой product config shape.

Agent-specific behavior хранится в agent-owned config. Facade может хранить
только UI/dashboard preferences, registry и технические shared paths.

### Project overrides are explicit and safe

Project-level изменения по умолчанию должны быть local/untracked. Tracked
изменения разрешены только через явный `--tracked` и должны быть видны в dry-run
или diff перед применением.

### Serena is global but opt-in

Serena является global optional tool, а не обязательной частью install.
Каждая agent utility может подключить её независимо и идемпотентно.

## Installation Model

### Claude-only install

Target UX:

```bash
claude-env install
claude-env install --with-serena
claude-env install --dry-run
```

Expected behavior:

- installs only Claude user-level files and features;
- does not require Codex;
- does not create Codex folders;
- does not install Codex skills/plugins;
- wires Serena only with `--with-serena`.

### Codex-only install

Target UX:

```bash
codex-env install
codex-env install --with-serena
codex-env install --dry-run
```

Expected behavior:

- installs only Codex user-level files and features;
- does not require Claude Code;
- does not create Claude folders;
- does not install Claude plugins/marketplaces;
- wires Serena only with `--with-serena`.

### Dashboard install

Target UX:

```bash
agent-env-dashboard install
agent-env-dashboard ui
```

Expected behavior:

- installs only server/UI facade;
- does not install Claude or Codex;
- discovers available adapters;
- works with zero, one or multiple installed agents;
- shows missing agents as unavailable, not broken.

### Serena opt-in

Serena is not installed by default.

Supported behavior:

- `--with-serena` ensures global Serena install if missing;
- if Serena already exists, do not reinstall it;
- each agent performs only its own MCP wiring;
- disabling Serena for one agent must not remove another agent's Serena wiring.

## Project Environment Model

Each agent utility must support project-level management.

Target commands:

```bash
claude-env project status
claude-env project init
claude-env project list
claude-env project enable plugin superpowers
claude-env project disable plugin superpowers
claude-env project enable skill frontend-design --tracked

codex-env project status
codex-env project init
codex-env project list
codex-env project enable skill personal-workflow
codex-env project disable skill personal-workflow
codex-env project enable plugin github
codex-env project disable plugin caveman
```

Common options:

```bash
--project <path>   # default: current working directory
--tracked          # write version-controlled project config
--local            # default; write local/untracked overrides
--dry-run          # show planned changes only
```

Required behavior:

- `project status` shows effective config for the current repo;
- status distinguishes sources: global, project tracked, project local;
- `project init` creates the minimum project config for the selected agent;
- `enable` and `disable` operate only on the selected agent;
- local mode must not modify tracked files;
- tracked mode must be explicit and reviewable.

Agent-specific project ownership:

- Claude project config may manage project `CLAUDE.md`, project `.claude`
  settings, project skills, hooks, commands and plugin toggles where supported.
- Codex project config may manage project `AGENTS.md`, project Codex config,
  rules, skills and plugin toggles where supported.
- Shared project metadata may exist only for registry/status purposes and must
  not define agent behavior.

Exact file formats must be validated against current official Claude/Codex
documentation before implementation. The architectural invariant is that
project behavior remains agent-owned.

## Config Direction

Use separate config domains.

Allowed:

- `claude-env` user config owned by `claude-env`;
- `codex-env` user config owned by `codex-env`;
- dashboard config owned by dashboard;
- project-local overrides owned by the relevant agent utility;
- tracked project profiles owned by the relevant agent utility.

Not allowed:

- one mixed config where Claude, Codex, dashboard and shared behavior are
  interleaved;
- dashboard config that becomes the source of truth for agent behavior;
- a project profile that silently changes both Claude and Codex unless the user
  explicitly invokes both utilities.

## Adapter Contract

Facade integrates with utilities through a capability-driven adapter contract.

Required adapter fields/methods:

- `id`
- `displayName`
- `version`
- `getCapabilities()`
- `getStatus()`
- `install(options)`

Optional capability groups:

- `config.readConfig()`
- `config.writeConfig(config)`
- `serena.getStatus()`
- `serena.ensure(options)`
- `serena.configureProject(projectPath, options)`
- `notifications.getStatus()`
- `notifications.test(event)`
- `sounds.list()`
- `sounds.upload(file)`
- `statusline.preview()`
- `pumpPhrase.getStatus()`
- `pumpPhrase.update(options)`
- `plugins.list(scope)`
- `plugins.enable(name, scope)`
- `plugins.disable(name, scope)`
- `skills.list(scope)`
- `skills.enable(name, scope)`
- `skills.disable(name, scope)`
- `project.getStatus(projectPath)`
- `project.init(projectPath, options)`
- `project.listFeatures(projectPath)`
- `project.planChange(projectPath, change)`
- `project.applyChange(projectPath, change)`

Facade rules:

- call only declared capabilities;
- do not infer agent internals from adapter id;
- show unavailable capabilities as absent UI, not disabled broken controls;
- allow single-agent operation.

## Migration Plan

### Phase 0. Inventory and package boundaries

- Treat `draft/` as legacy source inventory.
- Map every legacy behavior to `claude-env`, `codex-env`, dashboard or shared
  infrastructure.
- Decide package/workspace layout before moving code.

### Phase 1. Extract shared infrastructure

- Extract platform path helpers.
- Extract link/copy/render/backup helpers.
- Extract process helpers.
- Extract Serena install/detection helpers without MCP agent wiring.
- Define adapter interfaces and test fixtures.

### Phase 2. Build `codex-env`

- Move Codex install flow out of the monolith.
- Own Codex config template, rules, skills and plugin config.
- Implement Codex-only notification wiring.
- Implement Codex Serena MCP wiring behind `--with-serena`.
- Add `codex-env project` commands for project AGENTS/rules/skills/plugins.
- Ensure Codex install works without Claude installed.

### Phase 3. Build `claude-env`

- Move Claude install flow out of the monolith.
- Own Claude settings, hooks, commands, agents, statusline and pump phrase.
- Move Claude plugin marketplace/plugin install.
- Implement Claude Serena MCP wiring behind `--with-serena`.
- Add `claude-env project` commands for project instructions, skills, hooks and
  plugin toggles.
- Ensure Claude install works without Codex installed.

### Phase 4. Rebuild dashboard around adapters

- Replace direct imports from legacy modules with adapter discovery.
- Replace global `/api/config` with facade registry plus agent-scoped config APIs.
- Route sounds, pump phrase, statusline and project screens through capabilities.
- Make UI render correctly with zero, one or many adapters.

### Phase 5. Remove `agents-env` product identity

- Remove old `agents-env` help text and branding from target docs/UI.
- Update install docs to show separate utilities.
- Remove legacy config shape from target architecture.
- Do not provide backward compatibility for `agents-env install` unless a future
  explicit migration wrapper is approved.

## Test Strategy

### Unit tests

- adapter contract conformance;
- shared filesystem/template helpers;
- Serena install detection idempotency;
- config isolation;
- project override merge/effective-status logic;
- dry-run plan generation for project changes.

### Agent install tests

- `claude-env install --dry-run` contains no Codex operations;
- `codex-env install --dry-run` contains no Claude operations;
- `claude-env install` succeeds without Codex present;
- `codex-env install` succeeds without Claude present;
- `--with-serena` performs only selected agent wiring;
- default install does not install Serena.

### Project environment tests

- disabling a Claude plugin affects only Claude project override;
- disabling a Codex skill affects only Codex project override;
- local project mode does not edit tracked files;
- tracked project mode requires explicit option;
- effective status shows global, tracked and local sources separately.

### Dashboard tests

- dashboard starts with no adapters;
- dashboard starts with only Claude adapter;
- dashboard starts with only Codex adapter;
- unavailable capabilities are not rendered as actionable controls;
- project environment UI calls adapter capabilities, not direct filesystem logic.

## Success Criteria

Architecture is successful when:

- Claude and Codex can be installed and used independently;
- no install path forces the other agent's files, dependencies or plugins;
- dashboard remains optional and adapter-driven;
- Serena is optional and agent wiring is independent;
- project-level plugin/skill/instruction overrides are supported;
- project overrides are local by default and tracked only by explicit request;
- adding another AI agent does not require rebuilding facade as a monolith;
- `agents-env` no longer exists as the target product identity.

## Chosen Defaults

- Public agent CLIs: `claude-env`, `codex-env`.
- Public dashboard CLI: `agent-env-dashboard`.
- Default install scope: selected agent only.
- Dashboard: optional separate install.
- Serena: optional, enabled only by `--with-serena`.
- Project overrides: local/untracked by default.
- Tracked project config: only with `--tracked`.
- Migration: no backward compatibility for old `agents-env` product behavior.
