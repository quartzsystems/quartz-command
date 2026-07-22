"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Column, DataTable } from "@/components/dashboard/DataTable";
import { RowActions } from "@/components/dashboard/RowActions";
import { Toast } from "@/components/dashboard/Toast";
import { FeatureReadOnlyNotice, FeatureUnavailable } from "@/components/device/FeatureUnavailable";
import { useDeviceProduct } from "@/components/device/useDeviceProduct";
import {
  AaaAuthType,
  AaaDoc,
  AaaMethod,
  AaaProtocol,
  AaaServer,
  deleteAaaServer,
  fetchAaa,
  updateAaaAuthentication,
  updateAaaProtocol,
} from "@/lib/device/sonic-aaa";
import { AaaServerFormModal } from "./AaaServerFormModal";

const inputCls = "w-full rounded-md px-3 py-[9px] text-[13px] text-[var(--qz-fg-1)] outline-none";
const inputSt = { background: "var(--qz-input-bg)", border: "1px solid var(--qz-border)" } as const;
const monoSt = { ...inputSt, fontFamily: "var(--qz-font-mono)" } as const;

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-accent)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = "var(--qz-border)";
}

const dash = <span className="text-[var(--qz-fg-4)]">—</span>;

/** Sensible login orders; SONiC accepts any combination, these cover real
 *  deployments while keeping "local" reachable as a fallback. */
const LOGIN_ORDERS: { value: string; label: string }[] = [
  { value: "local", label: "Local only" },
  { value: "tacacs+,local", label: "TACACS+, then local" },
  { value: "radius,local", label: "RADIUS, then local" },
  { value: "local,tacacs+", label: "Local, then TACACS+" },
  { value: "local,radius", label: "Local, then RADIUS" },
];

const serverColumns: Column<AaaServer>[] = [
  { key: "address", header: "Server", value: (r) => r.address, mono: true, sortable: true },
  {
    key: "priority",
    header: "Priority",
    value: (r) => r.priority ?? 1,
    render: (r) => (r.priority != null ? r.priority : dash),
    mono: true,
    sortable: true,
    width: 90,
  },
  {
    key: "port",
    header: "Port",
    value: (r) => r.port ?? -1,
    render: (r) => (r.port != null ? r.port : dash),
    mono: true,
    width: 80,
  },
  {
    key: "timeout",
    header: "Timeout",
    value: (r) => r.timeout ?? -1,
    render: (r) => (r.timeout != null ? `${r.timeout}s` : dash),
    mono: true,
    width: 90,
  },
  {
    key: "key",
    header: "Secret",
    value: (r) => (r.key_set ? "server" : "global"),
    render: (r) =>
      r.key_set ? (
        <span className="badge badge-info">Per-server</span>
      ) : (
        <span className="badge badge-muted">Global</span>
      ),
    width: 110,
  },
];

type Tab = "authentication" | "tacacs" | "radius";

