-- Folders group the firewalls allocated to a sub-organization (e.g. by location
-- or branch). A folder belongs to exactly one sub-organization; deleting the
-- sub-organization cascades its folders away, and deleting a folder returns its
-- devices to the sub-org's ungrouped pool (the devices.folder_id FK is
-- ON DELETE SET NULL). Folders are purely organizational and never change a
-- device's allocation (devices.sub_org_id).
CREATE TABLE device_folders (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_folders_sub_org_idx ON device_folders (sub_org_id);
-- Folder names are unique within a sub-organization (case-insensitive).
CREATE UNIQUE INDEX device_folders_sub_org_name_idx
    ON device_folders (sub_org_id, lower(name));

-- Which folder a device sits in; NULL = ungrouped. The folder must always
-- belong to the device's current sub-organization (enforced in the handlers);
-- moving or deallocating a device clears folder_id.
ALTER TABLE devices
    ADD COLUMN folder_id uuid
        REFERENCES device_folders(id) ON DELETE SET NULL;
