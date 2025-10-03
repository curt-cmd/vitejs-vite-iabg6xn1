import React, { useEffect, useMemo, useState } from "react";

/**
 * Used Vehicle Reconditioning Manager — with Roles & Permissions
 * Roles: Admin, Manager, Technician, Viewer
 * - Capability gating on create/edit/delete/assign/export/cloud/settings/status changes
 * - Technician limited to vehicles assigned to them (see + edit their own only)
 * - Viewer read-only
 */

// ------------------ Utils ------------------

const toLocalISO = (d = new Date()) => {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};

const safeId = () =>
  (typeof globalThis !== "undefined" && (globalThis as any).crypto?.randomUUID)
    ? (globalThis as any).crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const deepClone = <T,>(obj: T): T =>
  typeof (globalThis as any).structuredClone === "function"
    ? (globalThis as any).structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));

const safeConfirm = (msg: string) => {
  if (typeof window !== "undefined" && typeof window.confirm === "function") return window.confirm(msg);
  return true;
};
const safeAlert = (msg: string) => {
  if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(msg);
  else console.warn(msg);
};
const safePrint = () => {
  if (typeof window !== "undefined" && typeof window.print === "function") window.print();
};

// ------------------ Types ------------------

type Role = "Admin" | "Manager" | "Technician" | "Viewer";
type UserRecord = {
  id: string;
  name: string;
  role: Role;
};
type TabId = "users" | "tracker" | "dashboard" | "assignments" | "settings";
type SortKey = "date" | "stock" | "ymm" | "assigned" | "status";
type SortDir = "asc" | "desc";

type CheckSection = { needed?: boolean; notes?: string; done?: boolean };

type Vehicle = {
  id: string;
  stockNumber: string;
  year?: string;
  make?: string;
  model?: string;
  ymm?: string;
  dateEntered?: string;
  dateSentOut?: string;
  dateAssigned?: string;
  dateComplete?: string;
  location?: string;
  assignedTo?: string;
  serviceFacility?: string;
  partsToOrder?: string;
  repairsNeeded?: string;
  notes?: string;
  updatedAt?: string;
  status?: "Open" | "In Progress" | "Done" | string;
  service?: CheckSection;
  body?: CheckSection;
  windshield?: CheckSection;
  interior?: CheckSection;
  tires?: CheckSection;
};

type VehicleDraft = Omit<Vehicle, "id"> & { id: string | null };
type Settings = { enableCloud: boolean; apiBase: string };
type CurrentUser = { role: Role; name: string };

// ------------------ Permissions ------------------

/**
 * Simple RBAC with contextual checks for Technician:
 * - Tech can edit only vehicles assigned to them (check sections, notes, status)
 * - Tech can set status among Open/In Progress/Done on assigned vehicles
 * - Manager cannot delete or access settings/cloud
 * - Viewer is read-only (print allowed)
 */
const can = (user: CurrentUser, action: string, vehicle?: Vehicle) => {
  const r = user.role;

  const base: Record<string, Role[]> = {
    view: ["Admin", "Manager", "Technician", "Viewer"],
    print: ["Admin", "Manager", "Technician", "Viewer"],
    exportCSV: ["Admin", "Manager"],
    createVehicle: ["Admin", "Manager"],
    editVehicle: ["Admin", "Manager"], // full edit
    deleteVehicle: ["Admin"],
    viewAssignments: ["Admin", "Manager"],
    batchAssign: ["Admin", "Manager"],
    settingsAccess: ["Admin"],
    cloudTest: ["Admin"],
    cloudPushPull: ["Admin"],
    changeStatus: ["Admin", "Manager", "Technician"],
    userManageView: ["Admin"],
    userManageWrite: ["Admin"],
  };

  if (action in base && !base[action].includes(r)) return false;

  // Contextual constraints for Technician
  if (r === "Technician") {
    // tech may change status or edit progress only if assigned
    if (["changeStatus", "techEditAssigned"].includes(action)) {
      if (!vehicle) return false;
      return (vehicle.assignedTo || "").trim().toLowerCase() === user.name.trim().toLowerCase();
    }
    // full edit not allowed
    if (action === "editVehicle") return false;
    // cannot see assignments management
    if (action === "viewAssignments" || action === "batchAssign") return false;
  }

  return true;
};

// ------------------ Component ------------------

