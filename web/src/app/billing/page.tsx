import { BillingPage } from "@/components/billing/BillingPage";

export const metadata = { title: "Quotes & bills" };

export default function Page() {
  return <BillingPage tab="invoices" />;
}
