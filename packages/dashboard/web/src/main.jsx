import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bell,
  CheckCircle2,
  Code2,
  Eraser,
  FolderGit2,
  LayoutDashboard,
  PackageCheck,
  Plug,
  RefreshCw,
  Save,
  Server,
  ShieldAlert,
  Sparkles,
  Terminal,
  Volume2,
  Wrench,
} from 'lucide-react';
import './styles.css';

const API = {
  async get(path) {
    return request(path);
  },
  async post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
};

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'install', label: 'Install', icon: PackageCheck },
  { id: 'plugins', label: 'Claude Plugins', icon: Plug },
  { id: 'skills', label: 'Codex Skills', icon: Sparkles },
  { id: 'project', label: 'Project', icon: FolderGit2 },
  { id: 'sounds', label: 'Sounds', icon: Volume2 },
  { id: 'statusline', label: 'Statusline', icon: Activity },
  { id: 'cleanup', label: 'Cleanup', icon: Eraser },
  { id: 'serena', label: 'Serena', icon: Server },
  { id: 'logs', label: 'Logs', icon: Terminal },
];

function App() {
  const [tab, setTab] = React.useState('overview');
  const [status, setStatus] = React.useState(null);
  const [logs, setLogs] = React.useState([]);

  const addLog = React.useCallback((title, payload) => {
    setLogs(current => [{ id: crypto.randomUUID(), title, payload, ts: new Date() }, ...current]);
  }, []);

  const refreshStatus = React.useCallback(async () => {
    const next = await API.get('/api/status');
    setStatus(next);
    return next;
  }, []);

  React.useEffect(() => {
    refreshStatus().catch(error => addLog('Status failed', { error: String(error) }));
  }, [addLog, refreshStatus]);

  const page = {
    overview: <Overview status={status} refreshStatus={refreshStatus} addLog={addLog} />,
    install: <InstallPanel addLog={addLog} refreshStatus={refreshStatus} />,
    plugins: <ClaudePlugins addLog={addLog} />,
    skills: <CodexSkills addLog={addLog} />,
    project: <ProjectPanel addLog={addLog} />,
    sounds: <SoundsPanel addLog={addLog} />,
    statusline: <StatuslinePanel addLog={addLog} />,
    cleanup: <CleanupPanel addLog={addLog} refreshStatus={refreshStatus} />,
    serena: <SerenaPanel status={status} refreshStatus={refreshStatus} addLog={addLog} />,
    logs: <LogsPanel logs={logs} />,
  }[tab];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Wrench size={20} />
          <div>
            <strong>agent-env</strong>
            <span>localhost dashboard</span>
          </div>
        </div>
        <nav>
          {NAV.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? 'active' : ''}
                onClick={() => setTab(item.id)}
                type="button"
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <h1>{NAV.find(item => item.id === tab)?.label}</h1>
            <p>Manage Claude Code, Codex, project overrides, sounds, cleanup, and Serena.</p>
          </div>
          <button className="iconText" onClick={refreshStatus} type="button">
            <RefreshCw size={16} />
            Refresh
          </button>
        </header>
        {page}
      </main>
    </div>
  );
}

function Overview({ status, refreshStatus, addLog }) {
  return (
    <section className="grid two">
      <Panel title="Adapters" icon={Code2}>
        <div className="list">
          {(status?.adapters ?? []).map(adapter => (
            <StatusRow
              key={adapter.id}
              label={adapter.displayName}
              detail={adapter.command}
              ok={adapter.available}
            />
          ))}
        </div>
      </Panel>
      <Panel title="Agent homes" icon={FolderGit2}>
        <div className="list">
          {Object.entries(status?.homes ?? {}).map(([agent, home]) => (
            <StatusRow
              key={agent}
              label={agent}
              detail={home.home}
              ok={home.installed}
              okText="managed"
              failText="missing"
            />
          ))}
        </div>
      </Panel>
      <Panel title="Serena" icon={Server}>
        <SerenaSummary serena={status?.serena} />
      </Panel>
      <Panel title="Quick actions" icon={CheckCircle2}>
        <div className="buttonRow">
          <button onClick={() => runAndLog('Refresh status', refreshStatus, addLog)} type="button">
            Refresh status
          </button>
          <button
            onClick={() =>
              runAndLog('Dry-run install', () => API.post('/api/install', { dryRun: true }), addLog)
            }
            type="button"
          >
            Dry-run install
          </button>
        </div>
      </Panel>
    </section>
  );
}

