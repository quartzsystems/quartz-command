-- Device allocation to sub-organizations. Devices always belong to the
-- top-level organization (org_id, which enrollment tokens are issued under);
-- sub_org_id records which sub-organization the device is allocated to, NULL
-- meaning it sits in the parent org's unallocated pool. Deleting a sub-org
-- returns its devices to that pool rather than deleting them.
ALTER TABLE devices
    ADD COLUMN sub_org_id uuid
        REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX devices_sub_org_idx
    ON devices (sub_org_id)
    WHERE sub_org_id IS NOT NULL;

-- Enrollment tokens can be scoped to a sub-organization ("Add device" from a
-- sub-org's inventory); devices enrolled through such a token are allocated
-- to that sub-organization on adoption.
ALTER TABLE enrollment_tokens
    ADD COLUMN sub_org_id uuid
        REFERENCES organizations(id) ON DELETE SET NULL;
