BEGIN;
INSERT INTO roles(name) VALUES ('Organization Admin') ON CONFLICT (name) DO NOTHING;
INSERT INTO organization_roles(organization_id,role_key,name,description,permissions,is_system)
SELECT id,'organization_admin','Organization Admin','Administrator for this organisation only.','["organization:read","organization:manage"]'::jsonb,true
FROM organizations ON CONFLICT (organization_id,role_key) DO NOTHING;
CREATE TABLE IF NOT EXISTS organization_admin_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 email VARCHAR(254) NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 accepted_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_admin_invites_org ON organization_admin_invitations(organization_id,created_at DESC);
COMMIT;
