import { InvoiceForm } from "@/components/billing/InvoiceForm";

export const metadata = { title: "New bill" };

export default function Page() {
  return <InvoiceForm mode="new" />;
}
