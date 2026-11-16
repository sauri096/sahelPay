import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, fcfa, getToken, ROLE_LABELS, setToken, TX_LABELS, when } from './api';

type Tab = 'dashboard' | 'users' | 'kyc' | 'transactions' | 'float' | 'ledger';

const TABS: [Tab, string][] = [
  ['dashboard', 'Tableau de bord'],
  ['users', 'Utilisateurs'],
  ['kyc', 'Vérifications KYC'],
  ['transactions', 'Transactions'],
  ['float', 'Float agents'],
  ['ledger', 'Grand livre & audit'],
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState<Tab>('dashboard');

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <aside>
        <div className="brand">SahelPay <span>Admin</span></div>
        <nav>
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
        <button className="logout" onClick={() => { setToken(null); setAuthed(false); }}>Déconnexion</button>
      </aside>
      <main>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'users' && <Users />}
        {tab === 'kyc' && <Kyc />}
        {tab === 'transactions' && <Transactions />}
        {tab === 'float' && <Float />}
        {tab === 'ledger' && <Ledger />}
      </main>
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { fn().then(setData).catch((e) => setError(e.message)); }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header><h2>{title}</h2>{actions}</header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('+221770000001');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ token: string; user: { role: string } }>('/auth/login', { body: { phone, pin } });
      if (r.user.role !== 'admin') throw new Error('Ce compte n\'est pas administrateur');
      setToken(r.token);
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand dark">SahelPay <span>Admin</span></div>
        <label>Téléphone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label>Code PIN<input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">Se connecter</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Dashboard() {
  const { data, error } = useLoad(() => api('/admin/stats'));
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Chargement…</p>;
  const volume30 = data.last30Days.reduce((s: number, r: any) => s + r.volume, 0);
  const maxDaily = Math.max(1, ...data.daily.map((d: any) => d.volume));
  return (
    <>
      <h1>Tableau de bord</h1>
      <div className="kpis">
        <Kpi label="Monnaie électronique en circulation" value={fcfa(data.walletsTotal)} />
        <Kpi label="Volume 30 jours" value={fcfa(volume30)} />
        <Kpi label="Revenus de frais" value={fcfa(data.feeRevenue)} />
        <Kpi label="KYC en attente" value={String(data.pendingKyc)} />
      </div>
      <div className="grid2">
        <Panel title="Volume journalier (14 jours)">
          <div className="bars">
            {data.daily.length === 0 && <p className="muted">Pas encore de transactions.</p>}
            {data.daily.map((d: any) => (
              <div key={d.day} className="bar" title={`${d.day} : ${fcfa(d.volume)} (${d.count} op.)`}>
                <div style={{ height: `${(d.volume / maxDaily) * 100}%` }} />
                <span>{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Répartition 30 jours">
          <table>
            <thead><tr><th>Type</th><th className="num">Nombre</th><th className="num">Volume</th></tr></thead>
            <tbody>
              {data.last30Days.map((r: any) => (
                <tr key={r.type}><td>{TX_LABELS[r.type]}</td><td className="num">{r.count}</td><td className="num">{fcfa(r.volume)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Utilisateurs : {Object.entries(data.usersByRole).map(([k, v]) => `${ROLE_LABELS[k]} ${v}`).join(' · ')}
          </p>
        </Panel>
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong></div>;
}

// ---------------------------------------------------------------------------
function Users() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const { data, error, reload } = useLoad(
    () => api(`/admin/users?${new URLSearchParams({ ...(search && { search }), ...(role && { role }) })}`),
    [search, role],
  );
  const [showCreate, setShowCreate] = useState(false);

  const toggle = async (u: any) => {
    const status = u.status === 'active' ? 'blocked' : 'active';
    if (!confirm(`${status === 'blocked' ? 'Bloquer' : 'Débloquer'} ${u.fullName} ?`)) return;
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status } }).catch((e) => alert(e.message));
    reload();
  };

  return (
    <>
      <h1>Utilisateurs</h1>
      <div className="toolbar">
        <input placeholder="Rechercher (nom, téléphone, code)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous les rôles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="primary" onClick={() => setShowCreate((s) => !s)}>+ Créer un compte</button>
      </div>
      {showCreate && <CreateUser onDone={() => { setShowCreate(false); reload(); }} />}
      {error && <p className="error">{error}</p>}
      <Panel title={`${data?.items.length ?? 0} comptes`}>
        <table>
          <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôle</th><th>Code</th><th>KYC</th><th className="num">Solde</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {data?.items.map((u: any) => (
              <tr key={u.id}>
                <td>{u.fullName}{u.businessName && <div className="muted small">{u.businessName}</div>}</td>
                <td>{u.phone}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{u.publicCode ?? '—'}</td>
                <td>Niv. {u.kycLevel}</td>
                <td className="num">{fcfa(u.balance)}</td>
                <td><span className={`tag ${u.status}`}>{u.status === 'active' ? 'Actif' : 'Bloqué'}</span></td>
                <td>{u.role !== 'admin' && <button className="link" onClick={() => toggle(u)}>{u.status === 'active' ? 'Bloquer' : 'Débloquer'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function CreateUser({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ phone: '+221', fullName: '', pin: '', role: 'agent', businessName: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/users', { body: { ...f, businessName: f.businessName || undefined } });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <Panel title="Nouveau compte (agent, marchand, admin)">
      <form className="inline" onSubmit={submit}>
        <input placeholder="Téléphone" value={f.phone} onChange={set('phone')} />
        <input placeholder="Nom complet" value={f.fullName} onChange={set('fullName')} />
        <input placeholder="Nom commercial" value={f.businessName} onChange={set('businessName')} />
        <select value={f.role} onChange={set('role')}>
          <option value="agent">Agent</option><option value="merchant">Marchand</option>
          <option value="customer">Client</option><option value="admin">Admin</option>
        </select>
        <input placeholder="PIN initial" maxLength={4} value={f.pin} onChange={set('pin')} />
        <button className="primary">Créer</button>
      </form>
      {error && <p className="error">{error}</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
function Kyc() {
  const { data, error, reload } = useLoad(() => api('/admin/kyc'));
  const review = async (id: string, decision: 'approved' | 'rejected') => {
    const note = decision === 'rejected' ? prompt('Motif du rejet ?') ?? undefined : undefined;
    await api(`/admin/kyc/${id}/review`, { body: { decision, note } }).catch((e) => alert(e.message));
    reload();
  };
  return (
    <>
      <h1>Vérifications KYC</h1>
      {error && <p className="error">{error}</p>}
      <Panel title="Demandes en attente">
        {data?.items.length === 0 && <p className="muted">Aucune demande en attente.</p>}
        <table>
          <thead><tr><th>Date</th><th>Client</th><th>Téléphone</th><th>Document</th><th>Numéro</th><th /></tr></thead>
          <tbody>
            {data?.items.map((k: any) => (
              <tr key={k.id}>
                <td>{when(k.created_at)}</td><td>{k.full_name}</td><td>{k.phone}</td>
                <td>{k.doc_type}</td><td><code>{k.doc_number}</code></td>
                <td className="actions">
                  <button className="primary small" onClick={() => review(k.id, 'approved')}>Approuver</button>
                  <button className="danger small" onClick={() => review(k.id, 'rejected')}>Rejeter</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function Transactions() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const { data, error, reload } = useLoad(
    () => api(`/admin/transactions?${new URLSearchParams({ ...(search && { search }), ...(type && { type }) })}`),
    [search, type],
  );
  const reverse = async (t: any) => {
    const reason = prompt(`Annuler ${t.reference} (${fcfa(t.amount)}) ? Motif :`);
    if (!reason) return;
    await api(`/admin/transactions/${t.id}/reverse`, { body: { reason } }).catch((e) => alert(e.message));
    reload();
  };
  return (
    <>
      <h1>Transactions</h1>
      <div className="toolbar">
        <input placeholder="Référence ou téléphone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tous les types</option>
          {Object.entries(TX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <Panel title="Dernières transactions">
        <table>
          <thead><tr><th>Date</th><th>Référence</th><th>Type</th><th>De</th><th>Vers</th><th className="num">Montant</th><th className="num">Frais</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {data?.items.map((t: any) => (
              <tr key={t.id}>
                <td>{when(t.created_at)}</td>
                <td><code>{t.reference}</code></td>
                <td>{TX_LABELS[t.type]}</td>
                <td>{t.from_name ?? '—'}<div className="muted small">{t.from_phone}</div></td>
                <td>{t.to_name ?? '—'}<div className="muted small">{t.to_phone}</div></td>
                <td className="num">{fcfa(t.amount)}</td>
                <td className="num">{fcfa(t.fee)}</td>
                <td><span className={`tag ${t.status}`}>{t.status === 'completed' ? 'Effectuée' : 'Annulée'}</span></td>
                <td>{t.status === 'completed' && t.type !== 'reversal' && <button className="link" onClick={() => reverse(t)}>Annuler</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function Float() {
  const { data, reload } = useLoad(() => api('/admin/users?role=agent'));
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (kind: 'issue' | 'redeem') => {
    setMsg(null);
    try {
      const r = await api(`/admin/float/${kind}`, {
        body: { agentPhone: phone, amount: Number(amount) },
        idempotencyKey: crypto.randomUUID(),
      });
      setMsg(`✓ ${kind === 'issue' ? 'Float émis' : 'Float racheté'} : ${fcfa(r.transaction.amount)} (réf ${r.transaction.reference})`);
      setAmount('');
      reload();
    } catch (e: any) {
      setMsg(`Erreur : ${e.message}`);
    }
  };

  return (
    <>
      <h1>Float agents</h1>
      <Panel title="Approvisionner ou racheter">
        <p className="muted small">
          Émettez du float uniquement après réception des espèces de l'agent sur le compte de cantonnement.
          Le rachat correspond à un virement bancaire vers l'agent.
        </p>
        <div className="inline">
          <input placeholder="Téléphone de l'agent" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input placeholder="Montant (FCFA)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          <button className="primary" disabled={!phone || !amount} onClick={() => run('issue')}>Émettre</button>
          <button className="secondary" disabled={!phone || !amount} onClick={() => run('redeem')}>Racheter</button>
        </div>
        {msg && <p className={msg.startsWith('Erreur') ? 'error' : 'ok'}>{msg}</p>}
      </Panel>
      <Panel title="Agents">
        <table>
          <thead><tr><th>Agent</th><th>Téléphone</th><th>Code</th><th className="num">Float</th><th /></tr></thead>
          <tbody>
            {data?.items.map((u: any) => (
              <tr key={u.id}>
                <td>{u.businessName ?? u.fullName}</td><td>{u.phone}</td><td>{u.publicCode}</td>
                <td className="num">{fcfa(u.balance)}</td>
                <td><button className="link" onClick={() => setPhone(u.phone)}>Sélectionner</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function Ledger() {
  const check = useLoad(() => api('/admin/ledger/check'));
  const audit = useLoad(() => api('/admin/audit'));
  const c = check.data;
  return (
    <>
      <h1>Grand livre & audit</h1>
      <Panel title="Contrôle d'intégrité" actions={<button className="secondary small" onClick={check.reload}>Relancer</button>}>
        {c && (
          <div className={`integrity ${c.ok ? 'good' : 'bad'}`}>
            <strong>{c.ok ? '✓ Grand livre équilibré' : '✗ Anomalie détectée'}</strong>
            <p>Monnaie électronique en circulation : <b>{fcfa(c.eMoneyInCirculation)}</b> — doit être couverte à 100 % par le compte de cantonnement à la banque.</p>
            {!c.ok && <pre>{JSON.stringify({ unbalanced: c.unbalancedTransactions, drift: c.balanceDrift }, null, 2)}</pre>}
          </div>
        )}
      </Panel>
      <Panel title="Journal d'audit (actions admin)">
        <table>
          <thead><tr><th>Date</th><th>Admin</th><th>Action</th><th>Détails</th></tr></thead>
          <tbody>
            {audit.data?.items.map((a: any) => (
              <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.actor_name}</td><td><code>{a.action}</code></td><td className="small">{JSON.stringify(a.details)}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
