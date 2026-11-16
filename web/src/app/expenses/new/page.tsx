import { ExpenseForm } from "@/components/expenses/ExpenseForm";

export const metadata = { title: "Add expense" };

export default function Page() {
  return <ExpenseForm mode="new" />;
}
