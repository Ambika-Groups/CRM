import { InvoiceForm } from "@/components/billing/InvoiceForm";

export const metadata = { title: "Change bill" };

export default function Page() {
  return <InvoiceForm mode="edit" />;
}
