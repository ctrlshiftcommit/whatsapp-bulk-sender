import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, Bell, CalendarClock, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, Clock3, ContactRound, Download, File, FileText, Film,
  Gauge, Image, Import, LayoutDashboard, ListFilter, Megaphone, MessageCircle,
  MessageSquareText, MoreHorizontal, Music2, Paperclip, Pause, Pencil, Phone,
  Play, Plus, RefreshCw, Search, Send, Settings, ShieldAlert, Sparkles, Square, Copy,
  Trash2, Upload, Users, Wifi, X,
} from "lucide-react";

const api = window.wasend || {
  getConnection: async () => ({ status: "disconnected" }),
  connect: async () => ({ status: "waiting-for-scan" }),
  disconnect: async () => ({ status: "disconnected" }),
  getSettings: async () => ({}),
  saveSettings: async () => true,
  listContacts: async () => [],
  addContact: async (contact) => ({ ...contact, id: Date.now() }),
  removeContact: async () => true,
  importContacts: async ({ content }) => content.split(/\r?\n/).map((phone, index) => ({ id: Date.now() + index, name: "", phone: phone.startsWith("+") ? phone : `+91${phone.replace(/\D/g, "")}`, tags: ["imported"], custom1: "", custom2: "" })).filter((contact) => contact.phone.length > 3),
  importContactFile: async () => [],
  exportContacts: async () => true,
  listTemplates: async () => [],
  saveTemplate: async (template) => ({ ...template, id: Date.now() }),
  listCampaigns: async () => [],
  getDashboardSummary: async () => ({ contacts: 0, activeCampaigns: 0, sent: 0, failed: 0, successRate: 0, timeline: [] }),
  createCampaign: async (campaign) => ({ ...campaign, id: Date.now() }),
  startCampaign: async () => true,
  resumeCampaign: async () => true,
  pauseCampaign: async () => true,
  stopCampaign: async () => true,
  duplicateCampaign: async () => true,
  removeCampaign: async () => true,
  listMedia: async () => [],
  addMedia: async () => null,
  listBlacklist: async () => [],
  addBlacklist: async () => true,
  removeBlacklist: async () => true,
  removeTemplate: async () => true,
  duplicateTemplate: async () => true,
  exportReportCsv: async () => true,
  exportReportPdf: async () => true,
  resetApp: async () => true,
};

const nav = [
  ["Dashboard", LayoutDashboard],
  ["Contacts", ContactRound],
  ["Templates", MessageSquareText],
  ["Campaigns", Megaphone],
  ["Media Library", Paperclip],
  ["Reports", BarChart3],
  ["Settings", Settings],
];

const cx = (...classes) => classes.filter(Boolean).join(" ");
const initials = (name) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

