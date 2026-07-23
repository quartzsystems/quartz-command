"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Combine, LucideIcon, Network } from "lucide-react";
import { useCloudOrg } from "@/components/CloudShell";

interface FeatureCard {
  href: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

/// Landing page of the sub-organization Configure section. Per-device
/// configuration lives on each device (sidebar → switch → Configure); this
/// scope holds the features that span devices — today the High Availability
/// pair features, which need two switches selected to mean anything.
export default function SubOrgConfigurePage() {
  const params = useParams<{ organization_guid: string; sub_guid: string }>();
  const base = `/cloud/${params.organization_guid}/orgs/${params.sub_guid}/configure`;

  const { subs, devices } = useCloudOrg();
  const sub = subs?.find((s) => s.id === params.sub_guid);
  const switches = (devices ?? []).filter(
    (d) => d.sub_org_id === params.sub_guid && d.product === "quartzsonic" && d.state === "adopted",
  );

  const cards: FeatureCard[] = [
    {
      href: `${base}/high-availability/mclag`,
      label: "MCLAG",
      icon: Combine,
      blurb:
        "Pair two switches into an MCLAG domain so downstream devices dual-home over one port channel.",
    },
    {
      href: `${base}/high-availability/vrrp`,
      label: "VRRP",
      icon: Network,
      blurb:
        "Define virtual gateway addresses across a switch pair — one master, one backup per group.",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-[36px] pt-[28px] pb-5 flex-shrink-0">
        <h1 className="text-[28px] font-bold text-[var(--qz-fg-1)] m-0" style={{ letterSpacing: "-0.015em" }}>
          Configure
        </h1>
        <p className="text-[13px] text-[var(--qz-fg-4)] mt-1">
          {sub ? `Fleet-level configuration for ${sub.name}` : "Fleet-level configuration"}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-[36px] pb-[28px] flex flex-col gap-5">
        <p className="text-[13px] text-[var(--qz-fg-3)] m-0 max-w-[640px]">
          Features here span more than one device. High Availability pairs two
          switches — select a switch in the sidebar for its single-device
          configuration instead.
        </p>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", maxWidth: 720 }}>
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-xl p-5 no-underline transition-all duration-[120ms] hover:border-[var(--qz-accent)]"
                style={{ background: "var(--qz-surface)", border: "1px solid var(--qz-border)" }}
              >
                <div className="flex items-center gap-2 text-[var(--qz-fg-1)]">
                  <Icon size={17} className="text-[var(--qz-accent)]" />
                  <span className="text-[14.5px] font-semibold">{card.label}</span>
                </div>
                <p className="text-[12.5px] text-[var(--qz-fg-3)] m-0 mt-2">{card.blurb}</p>
              </Link>
            );
          })}
        </div>

        {devices !== null && switches.length < 2 && (
          <p className="text-[12.5px] text-[var(--qz-fg-4)] m-0 max-w-[640px]">
            {switches.length === 0
              ? "This sub-organization has no adopted QuartzSONiC switches yet — allocate at least two under Inventory to use High Availability."
              : "Only one QuartzSONiC switch is adopted here — High Availability needs a second switch to pair with."}
          </p>
        )}
      </div>
    </div>
  );
}
