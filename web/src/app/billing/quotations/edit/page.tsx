import { QuotationForm } from "@/components/billing/QuotationForm";

export const metadata = { title: "Change quotation" };

export default function Page() {
  return <QuotationForm mode="edit" />;
}