function InstallPanel({ addLog, refreshStatus }) {
  const [form, setForm] = React.useState({
    claudeHome: '',
    codexHome: '',
    serenaClients: 'both',
  });

  async function run(dryRun) {
    const payload = cleanEmpty({ ...form, dryRun });
    const result = await API.post('/api/install', payload);
    addLog(dryRun ? 'Install dry-run' : 'Install applied', result);
    if (!dryRun) await refreshStatus();
  }

  return (
    <Panel title="Install Claude/Codex environments" icon={PackageCheck}>
      <FormGrid>
        <TextInput label="Claude home" value={form.claudeHome} onChange={claudeHome => setForm({ ...form, claudeHome })} placeholder="~/.claude" />
        <TextInput label="Codex home" value={form.codexHome} onChange={codexHome => setForm({ ...form, codexHome })} placeholder="~/.codex" />
        <SelectInput
          label="Serena clients"
          value={form.serenaClients}
          onChange={serenaClients => setForm({ ...form, serenaClients })}
          options={['both', 'codex', 'claude', 'none']}
        />
      </FormGrid>
      <ActionBar
        preview={() => run(true)}
        apply={() => run(false)}
        applyLabel="Apply install"
        confirmText="Apply install changes to local agent homes?"
      />
    </Panel>
  );
}

function ClaudePlugins({ addLog }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    API.get('/api/plugins/claude').then(setData).catch(error => addLog('Claude plugins failed', { error: String(error) }));
  }, [addLog]);
  return (
    <Panel title="Claude plugin marketplaces and plugins" icon={Plug}>
      <Summary count={data?.manifest?.plugins?.length ?? 0} label="plugins" />
      <TagList items={data?.manifest?.plugins ?? []} />
      <ActionBar
        preview={() => runAndLog('Claude plugins dry-run', () => API.post('/api/plugins/claude/install', { dryRun: true }), addLog)}
        apply={() => runAndLog('Claude plugins install', () => API.post('/api/plugins/claude/install', { dryRun: false }), addLog)}
        applyLabel="Install plugins"
        confirmText="Run Claude plugin marketplace/install commands?"
      />
    </Panel>
  );
}

function CodexSkills({ addLog }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    API.get('/api/skills/codex').then(setData).catch(error => addLog('Codex skills failed', { error: String(error) }));
  }, [addLog]);
  return (
    <Panel title="Codex skills sync" icon={Sparkles}>
      <div className="metrics">
        <Metric label="manifest" value={data?.manifest?.length ?? 0} />
        <Metric label="copyable" value={data?.copyable ?? 0} />
        <Metric label="missing" value={data?.missing ?? 0} />
      </div>
      <TagList items={(data?.manifest ?? []).map(item => `${item.destination} <- ${item.marketplace}/${item.plugin}`)} />
      <ActionBar
        preview={() => runAndLog('Codex skills dry-run', () => API.post('/api/skills/codex/sync', { dryRun: true }), addLog)}
        apply={() => runAndLog('Codex skills sync', () => API.post('/api/skills/codex/sync', { dryRun: false }), addLog)}
        applyLabel="Sync skills"
        confirmText="Copy Codex skills into the configured agents home?"
      />
    </Panel>
  );
}

