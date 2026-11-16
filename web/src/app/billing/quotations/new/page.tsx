import { QuotationForm } from "@/components/billing/QuotationForm";

export const metadata = { title: "New quotation" };

export default function Page() {
  return <QuotationForm mode="new" />;
}
