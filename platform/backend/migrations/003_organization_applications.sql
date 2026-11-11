BEGIN;
CREATE TABLE IF NOT EXISTS organization_applications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name VARCHAR(180) NOT NULL,
 organization_type VARCHAR(30) NOT NULL CHECK (organization_type IN ('College','Company','Club','Other')),
 contact_name VARCHAR(140) NOT NULL,
 email VARCHAR(254) NOT NULL,
 phone VARCHAR(30) NOT NULL,
 website VARCHAR(300),
 description VARCHAR(2000),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
 reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_applications_status_created ON organization_applications(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_applications_email ON organization_applications(lower(email));
COMMIT;
