import Link from "next/link";
import { SignIn } from "@shared/SignIn";

export const metadata = { title: "Sign in" };

// No join link: a builder seat arrives when a project makes you its PM or GC,
// so there is nothing to sign up for (doors.ts, NOT_SELF_SERVE).
export default function LoginPage() {
  return <SignIn home="/" footer={<Link href="https://greenbergen.vercel.app">The owner portal</Link>} />;
}
