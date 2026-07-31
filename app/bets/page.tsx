import { BetCouponApp } from "@/components/bets/bet-coupon-app";

export const metadata = {
  title: "Bets — tracking coupon",
};

export default function BetsPage() {
  return (
    <main style={{ maxWidth: "72rem", margin: "0 auto", padding: "1rem" }}>
      <BetCouponApp />
    </main>
  );
}
