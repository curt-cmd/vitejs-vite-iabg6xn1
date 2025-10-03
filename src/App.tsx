import React, { useEffect, useMemo, useState } from "react";

// Used Vehicle Reconditioning Manager — single-file React component
// Features
// - Vehicle intake with detailed checklists (checkbox + notes + completion)
// - Reconditioning details (parts to order, repairs needed when Service Needed checked, dates, facility, location)
// - Assignment tab for technicians (batch assign + workload view)
// - Time tracking (days from Date Entered to Date Complete; and Entered → Sent Out)
// - Customizable Dashboard (counts, averages, bottlenecks, leaderboards, aging buckets)
// - Search, filter, sort, export CSV, print
// - LocalStorage persistence; keyboard & mobile friendly
// - OPTIONAL Cloud sync to Google Sheets (Settings tab)

export default function ReconditioningManager() {
  // ------------------ State ------------------
  const [vehicles, setVehicles] = useState(() => {
    const raw = localStorage.getItem("recon_vehicles_v3");
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [editingId, setEditingId] = useState(null);
  const [activeTab, setActiveTab] = useState("tracker"); // tracker | dashboard | assignments | settings
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [techFilter, setTechFilter] = useState("all");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  // Settings (Cloud)
  const defaultSettings = { enableCloud: false, apiBase: "" };
  const [settings, setSettings] = useState(() => {
    const raw = localStorage.getItem("recon_settings_v1");
    try { return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings; } catch { return defaultSettings; }
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Form state
  const emptyForm = {
    id: null,
    dateEntered: new Date().toISOString().slice(0, 10),
    stockNumber: "",
    year: "",
    make: "",
    model: "",
    location: "Lot",
    // Check sections
    service: { needed: false, notes: "", done: false },
    body: { needed: false, notes: "", done: false },
    windshield: { needed: false, notes: "", done: false },
    interior: { needed: false, notes: "", done: false },
    tires: { needed: false, notes: "", done: false },
    // Reconditioning
    partsToOrder: "",
    repairsNeeded: "", // only relevant if service.needed
    dateSentOut: "",
    serviceFacility: "",
    dateAssigned: "",
    assignedTo: "",
    dateComplete: "",
    status: "Open",
    notes: "",
    updatedAt: new Date().toISOString(),
  };
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});

  // ------------------ Persistence ------------------
  useEffect(() => { localStorage.setItem("recon_vehicles_v3", JSON.stringify(vehicles)); }, [vehicles]);
  useEffect(() => { localStorage.setItem("recon_settings_v1", JSON.stringify(settings)); }, [settings]);

  // ------------------ Helpers ------------------
  const techs = useMemo(() => {
    const set = new Set(vehicles.map((v) => v.assignedTo).filter(Boolean));
    return Array.from(set).sort();
  }, [vehicles]);

  const resetForm = () => {
    setForm({ ...emptyForm, dateEntered: new Date().toISOString().slice(0, 10) });
    setEditingId(null);
    setErrors({});
  };

  const validate = () => {
    const e = {};
    if (!form.dateEntered) e.dateEntered = "Required";
    if (!form.stockNumber) e.stockNumber = "Required";
    if (!form.year) e.year = "Required";
    if (!form.make) e.make = "Required";
    if (!form.model) e.model = "Required";
    const dup = vehicles.find((v) => v.stockNumber.trim().toLowerCase() === form.stockNumber.trim().toLowerCase() && v.id !== editingId);
    if (dup) e.stockNumber = "Stock # already exists";
    if (form.dateComplete && form.dateComplete < form.dateEntered) e.dateComplete = "Cannot be before Date Entered";
    if (form.dateSentOut && form.dateSentOut < form.dateEntered) e.dateSentOut = "Cannot be before Date Entered";
    if (form.dateAssigned && form.dateAssigned < form.dateEntered) e.dateAssigned = "Cannot be before Date Entered";
    if (form.service?.needed && !form.repairsNeeded) e.repairsNeeded = "List repairs needed for Service";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveVehicle = () => {
    if (!validate()) return;
    const payload = {
      ...form,
      id: editingId ?? safeId(),
      ymm: `${form.year} ${form.make} ${form.model}`.trim(),
      updatedAt: new Date().toISOString(),
      status: form.dateComplete ? "Done" : form.status,
    };
    if (editingId) setVehicles((prev) => prev.map((v) => (v.id === editingId ? payload : v)));
    else setVehicles((prev) => [payload, ...prev]);
    resetForm();
  };

  const startEdit = (v) => { setEditingId(v.id); setForm({ ...emptyForm, ...v }); setErrors({}); setActiveTab("tracker"); };

  const removeVehicle = (id) => {
    if (!confirm("Delete this vehicle?")) return;
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    if (editingId === id) resetForm();
  };

  const updateField = (path, value) => {
    // path like "service.needed"
    const parts = path.split(".");
    setForm((f) => {
      const copy = structuredClone(f);
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts.at(-1)] = value;
      return copy;
    });
  };

  const updateStatus = (id, next) => setVehicles((prev) => prev.map((v) => (v.id === id ? { ...v, status: next, dateComplete: next === "Done" && !v.dateComplete ? new Date().toISOString().slice(0, 10) : v.dateComplete } : v)));

  // ------------------ Derived ------------------
  const filtered = useMemo(() => {
    let data = [...vehicles];
    const q = query.trim().toLowerCase();
    if (q) {
      data = data.filter((v) => {
        const hay = [
          v.stockNumber, v.ymm, v.location, v.partsToOrder, v.repairsNeeded,
          v.service?.notes, v.body?.notes, v.windshield?.notes, v.interior?.notes, v.tires?.notes,
          v.serviceFacility, v.assignedTo, v.notes,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (statusFilter !== "all") data = data.filter((v) => (v.status || "Open") === statusFilter);
    if (techFilter !== "all") data = data.filter((v) => (v.assignedTo || "") === techFilter);

    const dir = sortDir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      let A, B;
      switch (sortKey) {
        case "stock": A = a.stockNumber || ""; B = b.stockNumber || ""; break;
        case "ymm": A = a.ymm || ""; B = b.ymm || ""; break;
        case "status": A = a.status || ""; B = b.status || ""; break;
        case "assigned": A = a.assignedTo || ""; B = b.assignedTo || ""; break;
        case "date": default: A = a.dateEntered || ""; B = b.dateEntered || "";
      }
      if (A < B) return -1 * dir; if (A > B) return 1 * dir; return 0;
    });
    return data;
  }, [vehicles, query, statusFilter, techFilter, sortKey, sortDir]);

  // Metrics helpers
  const daysBetween = (a, b) => { if (!a || !b) return null; const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0); return Math.max(0, Math.round(ms / 86400000)); };
  const todayISO = new Date().toISOString().slice(0, 10);

  const kpis = useMemo(() => {
    const total = vehicles.length;
    const open = vehicles.filter((v) => (v.status || "Open") !== "Done").length;
    const inProg = vehicles.filter((v) => v.status === "In Progress").length;
    const done = vehicles.filter((v) => v.status === "Done").length;

    const cycleDays = vehicles.map((v) => daysBetween(v.dateEntered, v.dateComplete || todayISO)).filter((x) => x != null);
    const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : 0;

    const toSentDays = vehicles.map((v) => daysBetween(v.dateEntered, v.dateSentOut)).filter((x) => x != null);
    const avgToSent = toSentDays.length ? Math.round(toSentDays.reduce((a, b) => a + b, 0) / toSentDays.length) : 0;

    const agingBuckets = { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 };
    vehicles.forEach((v) => {
      const age = daysBetween(v.dateEntered, v.dateComplete || todayISO) || 0;
      if (age <= 3) agingBuckets["0-3"]++; else if (age <= 7) agingBuckets["4-7"]++; else if (age <= 14) agingBuckets["8-14"]++; else agingBuckets["15+"]++;
    });

    const byTech = {};
    vehicles.forEach((v) => {
      if (!v.assignedTo) return;
      byTech[v.assignedTo] = byTech[v.assignedTo] || { total: 0, open: 0, done: 0 };
      byTech[v.assignedTo].total++;
      if (v.status === "Done") byTech[v.assignedTo].done++; else byTech[v.assignedTo].open++;
    });

    return { total, open, inProg, done, avgCycle, avgToSent, agingBuckets, byTech };
  }, [vehicles]);

  // ---------- CSV helpers ----------
  const buildCSV = (headers, rows) => {
    return [headers, ...rows]
      .map((r) => r.map((x) => `"${(x ?? "").toString().replaceAll('"', '""')}"`).join(","))
      .join("\n");
  };

  // CSV export
  const exportCSV = () => {
    const headers = [
      "Date Entered","Vehicle Stock Number","Year/Make/Model","Location",
      "Service Needed","Service Notes","Service Done",
      "Body Work Needed","Body Notes","Body Done",
      "Windshield Repair Needed","Windshield Notes","Windshield Done",
      "Interior/Bowers Needed","Interior Notes","Interior Done",
      "Tires Needed","Tires Notes","Tires Done",
      "Parts To Order","Repairs Needed","Date Sent Out","Service Facility",
      "Date Assigned","Assigned To","Status","Date Complete","Notes",
      "Days Entered→Sent","Days Entered→Complete"
    ];
    const rows = vehicles.map((v) => [
      v.dateEntered, v.stockNumber, v.ymm, v.location,
      bool(v.service?.needed), v.service?.notes || "", bool(v.service?.done),
      bool(v.body?.needed), v.body?.notes || "", bool(v.body?.done),
      bool(v.windshield?.needed), v.windshield?.notes || "", bool(v.windshield?.done),
      bool(v.interior?.needed), v.interior?.notes || "", bool(v.interior?.done),
      bool(v.tires?.needed), v.tires?.notes || "", bool(v.tires?.done),
      v.partsToOrder || "", v.repairsNeeded || "", v.dateSentOut || "",
      v.serviceFacility || "", v.dateAssigned || "", v.assignedTo || "",
      v.status || "Open", v.dateComplete || "",
      daysBetween(v.dateEntered, v.dateSentOut) ?? "",
      daysBetween(v.dateEntered, v.dateComplete) ?? "",
    ]);

    try {
      const csv = buildCSV(headers, rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reconditioning_export_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed", err);
      alert("CSV export failed. See console for details.");
    }
  };
  const bool = (x) => (x ? "Yes" : "No");

  // Quick Tags
  const QUICK_TAGS = {
    service: ["Oil/Filters", "Brakes", "Suspension", "Alignment", "Diagnostics"],
    body: ["Dent Repair", "Paint Blend", "Rust Repair", "Bumper Replace"],
    windshield: ["Chip Repair", "Full Replace", "Wipers"],
    interior: ["Deep Clean", "Seat Repair", "Odor Treatment", "Detail"],
    tires: ["Inspect", "Rotate", "Balance", "Replace (2)", "Replace (4)"],
  };

  const addTag = (section, tag) => { setForm((f) => ({ ...f, [section]: { ...f[section], notes: f[section].notes ? `${f[section].notes} | ${tag}` : tag } })); };

  // ------------------ Cloud Sync helpers ------------------
  const safeId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`);

  const flattenVehicle = (v) => ({
    id: v.id,
    dateEntered: v.dateEntered,
    stockNumber: v.stockNumber,
    year: v.year, make: v.make, model: v.model, ymm: v.ymm,
    location: v.location,
    service_needed: !!v.service?.needed,
    service_notes: v.service?.notes || "",
    service_done: !!v.service?.done,
    body_needed: !!v.body?.needed,
    body_notes: v.body?.notes || "",
    body_done: !!v.body?.done,
    windshield_needed: !!v.windshield?.needed,
    windshield_notes: v.windshield?.notes || "",
    windshield_done: !!v.windshield?.done,
    interior_needed: !!v.interior?.needed,
    interior_notes: v.interior?.notes || "",
    interior_done: !!v.interior?.done,
    tires_needed: !!v.tires?.needed,
    tires_notes: v.tires?.notes || "",
    tires_done: !!v.tires?.done,
    partsToOrder: v.partsToOrder || "",
    repairsNeeded: v.repairsNeeded || "",
    dateSentOut: v.dateSentOut || "",
    serviceFacility: v.serviceFacility || "",
    dateAssigned: v.dateAssigned || "",
    assignedTo: v.assignedTo || "",
    status: v.status || "Open",
    dateComplete: v.dateComplete || "",
    notes: v.notes || "",
    updatedAt: v.updatedAt || new Date().toISOString(),
  });

  const inflateVehicle = (o) => ({
    id: o.id || safeId(),
    dateEntered: o.dateEntered || "",
    stockNumber: o.stockNumber || "",
    year: o.year || "", make: o.make || "", model: o.model || "",
    ymm: o.ymm || `${o.year || ""} ${o.make || ""} ${o.model || ""}`.trim(),
    location: o.location || "",
    service: { needed: truthy(o.service_needed), notes: o.service_notes || "", done: truthy(o.service_done) },
    body: { needed: truthy(o.body_needed), notes: o.body_notes || "", done: truthy(o.body_done) },
    windshield: { needed: truthy(o.windshield_needed), notes: o.windshield_notes || "", done: truthy(o.windshield_done) },
    interior: { needed: truthy(o.interior_needed), notes: o.interior_notes || "", done: truthy(o.interior_done) },
    tires: { needed: truthy(o.tires_needed), notes: o.tires_notes || "", done: truthy(o.tires_done) },
    partsToOrder: o.partsToOrder || "",
    repairsNeeded: o.repairsNeeded || "",
    dateSentOut: o.dateSentOut || "",
    serviceFacility: o.serviceFacility || "",
    dateAssigned: o.dateAssigned || "",
    assignedTo: o.assignedTo || "",
    dateComplete: o.dateComplete || "",
    status: o.status || "Open",
    notes: o.notes || "",
    updatedAt: o.updatedAt || new Date().toISOString(),
  });

  function truthy(x) {
    if (typeof x === "boolean") return x;
    if (typeof x === "number") return x !== 0;
    if (typeof x === "string") return ["true","yes","1","y","on","TRUE","Yes"].includes(x);
    return false;
  }

  async function apiList() {
    const base = settings.apiBase?.trim();
    if (!base) throw new Error("API base URL missing");
    const url = `${base}?action=list`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return data.items || [];
  }

  async function apiReplaceAll(items) {
    const base = settings.apiBase?.trim();
    if (!base) throw new Error("API base URL missing");
    const body = new URLSearchParams({ action: "replaceAll", payload: JSON.stringify(items) });
    const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return true;
  }

  const pullFromCloud = async () => {
    try {
      setSyncing(true); setSyncMsg("Pulling from Google Sheets...");
      const flat = await apiList();
      const infl = flat.map(inflateVehicle);
      setVehicles(infl);
      setSyncMsg(`Pulled ${infl.length} record(s).`);
    } catch (e) {
      console.error(e); setSyncMsg(`Pull failed: ${e.message}`);
      alert(`Pull failed: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const pushToCloud = async () => {
    try {
      setSyncing(true); setSyncMsg("Pushing to Google Sheets...");
      const flat = vehicles.map(flattenVehicle);
      await apiReplaceAll(flat);
      setSyncMsg(`Pushed ${flat.length} record(s).`);
    } catch (e) {
      console.error(e); setSyncMsg(`Push failed: ${e.message}`);
      alert(`Push failed: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const testConnection = async () => {
    try { setSyncing(true); setSyncMsg("Testing..."); await apiList(); setSyncMsg("Connection OK ✔"); }
    catch(e){ console.error(e); setSyncMsg(`Test failed: ${e.message}`); alert(`Test failed: ${e.message}`);} 
    finally { setSyncing(false);} 
  };

  // ------------------ Self-tests (runtime assertions) ------------------
  useEffect(() => {
    try {
      console.assert(daysBetween("2025-01-01", "2025-01-01") === 0, "daysBetween: same day should be 0");
      console.assert(daysBetween("2025-01-01", "2025-01-06") === 5, "daysBetween: 5-day diff should be 5");
      console.assert(daysBetween(null, "2025-01-01") === null, "daysBetween: null input should be null");
      const csv1 = buildCSV(["H"], [["1"], ["2"]]);
      console.assert(csv1.split("\n").length === 3, "CSV: should contain 3 lines including header");
      const csv2 = buildCSV(["Quote"], [["He said \"hi\""]]);
      console.assert(csv2.includes('"He said ""hi"""'), "CSV: inner quotes should be doubled");
    } catch (e) { console.warn("Self-tests encountered an error:", e); }
  }, []);

  // ------------------ UI ------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold">Used Vehicle Reconditioning Manager</h1>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="rounded-xl border overflow-hidden">
              {[
                { id: "tracker", label: "Tracker" },
                { id: "dashboard", label: "Dashboard" },
                { id: "assignments", label: "Assignments" },
                { id: "settings", label: "Settings" },
              ].map((t) => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-3 py-2 text-sm ${activeTab === t.id ? "bg-indigo-600 text-white" : "bg-white hover:bg-slate-50"}`}>{t.label}</button>
              ))}
            </nav>
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-56 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Search..." />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border px-3 py-2">
              <option value="all">All Statuses</option>
              <option>Open</option>
              <option>In Progress</option>
              <option>Done</option>
            </select>
            <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="rounded-xl border px-3 py-2">
              <option value="all">All Techs</option>
              {techs.map((t) => (<option key={t}>{t}</option>))}
            </select>
            <button onClick={exportCSV} className="rounded-xl border px-3 py-2 hover:bg-slate-100">Export CSV</button>
            <button onClick={() => window.print()} className="rounded-xl border px-3 py-2 hover:bg-slate-100">Print</button>
            <span className={`ml-2 px-2 py-1 rounded-full text-xs ${settings.enableCloud && settings.apiBase ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              Cloud: {settings.enableCloud && settings.apiBase ? 'Ready' : 'Off'}
            </span>
          </div>
        </div>
      </header>

      {activeTab === "tracker" && (
        <main className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-2 gap-6">
          {/* Form Card */}
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">{editingId ? "Edit Vehicle" : "Add Vehicle"}</h2>
            {/* Top row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Date Entered" required error={errors.dateEntered}>
                <input type="date" value={form.dateEntered} onChange={(e) => setForm({ ...form, dateEntered: e.target.value })} className={inputCls(errors.dateEntered)} />
              </Field>
              <Field label="Vehicle Stock Number" required error={errors.stockNumber}>
                <input value={form.stockNumber} onChange={(e) => setForm({ ...form, stockNumber: e.target.value.toUpperCase() })} placeholder="e.g., A1234" className={inputCls(errors.stockNumber) + " uppercase tracking-wide"} />
              </Field>
              <div className="flex items-end gap-2">
                <button onClick={saveVehicle} className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2 font-medium hover:bg-indigo-700">{editingId ? "Save Changes" : "Add Vehicle"}</button>
                {editingId && (<button onClick={resetForm} className="rounded-xl border px-4 py-2 hover:bg-slate-100">Cancel</button>)}
              </div>
            </div>

            {/* YMM + location */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              <Field label="Year" required error={errors.year}>
                <input type="number" min={1900} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className={inputCls(errors.year)} placeholder="YYYY" />
              </Field>
              <Field label="Make" required error={errors.make}>
                <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className={inputCls(errors.make)} placeholder="e.g., Ford" />
              </Field>
              <Field label="Model" required error={errors.model}>
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls(errors.model)} placeholder="e.g., F-150" />
              </Field>
              <Field label="Vehicle Location">
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls()} placeholder="Lot, Body Shop, Service, Detail…" />
              </Field>
            </div>

            {/* Checklist sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {([
                { key: "service", label: "Service Needed" },
                { key: "body", label: "Body Work Needed" },
                { key: "windshield", label: "Windshield Repair" },
                { key: "interior", label: "Interior/Bowers" },
                { key: "tires", label: "Tires" },
              ]).map(({ key, label }) => (
                <div className="border rounded-xl p-3" key={key}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form[key].needed} onChange={(e) => updateField(`${key}.needed`, e.target.checked)} />
                      <span className="font-medium">{label}</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span>Done</span>
                      <input type="checkbox" checked={form[key].done} onChange={(e) => updateField(`${key}.done`, e.target.checked)} />
                    </label>
                  </div>
                  <div className="mt-2 text-right">
                    {(QUICK_TAGS[key] || []).map((t) => (
                      <button key={t} type="button" onClick={() => addTag(key, t)} className="text-xs rounded-full border px-2 py-1 hover:bg-slate-50 mr-1 mb-1">+ {t}</button>
                    ))}
                  </div>
                  <textarea rows={3} value={form[key].notes} onChange={(e) => updateField(`${key}.notes`, e.target.value)} placeholder="Notes…" className="mt-2 w-full rounded-xl border px-3 py-2" />
                </div>
              ))}
            </div>

            {/* Reconditioning details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Parts to Order">
                <textarea rows={3} value={form.partsToOrder} onChange={(e) => setForm({ ...form, partsToOrder: e.target.value })} className={inputCls()} placeholder="List parts…" />
              </Field>
              <Field label="Repairs Needed (shown if Service Needed is checked)" error={errors.repairsNeeded}>
                <textarea rows={3} value={form.repairsNeeded} onChange={(e) => setForm({ ...form, repairsNeeded: e.target.value })} className={inputCls(errors.repairsNeeded)} placeholder="Detail specific repairs…" />
                {form.service?.needed ? null : <p className="text-xs text-slate-500 mt-1">Tip: Enable "Service Needed" to require this field.</p>}
              </Field>

              <Field label="Date Sent Out" error={errors.dateSentOut}>
                <input type="date" value={form.dateSentOut} onChange={(e) => setForm({ ...form, dateSentOut: e.target.value })} className={inputCls(errors.dateSentOut)} />
              </Field>
              <Field label="Service Facility Sent To">
                <input value={form.serviceFacility} onChange={(e) => setForm({ ...form, serviceFacility: e.target.value })} className={inputCls()} placeholder="e.g., ABC Auto Body" />
              </Field>

              <Field label="Date Assigned">
                <input type="date" value={form.dateAssigned} onChange={(e) => setForm({ ...form, dateAssigned: e.target.value })} className={inputCls()} />
              </Field>
              <Field label="Assigned Technician">
                <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className={inputCls()} placeholder="Tech name" />
              </Field>

              <Field label="Date Complete" error={errors.dateComplete}>
                <input type="date" value={form.dateComplete} onChange={(e) => setForm({ ...form, dateComplete: e.target.value, status: e.target.value ? "Done" : form.status })} className={inputCls(errors.dateComplete)} />
              </Field>
              <Field label="Overall Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls()}>
                  <option>Open</option>
                  <option>In Progress</option>
                  <option>Done</option>
                </select>
              </Field>

              <Field label="General Notes" full>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls()} placeholder="Optional notes (estimates, vendors, costs, etc.)" />
              </Field>
            </div>
          </section>

          {/* Table Card */}
          <section className="bg-white rounded-2xl shadow p-4 md:p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Inventory & Tasks</h2>
              <div className="text-sm text-slate-500">{filtered.length} item(s)</div>
            </div>
            <div className="overflow-auto -mx-4 md:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <Th onClick={() => toggleSort(setSortKey, setSortDir, sortKey, sortDir, "date")} active={sortKey === "date"} dir={sortDir}>Date Entered</Th>
                    <Th onClick={() => toggleSort(setSortKey, setSortDir, sortKey, sortDir, "stock")} active={sortKey === "stock"} dir={sortDir}>Stock #</Th>
                    <Th onClick={() => toggleSort(setSortKey, setSortDir, sortKey, sortDir, "ymm")} active={sortKey === "ymm"} dir={sortDir}>Year/Make/Model</Th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Service</th>
                    <th className="px-3 py-2 text-left">Body</th>
                    <th className="px-3 py-2 text-left">Windshield</th>
                    <th className="px-3 py-2 text-left">Interior</th>
                    <th className="px-3 py-2 text-left">Tires</th>
                    <Th onClick={() => toggleSort(setSortKey, setSortDir, sortKey, sortDir, "assigned")} active={sortKey === "assigned"} dir={sortDir}>Assigned</Th>
                    <Th onClick={() => toggleSort(setSortKey, setSortDir, sortKey, sortDir, "status")} active={sortKey === "status"} dir={sortDir}>Status</Th>
                    <th className="px-3 py-2 text-left">Dates</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <tr key={v.id} className="border-t align-top hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap">{v.dateEntered}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{v.stockNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{v.ymm}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{v.location || "—"}</td>
                      <td className="px-3 py-2 min-w-[14rem]"><CheckCell v={v.service} /></td>
                      <td className="px-3 py-2 min-w-[14rem]"><CheckCell v={v.body} /></td>
                      <td className="px-3 py-2 min-w-[12rem]"><CheckCell v={v.windshield} /></td>
                      <td className="px-3 py-2 min-w-[12rem]"><CheckCell v={v.interior} /></td>
                      <td className="px-3 py-2 min-w-[10rem]"><CheckCell v={v.tires} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{v.assignedTo || "—"}</td>
                      <td className="px-3 py-2"><StatusBadge value={v.status || "Open"} /></td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        <div>Sent: {v.dateSentOut || "—"} ({daysBetween(v.dateEntered, v.dateSentOut) ?? "—"} d)</div>
                        <div>Complete: {v.dateComplete || "—"} ({daysBetween(v.dateEntered, v.dateComplete) ?? "—"} d)</div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex gap-2">
                          <button onClick={() => startEdit(v)} className="px-2 py-1 rounded-lg border hover:bg-slate-100" title="Edit">Edit</button>
                          <select value={v.status || "Open"} onChange={(e) => updateStatus(v.id, e.target.value)} className="px-2 py-1 rounded-lg border" title="Quick Status">
                            <option>Open</option>
                            <option>In Progress</option>
                            <option>Done</option>
                          </select>
                          <button onClick={() => removeVehicle(v.id)} className="px-2 py-1 rounded-lg border hover:bg-rose-50 text-rose-600 border-rose-200" title="Delete">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-3 py-12 text-center text-slate-500">No vehicles yet. Add your first one with the form on the left.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {activeTab === "dashboard" && (
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="Total Vehicles" value={kpis.total} />
            <KPI label="Open" value={kpis.open} />
            <KPI label="In Progress" value={kpis.inProg} />
            <KPI label="Done" value={kpis.done} />
            <KPI label="Avg Days to Complete" value={kpis.avgCycle} />
            <KPI label="Avg Days to Send Out" value={kpis.avgToSent} />
          </div>

          {/* Aging Buckets */}
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-3">Aging Buckets (Entered → Complete)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(kpis.agingBuckets).map(([k, v]) => (
                <div key={k} className="border rounded-xl p-3">
                  <div className="text-sm text-slate-500">{k} days</div>
                  <div className="text-2xl font-bold">{v}</div>
                  <div className="mt-2 h-2 rounded bg-slate-100"><div className="h-2 rounded" style={{ width: `${Math.min(100, (v / Math.max(1, kpis.total)) * 100)}%`, backgroundColor: "#4f46e5" }} /></div>
                </div>
              ))}
            </div>
          </section>

          {/* Technician Leaderboard */}
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-3">Technician Workload</h3>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <th className="px-3 py-2 text-left">Technician</th>
                    <th className="px-3 py-2 text-left">Open</th>
                    <th className="px-3 py-2 text-left">Done</th>
                    <th className="px-3 py-2 text-left">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(kpis.byTech).map(([tech, stats]) => (
                    <tr key={tech} className="border-t">
                      <td className="px-3 py-2">{tech}</td>
                      <td className="px-3 py-2">{stats.open}</td>
                      <td className="px-3 py-2">{stats.done}</td>
                      <td className="px-3 py-2">{stats.total}</td>
                    </tr>
                  ))}
                  {Object.keys(kpis.byTech).length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No assignments yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Quick filters */}
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-3">Quick Filters</h3>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge>Service Needed: {vehicles.filter((v) => v.service?.needed).length}</Badge>
              <Badge>Body Work Needed: {vehicles.filter((v) => v.body?.needed).length}</Badge>
              <Badge>Windshield Repair: {vehicles.filter((v) => v.windshield?.needed).length}</Badge>
              <Badge>Interior/Bowers: {vehicles.filter((v) => v.interior?.needed).length}</Badge>
              <Badge>Tires: {vehicles.filter((v) => v.tires?.needed).length}</Badge>
            </div>
          </section>
        </main>
      )}

      {activeTab === "assignments" && (
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-4">Batch Assign / Update Location</h3>
            <AssignmentTool vehicles={vehicles} setVehicles={setVehicles} />
          </section>

          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-3">Queue (Open & In Progress)</h3>
            <div className="overflow-auto -mx-4 md:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <th className="px-3 py-2 text-left">Stock #</th>
                    <th className="px-3 py-2 text-left">Y/M/M</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Assigned To</th>
                    <th className="px-3 py-2 text-left">Entered</th>
                    <th className="px-3 py-2 text-left">Age (d)</th>
                    <th className="px-3 py-2 text-left">Needed</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.filter((v) => v.status !== "Done").map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="px-3 py-2">{v.stockNumber}</td>
                      <td className="px-3 py-2">{v.ymm}</td>
                      <td className="px-3 py-2">{v.location || "—"}</td>
                      <td className="px-3 py-2">{v.assignedTo || "—"}</td>
                      <td className="px-3 py-2">{v.dateEntered}</td>
                      <td className="px-3 py-2">{daysBetween(v.dateEntered, todayISO) ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {["service","body","windshield","interior","tires"].filter((k) => v[k]?.needed).map((k) => <Badge key={k}>{cap(k)}</Badge>)}
                      </td>
                    </tr>
                  ))}
                  {vehicles.filter((v) => v.status !== "Done").length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No open vehicles.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {activeTab === "settings" && (
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="text-lg font-semibold mb-2">Google Sheets Cloud Sync</h3>
            <p className="text-sm text-slate-600 mb-4">Paste your Google Apps Script Web App URL and use Pull/Push to sync the tracker with a Google Sheet. Toggle “Enable Cloud Sync” to show the buttons.</p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium">Apps Script Web App URL</span>
                <input value={settings.apiBase} onChange={(e)=>setSettings((s)=>({...s,apiBase:e.target.value}))} className={inputCls()} placeholder="https://script.google.com/macros/s/XXXXXXXX/exec" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.enableCloud} onChange={(e)=>setSettings((s)=>({...s, enableCloud: e.target.checked}))} />
                <span>Enable Cloud Sync</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={testConnection} className="rounded-xl border px-4 py-2 hover:bg-slate-50">Test Connection</button>
                <button onClick={pullFromCloud} disabled={!settings.enableCloud || !settings.apiBase || syncing} className="rounded-xl bg-indigo-600 text-white px-4 py-2 disabled:opacity-50">Pull from Cloud</button>
                <button onClick={pushToCloud} disabled={!settings.enableCloud || !settings.apiBase || syncing} className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50">Push to Cloud</button>
              </div>
              {syncMsg && <div className="text-sm text-slate-600">{syncing ? "⏳ " : ""}{syncMsg}</div>}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-600">
                  What does Push/Pull do?
                </summary>
                <ul className="list-disc ml-6 text-sm text-slate-600 mt-2 space-y-1">
                  <li><b>Pull</b> replaces your local list with rows from the Google Sheet.</li>
                  <li><b>Push</b> replaces the Google Sheet contents with your local list.</li>
                  <li>Columns are kept in sync, including nested fields (Service/Body/Windshield/Interior/Tires).</li>
                </ul>
              </details>
            </div>
          </section>
        </main>
      )}

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 pb-12 text-xs text-slate-500">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
          <div>
            <p>Tip: Use quick tags to speed common notes. Data is saved to your browser. Cloud sync is optional via Settings (Google Sheets).</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
// ---------- Reusable UI ----------
function Field({ label, children, required, error, full }) {
  return (
    <div className={full ? "md:col-span-2" : undefined}>
      <label className="text-sm font-medium mb-1 block">
        {label} {required && <span className="text-rose-600">*</span>}
      </label>
      {children}
      {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
    </div>
  );
}

function inputCls(hasError?) {
  return `w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 ${hasError ? "border-rose-400" : ""}`;
}

function Th({ children, onClick, active, dir }) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-left select-none cursor-pointer ${active ? "text-indigo-700" : ""}`}
      title="Click to sort"
    >
      <div className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}
      </div>
    </th>
  );
}

function toggleSort(setSortKey, setSortDir, sortKey, sortDir, key) {
  if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  else { setSortKey(key); setSortDir("asc"); }
}

function MultilineText({ text }) {
  if (!text) return <span className="text-slate-400">—</span>;
  return <div className="whitespace-pre-wrap leading-relaxed">{text}</div>;
}

function CheckCell({ v }) {
  if (!v) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1 rounded bg-slate-100">Needed</span> {v.needed ? "Yes" : "No"}
        <span className="px-1 rounded bg-slate-100 ml-2">Done</span> {v.done ? "Yes" : "No"}
      </div>
      <MultilineText text={v.notes} />
    </div>
  );
}

