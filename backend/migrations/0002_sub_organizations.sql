-- Sub-organizations: an organization may sit under a parent organization.
-- Access to a sub-organization derives from membership in the parent, so no
-- membership rows are needed for sub-orgs; deleting a parent cascades away its
-- sub-organizations.
ALTER TABLE organizations
    ADD COLUMN parent_organization_id uuid
        REFERENCES organizations(id) ON DELETE CASCADE;

-- Sub-organizations of a given parent.
CREATE INDEX organizations_parent_idx
    ON organizations (parent_organization_id)
    WHERE parent_organization_id IS NOT NULL;
