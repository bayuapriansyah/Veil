'use client';

import { PageHeader } from '@/components/ui';
import { AuditConsole } from '@/components/audit-panel';

export default function AuditPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        title="Audit"
        sub="The register stores only public facts (txId · commitment · status banners). Amounts, agents and evidence are sealed with AES-256-GCM and opened only to auditors whose signed AuditAccess recovers to an authorized address."
      />
      <AuditConsole />
    </div>
  );
}