function ProjectPanel({ addLog }) {
  const [form, setForm] = React.useState({
    agent: 'codex',
    projectPath: '',
    scope: 'local',
    type: 'skill',
    name: 'personal-workflow',
    enabled: true,
  });
  const [features, setFeatures] = React.useState(null);

  React.useEffect(() => {
    API.get(`/api/project/features?agent=${form.agent}`).then(setFeatures).catch(() => setFeatures(null));
  }, [form.agent]);

  return (
    <Panel title="Project overrides" icon={FolderGit2}>
      <FormGrid>
        <SelectInput label="Agent" value={form.agent} onChange={agent => setForm({ ...form, agent })} options={['claude', 'codex']} />
        <TextInput label="Project path" value={form.projectPath} onChange={projectPath => setForm({ ...form, projectPath })} placeholder={window.location.pathname} />
        <SelectInput label="Scope" value={form.scope} onChange={scope => setForm({ ...form, scope })} options={['local', 'tracked']} />
        <SelectInput label="Feature type" value={form.type} onChange={type => setForm({ ...form, type })} options={['plugin', 'skill', 'hook', 'instruction']} />
        <TextInput label="Feature name" value={form.name} onChange={name => setForm({ ...form, name })} />
        <SelectInput label="Enabled" value={String(form.enabled)} onChange={enabled => setForm({ ...form, enabled: enabled === 'true' })} options={['true', 'false']} />
      </FormGrid>
      <div className="buttonRow">
        <button onClick={() => runAndLog('Project status', () => API.get(`/api/project/status?agent=${form.agent}&projectPath=${encodeURIComponent(form.projectPath || '.')}`), addLog)} type="button">Status</button>
        <button onClick={() => runAndLog('Project init', () => API.post('/api/project/init', cleanEmpty(form)), addLog)} type="button">Init profile</button>
        <button onClick={() => runAndLog('Project feature change', () => API.post('/api/project/feature', cleanEmpty(form)), addLog)} type="button">Save feature</button>
      </div>
      <Details title="Available defaults" value={features} />
    </Panel>
  );
}

function SoundsPanel({ addLog }) {
  const [form, setForm] = React.useState({ agent: 'codex', event: 'agent_turn_complete', soundName: '' });
  const [settings, setSettings] = React.useState(null);
  const soundNames = (settings?.sounds ?? []).map(sound => sound.name);

  const load = React.useCallback(() => {
    API.get(`/api/sounds?agent=${form.agent}`).then(setSettings).catch(error => addLog('Sounds failed', { error: String(error) }));
  }, [addLog, form.agent]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!soundNames.length || soundNames.includes(form.soundName)) return;
    setForm(current => ({ ...current, soundName: soundNames[0] }));
  }, [form.soundName, soundNames]);

  async function upload(file) {
    if (!file) return;
    const contentBase64 = await fileToBase64(file);
    const result = await API.post('/api/sounds/upload', {
      agent: form.agent,
      assignEvent: form.event,
      fileName: file.name,
      contentBase64,
    });
    addLog('Sound uploaded and assigned', result);
    load();
  }

  return (
    <Panel title="Sound library and event assignments" icon={Bell}>
      <FormGrid>
        <SelectInput label="Agent" value={form.agent} onChange={agent => setForm({ ...form, agent })} options={['claude', 'codex']} />
        <SelectInput label="Event" value={form.event} onChange={event => setForm({ ...form, event })} options={settings?.events ?? []} />
        {soundNames.length > 0 ? (
          <SelectInput label="Existing sound" value={form.soundName} onChange={soundName => setForm({ ...form, soundName })} options={soundNames} />
        ) : null}
        <label className="field">
          Upload audio
          <input
            type="file"
            accept=".mp3,.wav,.ogg,.m4a,.flac"
            onChange={event => {
              void upload(event.target.files?.[0]).catch(error =>
                addLog('Sound upload failed', { error: String(error) }),
              );
              event.currentTarget.value = '';
            }}
          />
        </label>
      </FormGrid>
      <div className="buttonRow">
        <button
          onClick={() => runAndLog('Assign sound', () => API.post('/api/sounds/assign', { ...form, soundNames: [form.soundName] }), addLog)}
          type="button"
          disabled={!form.soundName}
        >
          Assign selected
        </button>
        <button onClick={() => runAndLog('Test first sound', () => API.post('/api/sounds/test', { path: settings?.sounds?.[0]?.path }), addLog)} type="button" disabled={!settings?.sounds?.[0]}>Test first</button>
      </div>
      <TagList items={(settings?.sounds ?? []).map(sound => sound.name)} empty="No sounds found" />
    </Panel>
  );
}