/// Per-protocol settings card + server table (shared by TACACS+ / RADIUS).
function ProtocolPanel({
  protocol,
  doc,
  editable,
  onToast,
  onReload,
  onAddServer,
  onEditServer,
}: {
  protocol: AaaProtocol;
  doc: AaaDoc;
  editable: boolean;
  onToast: (msg: string) => void;
  onReload: () => void;
  onAddServer: () => void;
  onEditServer: (server: AaaServer) => void;
}) {
  const cfg = protocol === "tacacs" ? doc.tacacs : doc.radius;
  const label = protocol === "tacacs" ? "TACACS+" : "RADIUS";

  const [authType, setAuthType] = useState<AaaAuthType>(cfg.auth_type);
  const [timeout_, setTimeout_] = useState(cfg.timeout != null ? String(cfg.timeout) : "");
  const [key, setKey] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setFormError("");
    let t: number | null = null;
    if (timeout_.trim()) {
      t = Number(timeout_);
      if (!Number.isInteger(t) || t < 1 || t > 60) {
        return setFormError("Timeout must be a whole number between 1 and 60 seconds.");
      }
    }
    setSaving(true);
    try {
      await updateAaaProtocol(protocol, { auth_type: authType, timeout: t, key: key || null });
      onToast(`Saved ${label} settings.`);
      setKey("");
      onReload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : `Failed to save ${label} settings.`);
    } finally {
      setSaving(false);
    }
  };

  const removeServer = async (row: AaaServer) => {
    try {
      await deleteAaaServer(protocol, row.address);
      onToast(`Deleted ${row.address}.`);
      onReload();
    } catch (e) {
      onToast(e instanceof Error ? e.message : `Failed to delete ${row.address}.`);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        className="max-w-[640px] rounded-xl p-6 flex flex-col gap-4"
        style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
      >
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Authentication type</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as AaaAuthType)}
              disabled={!editable}
              className={`${inputCls} disabled:opacity-60`}
              style={inputSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            >
              <option value="pap">PAP</option>
              <option value="chap">CHAP</option>
              <option value="mschapv2">MS-CHAPv2</option>
              <option value="login">Login</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Timeout (s)</label>
            <input
              value={timeout_}
              onChange={(e) => setTimeout_(e.target.value)}
              placeholder="5 (default)"
              disabled={!editable}
              className={`${inputCls} disabled:opacity-60`}
              style={monoSt}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">
            Global shared secret{" "}
            <span className="text-[var(--qz-fg-4)]">
              ({cfg.global_key_set ? "set — leave blank to keep" : "not set"})
            </span>
          </label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={cfg.global_key_set ? "Unchanged" : "Shared secret"}
            disabled={!editable}
            className={`${inputCls} disabled:opacity-60`}
            style={inputSt}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </div>

        {formError && (
          <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
            {formError}
          </p>
        )}

        {editable && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
              style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      <DataTable
        rows={cfg.servers}
        columns={serverColumns}
        rowId={(r) => r.address}
        storageKey={`security-aaa-${protocol}-servers`}
        searchPlaceholder="Search servers…"
        emptyMessage={`No ${label} servers configured.`}
        onRefresh={onReload}
        onRowDoubleClick={onEditServer}
        toolbar={
          editable ? (
            <Button kind="primary" size="sm" icon={Plus} onClick={onAddServer}>
              Add server
            </Button>
          ) : undefined
        }
        actions={(row) => (
          <RowActions
            label={row.address}
            onEdit={() => onEditServer(row)}
            onDelete={() => removeServer(row)}
          />
        )}
      />
    </div>
  );
}

