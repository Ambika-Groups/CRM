import { ExpenseForm } from "@/components/expenses/ExpenseForm";

export const metadata = { title: "Change expense" };

export default function Page() {
  return <ExpenseForm mode="edit" />;
}