function StatuslinePanel({ addLog }) {
  const [form, setForm] = React.useState({ home: '', enabled: true, force: false });
  const [data, setData] = React.useState(null);

  const load = React.useCallback(() => {
    const query = form.home ? `?home=${encodeURIComponent(form.home)}` : '';
    API.get(`/api/statusline${query}`).then(setData).catch(error => addLog('Statusline failed', { error: String(error) }));
  }, [addLog, form.home]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (typeof data?.config?.enabled === 'boolean') {
      setForm(current => ({ ...current, enabled: data.config.enabled }));
    }
  }, [data?.config?.enabled]);

  async function install(dryRun) {
    const result = await API.post('/api/statusline/install', cleanEmpty({
      home: form.home,
      dryRun,
      force: form.force,
      enabled: form.enabled,
    }));
    addLog(dryRun ? 'Statusline dry-run' : 'Statusline applied', result);
    if (!dryRun) load();
  }

  return (
    <Panel title="Claude statusline" icon={Activity}>
      <div className="list">
        <StatusRow
          label="Settings"
          detail={data?.settingsPath ?? '~/.claude/settings.json'}
          ok={data?.installed}
          okText="installed"
          failText={data?.conflict ? 'custom' : 'missing'}
        />
        <StatusRow
          label="Managed config"
          detail={data?.configPath ?? '~/.claude/statusline.json'}
          ok={data?.config?.enabled}
          okText="enabled"
          failText="disabled"
        />
      </div>
      <FormGrid>
        <TextInput label="Claude home" value={form.home} onChange={home => setForm({ ...form, home })} placeholder="~/.claude" />
        <SelectInput label="Enable statusline" value={String(form.enabled)} onChange={enabled => setForm({ ...form, enabled: enabled === 'true' })} options={['true', 'false']} />
        <SelectInput label="Overwrite custom statusLine" value={String(form.force)} onChange={force => setForm({ ...form, force: force === 'true' })} options={['false', 'true']} />
      </FormGrid>
      <div className="statuslinePreview">
        {ansiToSpans(data?.preview ?? '').map((part, index) => (
          part.text === '\n' ? <br key={index} /> : <span key={index} style={part.style}>{part.text}</span>
        ))}
      </div>
      <ActionBar
        preview={() => install(true)}
        apply={() => install(false)}
        applyLabel="Install statusline"
        confirmText="Apply Claude statusline settings?"
      />
    </Panel>
  );
}

function CleanupPanel({ addLog, refreshStatus }) {
  const [form, setForm] = React.useState({
    agent: 'codex',
    target: 'global',
    home: '',
    projectPath: '',
    scope: 'local',
    wipe: false,
  });

  async function run(dryRun) {
    const pathName = form.target === 'global' ? '/api/cleanup/global' : '/api/cleanup/project';
    const payload = cleanEmpty({ ...form, dryRun, confirmWipe: !dryRun && form.wipe });
    const result = await API.post(pathName, payload);
    addLog(dryRun ? 'Cleanup dry-run' : 'Cleanup applied', result);
    if (!dryRun) await refreshStatus();
  }

  return (
    <Panel title="Cleanup managed files" icon={ShieldAlert}>
      <FormGrid>
        <SelectInput label="Agent" value={form.agent} onChange={agent => setForm({ ...form, agent })} options={['claude', 'codex']} />
        <SelectInput label="Target" value={form.target} onChange={target => setForm({ ...form, target })} options={['global', 'project']} />
        <TextInput label="Home" value={form.home} onChange={home => setForm({ ...form, home })} placeholder="Only for global cleanup" />
        <TextInput label="Project path" value={form.projectPath} onChange={projectPath => setForm({ ...form, projectPath })} placeholder="Only for project cleanup" />
        <SelectInput label="Scope" value={form.scope} onChange={scope => setForm({ ...form, scope })} options={['local', 'tracked', 'both']} />
        <SelectInput label="Wipe global home" value={String(form.wipe)} onChange={wipe => setForm({ ...form, wipe: wipe === 'true' })} options={['false', 'true']} />
      </FormGrid>
      <ActionBar
        preview={() => run(true)}
        apply={() => run(false)}
        applyLabel="Apply cleanup"
        confirmText={form.wipe ? 'This will wipe the global home if safety checks pass. Continue?' : 'Apply cleanup?'}
      />
    </Panel>
  );
}

