import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

/** Registers FT settlement listener for this serverless instance. */
export default function BetsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureBetSettlementRegistered();
  return children;
}