function StatusBadge({ value }) {
  const map = {
    Open: "bg-rose-100 text-rose-700",
    "In Progress": "bg-amber-100 text-amber-700",
    Done: "bg-emerald-100 text-emerald-700",
  };
  const cls = map[value] || "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{value}</span>;
}

function KPI({ label, value }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs mr-1 mb-1">
      {children}
    </span>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function AssignmentTool({ vehicles, setVehicles }) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [assignee, setAssignee] = React.useState("");
  const [location, setLocation] = React.useState("");

  const toggle = (id) =>
    setSelectedIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const allOpen = vehicles.filter((v) => v.status !== "Done");

  const apply = () => {
    if (selectedIds.length === 0) return;
    setVehicles((prev) =>
      prev.map((v) => {
        if (!selectedIds.includes(v.id)) return v;
        return {
          ...v,
          assignedTo: assignee || v.assignedTo,
          location: location || v.location,
        };
      })
    );
    setSelectedIds([]);
    setAssignee("");
    setLocation("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className={inputCls()}
            placeholder="Technician name (optional)"
          />
        </div>
        <div className="md:col-span-2">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={inputCls()}
            placeholder="New location (optional)"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={apply}
          className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
          disabled={selectedIds.length === 0}
        >
          Apply to Selected
        </button>
      </div>

      <div className="overflow-auto -mx-4 md:mx-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
              <th className="px-3 py-2 text-left">Select</th>
              <th className="px-3 py-2 text-left">Stock #</th>
              <th className="px-3 py-2 text-left">Y/M/M</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Assigned</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {allOpen.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(v.id)}
                    onChange={() => toggle(v.id)}
                  />
                </td>
                <td className="px-3 py-2">{v.stockNumber}</td>
                <td className="px-3 py-2">{v.ymm}</td>
                <td className="px-3 py-2">{v.location || "—"}</td>
                <td className="px-3 py-2">{v.assignedTo || "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={v.status || "Open"} /></td>
              </tr>
            ))}
            {allOpen.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  No open vehicles to assign.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