function SerenaPanel({ status, refreshStatus, addLog }) {
  return (
    <Panel title="Serena MCP status" icon={Server}>
      <SerenaSummary serena={status?.serena} />
      <div className="buttonRow">
        <button onClick={() => runAndLog('Serena status', () => API.get('/api/serena/status'), addLog)} type="button">Refresh Serena</button>
        <button onClick={refreshStatus} type="button">Refresh all</button>
      </div>
    </Panel>
  );
}

function LogsPanel({ logs }) {
  return (
    <Panel title="Operation log" icon={Terminal}>
      {logs.length === 0 ? <p className="muted">No operations yet.</p> : null}
      <div className="logs">
        {logs.map(log => (
          <details key={log.id} open>
            <summary>{log.title} <span>{log.ts.toLocaleTimeString()}</span></summary>
            <pre>{JSON.stringify(log.payload, null, 2)}</pre>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="panel">
      <h2>
        <Icon size={18} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ActionBar({ preview, apply, applyLabel, confirmText }) {
  return (
    <div className="actionBar">
      <button onClick={preview} type="button">Dry-run</button>
      <button
        className="primary"
        onClick={() => {
          if (window.confirm(confirmText)) apply();
        }}
        type="button"
      >
        <Save size={15} />
        {applyLabel}
      </button>
    </div>
  );
}

function StatusRow({ label, detail, ok, okText = 'available', failText = 'missing' }) {
  return (
    <div className="statusRow">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <span className={ok ? 'pill ok' : 'pill warn'}>{ok ? okText : failText}</span>
    </div>
  );
}

function SerenaSummary({ serena }) {
  return (
    <div className="list">
      <StatusRow label="uv" detail={serena?.uv?.command ?? 'not found'} ok={serena?.uv?.available} />
      <StatusRow label="serena" detail={serena?.serena?.command ?? 'not found'} ok={serena?.serena?.available} />
      <div className="statusRow">
        <div>
          <strong>Dashboard</strong>
          <span>{serena?.dashboardUrl ?? 'http://localhost:24282/dashboard/index.html'}</span>
        </div>
      </div>
    </div>
  );
}

function FormGrid({ children }) {
  return <div className="formGrid">{children}</div>;
}

function TextInput({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="field">
      {label}
      <input value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Summary({ count, label }) {
  return <div className="summary"><Metric label={label} value={count} /></div>;
}

function TagList({ items, empty = 'Nothing found' }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <div className="tags">{items.map(item => <span key={item}>{item}</span>)}</div>;
}

function Details({ title, value }) {
  return (
    <details className="details">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

const ANSI_COLORS = {
  '0;31': '#ef4444',
  '0;32': '#22c55e',
  '0;33': '#f59e0b',
  '0;36': '#22d3ee',
  '0;37': '#e2e8f0',
  '0;90': '#94a3b8',
};

function ansiToSpans(text) {
  const spans = [];
  let i = 0;
  let style = {};
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i + 2);
      if (end === -1) break;
      const code = text.slice(i + 2, end);
      i = end + 1;
      if (code === '0' || code === '') {
        style = {};
      } else if (code === '1') {
        style = { ...style, fontWeight: 700 };
      } else if (code === '2') {
        style = { ...style, opacity: 0.65 };
      } else if (ANSI_COLORS[code]) {
        style = { ...style, color: ANSI_COLORS[code] };
      }
      continue;
    }
    let j = i;
    while (j < text.length && !(text[j] === '\x1b' && text[j + 1] === '[')) j += 1;
    const chunk = text.slice(i, j);
    for (const part of chunk.split(/(\n)/)) {
      if (part) spans.push({ text: part, style: { ...style } });
    }
    i = j;
  }
  return spans;
}

async function runAndLog(title, fn, addLog) {
  try {
    addLog(title, await fn());
  } catch (error) {
    addLog(`${title} failed`, { error: String(error) });
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function cleanEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== ''));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
