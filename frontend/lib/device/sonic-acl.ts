// Data layer for ACLs on QuartzSONiC switches, fetched live through the
// device proxy against the agent's management API (quartz-sonic
// src/mgmtapi.rs). The agent maps these documents onto the ACL_TABLE /
// ACL_RULE CONFIG_DB tables (rule key "table|RULE_<priority>", matches as
// SRC_IP / DST_IP / IP_PROTOCOL / L4_SRC_PORT(_RANGE) / L4_DST_PORT(_RANGE),
// action PACKET_ACTION FORWARD|DROP). Keep these shapes in step with
// quartz-sonic — the agent is the source of truth for the contract.

import { apiFetch } from "@/lib/device/api";
import { FeatureCapability } from "@/lib/device/sonic-features";

/** ACL_TABLE TYPE — which header fields rules in the table may match. */
export type AclTableType = "L3" | "L3V6" | "MAC";
export type AclStage = "ingress" | "egress";
export type AclAction = "forward" | "drop";

export interface AclRule {
  /** ACL_RULE PRIORITY — higher wins; doubles as the rule's identity within
   *  its table (the agent names rows RULE_<priority>). */
  priority: number;
  action: AclAction;
  description: string | null;
  /** Source CIDR (L3/L3V6) or MAC (MAC tables); null = any. */
  src: string | null;
  /** Destination, same forms as src; null = any. */
  dst: string | null;
  /** "tcp" | "udp" | "icmp" | IP protocol number as string; null = any.
   *  L3/L3V6 only. */
  protocol: string | null;
  /** L4 source port "22" or range "1024-65535"; null = any. tcp/udp only. */
  src_port: string | null;
  dst_port: string | null;
}

export interface AclTable {
  name: string;
  type: AclTableType;
  stage: AclStage;
  description: string | null;
  /** Bound interfaces: port, port-channel, or VLAN names. */
  ports: string[];
  /** Sorted by priority descending (match order). */
  rules: AclRule[];
}

export interface AclsDoc {
  capability: FeatureCapability;
  tables: AclTable[];
}

export async function fetchAcls(): Promise<AclsDoc> {
  return apiFetch<AclsDoc>("/security/acls");
}

export interface AclTableInput {
  type: AclTableType;
  stage: AclStage;
  description: string | null;
  ports: string[];
}

export async function createAclTable(name: string, input: AclTableInput): Promise<void> {
  await apiFetch("/security/acls", {
    method: "POST",
    body: JSON.stringify({ name, ...input }),
  });
}

/** `type` is immutable after creation — the agent rejects changing it. */
export async function updateAclTable(name: string, input: AclTableInput): Promise<void> {
  await apiFetch(`/security/acls/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Deletes the table and all its rules. */
export async function deleteAclTable(name: string): Promise<void> {
  await apiFetch(`/security/acls/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** Upsert one rule (keyed by rule.priority) in `table`. */
export async function putAclRule(table: string, rule: AclRule): Promise<void> {
  await apiFetch(
    `/security/acls/${encodeURIComponent(table)}/rules/${rule.priority}`,
    { method: "PUT", body: JSON.stringify(rule) },
  );
}

export async function deleteAclRule(table: string, priority: number): Promise<void> {
  await apiFetch(`/security/acls/${encodeURIComponent(table)}/rules/${priority}`, {
    method: "DELETE",
  });
}