function App() {
  const [page, setPage] = useState("Dashboard");
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [media, setMedia] = useState([]);
  const [summary, setSummary] = useState({ contacts: 0, activeCampaigns: 0, sent: 0, failed: 0, successRate: 0, timeline: [] });
  const [connection, setConnection] = useState({ status: "disconnected" });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const lastConnectionStatus = useRef("disconnected");
  const notifiedCampaignStatuses = useRef(new Map());

  const addNotification = (message, tone = "info") => {
    setNotifications((items) => [{
      id: `${Date.now()}-${Math.random()}`,
      message,
      tone,
      createdAt: new Date().toISOString(),
      read: false,
    }, ...items].slice(0, 30));
  };
  const recordConnectionStatus = (value) => {
    setConnection(value);
    if (value.status !== lastConnectionStatus.current) {
      const message = {
        connected: `WhatsApp connected${value.profileName ? ` as ${value.profileName}` : ""}.`,
        disconnected: value.error ? `WhatsApp disconnected: ${value.error}` : "WhatsApp disconnected.",
        "opening-browser": "Opening the WhatsApp Web browser.",
        "waiting-for-scan": "WhatsApp Web is waiting for a QR scan in the browser window.",
      }[value.status];
      if (message) addNotification(message, value.status === "disconnected" && value.error ? "error" : value.status === "connected" ? "success" : "info");
      lastConnectionStatus.current = value.status;
    }
  };

  useEffect(() => {
    api.getConnection().then(recordConnectionStatus).catch(() => {});
    if (window.wasend) api.getSettings().then((settings) => settings.reconnect !== false && api.connect().then(recordConnectionStatus)).catch(() => {});
    Promise.all([api.listContacts(), api.listTemplates(), api.listCampaigns(), api.listMedia(), api.getDashboardSummary()])
      .then(([freshContacts, freshTemplates, freshCampaigns, freshMedia, freshSummary]) => {
        setContacts(freshContacts);
        setTemplates(freshTemplates);
        setCampaigns(freshCampaigns);
        setMedia(freshMedia);
        setSummary(freshSummary);
      })
      .finally(() => setLoading(false));
    const listener = (value) => recordConnectionStatus(value);
    api.onConnection?.(listener);
    const progress = ({ campaignId, sent, total, status }) => {
      setCampaigns((items) => items.map((campaign) => campaign.id === campaignId ? { ...campaign, sent: sent ?? campaign.sent, pending: total ? total - (sent || 0) : campaign.pending, progress: total ? Math.round(((sent || 0) / total) * 100) : campaign.progress, status } : campaign));
      const priorStatus = notifiedCampaignStatuses.current.get(campaignId);
      if (status && status !== priorStatus && ["Running", "Paused", "Completed", "Failed", "Stopped"].includes(status)) {
        addNotification(`Campaign ${status.toLowerCase()}.`, status === "Completed" ? "success" : status === "Failed" ? "error" : "info");
        notifiedCampaignStatuses.current.set(campaignId, status);
      }
    };
    api.onCampaignProgress?.(progress);
    return () => { api.offConnection?.(listener); api.offCampaignProgress?.(); };
  }, []);
  useEffect(() => {
    const handleShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setModal("campaign"); }
      if (event.key.toLowerCase() === "i") { event.preventDefault(); setModal("import"); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const notify = (message, tone = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2800);
  };

  const context = { page, setPage, contacts, setContacts, templates, setTemplates, campaigns, setCampaigns, media, setMedia, summary, setSummary, loading, connection, setConnection, setModal, notify };
  const Page = { Dashboard, ContactsPage, TemplatesPage, CampaignsPage, MediaPage, ReportsPage, SettingsPage }[page === "Media Library" ? "MediaPage" : `${page}Page`] || Dashboard;

  return (
    <div className="flex min-h-screen bg-mist">
      <Sidebar page={page} setPage={setPage} connection={connection} campaigns={campaigns} />
      <main className="ml-[238px] min-h-screen w-[calc(100%-238px)]">
        <Header page={page} setModal={setModal} connection={connection} notifications={notifications} notificationsOpen={notificationsOpen} setNotificationsOpen={setNotificationsOpen} setNotifications={setNotifications} />
        <div className="px-8 pb-10 pt-5">
          {page === "Dashboard" && <PolicyBanner />}
          <Page {...context} />
        </div>
      </main>
      {modal === "contact" && <ContactModal onClose={() => setModal(null)} onSave={async (contact) => { const saved = await api.addContact(contact); setContacts((items) => [...items.filter((item) => item.phone !== saved.phone), saved]); setSummary(await api.getDashboardSummary()); setModal(null); notify("Contact added successfully"); }} />}
      {modal === "template" && <TemplateModal onClose={() => setModal(null)} onSave={async (template) => { const saved = await api.saveTemplate(template); setTemplates((items) => [{ ...template, id: saved.id || Date.now() }, ...items]); setModal(null); notify("Template saved"); }} />}
      {modal === "campaign" && <CampaignWizard contacts={contacts} templates={templates} media={media} onClose={() => setModal(null)} onLaunch={async (campaign) => { const saved = await api.createCampaign(campaign); setCampaigns((items) => [{ ...campaign, id: saved.id || Date.now() }, ...items]); setSummary(await api.getDashboardSummary()); setModal(null); notify("Campaign created. Review policy limits before launch.", "warning"); }} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onImport={async (payload) => { const added = await api.importContacts({ ...payload, defaultCountryCode: "91" }); setContacts(await api.listContacts()); setSummary(await api.getDashboardSummary()); setModal(null); notify(`${added.length} contacts imported`); }} onImportFile={async () => { const added = await api.importContactFile(); setContacts(await api.listContacts()); setSummary(await api.getDashboardSummary()); setModal(null); notify(`${added.length} contacts imported`); }} />}
      {modal === "connect" && <ConnectionModal connection={connection} onClose={() => setModal(null)} onConnect={async () => recordConnectionStatus(await api.connect())} onDisconnect={async () => { await api.disconnect?.(); recordConnectionStatus({ status: "disconnected" }); setModal(null); notify("WhatsApp disconnected", "warning"); }} />}
      {onboarding && <Onboarding onClose={() => setOnboarding(false)} setModal={setModal} />}
      {toast && <Toast {...toast} />}
      <button onClick={() => setOnboarding(true)} className="fixed bottom-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white shadow-lg transition hover:scale-105" aria-label="Open onboarding"><CircleHelp size={18} /></button>
    </div>
  );
}

function Sidebar({ page, setPage, connection, campaigns }) {
  const activeCampaigns = campaigns.filter((campaign) => ["Running", "Paused", "Scheduled"].includes(campaign.status)).length;
  return <aside className="fixed inset-y-0 left-0 z-20 flex w-[238px] flex-col bg-[#062753] px-3.5 py-5 text-white">
    <div className="mb-8 flex items-center gap-2.5 px-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald text-white"><MessageCircle size={20} fill="currentColor" /></div>
      <div><div className="text-[17px] font-bold leading-none">WASend</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-300">Campaign Desk</div></div>
    </div>
    <nav className="space-y-1">
      {nav.map(([label, Icon]) => <button key={label} onClick={() => setPage(label)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition", page === label ? "bg-white/14 text-white" : "text-slate-300 hover:bg-white/7 hover:text-white")}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === "Campaigns" && activeCampaigns > 0 && <span className="ml-auto rounded-full bg-emerald px-1.5 py-0.5 text-[10px] font-bold">{activeCampaigns}</span>}
      </button>)}
    </nav>
    <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold"><span className={cx("h-2 w-2 rounded-full", connection.status === "connected" ? "bg-emerald-400" : "bg-amber-400")} /> WhatsApp {connection.status}</div>
      <p className="mt-1.5 truncate text-[11px] text-slate-300">{connection.phone || "Scan QR to connect"}</p>
    </div>
  </aside>;
}

function Header({ page, setModal, connection, notifications, notificationsOpen, setNotificationsOpen, setNotifications }) {
  const profileName = connection.profileName || "Connect WhatsApp";
  const profileInitials = connection.profileName ? initials(connection.profileName) : "--";
  const unread = notifications.filter((item) => !item.read).length;
  const toggleNotifications = () => {
    setNotificationsOpen((open) => {
      if (!open) setNotifications((items) => items.map((item) => ({ ...item, read: true })));
      return !open;
    });
  };
  return <header className="flex h-[76px] items-center justify-between border-b border-slate-200 bg-white px-8">
    <div><h1 className="text-xl font-bold text-ink">{page}</h1><p className="mt-1 text-xs text-slate-500">{page === "Dashboard" ? "Welcome back. Here is what is happening today." : `Manage your ${page.toLowerCase()} in one place.`}</p></div>
    <div className="flex items-center gap-3">
      <button onClick={() => setModal("campaign")} className="btn-primary"><Plus size={16} /> New Campaign</button>
      <div className="relative">
        <button onClick={toggleNotifications} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Open notifications" aria-expanded={notificationsOpen}><Bell size={17} />{unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}</button>
        {notificationsOpen && <NotificationCenter notifications={notifications} onClear={() => setNotifications([])} />}
      </div>
      <button onClick={() => setModal("connect")} className="flex items-center gap-2 border-l border-slate-200 pl-3 text-left">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{profileInitials}</div>
        <div><div className="text-xs font-semibold text-slate-800">{profileName}</div><div className={cx("mt-0.5 flex items-center gap-1 text-[10px] capitalize", connection.status === "connected" ? "text-emerald-600" : "text-slate-500")}><span className={cx("h-1.5 w-1.5 rounded-full", connection.status === "connected" ? "bg-emerald" : "bg-slate-400")} /> {connection.status}</div></div>
        <ChevronDown size={14} className="text-slate-400" />
      </button>
    </div>
  </header>;
}

function NotificationCenter({ notifications, onClear }) {
  return <section className="absolute right-0 top-12 z-30 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-bold text-ink">Notifications</h2><p className="mt-0.5 text-[11px] text-slate-400">Connection and campaign updates</p></div>{notifications.length > 0 && <button onClick={onClear} className="text-[11px] font-bold text-slate-500 hover:text-rose-600">Clear all</button>}</div>
    {notifications.length ? <div className="max-h-80 overflow-auto">{notifications.map((item) => <div key={item.id} className="flex gap-3 border-b border-slate-100 px-4 py-3 last:border-0"><span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", item.tone === "success" ? "bg-emerald" : item.tone === "error" ? "bg-rose-500" : "bg-sky-500")} /><div><p className="text-xs leading-5 text-slate-700">{item.message}</p><p className="mt-1 text-[10px] text-slate-400">{formatNotificationTime(item.createdAt)}</p></div></div>)}</div> : <EmptyState icon={Bell} title="No notifications yet" text="Connection changes and campaign updates will appear here." compact />}
  </section>;
}

function PolicyBanner() {
  return <div className="mb-5 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
    <ShieldAlert size={18} className="shrink-0 text-amber-600" />
    <p className="text-xs leading-5"><b>Send responsibly.</b> Only message contacts who opted in. High-volume or unsolicited messaging can violate WhatsApp policies and lead to account restrictions.</p>
    <button className="ml-auto shrink-0 text-xs font-bold text-amber-700">Learn more</button>
  </div>;
}

function Dashboard({ campaigns, contacts, connection, setModal, summary, loading }) {
  const scheduled = campaigns.filter((campaign) => campaign.status === "Scheduled");
  const stats = [
    ["Total Sent", summary.sent.toLocaleString(), "All recorded sends", Send, "text-indigo-600 bg-indigo-50"],
    ["Success Rate", `${summary.successRate}%`, `${summary.failed.toLocaleString()} failed`, CheckCircle2, "text-emerald-600 bg-emerald-50"],
    ["Active Campaigns", summary.activeCampaigns.toLocaleString(), "Running, paused, or scheduled", Gauge, "text-amber-600 bg-amber-50"],
    ["Contacts", contacts.length.toLocaleString(), "Opted-in records", Users, "text-sky-600 bg-sky-50"],
  ];
  return <div className="space-y-5">
    <div className="grid grid-cols-4 gap-4">
      {stats.map(([title, value, change, Icon, color]) => <div key={title} className="panel flex items-start justify-between p-4">
        <div><p className="text-xs font-medium text-slate-500">{title}</p><p className="mt-2 text-2xl font-bold text-ink">{value}</p><p className="mt-1 text-[11px] text-slate-400">{change}</p></div>
        <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg", color)}><Icon size={18} /></span>
      </div>)}
    </div>
    <div className="grid grid-cols-[1fr_278px] gap-5">
      <section className="panel p-5"><SectionTitle title="Messages Overview" sub="Messages sent over the last 7 days" action={<button className="btn-secondary">Last 7 days <ChevronDown size={14} /></button>} /><OverviewChart timeline={summary.timeline} loading={loading} /></section>
      <ConnectionCard connection={connection} setModal={setModal} />
    </div>
    <div className="grid grid-cols-[1fr_278px] gap-5">
      <section className="panel overflow-hidden"><div className="p-5 pb-2"><SectionTitle title="Recent Campaigns" sub="Performance from your latest sends" /></div>{campaigns.length ? <CampaignTable campaigns={campaigns.slice(0, 4)} compact /> : <EmptyState icon={Megaphone} title="No campaigns yet" text="Create your first campaign when your contact list is ready." compact />}</section>
      <section className="panel p-5"><SectionTitle title="Scheduled Queue" sub="Upcoming sends" /><div className="mt-4 space-y-3">{scheduled.length ? scheduled.slice(0, 4).map((campaign) => <QueueItem key={campaign.id} name={campaign.name} time={formatDate(campaign.scheduled_at)} count={`${campaign.total} contacts`} />) : <EmptyState icon={CalendarClock} title="Nothing scheduled" text="Scheduled campaigns will appear here." compact />}</div></section>
    </div>
  </div>;
}

function OverviewChart({ timeline, loading }) {
  const values = lastSevenDays(timeline);
  const max = Math.max(...values.map((item) => item.sent), 1);
  return <div className="mt-6 flex h-[164px] items-end gap-3 border-b border-slate-100 pb-2">
    {values.map((item) => <div key={item.day} className="flex h-full flex-1 flex-col justify-end gap-2 text-center"><div className={cx("mx-auto w-[55%] rounded-t transition", loading ? "animate-pulse bg-slate-200" : "bg-emerald/85 hover:bg-emerald")} style={{ height: `${loading ? 38 : (item.sent / max) * 128}px` }} /><span className="text-[10px] text-slate-400">{item.label}</span></div>)}
  </div>;
}

function ConnectionCard({ connection, setModal }) {
  const connected = connection.status === "connected";
  const opening = connection.status === "opening-browser";
  const waiting = connection.status === "waiting-for-scan";
  return <section className="panel p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-ink">WhatsApp Connection</h2><Wifi size={16} className={connected ? "text-emerald" : "text-amber-500"} /></div>
    <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald"><Phone size={21} /></div>
    <div className="mt-4 text-sm font-bold text-slate-800">{connected ? "WhatsApp connected" : opening ? "Opening browser..." : waiting ? "Waiting for QR scan" : "Not connected"}</div>
    <p className="mt-1 text-xs text-slate-500">{connection.profileName || (waiting ? "Scan in the separate browser window" : "Connect an account to begin")}</p><p className="mt-0.5 text-xs text-slate-400">{connection.phone || (connected ? "Session active" : "No active session")}</p>
    <button onClick={() => setModal("connect")} className="btn-secondary mt-4 w-full justify-center">{connected ? "Manage connection" : waiting ? "View instructions" : "Connect WhatsApp"}</button>
  </section>;
}

function ContactsPage({ contacts, setContacts, setModal, setSummary, notify }) {
  const [query, setQuery] = useState("");
  const shown = contacts.filter((c) => `${c.name} ${c.phone} ${c.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    <div className="flex items-center justify-between"><p className="text-sm text-slate-500">{contacts.length} saved contacts with opt-in records and tags.</p><div className="flex gap-2"><button onClick={async () => { await api.exportContacts(); notify("Contacts exported to CSV"); }} className="btn-secondary"><Download size={16} /> Export</button><button onClick={() => setModal("import")} className="btn-secondary"><Import size={16} /> Import</button><button onClick={() => setModal("contact")} className="btn-primary"><Plus size={16} /> Add Contact</button></div></div>
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-4"><SearchBox value={query} setValue={setQuery} placeholder="Search name, phone, or tag" /><button className="btn-secondary"><ListFilter size={15} /> Filter</button></div>
      {shown.length ? <table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr>{["Contact", "Phone number", "Tags", "Location", "Plan", ""].map((h) => <th key={h} className="table-head px-4 py-3">{h}</th>)}</tr></thead><tbody>{shown.map((contact) => <tr key={contact.id} className="border-b border-slate-100 text-xs hover:bg-slate-50/70"><td className="px-4 py-3"><div className="flex items-center gap-2.5"><Avatar name={contact.name} /><b>{contact.name || "Unnamed contact"}</b></div></td><td className="px-4 py-3 text-slate-600">{contact.phone}</td><td className="px-4 py-3"><div className="flex gap-1">{contact.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div></td><td className="px-4 py-3 text-slate-500">{contact.custom1}</td><td className="px-4 py-3 text-slate-500">{contact.custom2}</td><td className="px-4 py-3 text-right"><button onClick={async () => { await api.removeContact(contact.id); setContacts((items) => items.filter((x) => x.id !== contact.id)); setSummary(await api.getDashboardSummary()); notify("Contact removed", "warning"); }} className="text-slate-400 hover:text-rose-500"><Trash2 size={15} /></button></td></tr>)}</tbody></table> : <EmptyState icon={ContactRound} title={query ? "No matching contacts" : "No contacts yet"} text={query ? "Try a different search term." : "Import a list or add an opted-in contact manually."} />}
    </section>
  </div>;
}

function TemplatesPage({ templates, setTemplates, setModal, notify }) {
  return <div><div className="mb-5 flex items-center justify-between"><p className="text-sm text-slate-500">Reusable, personalized messages for your approved contacts.</p><button onClick={() => setModal("template")} className="btn-primary"><Plus size={16} /> New Template</button></div>
    {templates.length ? <div className="grid grid-cols-3 gap-4">{templates.map((template) => <section key={template.id} className="panel flex min-h-[226px] flex-col p-4">
      <div className="flex items-start justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald"><MessageSquareText size={17} /></span><button className="text-slate-400"><MoreHorizontal size={17} /></button></div>
      <h3 className="mt-4 text-sm font-bold text-slate-800">{template.name}</h3><p className="mt-1 text-[11px] font-semibold text-emerald-700">{template.category}</p><p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-slate-500">{template.body}</p>
      <div className="mt-auto flex items-center justify-between pt-4 text-slate-400"><span className="text-[11px]">{template.body.length} characters</span><div className="flex gap-2"><button onClick={async () => { await api.duplicateTemplate(template.id); setTemplates((items) => [{ ...template, id: Date.now(), name: `${template.name} copy` }, ...items]); notify("Template duplicated"); }} className="hover:text-emerald" aria-label="Duplicate template"><Copy size={14} /></button><button onClick={async () => { await api.removeTemplate(template.id); setTemplates((items) => items.filter((x) => x.id !== template.id)); notify("Template deleted", "warning"); }} className="hover:text-rose-500" aria-label="Delete template"><Trash2 size={14} /></button></div></div>
    </section>)}</div> : <section className="panel"><EmptyState icon={MessageSquareText} title="No templates yet" text="Create a reusable message template for your first campaign." /></section>}
  </div>;
}

function CampaignsPage({ campaigns, setCampaigns, setModal, notify }) {
  const changeStatus = async (campaign, status) => { if (status === "Running") { if (campaign.status === "Paused") await api.resumeCampaign(campaign.id); else await api.startCampaign(campaign.id); } else if (status === "Paused") await api.pauseCampaign(campaign.id); else if (status === "Stopped") await api.stopCampaign(campaign.id); setCampaigns((items) => items.map((c) => c.id === campaign.id ? { ...c, status } : c)); notify(`Campaign ${status.toLowerCase()}`); };
  const duplicate = async (id) => { await api.duplicateCampaign(id); setCampaigns(await api.listCampaigns()); notify("Campaign duplicated as a draft"); };
  const remove = async (id) => { if (!window.confirm("Delete this campaign and its delivery logs? This cannot be undone.")) return; await api.removeCampaign(id); setCampaigns((items) => items.filter((campaign) => campaign.id !== id)); notify("Campaign deleted", "warning"); };
  return <div><div className="mb-5 flex items-center justify-between"><p className="text-sm text-slate-500">Review, schedule, and monitor opted-in campaign sends.</p><button onClick={() => setModal("campaign")} className="btn-primary"><Plus size={16} /> New Campaign</button></div>
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-4"><SearchBox placeholder="Search campaigns" /><button className="btn-secondary"><ListFilter size={15} /> All statuses</button></div>{campaigns.length ? <CampaignTable campaigns={campaigns} actions changeStatus={changeStatus} duplicate={duplicate} remove={remove} /> : <EmptyState icon={Megaphone} title="No campaigns yet" text="Create a campaign after importing opted-in contacts and a message template." />}</section>
  </div>;
}

function CampaignTable({ campaigns, compact, actions, changeStatus, duplicate, remove }) {
  return <table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr>{["Campaign", "Status", "Recipients", "Progress", "Sent date", actions ? "Actions" : ""].map((h) => <th key={h} className="table-head px-4 py-3">{h}</th>)}</tr></thead><tbody>{campaigns.map((c) => <tr key={c.id} className="border-b border-slate-100 text-xs hover:bg-slate-50/70"><td className="px-4 py-3 font-semibold text-slate-700">{c.name}</td><td className="px-4 py-3"><Status value={c.status} /></td><td className="px-4 py-3 text-slate-500">{c.total}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald" style={{ width: `${c.progress}%` }} /></div><span className="text-[11px] text-slate-400">{c.progress}%</span></div></td><td className="px-4 py-3 text-slate-500">{formatDate(c.date)}</td>{actions && <td className="px-4 py-3"><div className="flex gap-2">{c.status === "Running" ? <button onClick={() => changeStatus(c, "Paused")} className="text-amber-600" aria-label="Pause campaign"><Pause size={15} /></button> : <button onClick={() => changeStatus(c, "Running")} className="text-emerald" aria-label={c.status === "Paused" ? "Resume campaign" : "Start campaign"}><Play size={15} /></button>}<button onClick={() => changeStatus(c, "Stopped")} className="text-slate-400 hover:text-rose-500" aria-label="Stop campaign"><Square size={14} /></button><button onClick={() => duplicate(c.id)} className="text-slate-400 hover:text-emerald" aria-label="Duplicate campaign"><Copy size={14} /></button><button onClick={() => remove(c.id)} className="text-slate-400 hover:text-rose-500" aria-label="Delete campaign"><Trash2 size={14} /></button></div></td>}</tr>)}</tbody></table>;
}

function MediaPage({ media, setMedia, notify }) {
  return <div><div className="mb-5 flex items-center justify-between"><p className="text-sm text-slate-500">Reuse attachments across approved campaigns.</p><button onClick={async () => { const uploaded = await api.addMedia(); if (uploaded) { setMedia((items) => [uploaded, ...items]); notify("File added to media library"); } }} className="btn-primary"><Upload size={16} /> Upload File</button></div>
    {media.length ? <div className="grid grid-cols-4 gap-4">{media.map((file) => <section key={file.id} className="panel overflow-hidden"><div className={cx("flex h-28 items-center justify-center", file.color || "bg-slate-100")}>{String(file.type).match(/jpg|jpeg|png|gif|webp|Image/i) ? <Image size={32} /> : String(file.type).match(/mp4|Video/i) ? <Film size={32} /> : String(file.type).match(/mp3|Audio/i) ? <Music2 size={32} /> : <FileText size={32} />}</div><div className="p-3"><div className="truncate text-xs font-bold text-slate-700">{file.name || file.filename}</div><div className="mt-1 text-[11px] text-slate-400">{file.type} {file.size && `· ${file.size}`}</div></div></section>)}</div> : <section className="panel"><EmptyState icon={Paperclip} title="No attachments yet" text="Upload a file when you want to reuse it in campaigns." /></section>}
  </div>;
}

function ReportsPage({ campaigns, summary }) {
  return <div className="space-y-5"><div className="flex items-center justify-between"><p className="text-sm text-slate-500">Track outcomes and export campaign delivery logs.</p><div className="flex gap-2"><button onClick={() => api.exportReportPdf()} className="btn-secondary"><FileText size={15} /> Export PDF</button><button onClick={() => api.exportReportCsv()} className="btn-secondary"><Download size={15} /> Export CSV</button></div></div><div className="grid grid-cols-3 gap-4"><Metric label="Sent messages" value={summary.sent.toLocaleString()} /><Metric label="Failed messages" value={summary.failed.toLocaleString()} /><Metric label="Average success" value={`${summary.successRate}%`} /></div><section className="panel p-5"><SectionTitle title="Campaign performance" sub="Delivery totals by campaign" />{campaigns.length ? <div className="mt-5 space-y-4">{campaigns.map((c) => <div key={c.id} className="grid grid-cols-[180px_1fr_70px] items-center gap-4 text-xs"><b className="truncate text-slate-700">{c.name}</b><div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald" style={{ width: `${c.progress}%` }} /></div><span className="text-right text-slate-400">{c.sent} sent</span></div>)}</div> : <EmptyState icon={BarChart3} title="No report data yet" text="Delivery metrics will appear after your first campaign sends messages." />}</section></div>;
}

function SettingsPage({ notify }) {
  const [settings, setSettings] = useState({ minDelay: 8, maxDelay: 15, batch: 40, pause: 5, retries: 1, country: "+91", reconnect: true, sounds: true, maxSession: 500 });
  const [blacklist, setBlacklist] = useState([]);
  const [blockedPhone, setBlockedPhone] = useState("");
  useEffect(() => { api.listBlacklist().then(setBlacklist).catch(() => {}); }, []);
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  return <div className="grid grid-cols-[1fr_290px] gap-5"><section className="panel divide-y divide-slate-100"><div className="p-5"><SectionTitle title="Sending limits" sub="Use conservative limits and send only to opted-in contacts." /><div className="mt-5 grid grid-cols-3 gap-4"><SettingInput label="Minimum delay (sec)" value={settings.minDelay} onChange={(v) => update("minDelay", v)} /><SettingInput label="Maximum delay (sec)" value={settings.maxDelay} onChange={(v) => update("maxDelay", v)} /><SettingInput label="Max messages / session" value={settings.maxSession} onChange={(v) => update("maxSession", v)} /><SettingInput label="Batch size" value={settings.batch} onChange={(v) => update("batch", v)} /><SettingInput label="Pause between batches (min)" value={settings.pause} onChange={(v) => update("pause", v)} /><SettingInput label="Retry failed messages" value={settings.retries} onChange={(v) => update("retries", v)} /></div></div><div className="p-5"><SectionTitle title="Application preferences" /><div className="mt-4 space-y-4"><Toggle label="Auto-reconnect WhatsApp Web session" value={settings.reconnect} setValue={(v) => update("reconnect", v)} /><Toggle label="Play notification sound when a campaign completes" value={settings.sounds} setValue={(v) => update("sounds", v)} /></div></div><div className="p-5"><button onClick={() => { api.saveSettings(settings); notify("Settings saved"); }} className="btn-primary">Save settings</button></div></section><aside className="space-y-4"><section className="panel p-5"><h2 className="text-sm font-bold text-ink">Do-not-contact list</h2><p className="mt-2 text-xs leading-5 text-slate-500">Blocked numbers are skipped in every campaign.</p><div className="mt-3 flex gap-2"><input value={blockedPhone} onChange={(e) => setBlockedPhone(e.target.value)} className="input py-2" placeholder="+91..." /><button onClick={async () => { await api.addBlacklist(blockedPhone, "Manual block"); setBlacklist(await api.listBlacklist()); setBlockedPhone(""); notify("Number blocked"); }} className="btn-secondary">Add</button></div><p className="mt-3 text-[11px] text-slate-400">{blacklist.length} blocked numbers</p></section><section className="panel border-rose-200 p-5"><h2 className="text-sm font-bold text-rose-700">Danger zone</h2><p className="mt-2 text-xs leading-5 text-slate-500">Clear local campaign data or reset this application. This cannot be undone.</p><button onClick={async () => { if (window.confirm("Clear all WASend data? This cannot be undone.")) { await api.resetApp(); window.location.reload(); } }} className="mt-4 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">Reset application</button></section></aside></div>;
}

function ContactModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", phone: "", tags: ["lead"], custom1: "", custom2: "" });
  return <Modal title="Add contact" sub="Add a contact who has opted in to receive messages." onClose={onClose}><div className="grid grid-cols-2 gap-4"><Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} /><Field label="Phone number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+91 98765 43210" /><Field label="Location" value={form.custom1} onChange={(v) => setForm({ ...form, custom1: v })} /><Field label="Custom field" value={form.custom2} onChange={(v) => setForm({ ...form, custom2: v })} /></div><ModalFooter onClose={onClose} onSave={() => onSave(form)} label="Add contact" /></Modal>;
}

function TemplateModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", category: "Follow-up", body: "" });
  return <Modal title="Create template" sub="Personalize messages with variables such as {{name}} and {{phone}}." onClose={onClose}><Field label="Template name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} /><label className="label mt-4">Message body</label><textarea className="input h-40 resize-none leading-6" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /><div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>*bold* · _italic_ · ~strike~</span><span>{form.body.length} characters</span></div><ModalFooter onClose={onClose} onSave={() => onSave(form)} label="Save template" /></Modal>;
}

function ImportModal({ onClose, onImport, onImportFile }) {
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState("paste");
  const imported = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <Modal title="Import contacts" sub="Choose a file, paste phone numbers, or import a public Google Sheet." onClose={onClose}><div className="grid grid-cols-3 gap-3"><button onClick={onImportFile} className="btn-secondary justify-center py-3"><Upload size={16} /> CSV / Excel</button><button onClick={() => setMode("paste")} className={cx("btn-secondary justify-center py-3", mode === "paste" && "border-emerald bg-emerald-50")}><FileText size={16} /> Paste numbers</button><button onClick={() => setMode("sheets")} className={cx("btn-secondary justify-center py-3", mode === "sheets" && "border-emerald bg-emerald-50")}><File size={16} /> Sheets URL</button></div><label className="label mt-4">{mode === "sheets" ? "Public Google Sheets URL" : "Paste phone numbers"}</label>{mode === "sheets" ? <input value={raw} onChange={(e) => setRaw(e.target.value)} className="input" placeholder="https://docs.google.com/spreadsheets/d/..." /> : <textarea value={raw} onChange={(e) => setRaw(e.target.value)} className="input h-36 resize-none" placeholder={"9876543210\n9123456780"} />}<p className="mt-2 text-xs text-slate-400">{mode === "sheets" ? "The sheet needs public link sharing and name / phone columns." : `${imported.length} rows detected. Duplicates will be updated.`}</p><ModalFooter onClose={onClose} onSave={() => onImport({ type: mode, content: raw })} label="Import contacts" /></Modal>;
}

function CampaignWizard({ contacts, templates, media, onClose, onLaunch }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", templateId: templates[0]?.id, total: contacts.length, delay: "8–15 seconds", consent: false, mediaPath: "", scheduledAt: "", recurrence: "none", typingSimulation: false });
  const steps = ["Name", "Contacts", "Message", "Attachment", "Settings", "Review"];
  return <Modal wide title="Create campaign" sub="Build a careful, opt-in send in six steps." onClose={onClose}><div className="mb-6 flex items-center">{steps.map((label, i) => <div key={label} className="flex flex-1 items-center"><div className={cx("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold", step >= i + 1 ? "bg-emerald text-white" : "bg-slate-100 text-slate-400")}>{step > i + 1 ? <Check size={14} /> : i + 1}</div><span className="ml-2 text-[11px] font-semibold text-slate-500">{label}</span>{i < 5 && <div className="mx-2 h-px flex-1 bg-slate-200" />}</div>)}</div>
    <div className="min-h-[210px]">{step === 1 && <div><h3 className="text-sm font-bold">Name your campaign</h3><p className="mt-1 text-xs text-slate-500">Use a descriptive internal name for your records.</p><div className="mt-5 max-w-md"><Field label="Campaign name" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="e.g. June customer update" /></div></div>}
      {step === 2 && <WizardChoice title="Choose recipients" text={`${contacts.length} opted-in contacts currently available`} icon={Users} />}
      {step === 3 && <div><h3 className="text-sm font-bold">Select a message template</h3><div className="mt-4 grid grid-cols-2 gap-3">{templates.map((t) => <button key={t.id} onClick={() => setForm({ ...form, templateId: t.id })} className={cx("rounded-lg border p-3 text-left text-xs", form.templateId === t.id ? "border-emerald bg-emerald-50" : "border-slate-200")}><b>{t.name}</b><p className="mt-2 line-clamp-2 text-slate-500">{t.body}</p></button>)}</div></div>}
      {step === 4 && <div><h3 className="text-sm font-bold">Attachment is optional</h3><p className="mt-1 text-xs text-slate-500">Choose one reusable file or continue without an attachment.</p><div className="mt-4 grid grid-cols-3 gap-3"><button onClick={() => setForm({ ...form, mediaPath: "" })} className={cx("rounded-lg border p-3 text-left text-xs", !form.mediaPath ? "border-emerald bg-emerald-50" : "border-slate-200")}><b>No attachment</b></button>{media.slice(0, 5).map((file) => <button key={file.id} onClick={() => setForm({ ...form, mediaPath: file.filepath || file.name })} className={cx("truncate rounded-lg border p-3 text-left text-xs", form.mediaPath === (file.filepath || file.name) ? "border-emerald bg-emerald-50" : "border-slate-200")}><b>{file.filename || file.name}</b></button>)}</div></div>}
      {step === 5 && <div><h3 className="text-sm font-bold">Sending settings</h3><div className="mt-4 grid grid-cols-3 gap-3"><Metric label="Pacing" value={form.delay} /><Metric label="Batch size" value="40" /><Metric label="Session cap" value="500" /></div><div className="mt-4 grid grid-cols-2 gap-3"><label><span className="label">Schedule start (optional)</span><input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className="input" /></label><label><span className="label">Repeat</span><select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} className="input"><option value="none">Do not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label></div><label className="mt-4 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={form.typingSimulation} onChange={(e) => setForm({ ...form, typingSimulation: e.target.checked })} className="accent-emerald" /> Add a short typing pause before sending</label></div>}
      {step === 6 && <div><h3 className="text-sm font-bold">Review and confirm</h3><div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-600"><div className="grid grid-cols-2 gap-3"><span>Campaign <b className="block text-slate-800">{form.name || "Untitled campaign"}</b></span><span>Recipients <b className="block text-slate-800">{contacts.length} contacts</b></span></div><label className="mt-5 flex items-start gap-2"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 accent-emerald" /><span>I confirm these recipients opted in and this send complies with applicable policies.</span></label></div></div>}</div>
    <div className="mt-6 flex justify-between border-t border-slate-100 pt-4"><button onClick={step === 1 ? onClose : () => setStep(step - 1)} className="btn-secondary">{step === 1 ? "Cancel" : "Back"}</button><button onClick={() => step === 6 ? form.consent && onLaunch({ name: form.name || "Untitled campaign", status: form.scheduledAt ? "Scheduled" : "Draft", templateId: form.templateId, scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null, settings: { mediaPath: form.mediaPath, recurrence: form.recurrence, typingSimulation: form.typingSimulation }, total: contacts.length, sent: 0, failed: 0, pending: contacts.length, progress: 0, date: form.scheduledAt || "Not launched" }) : setStep(step + 1)} className={cx("btn-primary", step === 6 && !form.consent && "cursor-not-allowed opacity-50")}>{step === 6 ? "Create draft" : "Continue"} <ChevronRight size={15} /></button></div>
  </Modal>;
}

function ConnectionModal({ connection, onClose, onConnect, onDisconnect }) {
  const connected = connection.status === "connected";
  const opening = connection.status === "opening-browser";
  const waiting = connection.status === "waiting-for-scan";
  return <Modal title="WhatsApp connection" sub="WASend controls a separate visible Chromium window and stores its login session locally." onClose={onClose}><div className="flex flex-col items-center rounded-xl border border-slate-100 bg-slate-50 p-6 text-center">{connected ? <><div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald"><CheckCircle2 size={30} /></div><h3 className="mt-4 text-sm font-bold">WhatsApp connected</h3>{(connection.profileName || connection.phone) && <p className="mt-1 text-xs text-slate-500">{[connection.profileName, connection.phone].filter(Boolean).join(" · ")}</p>}<p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Keep the WhatsApp Web browser window open while campaigns are running.</p><button onClick={onDisconnect} className="mt-5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600">Disconnect account</button></> : <><div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald">{opening ? <RefreshCw className="animate-spin" size={28} /> : <Phone size={28} />}</div><h3 className="mt-4 text-sm font-bold">{opening ? "Opening WhatsApp Web browser..." : waiting ? "Scan QR code in the browser window" : "Connect WhatsApp Web"}</h3><p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">{waiting ? "A separate Chromium window is open. Scan the QR shown on web.whatsapp.com with your phone, then return to WASend." : "WASend will open its bundled Chromium browser and navigate to web.whatsapp.com."}</p>{connection.error && <p className="mt-3 max-w-sm rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{connection.error}</p>}<button onClick={onConnect} disabled={opening} className={cx("btn-secondary mt-4", opening && "cursor-not-allowed opacity-50")}><RefreshCw size={14} /> {waiting ? "Reopen browser" : "Open WhatsApp Web browser"}</button></>}</div></Modal>;
}

function Onboarding({ onClose, setModal }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6"><section className="w-[720px] rounded-2xl bg-white p-8 shadow-2xl"><div className="flex justify-between"><div><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald text-white"><Sparkles size={22} /></div><h2 className="mt-5 text-2xl font-bold text-ink">Get started with WASend</h2><p className="mt-2 text-sm text-slate-500">Set up your responsible messaging workspace in three short steps.</p></div><button onClick={onClose}><X size={18} /></button></div><div className="mt-7 grid grid-cols-3 gap-3">{[["1", "Connect WhatsApp", "Link your WhatsApp Web session.", "connect"], ["2", "Import contacts", "Add opted-in recipients only.", "import"], ["3", "Create campaign", "Prepare and review your first send.", "campaign"]].map(([n, title, text, modal]) => <button key={n} onClick={() => { onClose(); setModal(modal); }} className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-emerald hover:bg-emerald-50"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald text-xs font-bold text-white">{n}</span><h3 className="mt-4 text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></button>)}</div></section></div>;
}

function Modal({ title, sub, onClose, children, wide }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-6"><section className={cx("max-h-[92vh] overflow-auto rounded-2xl bg-white p-6 shadow-2xl", wide ? "w-[880px]" : "w-[560px]")}><div className="mb-5 flex justify-between"><div><h2 className="text-lg font-bold text-ink">{title}</h2><p className="mt-1 text-xs text-slate-500">{sub}</p></div><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button></div>{children}</section></div>;
}
function ModalFooter({ onClose, onSave, label }) { return <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4"><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={onSave} className="btn-primary">{label}</button></div>; }
function SectionTitle({ title, sub, action }) { return <div className="flex items-start justify-between"><div><h2 className="text-sm font-bold text-ink">{title}</h2>{sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}</div>{action}</div>; }
function SearchBox({ value = "", setValue = () => {}, placeholder }) { return <label className="relative block w-72"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" /><input className="input py-2 pl-9" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} /></label>; }
function Field({ label, value, onChange, placeholder }) { return <label><span className="label">{label}</span><input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>; }
function SettingInput({ label, value, onChange }) { return <Field label={label} value={value} onChange={onChange} />; }
function Toggle({ label, value, setValue }) { return <label className="flex items-center justify-between text-sm text-slate-600"><span>{label}</span><button type="button" onClick={() => setValue(!value)} className={cx("relative h-6 w-11 rounded-full transition", value ? "bg-emerald" : "bg-slate-200")}><span className={cx("absolute top-1 h-4 w-4 rounded-full bg-white transition", value ? "left-6" : "left-1")} /></button></label>; }
function Status({ value }) { const colors = { Completed: "bg-emerald-50 text-emerald-700", Running: "bg-sky-50 text-sky-700", Scheduled: "bg-violet-50 text-violet-700", Paused: "bg-amber-50 text-amber-700", Draft: "bg-slate-100 text-slate-600", Stopped: "bg-rose-50 text-rose-600" }; return <span className={cx("rounded-full px-2 py-1 text-[10px] font-bold", colors[value] || colors.Draft)}>{value}</span>; }
function Avatar({ name }) { return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700">{initials(name)}</span>; }
function Tag({ children }) { return <span className="rounded bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-500">{children}</span>; }
function QueueItem({ name, time, count }) { return <div className="rounded-lg border border-slate-100 p-3"><div className="text-xs font-bold text-slate-700">{name}</div><div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><Clock3 size={11} /> {time}</div><div className="mt-1 text-[10px] text-slate-400">{count}</div></div>; }
function Metric({ label, value }) { return <div className="rounded-lg border border-slate-100 bg-slate-50 p-3"><p className="text-[11px] font-medium text-slate-400">{label}</p><p className="mt-1 text-lg font-bold text-ink">{value}</p></div>; }
function WizardChoice({ title, text, icon: Icon, secondary }) { return <div><h3 className="text-sm font-bold">{title}</h3><button className="mt-4 flex w-full items-center gap-4 rounded-xl border border-emerald bg-emerald-50 p-4 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-emerald"><Icon size={19} /></span><span><b className="block text-sm text-slate-700">{text}</b>{secondary && <small className="mt-1 block text-slate-500">{secondary}</small>}</span><CheckCircle2 className="ml-auto text-emerald" size={18} /></button></div>; }
function Toast({ message, tone }) { return <div className={cx("fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-3 text-xs font-semibold text-white shadow-lg", tone === "warning" ? "bg-amber-600" : "bg-slate-800")}>{tone === "warning" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} className="text-emerald-300" />}{message}</div>; }
function EmptyState({ icon: Icon, title, text, compact }) { return <div className={cx("flex flex-col items-center justify-center px-5 text-center", compact ? "min-h-28 py-5" : "min-h-56 py-10")}><span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon size={18} /></span><h3 className="mt-3 text-sm font-bold text-slate-700">{title}</h3><p className="mt-1 max-w-xs text-xs leading-5 text-slate-400">{text}</p></div>; }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled"; }
function formatNotificationTime(value) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function lastSevenDays(timeline = []) {
  const counts = new Map(timeline.map((item) => [item.day, Number(item.sent || 0)]));
  return Array.from({ length: 7 }, (_item, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, sent: counts.get(day) || 0, label: date.toLocaleDateString([], { weekday: "short" }) };
  });
}

export default App;
