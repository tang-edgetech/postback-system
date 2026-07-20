import { SimpleEntityManager } from "@/components/dashboard/simple-entity-manager";

export default function MerchantsPage() {
  return <SimpleEntityManager title="Merchants" apiPath="/v1/tenants" entityLabel="Merchant" permissionPrefix="merchants" />;
}