function SonicAaaPage() {
  const [doc, setDoc] = useState<AaaDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tab, setTab] = useState<Tab>("authentication");
  const [toast, setToast] = useState("");

  const [loginOrder, setLoginOrder] = useState("local");
  const [failthrough, setFailthrough] = useState(false);
  const [authError, setAuthError] = useState("");
  const [savingAuth, setSavingAuth] = useState(false);

  const [serverModal, setServerModal] = useState<{ protocol: AaaProtocol; server?: AaaServer } | null>(null);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "load") setStatus("loading");
    try {
      const d = await fetchAaa();
      setDoc(d);
      setLoginOrder(d.login_order.join(","));
      setFailthrough(d.failthrough);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load AAA settings.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveAuth = async () => {
    setAuthError("");
    const order = loginOrder.split(",").filter(Boolean) as AaaMethod[];
    if (order.length === 0) return setAuthError("Pick a login order.");
    if (!order.includes("local")) {
      return setAuthError('Keep "local" in the order so a dead AAA server can\'t lock you out.');
    }
    setSavingAuth(true);
    try {
      await updateAaaAuthentication(order, failthrough);
      setToast("Saved login authentication.");
      await load("refresh");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Failed to save login authentication.");
    } finally {
      setSavingAuth(false);
    }
  };

  const editable = !!doc && doc.capability.supported && !doc.capability.read_only;

  const tabs: [Tab, string, number | null][] = [
    ["authentication", "Authentication", null],
    ["tacacs", "TACACS+", doc?.tacacs.servers.length ?? 0],
    ["radius", "RADIUS", doc?.radius.servers.length ?? 0],
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          AAA
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          Login authentication order and remote TACACS+ / RADIUS servers
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px]">
        {status === "loading" && (
          <div className="text-[13px] text-[var(--qz-fg-4)]">Loading AAA settings…</div>
        )}
        {status === "error" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[13px] text-[var(--qz-danger)]">
              <AlertTriangle size={15} />
              {errorMsg}
            </div>
            <div>
              <Button kind="secondary" icon={RotateCw} onClick={load}>Retry</Button>
            </div>
          </div>
        )}
        {status === "ready" && doc && !doc.capability.supported && (
          <FeatureUnavailable feature="AAA" capability={doc.capability} />
        )}
        {status === "ready" && doc && doc.capability.supported && (
          <div className="flex flex-col gap-5">
            <FeatureReadOnlyNotice capability={doc.capability} />

            <div className="flex items-center gap-1 border-b border-[var(--qz-border)]">
              {tabs.map(([id, label, count]) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={[
                      "px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer",
                      active
                        ? "text-[var(--qz-accent)] border-[var(--qz-accent)]"
                        : "text-[var(--qz-fg-3)] border-transparent hover:text-[var(--qz-fg-1)]",
                    ].join(" ")}
                  >
                    {label}
                    {count !== null && (
                      <span className="ml-[6px] text-[12px] text-[var(--qz-fg-4)]">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {tab === "authentication" && (
              <div
                className="max-w-[640px] rounded-xl p-6 flex flex-col gap-4"
                style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
              >
                <div>
                  <label className="block text-[12px] text-[var(--qz-fg-3)] mb-[6px]">Login order</label>
                  <select
                    value={loginOrder}
                    onChange={(e) => setLoginOrder(e.target.value)}
                    disabled={!editable}
                    className={`${inputCls} disabled:opacity-60`}
                    style={inputSt}
                    onFocus={focusBorder}
                    onBlur={blurBorder}
                  >
                    {LOGIN_ORDERS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[6px]">
                    Applies to SSH and console logins. Orders without a local fallback are not
                    offered — an unreachable AAA server would lock every account out.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[var(--qz-fg-1)] m-0">Failthrough</p>
                    <p className="text-[12px] text-[var(--qz-fg-4)] m-0 mt-[2px]">
                      Try the next method even when a server rejects the login (not just when it&apos;s
                      unreachable)
                    </p>
                  </div>
                  <Switch on={failthrough} onChange={editable ? setFailthrough : () => {}} />
                </div>

                {authError && (
                  <p className="text-[12px] m-0" style={{ color: "var(--qz-danger)" }}>
                    {authError}
                  </p>
                )}

                {editable && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveAuth}
                      disabled={savingAuth}
                      className="px-4 py-[9px] rounded-md text-[13px] font-semibold cursor-pointer border-0"
                      style={{ background: "var(--qz-accent)", color: "var(--qz-fg-on-accent)", opacity: savingAuth ? 0.7 : 1 }}
                    >
                      {savingAuth ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "tacacs" && (
              <ProtocolPanel
                key="tacacs"
                protocol="tacacs"
                doc={doc}
                editable={editable}
                onToast={setToast}
                onReload={() => load("refresh")}
                onAddServer={() => setServerModal({ protocol: "tacacs" })}
                onEditServer={(s) => setServerModal({ protocol: "tacacs", server: s })}
              />
            )}

            {tab === "radius" && (
              <ProtocolPanel
                key="radius"
                protocol="radius"
                doc={doc}
                editable={editable}
                onToast={setToast}
                onReload={() => load("refresh")}
                onAddServer={() => setServerModal({ protocol: "radius" })}
                onEditServer={(s) => setServerModal({ protocol: "radius", server: s })}
              />
            )}
          </div>
        )}
      </div>

      {serverModal && doc && (
        <AaaServerFormModal
          protocol={serverModal.protocol}
          initial={serverModal.server}
          existingAddresses={(serverModal.protocol === "tacacs" ? doc.tacacs : doc.radius).servers.map(
            (s) => s.address,
          )}
          onClose={() => setServerModal(null)}
          onSaved={(msg) => {
            setServerModal(null);
            setToast(msg);
            load("refresh");
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast("")} />}
    </div>
  );
}

/// /security/aaa only exists in the QuartzSONiC nav; render nothing for
/// other products.
export default function AaaPage() {
  const product = useDeviceProduct();
  if (product === null) return null;
  return product === "quartzsonic" ? <SonicAaaPage /> : null;
}