export default function ReconditioningManager() {
  // ------------------ User / Role ------------------
  const [currentUser, setCurrentUser] = useState<CurrentUser>(() => {
    if (typeof window === "undefined") return { role: "Admin", name: "Admin" };
    const raw = window.localStorage.getItem("recon_user_v1");
    try {
      return raw ? (JSON.parse(raw) as CurrentUser) : { role: "Admin", name: "Admin" };
    } catch {
      return { role: "Admin", name: "Admin" };
    }
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("recon_user_v1", JSON.stringify(currentUser));
  }, [currentUser]);

  // ------------------ State ------------------
  const defaultSettings: Settings = { enableCloud: false, apiBase: "" };

  const [vehicles, setVehicles] = useState<Vehicle[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem("recon_vehicles_v3");
    try { return raw ? (JSON.parse(raw) as Vehicle[]) : []; } catch { return []; }
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("tracker");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Open" | "In Progress" | "Done">("all");
  const [techFilter, setTechFilter] = useState<string | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window === "undefined") return defaultSettings;
    const raw = window.localStorage.getItem("recon_settings_v1");
    try { return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings; } catch { return defaultSettings; }
  });

  // Users store (Admin manages it). Seed with an Admin if empty.
  const [users, setUsers] = useState<UserRecord[]>(() => {
    if (typeof window === "undefined") return [{ id: safeId(), name: "Admin", role: "Admin" }];
    try {
      const raw = window.localStorage.getItem("recon_users_v1");
      if (raw) return JSON.parse(raw) as UserRecord[];
    } catch {}
    return [{ id: safeId(), name: "Admin", role: "Admin" }];
  });
  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem("recon_users_v1", JSON.stringify(users));
  }, [users]);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Form
  const emptyForm: VehicleDraft = {
    id: null,
    dateEntered: toLocalISO(),
    stockNumber: "",
    year: "",
    make: "",
    model: "",
    location: "Lot",
    service: { needed: false, notes: "", done: false },
    body: { needed: false, notes: "", done: false },
    windshield: { needed: false, notes: "", done: false },
    interior: { needed: false, notes: "", done: false },
    tires: { needed: false, notes: "", done: false },
    partsToOrder: "",
    repairsNeeded: "",
    dateSentOut: "",
    serviceFacility: "",
    dateAssigned: "",
    assignedTo: "",
    dateComplete: "",
    status: "Open",
    notes: "",
    updatedAt: new Date().toISOString(),
  };
  const [form, setForm] = useState<VehicleDraft>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ------------------ Persistence ------------------
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("recon_vehicles_v3", JSON.stringify(vehicles));
  }, [vehicles]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("recon_settings_v1", JSON.stringify(settings));
  }, [settings]);

  // ------------------ Helpers ------------------
  const techs = useMemo(() => {
    const fromUsers = users.filter(u => u.role === "Technician").map(u => u.name);
    const fromVehicles = vehicles.map((v) => v.assignedTo).filter(Boolean) as string[];
    return Array.from(new Set([...fromUsers, ...fromVehicles])).sort();
  }, [users, vehicles]);

  const resetForm = () => {
    setForm({ ...emptyForm, dateEntered: toLocalISO() });
    setEditingId(null); setErrors({});
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.dateEntered) e.dateEntered = "Required";
    if (!form.stockNumber) e.stockNumber = "Required";
    if (!form.year) e.year = "Required";
    if (!form.make) e.make = "Required";
    if (!form.model) e.model = "Required";
    const dup = vehicles.find(
      (v) => ((v.stockNumber || "").trim().toLowerCase() === (form.stockNumber || "").trim().toLowerCase()) && v.id !== editingId
    );
    if (dup) e.stockNumber = "Stock # already exists";
    if (form.dateComplete && form.dateComplete < (form.dateEntered || "")) e.dateComplete = "Cannot be before Date Entered";
    if (form.dateSentOut && form.dateSentOut < (form.dateEntered || "")) e.dateSentOut = "Cannot be before Date Entered";
    if (form.dateAssigned && form.dateAssigned < (form.dateEntered || "")) e.dateAssigned = "Cannot be before Date Entered";
    if (form.service?.needed && !form.repairsNeeded) e.repairsNeeded = "List repairs needed for Service";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Restrict what Technicians can edit (only assigned vehicles; only progress-related fields)
  const mergeTechRestricted = (prev: Vehicle, draft: VehicleDraft): Vehicle => {
    const next: Vehicle = { ...prev };
    (["service","body","windshield","interior","tires"] as const).forEach((k) => {
      const src = (draft as any)[k] as CheckSection | undefined;
      if (src) (next as any)[k] = { ...(prev as any)[k], ...src };
    });
    next.notes = draft.notes ?? prev.notes;
    // Status + dateComplete (auto if Done)
    const newStatus = draft.status || prev.status || "Open";
    next.status = newStatus;
    next.dateComplete = newStatus === "Done" ? (draft.dateComplete || prev.dateComplete || toLocalISO()) : "";
    return next;
  };

  const saveVehicle = () => {
    const isEdit = !!editingId;
    if (isEdit) {
      const existing = vehicles.find(v => v.id === editingId);
      if (!existing) return;
      if (currentUser.role === "Technician") {
        const allowed = can(currentUser, "techEditAssigned", existing);
        if (!allowed) { safeAlert("You can only update vehicles assigned to you."); return; }
      } else if (!can(currentUser, "editVehicle")) {
        safeAlert("You don't have permission to edit vehicles."); return;
      }
    } else {
      if (!can(currentUser, "createVehicle")) { safeAlert("You don't have permission to add vehicles."); return; }
    }

    if (!validate()) return;

    const computedStatus: Vehicle["status"] = form.dateComplete ? "Done" : form.status || "Open";
    const basePayload: Vehicle = {
      ...form,
      id: editingId ?? safeId(),
      ymm: `${form.year} ${form.make} ${form.model}`.trim(),
      updatedAt: new Date().toISOString(),
      status: computedStatus,
      dateComplete: form.dateComplete || (computedStatus === "Done" ? toLocalISO() : ""),
    };

    if (isEdit) {
      setVehicles((prev) =>
        prev.map((v) => {
          if (v.id !== editingId) return v;
          if (currentUser.role === "Technician") return mergeTechRestricted(v, form);
          return basePayload; // Admin/Manager full edit
        })
      );
    } else {
      setVehicles((prev) => [basePayload, ...prev]);
    }
    resetForm();
  };

  const startEdit = (v: Vehicle) => {
    const canEdit = currentUser.role === "Technician"
      ? can(currentUser, "techEditAssigned", v)
      : can(currentUser, "editVehicle");
    if (!canEdit) { safeAlert("You don't have permission to edit this vehicle."); return; }

    setEditingId(v.id);
    setForm({ ...emptyForm, ...v, id: v.id });
    setErrors({});
    setActiveTab("tracker");
  };

  const removeVehicle = (id: string) => {
    if (!can(currentUser, "deleteVehicle")) { safeAlert("You don't have permission to delete."); return; }
    if (!safeConfirm("Delete this vehicle?")) return;
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    if (editingId === id) resetForm();
  };

  const updateField = (path: string, value: any) => {
    // Restrict what Tech can change while editing
    if (currentUser.role === "Technician" && editingId) {
      const allowedPrefixes = ["service","body","windshield","interior","tires","notes","status","dateComplete"];
      if (!allowedPrefixes.some((p) => path.startsWith(p))) return;
    }
    const parts = path.split(".");
    setForm((f) => {
      const copy: any = deepClone(f);
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = value;
      return copy;
    });
  };

  const updateStatus = (id: string, next: Vehicle["status"]) => {
    const target = vehicles.find((v) => v.id === id);
    if (!target) return;

    const allowed = currentUser.role === "Technician"
      ? can(currentUser, "techEditAssigned", target) && can(currentUser, "changeStatus", target)
      : can(currentUser, "changeStatus", target);

    if (!allowed) { safeAlert("You don't have permission to change status."); return; }

    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== id) return v;
        const dateComplete = next === "Done" ? v.dateComplete || toLocalISO() : "";
        return { ...v, status: next, dateComplete };
      })
    );
  };

  // ------------------ Derived ------------------
  const filtered = useMemo(() => {
    let data = [...vehicles];

    // Technician can only see assigned vehicles
    if (currentUser.role === "Technician") {
      const me = currentUser.name.trim().toLowerCase();
      data = data.filter(v => (v.assignedTo || "").trim().toLowerCase() === me);
    }

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
      let A: string, B: string;
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
  }, [vehicles, query, statusFilter, techFilter, sortKey, sortDir, currentUser]);

  const daysBetween = (a?: string, b?: string) => {
    if (!a || !b) return null;
    const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0);
    return Math.max(0, Math.round(ms / 86400000));
  };
  const todayISO = toLocalISO();

  const kpis = useMemo(() => {
    const base = currentUser.role === "Technician"
      ? vehicles.filter(v => (v.assignedTo || "").trim().toLowerCase() === currentUser.name.trim().toLowerCase())
      : vehicles;

    const total = base.length;
    const open = base.filter((v) => (v.status || "Open") !== "Done").length;
    const inProg = base.filter((v) => v.status === "In Progress").length;
    const done = base.filter((v) => v.status === "Done").length;

    const cycleDays = base.map((v) => daysBetween(v.dateEntered, v.dateComplete || todayISO)).filter((x): x is number => x != null);
    const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : 0;

    const toSentDays = base.map((v) => daysBetween(v.dateEntered, v.dateSentOut)).filter((x): x is number => x != null);
    const avgToSent = toSentDays.length ? Math.round(toSentDays.reduce((a, b) => a + b, 0) / toSentDays.length) : 0;

    const agingBuckets: Record<"0-3"|"4-7"|"8-14"|"15+", number> = { "0-3": 0, "4-7": 0, "8-14": 0, "15+": 0 };
    base.forEach((v) => {
      const age = (daysBetween(v.dateEntered, v.dateComplete || todayISO) ?? 0);
      if (age <= 3) agingBuckets["0-3"]++;
      else if (age <= 7) agingBuckets["4-7"]++;
      else if (age <= 14) agingBuckets["8-14"]++;
      else agingBuckets["15+"]++;
    });

    const byTech: Record<string, { total: number; open: number; done: number }> = {};
    base.forEach((v) => {
      if (!v.assignedTo) return;
      byTech[v.assignedTo] = byTech[v.assignedTo] || { total: 0, open: 0, done: 0 };
      byTech[v.assignedTo].total++;
      if (v.status === "Done") byTech[v.assignedTo].done++; else byTech[v.assignedTo].open++;
    });

    return { total, open, inProg, done, avgCycle, avgToSent, agingBuckets, byTech };
  }, [vehicles, currentUser, todayISO]);

  // ---------- CSV helpers ----------
  const buildCSV = (headers: string[], rows: (string | number | null | undefined)[][]) =>
    [headers, ...rows].map((r) => r.map((x) => `"${(x ?? "").toString().replaceAll('"', '""')}"`).join(",")).join("\n");

  const exportCSV = () => {
    if (!can(currentUser, "exportCSV")) { safeAlert("You don't have permission to export."); return; }
    const headers = [
      "Date Entered","Vehicle Stock Number","Year/Make/Model","Location",
      "Service Needed","Service Notes","Service Done",
      "Body Work Needed","Body Notes","Body Done",
      "Windshield Repair Needed","Windshield Notes","Windshield Done",
      "Interior Needed","Interior Notes","Interior Done",
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
      if (typeof document === "undefined") { console.warn("CSV export requested, but document is not available."); return; }
      const csv = buildCSV(headers, rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `reconditioning_export_${toLocalISO()}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed", err);
      safeAlert("CSV export failed. See console for details.");
    }
  };
  const bool = (x?: boolean) => (x ? "Yes" : "No");

  // Quick Tags
  const QUICK_TAGS: Record<string, string[]> = {
    service: ["Oil/Filters", "Brakes", "Suspension", "Alignment", "Diagnostics"],
    body: ["Dent Repair", "Paint Blend", "Rust Repair", "Bumper Replace"],
    windshield: ["Chip Repair", "Full Replace", "Wipers"],
    interior: ["Deep Clean", "Seat Repair", "Odor Treatment", "Detail"],
    tires: ["Inspect", "Rotate", "Balance", "Replace (2)", "Replace (4)"],
  };

  const addTag = (section: keyof VehicleDraft, tag: string) => {
    if (currentUser.role === "Technician" && editingId) {
      if (!["service","body","windshield","interior","tires"].includes(section as string)) return;
    }
    setForm((f) => ({
      ...f,
      [section]: {
        ...(f as any)[section],
        notes: ((f as any)[section]?.notes ? `${(f as any)[section].notes} | ${tag}` : tag),
      },
    }));
  };

  // ------------------ Cloud Sync helpers (Admin only) ------------------

  const flattenVehicle = (v: Vehicle) => ({
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

  const inflateVehicle = (o: any): Vehicle => ({
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

  function truthy(x: unknown) {
    if (typeof x === "boolean") return x;
    if (typeof x === "number") return x !== 0;
    if (typeof x === "string") return ["true","yes","1","y","on"].includes(x.trim().toLowerCase());
    return false;
  }

  async function apiList(): Promise<any[]> {
    const base = settings.apiBase?.trim();
    if (!base) throw new Error("API base URL missing");
    const url = `${base}?action=list`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "API error");
    return data.items || [];
  }

  async function apiReplaceAll(items: any[]): Promise<boolean> {
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
    if (!can(currentUser, "cloudPushPull")) { safeAlert("Only Admin can pull from cloud."); return; }
    try {
      setSyncing(true); setSyncMsg("Pulling from Google Sheets...");
      const flat = await apiList();
      const infl = flat.map(inflateVehicle);
      setVehicles(infl);
      setSyncMsg(`Pulled ${infl.length} record(s).`);
    } catch (e: any) {
      console.error(e); setSyncMsg(`Pull failed: ${e.message}`); safeAlert(`Pull failed: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const pushToCloud = async () => {
    if (!can(currentUser, "cloudPushPull")) { safeAlert("Only Admin can push to cloud."); return; }
    try {
      setSyncing(true); setSyncMsg("Pushing to Google Sheets...");
      const flat = vehicles.map(flattenVehicle);
      await apiReplaceAll(flat);
      setSyncMsg(`Pushed ${flat.length} record(s).`);
    } catch (e: any) {
      console.error(e); setSyncMsg(`Push failed: ${e.message}`); safeAlert(`Push failed: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const testConnection = async () => {
    if (!can(currentUser, "cloudTest")) { safeAlert("Only Admin can test connection."); return; }
    try { setSyncing(true); setSyncMsg("Testing..."); await apiList(); setSyncMsg("Connection OK ✔"); }
    catch(e: any){ console.error(e); setSyncMsg(`Test failed: ${e.message}`); safeAlert(`Test failed: ${e.message}`);} 
    finally { setSyncing(false);} 
  };

  // ------------------ Self-tests ------------------
  useEffect(() => {
    try {
      console.assert(daysBetween("2025-01-01", "2025-01-01") === 0, "daysBetween: 0");
      console.assert(daysBetween("2025-01-01", "2025-01-06") === 5, "daysBetween: 5");
      console.assert(daysBetween(undefined, "2025-01-01") === null, "daysBetween: null");
      const csv1 = buildCSV(["H"], [["1"], ["2"]]); console.assert(csv1.split("\n").length === 3, "CSV lines");
      const csv2 = buildCSV(["Quote"], [[`He said "hi"`]]); console.assert(csv2.includes('"He said ""hi"""'), "CSV quotes");
    } catch (e) { console.warn("Self-tests error:", e); }
  }, []);

  // ------------------ UI ------------------
  const roleBadge = {
    Admin: "bg-indigo-100 text-indigo-700",
    Manager: "bg-emerald-100 text-emerald-700",
    Technician: "bg-amber-100 text-amber-700",
    Viewer: "bg-slate-100 text-slate-700",
  }[currentUser.role];

  const sortBy = (key: SortKey) => toggleSort(setSortKey, setSortDir, sortKey, key);

  const canSave = editingId
    ? (currentUser.role === "Technician" || can(currentUser, "editVehicle"))
    : can(currentUser, "createVehicle");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold">Used Vehicle Reconditioning Manager</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/* Tabs */}
            <nav className="rounded-xl border overflow-hidden">
              {[
                { id: "users", label: "Users", show: can(currentUser, "userManageView") },
                { id: "tracker", label: "Tracker", show: true },
                { id: "dashboard", label: "Dashboard", show: true },
                { id: "assignments", label: "Assignments", show: can(currentUser, "viewAssignments") },
                { id: "settings", label: "Settings", show: can(currentUser, "settingsAccess") },
              ].filter(t => t.show).map((t) => (
                <button key={t.id} onClick={() => setActiveTab(t.id as TabId)} className={`px-3 py-2 text-sm ${activeTab === t.id ? "bg-indigo-600 text-white" : "bg-white hover:bg-slate-50"}`}>{t.label}</button>
              ))}
            </nav>

            {/* Search & Filters */}
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-56 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Search..." />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-xl border px-3 py-2">
              <option value="all">All Statuses</option>
              <option>Open</option><option>In Progress</option><option>Done</option>
            </select>
            <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="rounded-xl border px-3 py-2">
              <option value="all">All Techs</option>
              {techs.map((t) => (<option key={t}>{t}</option>))}
            </select>

            {/* Actions */}
            <button onClick={exportCSV} disabled={!can(currentUser, "exportCSV")} className="rounded-xl border px-3 py-2 hover:bg-slate-100 disabled:opacity-50">Export CSV</button>
            <button onClick={safePrint} className="rounded-xl border px-3 py-2 hover:bg-slate-100">Print</button>
            <span className={`ml-2 px-2 py-1 rounded-full text-xs ${settings.enableCloud && settings.apiBase ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              Cloud: {settings.enableCloud && settings.apiBase ? 'Ready' : 'Off'}
            </span>

            {/* Role switcher (demo) */}
            <div className="ml-2 flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs ${roleBadge}`}>{currentUser.role}</span>
              <select
                value={currentUser.role}
                onChange={(e) => setCurrentUser(u => ({ ...u, role: e.target.value as Role }))}
                className="rounded-xl border px-2 py-1 text-sm"
                aria-label="Switch role"
              >
                <option>Admin</option>
                <option>Manager</option>
                <option>Technician</option>
                <option>Viewer</option>
              </select>
              {currentUser.role === "Technician" && (
                <input
                  value={currentUser.name}
                  onChange={(e) => setCurrentUser(u => ({ ...u, name: e.target.value }))}
                  placeholder="Tech name (for assignments)"
                  className="rounded-xl border px-2 py-1 text-sm"
                />
              )}
            </div>
          </div>
        </div>
      </header>

      {activeTab === "tracker" && (
        <main className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-2 gap-6">
          {/* Form Card */}
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingId ? "Edit Vehicle" : "Add Vehicle"}{" "}
              {currentUser.role === "Viewer" && <span className="text-xs text-slate-500">(read-only)</span>}
            </h2>

            {/* Top row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Date Entered" required error={errors.dateEntered}>
                <input type="date" value={form.dateEntered} onChange={(e) => setForm({ ...form, dateEntered: e.target.value })} className={inputCls(errors.dateEntered)} disabled={
                  currentUser.role === "Viewer" || (currentUser.role === "Technician" && !!editingId)
                } />
              </Field>
              <Field label="Vehicle Stock Number" required error={errors.stockNumber}>
                <input value={form.stockNumber} onChange={(e) => setForm({ ...form, stockNumber: e.target.value.toUpperCase() })} placeholder="e.g., A1234" className={inputCls(errors.stockNumber) + " uppercase tracking-wide"} disabled={
                  currentUser.role === "Viewer" || (currentUser.role === "Technician" && !!editingId)
                } />
              </Field>
              <div className="flex items-end gap-2">
                <button
                  onClick={saveVehicle}
                  className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
                  disabled={!canSave}
                >
                  {editingId ? "Save Changes" : "Add Vehicle"}
                </button>
                {editingId && (<button onClick={resetForm} className="rounded-xl border px-4 py-2 hover:bg-slate-100">Cancel</button>)}
              </div>
            </div>

            {/* YMM + location */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              <Field label="Year" required error={errors.year}>
                <input type="number" min={1900} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className={inputCls(errors.year)} placeholder="YYYY" disabled={
                  currentUser.role === "Viewer" || (currentUser.role === "Technician" && !!editingId)
                } />
              </Field>
              <Field label="Make" required error={errors.make}>
                <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className={inputCls(errors.make)} placeholder="e.g., Ford" disabled={
                  currentUser.role === "Viewer" || (currentUser.role === "Technician" && !!editingId)
                } />
              </Field>
              <Field label="Model" required error={errors.model}>
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls(errors.model)} placeholder="e.g., F-150" disabled={
                  currentUser.role === "Viewer" || (currentUser.role === "Technician" && !!editingId)
                } />
              </Field>
              <Field label="Vehicle Location">
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls()} placeholder="Lot, Body Shop, Service, Detail…" disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>
            </div>

            {/* Checklist sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {([
                { key: "service", label: "Service Needed" },
                { key: "body", label: "Body Work Needed" },
                { key: "windshield", label: "Windshield Repair" },
                { key: "interior", label: "Interior/Detail" },
                { key: "tires", label: "Tires" },
              ] as const).map(({ key, label }) => (
                <div className="border rounded-xl p-3" key={key}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={(form as any)[key].needed} onChange={(e) => updateField(`${key}.needed`, e.target.checked)} disabled={
                        currentUser.role === "Viewer" || (currentUser.role === "Technician" && !editingId)
                      } />
                      <span className="font-medium">{label}</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span>Done</span>
                      <input type="checkbox" checked={(form as any)[key].done} onChange={(e) => updateField(`${key}.done`, e.target.checked)} disabled={
                        currentUser.role === "Viewer" || (currentUser.role === "Technician" && !editingId)
                      } />
                    </label>
                  </div>
                  <div className="mt-2 text-right">
                    {(QUICK_TAGS[key] || []).map((t) => (
                      <button key={t} type="button" onClick={() => addTag(key as keyof VehicleDraft, t)} className="text-xs rounded-full border px-2 py-1 hover:bg-slate-50 mr-1 mb-1" disabled={
                        currentUser.role === "Viewer" || (currentUser.role === "Technician" && !editingId)
                      }>+ {t}</button>
                    ))}
                  </div>
                  <textarea rows={3} value={(form as any)[key].notes} onChange={(e) => updateField(`${key}.notes`, e.target.value)} placeholder="Notes…" className="mt-2 w-full rounded-xl border px-3 py-2" disabled={
                    currentUser.role === "Viewer" || (currentUser.role === "Technician" && !editingId)
                  } />
                </div>
              ))}
            </div>

            {/* Reconditioning details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Parts to Order">
                <textarea rows={3} value={form.partsToOrder} onChange={(e) => setForm({ ...form, partsToOrder: e.target.value })} className={inputCls()} placeholder="List parts…" disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>
              <Field label='Repairs Needed (shown if "Service Needed" is checked)' error={errors.repairsNeeded}>
                <textarea rows={3} value={form.repairsNeeded} onChange={(e) => setForm({ ...form, repairsNeeded: e.target.value })} className={inputCls(errors.repairsNeeded)} placeholder="Detail specific repairs…" disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
                {form.service?.needed ? null : <p className="text-xs text-slate-500 mt-1">Tip: Enable "Service Needed" to require this field.</p>}
              </Field>

              <Field label="Date Sent Out" error={errors.dateSentOut}>
                <input type="date" value={form.dateSentOut} onChange={(e) => setForm({ ...form, dateSentOut: e.target.value })} className={inputCls(errors.dateSentOut)} disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>
              <Field label="Service Facility Sent To">
                <input value={form.serviceFacility} onChange={(e) => setForm({ ...form, serviceFacility: e.target.value })} className={inputCls()} placeholder="e.g., ABC Auto Body" disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>

              <Field label="Date Assigned">
                <input type="date" value={form.dateAssigned} onChange={(e) => setForm({ ...form, dateAssigned: e.target.value })} className={inputCls()} disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>
              <Field label="Assigned Technician">
                <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className={inputCls()} placeholder="Tech name" disabled={
                  currentUser.role !== "Admin" && currentUser.role !== "Manager"
                } />
              </Field>

              <Field label="Date Complete" error={errors.dateComplete}>
                <input type="date" value={form.dateComplete} onChange={(e) => setForm({ ...form, dateComplete: e.target.value, status: e.target.value ? "Done" : form.status })} className={inputCls(errors.dateComplete)} disabled={
                  currentUser.role === "Viewer"
                } />
              </Field>
              <Field label="Overall Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Vehicle["status"] })} className={inputCls()} disabled={
                  currentUser.role === "Viewer"
                }>
                  <option>Open</option><option>In Progress</option><option>Done</option>
                </select>
              </Field>

              <Field label="General Notes" full>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls()} placeholder="Optional notes (estimates, vendors, costs, etc.)" disabled={
                  currentUser.role === "Viewer"
                } />
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
                    <Th onClick={() => sortBy("date")} active={sortKey === "date"} dir={sortDir}>Date Entered</Th>
                    <Th onClick={() => sortBy("stock")} active={sortKey === "stock"} dir={sortDir}>Stock #</Th>
                    <Th onClick={() => sortBy("ymm")} active={sortKey === "ymm"} dir={sortDir}>Year/Make/Model</Th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Service</th>
                    <th className="px-3 py-2 text-left">Body</th>
                    <th className="px-3 py-2 text-left">Windshield</th>
                    <th className="px-3 py-2 text-left">Interior</th>
                    <th className="px-3 py-2 text-left">Tires</th>
                    <Th onClick={() => sortBy("assigned")} active={sortKey === "assigned"} dir={sortDir}>Assigned</Th>
                    <Th onClick={() => sortBy("status")} active={sortKey === "status"} dir={sortDir}>Status</Th>
                    <th className="px-3 py-2 text-left">Dates</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const canEditThis = currentUser.role === "Technician"
                      ? can(currentUser, "techEditAssigned", v)
                      : can(currentUser, "editVehicle");
                    const canChangeStatusThis = currentUser.role === "Technician"
                      ? can(currentUser, "techEditAssigned", v) && can(currentUser, "changeStatus", v)
                      : can(currentUser, "changeStatus", v);
                    return (
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
                            <button onClick={() => startEdit(v)} className="px-2 py-1 rounded-lg border hover:bg-slate-100 disabled:opacity-50" title="Edit" aria-label={`Edit ${v.stockNumber}`} disabled={!canEditThis}>Edit</button>
                            <select value={v.status || "Open"} onChange={(e) => updateStatus(v.id, e.target.value as Vehicle["status"])} className="px-2 py-1 rounded-lg border disabled:opacity-50" title="Quick Status" aria-label={`Change status for ${v.stockNumber}`} disabled={!canChangeStatusThis}>
                              <option>Open</option><option>In Progress</option><option>Done</option>
                            </select>
                            {can(currentUser, "deleteVehicle") && (
                              <button onClick={() => removeVehicle(v.id)} className="px-2 py-1 rounded-lg border hover:bg-rose-50 text-rose-600 border-rose-200" title="Delete">Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

          {/* Technician Workload */}
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
              <Badge>Interior/Detail: {vehicles.filter((v) => v.interior?.needed).length}</Badge>
              <Badge>Tires: {vehicles.filter((v) => v.tires?.needed).length}</Badge>
            </div>
          </section>
        </main>
      )}

      {activeTab === "assignments" && can(currentUser, "viewAssignments") && (
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-4">Batch Assign / Update Location</h3>
            <AssignmentTool vehicles={vehicles} setVehicles={setVehicles} disabled={!can(currentUser, "batchAssign")} />
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
                        {(["service","body","windshield","interior","tires"] as const).filter((k) => (v as any)[k]?.needed).map((k) => <Badge key={k}>{cap(k)}</Badge>)}
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

      {activeTab === "settings" && can(currentUser, "settingsAccess") && (
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          <section className="bg-white rounded-2xl shadow p-4">
            <h3 className="text-lg font-semibold mb-2">Google Sheets Cloud Sync</h3>
            <p className="text-sm text-slate-600 mb-4">Paste your Google Apps Script Web App URL and use Pull/Push to sync. Only Admins can access these settings.</p>
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
                <summary className="cursor-pointer text-sm text-slate-600">What does Push/Pull do?</summary>
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

      {activeTab === "users" && can(currentUser, "userManageView") && (
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">User Management</h2>
            <UserManager
              users={users}
              setUsers={setUsers}
              canWrite={can(currentUser, "userManageWrite")}
              onImpersonate={(u) => setCurrentUser({ role: u.role, name: u.name })}
            />
          </section>
        </main>
      )}

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 pb-12 text-xs text-slate-500">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
          <div>
            <p>Tip: Roles are simulated locally. Set Technician name to match “Assigned To” for vehicle-scoped permissions.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------- Reusable UI ----------
function Field({ label, children, required, error, full }: { label: string; children: React.ReactNode; required?: boolean; error?: string; full?: boolean }) {
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
function inputCls(hasError?: string | boolean): string {
  return `w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 ${hasError ? "border-rose-400" : ""}`;
}
function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active?: boolean; dir?: "asc" | "desc" }) {
  return (
    <th onClick={onClick} className={`px-3 py-2 text-left select-none cursor-pointer ${active ? "text-indigo-700" : ""}`} title="Click to sort">
      <div className="inline-flex items-center gap-1">{children}{active && <span className="text-xs">{dir === "asc" ? "▲" : "▼"}</span>}</div>
    </th>
  );
}
function toggleSort(setSortKey: React.Dispatch<React.SetStateAction<SortKey>>, setSortDir: React.Dispatch<React.SetStateAction<SortDir>>, currentKey: SortKey, key: SortKey): void {
  if (currentKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("asc"); }
}
function MultilineText({ text }: { text?: string }) {
  if (!text) return <span className="text-slate-400">—</span>;
  return <div className="whitespace-pre-wrap leading-relaxed">{text}</div>;
}
function CheckCell({ v }: { v?: CheckSection }) {
  if (!v) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs"><span className="px-1 rounded bg-slate-100">Needed</span> {v.needed ? "Yes" : "No"} <span className="px-1 rounded bg-slate-100 ml-2">Done</span> {v.done ? "Yes" : "No"}</div>
      <MultilineText text={v.notes} />
    </div>
  );
}
function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = { Open: "bg-rose-100 text-rose-700", "In Progress": "bg-amber-100 text-amber-700", Done: "bg-emerald-100 text-emerald-700" };
  const cls = map[value] ?? "bg-slate-100 text-slate-700";
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{value}</span>;
}
function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs mr-1 mb-1">{children}</span>;
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function AssignmentTool({ vehicles, setVehicles, disabled }: { vehicles: Vehicle[]; setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>; disabled?: boolean; }) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [assignee, setAssignee] = React.useState<string>("");
  const [location, setLocation] = React.useState<string>("");

  const toggle = (id: string) => setSelectedIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const allOpen = vehicles.filter((v) => v.status !== "Done");

  const apply = () => {
    if (disabled) return;
    if (selectedIds.length === 0) return;
    setVehicles((prev) => prev.map((v) => {
      if (!selectedIds.includes(v.id)) return v;
      return { ...v, assignedTo: assignee || v.assignedTo, location: location || v.location } as Vehicle;
    }));
    setSelectedIds([]); setAssignee(""); setLocation("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls()} placeholder="Technician name (optional)" /></div>
        <div className="md:col-span-2"><input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls()} placeholder="New location (optional)" /></div>
      </div>
      <div className="flex gap-2">
        <button onClick={apply} className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50" disabled={disabled || selectedIds.length === 0}>Apply to Selected</button>
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
                <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(v.id)} onChange={() => toggle(v.id)} /></td>
                <td className="px-3 py-2">{v.stockNumber}</td>
                <td className="px-3 py-2">{v.ymm}</td>
                <td className="px-3 py-2">{v.location || "—"}</td>
                <td className="px-3 py-2">{v.assignedTo || "—"}</td>
                <td className="px-3 py-2"><StatusBadge value={v.status || "Open"} /></td>
              </tr>
            ))}
            {allOpen.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No open vehicles to assign.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------ Users Manager (Top-level, not nested) ------------------
function UserManager({
  users,
  setUsers,
  canWrite,
  onImpersonate,
}: {
  users: UserRecord[];
  setUsers: React.Dispatch<React.SetStateAction<UserRecord[]>>;
  canWrite: boolean;
  onImpersonate: (u: UserRecord) => void;
}) {
  const empty: UserRecord = { id: "", name: "", role: "Viewer" };
  const [form, setForm] = React.useState<UserRecord>(empty);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string>("");

  const startNew = () => {
    setEditingId(null);
    setForm({ ...empty });
    setError("");
  };

  const startEdit = (u: UserRecord) => {
    setEditingId(u.id);
    setForm({ ...u });
    setError("");
  };

  const validate = () => {
    if (!form.name.trim()) { setError("Name is required"); return false; }
    const dup = users.find(u =>
      u.name.trim().toLowerCase() === form.name.trim().toLowerCase() && u.id !== editingId
    );
    if (dup) { setError("A user with this name already exists"); return false; }
    return true;
  };

  const save = () => {
    if (!canWrite) return;
    if (!validate()) return;

    if (editingId) {
      setUsers(prev => prev.map(u => u.id === editingId ? { ...form, id: editingId } : u));
    } else {
      setUsers(prev => [{ ...form, id: safeId() }, ...prev]);
    }
    startNew();
  };

  const remove = (id: string) => {
    if (!canWrite) return;
    if (!safeConfirm("Delete this user?")) return;
    setUsers(prev => prev.filter(u => u.id !== id));
    if (editingId === id) startNew();
  };

  return (
    <div className="space-y-6">
      {/* Editor */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="text-sm font-medium mb-1 block">Name</label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls(Boolean(error))}
            placeholder="e.g., Alicia"
            disabled={!canWrite}
          />
          {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Role</label>
          <select
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
            className={inputCls()}
            disabled={!canWrite}
          >
            <option>Admin</option>
            <option>Manager</option>
            <option>Technician</option>
            <option>Viewer</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            className="rounded-xl bg-indigo-600 text-white px-4 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            disabled={!canWrite}
          >
            {editingId ? "Save Changes" : "Add User"}
          </button>
          {editingId && (
            <button onClick={startNew} className="rounded-xl border px-4 py-2 hover:bg-slate-100">Cancel</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-1 rounded-full text-xs bg-slate-100">{u.role}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={() => onImpersonate(u)}
                      className="px-2 py-1 rounded-lg border hover:bg-slate-100"
                      title="Use this user"
                    >
                      Impersonate
                    </button>
                    <button
                      onClick={() => startEdit(u)}
                      className="px-2 py-1 rounded-lg border hover:bg-slate-100 disabled:opacity-50"
                      disabled={!canWrite}
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(u.id)}
                      className="px-2 py-1 rounded-lg border hover:bg-rose-50 text-rose-600 border-rose-200 disabled:opacity-50"
                      disabled={!canWrite}
                      title="Delete"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-500">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
