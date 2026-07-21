-- Product lines. Quartz Command now manages QuartzSONiC switch agents
-- alongside QuartzFire firewalls. The enrollment token carries the product
-- line ("Add device" under a product's inventory view creates a token for
-- that product); adoption stamps it onto the device row and picks the
-- device-ID prefix (QF- / QS-). Every pre-existing row is a QuartzFire.
ALTER TABLE enrollment_tokens
    ADD COLUMN product text NOT NULL DEFAULT 'quartzfire'
        CHECK (product IN ('quartzfire', 'quartzsonic'));

ALTER TABLE devices
    ADD COLUMN product text NOT NULL DEFAULT 'quartzfire'
        CHECK (product IN ('quartzfire', 'quartzsonic'));
